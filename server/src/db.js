import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import initSqlJs from 'sql.js';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDbPath = path.join(__dirname, '..', 'db', 'team_worklog.sqlite');
const dbPath = process.env.DATABASE_PATH || defaultDbPath;
const databaseUrl = process.env.DATABASE_URL || '';
const usePostgres = Boolean(databaseUrl);

class PersistedSqlite {
  constructor(filename, SQL) {
    this.filename = filename;
    this.inTransaction = false;
    const bytes = fs.existsSync(filename) ? fs.readFileSync(filename) : null;
    this.sqlite = bytes ? new SQL.Database(bytes) : new SQL.Database();
  }

  async pragma(sql) {
    await this.exec(`PRAGMA ${sql}`);
  }

  async exec(sql) {
    this.sqlite.exec(sql);
    if (isMutating(sql)) this.persist();
  }

  prepare(sql) {
    return new SqliteStatement(this, sql);
  }

  persist() {
    fs.writeFileSync(this.filename, Buffer.from(this.sqlite.export()));
  }

  async close() {
    this.persist();
    this.sqlite.close();
  }
}

class SqliteStatement {
  constructor(parent, sql) {
    this.parent = parent;
    this.sql = sql;
  }

  async run(...args) {
    const stmt = this.parent.sqlite.prepare(this.sql);
    bindSqlite(stmt, args);
    stmt.step();
    stmt.free();
    if (isMutating(this.sql) && !this.parent.inTransaction) this.parent.persist();
    return {
      changes: this.parent.sqlite.getRowsModified(),
      lastInsertRowid: Number(this.parent.sqlite.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0] || 0)
    };
  }

  async get(...args) {
    const stmt = this.parent.sqlite.prepare(this.sql);
    bindSqlite(stmt, args);
    const row = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.free();
    return row;
  }

  async all(...args) {
    const stmt = this.parent.sqlite.prepare(this.sql);
    bindSqlite(stmt, args);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
}

class PostgresDb {
  constructor(url) {
    this.pool = new Pool({
      connectionString: url,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
    });
  }

  async pragma() {
    return undefined;
  }

  async exec(sql) {
    const statements = splitSqlStatements(toPostgresSchema(sql));
    for (const statement of statements) {
      await this.pool.query(statement);
    }
  }

  prepare(sql) {
    return new PostgresStatement(this.pool, sql);
  }

  async close() {
    await this.pool.end();
  }
}

class PostgresStatement {
  constructor(pool, sql) {
    this.pool = pool;
    this.sql = sql;
  }

  async run(...args) {
    const { text, values } = normalizePostgresQuery(this.sql, args);
    const result = await this.pool.query(text, values);
    return { changes: result.rowCount, lastInsertRowid: result.rows?.[0]?.id || 0 };
  }

  async get(...args) {
    const { text, values } = normalizePostgresQuery(this.sql, args);
    const result = await this.pool.query(text, values);
    return result.rows[0];
  }

  async all(...args) {
    const { text, values } = normalizePostgresQuery(this.sql, args);
    const result = await this.pool.query(text, values);
    return result.rows;
  }
}

function bindSqlite(stmt, args) {
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

function normalizePostgresQuery(sql, args) {
  let text = sql;
  const values = [];
  const firstArg = args[0];

  if (args.length === 1 && typeof firstArg === 'object' && !Array.isArray(firstArg) && firstArg !== null) {
    const seen = new Map();
    text = text.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name) => {
      if (!seen.has(name)) {
        values.push(firstArg[name]);
        seen.set(name, values.length);
      }
      return `$${seen.get(name)}`;
    });
    text = text.replace(/\$(\d+) = ''/g, (_match, index) => `$${index}::text = ''`);
    text = text.replace(/((?:[a-zA-Z_][a-zA-Z0-9_]*\.)?(?:id|project_id|task_id)) = \$(\d+)/g, (_match, column, index) => {
      return `${column} = NULLIF($${index}::text, '')::integer`;
    });
    return { text, values };
  }

  values.push(...args);
  let index = 0;
  text = text.replace(/\?/g, () => `$${++index}`);
  return { text, values };
}

function splitSqlStatements(sql) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function toPostgresSchema(sql) {
  return sql
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY')
    .replace(/TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP/gi, 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP')
    .replace(/TEXT DEFAULT CURRENT_TIMESTAMP/gi, 'TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP');
}

function isMutating(sql) {
  return /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|BEGIN|COMMIT|ROLLBACK|PRAGMA)/i.test(sql);
}

async function createDb() {
  if (usePostgres) return new PostgresDb(databaseUrl);

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const SQL = await initSqlJs();
  return new PersistedSqlite(dbPath, SQL);
}

export const db = await createDb();
await db.pragma('foreign_keys = ON');

export async function initDb() {
  await resetOldPrototypeSchema();
  await db.exec(`
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
  await migrateProjectMembers();
}

async function resetOldPrototypeSchema() {
  if (usePostgres) {
    const taskProjectColumn = await db.prepare(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'tasks' AND column_name = 'project_id'
    `).get();
    const taskTable = await db.prepare(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'tasks'
    `).get();

    if (taskTable && !taskProjectColumn) {
      await db.exec(`
        DROP TABLE IF EXISTS notes;
        DROP TABLE IF EXISTS work_logs;
        DROP TABLE IF EXISTS tasks;
        DROP TABLE IF EXISTS project_members;
        DROP TABLE IF EXISTS projects;
      `);
    }
    return;
  }

  const taskColumns = await db.prepare('PRAGMA table_info(tasks)').all();
  if (taskColumns.length && !taskColumns.some((column) => column.name === 'project_id')) {
    await db.exec(`
      DROP TABLE IF EXISTS notes;
      DROP TABLE IF EXISTS work_logs;
      DROP TABLE IF EXISTS tasks;
      DROP TABLE IF EXISTS project_members;
      DROP TABLE IF EXISTS projects;
    `);
  }
}

async function migrateProjectMembers() {
  if (usePostgres) {
    const column = await db.prepare(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'project_members' AND column_name = 'access_level'
    `).get();

    if (!column) {
      await db.exec("ALTER TABLE project_members ADD COLUMN access_level TEXT NOT NULL DEFAULT 'Employee'");
    }
    return;
  }

  const columns = await db.prepare('PRAGMA table_info(project_members)').all();
  if (columns.length && !columns.some((column) => column.name === 'access_level')) {
    await db.exec("ALTER TABLE project_members ADD COLUMN access_level TEXT NOT NULL DEFAULT 'Employee'");
  }
}

export function now() {
  return new Date().toISOString();
}

export async function closeDb() {
  await db.close();
}
