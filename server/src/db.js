import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import initSqlJs from 'sql.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDbPath = path.join(__dirname, '..', 'db', 'team_worklog.sqlite');
const dbPath = process.env.DATABASE_PATH || defaultDbPath;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const SQL = await initSqlJs();

class PersistedSqlite {
  constructor(filename) {
    this.filename = filename;
    this.inTransaction = false;
    const bytes = fs.existsSync(filename) ? fs.readFileSync(filename) : null;
    this.sqlite = bytes ? new SQL.Database(bytes) : new SQL.Database();
  }

  pragma(sql) {
    this.exec(`PRAGMA ${sql}`);
  }

  exec(sql) {
    this.sqlite.exec(sql);
    if (isMutating(sql)) this.persist();
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  transaction(fn) {
    return (...args) => {
      this.sqlite.exec('BEGIN');
      this.inTransaction = true;
      try {
        const result = fn(...args);
        this.sqlite.exec('COMMIT');
        this.inTransaction = false;
        this.persist();
        return result;
      } catch (error) {
        this.sqlite.exec('ROLLBACK');
        this.inTransaction = false;
        throw error;
      }
    };
  }

  persist() {
    fs.writeFileSync(this.filename, Buffer.from(this.sqlite.export()));
  }

  close() {
    this.persist();
    this.sqlite.close();
  }
}

class Statement {
  constructor(parent, sql) {
    this.parent = parent;
    this.sql = sql;
  }

  run(...args) {
    const stmt = this.parent.sqlite.prepare(this.sql);
    bind(stmt, args);
    stmt.step();
    stmt.free();
    if (isMutating(this.sql) && !this.parent.inTransaction) this.parent.persist();
    return {
      changes: this.parent.sqlite.getRowsModified(),
      lastInsertRowid: Number(this.parent.sqlite.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0] || 0)
    };
  }

  get(...args) {
    const stmt = this.parent.sqlite.prepare(this.sql);
    bind(stmt, args);
    const row = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.free();
    return row;
  }

  all(...args) {
    const stmt = this.parent.sqlite.prepare(this.sql);
    bind(stmt, args);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
}

function bind(stmt, args) {
  if (args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0]) && args[0] !== null) {
    stmt.bind(expandNamedParams(args[0]));
    return;
  }
  if (args.length) stmt.bind(args);
}

function expandNamedParams(params) {
  const expanded = {};
  Object.entries(params).forEach(([key, value]) => {
    expanded[key] = value;
    expanded[`@${key}`] = value;
    expanded[`$${key}`] = value;
    expanded[`:${key}`] = value;
  });
  return expanded;
}

function isMutating(sql) {
  return /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|BEGIN|COMMIT|ROLLBACK|PRAGMA)/i.test(sql);
}

export const db = new PersistedSqlite(dbPath);
db.pragma('foreign_keys = ON');

export function initDb() {
  resetOldPrototypeSchema();
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'On Hold', 'Completed', 'Archived')),
      start_date TEXT,
      due_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Employee' CHECK(role IN ('Admin', 'Manager', 'Employee')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT '',
      access_level TEXT NOT NULL DEFAULT 'Employee' CHECK(access_level IN ('Admin', 'Manager', 'Employee')),
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      assignee TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('Low', 'Medium', 'High')),
      status TEXT NOT NULL CHECK(status IN ('Pending', 'In Progress', 'Completed', 'Blocked')),
      due_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS work_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      work_description TEXT NOT NULL,
      time_minutes INTEGER NOT NULL DEFAULT 0,
      log_date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      note_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      actor TEXT NOT NULL DEFAULT 'Unknown',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      summary TEXT NOT NULL,
      details TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
    );
  `);
  migrateProjectMembers();
}

function resetOldPrototypeSchema() {
  const taskColumns = db.prepare("PRAGMA table_info(tasks)").all();
  if (taskColumns.length && !taskColumns.some((column) => column.name === 'project_id')) {
    db.exec(`
      DROP TABLE IF EXISTS notes;
      DROP TABLE IF EXISTS work_logs;
      DROP TABLE IF EXISTS tasks;
      DROP TABLE IF EXISTS project_members;
      DROP TABLE IF EXISTS projects;
    `);
  }
}

function migrateProjectMembers() {
  const columns = db.prepare("PRAGMA table_info(project_members)").all();
  if (columns.length && !columns.some((column) => column.name === 'access_level')) {
    db.exec("ALTER TABLE project_members ADD COLUMN access_level TEXT NOT NULL DEFAULT 'Employee'");
  }
}

export function now() {
  return new Date().toISOString();
}

export function closeDb() {
  db.close();
}
