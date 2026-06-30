import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { Parser } from 'json2csv';
import { db, initDb, now } from './db.js';

initDb();

const app = express();
const port = Number(process.env.PORT || 5000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const appSecret = process.env.APP_SECRET || 'change-this-local-secret';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');
  if (!salt || !hash) return false;
  return hashPassword(password, salt) === storedHash;
}

function signToken(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', appSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', appSecret).update(payload).digest('base64url');
  if (signature !== expected) return null;
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function auth(req, res, next) {
  if (req.path === '/api/auth/login' || req.path === '/api/health') return next();
  if (!req.path.startsWith('/api')) return next();
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = readToken(token);
  if (!user) return res.status(401).json({ error: 'Please log in.' });
  req.user = user;
  next();
}

app.use(auth);

function actorName(req) {
  return req.user?.display_name || req.body?.actor || req.query.actor || req.headers['x-actor'] || 'Unknown';
}

function accessLevel(req) {
  return req.user?.role || req.headers['x-access-level'] || req.query.current_access_level || 'Employee';
}

function canManage(req) {
  return ['Admin', 'Manager'].includes(accessLevel(req));
}

function requireManager(req, res) {
  if (canManage(req)) return true;
  res.status(403).json({ error: 'Only Admin or Manager users can perform this action.' });
  return false;
}

function requireAdmin(req, res) {
  if (accessLevel(req) === 'Admin') return true;
  res.status(403).json({ error: 'Only Admin users can manage access and view admin logs.' });
  return false;
}

function isFirstProjectMember(projectId) {
  return db.prepare('SELECT COUNT(*) AS count FROM project_members WHERE project_id = ?').get(projectId).count === 0;
}

function logActivity({ projectId = null, actor = 'Unknown', action, entityType, entityId = null, summary, details = null }) {
  db.prepare(`
    INSERT INTO audit_logs (project_id, actor, action, entity_type, entity_id, summary, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(projectId || null, actor || 'Unknown', action, entityType, entityId, summary, details ? JSON.stringify(details) : '');
}

function publicUser(user) {
  if (!user) return null;
  const { password_hash, ...safeUser } = user;
  return safeUser;
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User is inactive or missing.' });
  res.json(publicUser(user));
});

app.get('/api/users', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const users = db.prepare('SELECT id, username, display_name, role, active, created_at, updated_at FROM users ORDER BY display_name ASC').all();
  res.json(users);
});

app.post('/api/users', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { username, display_name, password, role = 'Employee', active = 1 } = req.body;
  if (!username || !display_name || !password) return res.status(400).json({ error: 'Username, display name, and password are required.' });
  try {
    db.prepare(`
      INSERT INTO users (username, display_name, password_hash, role, active)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, display_name, hashPassword(password), role, active ? 1 : 0);
  } catch {
    return res.status(400).json({ error: 'Username already exists.' });
  }
  const user = db.prepare('SELECT id, username, display_name, role, active, created_at, updated_at FROM users ORDER BY id DESC LIMIT 1').get();
  logActivity({ actor: actorName(req), action: 'created', entityType: 'User', entityId: user.id, summary: `Created login user "${user.username}" as ${user.role}`, details: user });
  res.status(201).json(user);
});

app.put('/api/users/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { username, display_name, password, role = 'Employee', active = 1 } = req.body;
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users').all().find((row) => Number(row.id) === id);
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  const passwordHash = password ? hashPassword(password) : existing.password_hash;
  try {
    db.prepare(`
      UPDATE users
      SET username = ?, display_name = ?, password_hash = ?, role = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(username, display_name, passwordHash, role, active ? 1 : 0, now(), id);
  } catch {
    return res.status(400).json({ error: 'Username already exists.' });
  }
  const user = db.prepare('SELECT id, username, display_name, role, active, created_at, updated_at FROM users WHERE id = ?').get(id);
  logActivity({ actor: actorName(req), action: 'updated', entityType: 'User', entityId: user.id, summary: `Updated login user "${user.username}"`, details: user });
  res.json(user);
});

app.delete('/api/users/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (id === Number(req.user.id)) return res.status(400).json({ error: 'You cannot delete your own account while logged in.' });
  const user = db.prepare('SELECT id, username, display_name, role, active, created_at, updated_at FROM users').all().find((row) => Number(row.id) === id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  db.exec(`DELETE FROM users WHERE id = ${id}`);
  logActivity({ actor: actorName(req), action: 'deleted', entityType: 'User', entityId: user.id, summary: `Deleted login user "${user.username}"`, details: user });
  res.status(204).end();
});

app.get('/api/projects', (_req, res) => {
  res.json(db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all());
});

app.get('/api/audit-logs', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const rows = db.prepare(`
    SELECT audit_logs.*, projects.name AS project_name
    FROM audit_logs
    LEFT JOIN projects ON projects.id = audit_logs.project_id
    WHERE (@project_id = '' OR audit_logs.project_id = @project_id)
    ORDER BY audit_logs.created_at DESC
    LIMIT 200
  `).all({ project_id: req.query.project_id || '' });
  res.json(rows);
});

app.post('/api/projects', (req, res) => {
  const { name, description = '', status = 'Active', start_date = null, due_date = null } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required.' });
  if (!requireAdmin(req, res)) return;
  db.prepare(`
    INSERT INTO projects (name, description, status, start_date, due_date)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, description, status, start_date || null, due_date || null);
  const project = db.prepare('SELECT * FROM projects ORDER BY id DESC LIMIT 1').get();
  logActivity({ projectId: project.id, actor: actorName(req), action: 'created', entityType: 'Project', entityId: project.id, summary: `Created project "${project.name}"`, details: project });
  res.status(201).json(project);
});

app.put('/api/projects/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { name, description = '', status = 'Active', start_date = null, due_date = null } = req.body;
  const result = db.prepare(`
    UPDATE projects SET name = ?, description = ?, status = ?, start_date = ?, due_date = ?, updated_at = ?
    WHERE id = ?
  `).run(name, description, status, start_date || null, due_date || null, now(), req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Project not found.' });
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  logActivity({ projectId: project.id, actor: actorName(req), action: 'updated', entityType: 'Project', entityId: project.id, summary: `Updated project "${project.name}"`, details: project });
  res.json(project);
});

app.delete('/api/projects/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  const project = db.prepare('SELECT * FROM projects').all().find((row) => Number(row.id) === id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  const snapshot = {
    project,
    tasks: db.prepare('SELECT * FROM tasks').all().filter((row) => Number(row.project_id) === id),
    members: db.prepare('SELECT * FROM project_members').all().filter((row) => Number(row.project_id) === id)
  };
  db.exec(`DELETE FROM projects WHERE id = ${id}`);
  logActivity({ projectId: null, actor: actorName(req), action: 'deleted', entityType: 'Project', entityId: Number(req.params.id), summary: `Deleted project "${project.name}"`, details: snapshot });
  res.status(204).end();
});

app.get('/api/project-members', (req, res) => {
  const rows = db.prepare(`
    SELECT project_members.*, projects.name AS project_name
    FROM project_members
    JOIN projects ON projects.id = project_members.project_id
    WHERE (@project_id = '' OR project_members.project_id = @project_id)
    ORDER BY project_members.name ASC
  `).all({ project_id: req.query.project_id || '' });
  res.json(rows);
});

app.post('/api/project-members', (req, res) => {
  const { project_id, name, role = '', access_level = 'Employee', email = '', phone = '', notes = '' } = req.body;
  if (!project_id || !name) return res.status(400).json({ error: 'Project and member name are required.' });
  if (!requireAdmin(req, res)) return;
  db.prepare(`
    INSERT INTO project_members (project_id, name, role, access_level, email, phone, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(project_id, name, role, access_level, email, phone, notes);
  const member = db.prepare('SELECT * FROM project_members ORDER BY id DESC LIMIT 1').get();
  logActivity({ projectId: member.project_id, actor: actorName(req), action: 'created', entityType: 'Team Member', entityId: member.id, summary: `Added ${member.name} as ${member.access_level}`, details: member });
  res.status(201).json(member);
});

app.put('/api/project-members/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { project_id, name, role = '', access_level = 'Employee', email = '', phone = '', notes = '' } = req.body;
  const result = db.prepare(`
    UPDATE project_members
    SET project_id = ?, name = ?, role = ?, access_level = ?, email = ?, phone = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(project_id, name, role, access_level, email, phone, notes, now(), req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Team member not found.' });
  const member = db.prepare('SELECT * FROM project_members WHERE id = ?').get(req.params.id);
  logActivity({ projectId: member.project_id, actor: actorName(req), action: 'updated', entityType: 'Team Member', entityId: member.id, summary: `Updated ${member.name}`, details: member });
  res.json(member);
});

app.delete('/api/project-members/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  const member = db.prepare('SELECT * FROM project_members').all().find((row) => Number(row.id) === id);
  if (!member) return res.status(404).json({ error: 'Team member not found.' });
  db.exec(`DELETE FROM project_members WHERE id = ${id}`);
  logActivity({ projectId: member.project_id, actor: actorName(req), action: 'deleted', entityType: 'Team Member', entityId: member.id, summary: `Deleted team member "${member.name}"`, details: member });
  res.status(204).end();
});

app.get('/api/dashboard', (req, res) => {
  const projectId = req.query.project_id || '';
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'Blocked' THEN 1 ELSE 0 END) AS blocked
    FROM tasks
    WHERE (@project_id = '' OR project_id = @project_id)
  `).get({ project_id: projectId });

  const recentLogs = db.prepare(`
    SELECT work_logs.*, tasks.title AS task_title, projects.name AS project_name
    FROM work_logs
    JOIN tasks ON tasks.id = work_logs.task_id
    JOIN projects ON projects.id = tasks.project_id
    WHERE (@project_id = '' OR tasks.project_id = @project_id)
    ORDER BY work_logs.log_date DESC, work_logs.created_at DESC
    LIMIT 8
  `).all({ project_id: projectId });

  const hoursByMember = db.prepare(`
    SELECT author, SUM(time_minutes) AS minutes
    FROM work_logs
    JOIN tasks ON tasks.id = work_logs.task_id
    WHERE (@project_id = '' OR tasks.project_id = @project_id)
    GROUP BY author
    ORDER BY minutes DESC
  `).all({ project_id: projectId }).map((row) => ({ ...row, hours: Math.round((row.minutes / 60) * 100) / 100 }));

  const recentActivity = db.prepare(`
    SELECT 'Project' AS type, name AS label, status AS actor, description AS detail, updated_at AS activity_at FROM projects
    WHERE (@project_id = '' OR id = @project_id)
    UNION ALL
    SELECT 'Task' AS type, title AS label, assignee AS actor, status AS detail, updated_at AS activity_at FROM tasks
    WHERE (@project_id = '' OR project_id = @project_id)
    UNION ALL
    SELECT 'Work Log' AS type, tasks.title AS label, work_logs.author AS actor, work_logs.work_description AS detail, work_logs.updated_at AS activity_at
    FROM work_logs JOIN tasks ON tasks.id = work_logs.task_id
    WHERE (@project_id = '' OR tasks.project_id = @project_id)
    UNION ALL
    SELECT 'Note' AS type, tasks.title AS label, notes.author AS actor, notes.content AS detail, notes.updated_at AS activity_at
    FROM notes JOIN tasks ON tasks.id = notes.task_id
    WHERE (@project_id = '' OR tasks.project_id = @project_id)
    ORDER BY activity_at DESC
    LIMIT 10
  `).all({ project_id: projectId });

  res.json({ counts, recentLogs, hoursByMember, recentActivity });
});

app.get('/api/tasks', (req, res) => {
  const rows = db.prepare(`
    SELECT tasks.*, projects.name AS project_name
    FROM tasks
    JOIN projects ON projects.id = tasks.project_id
    WHERE (@project_id = '' OR tasks.project_id = @project_id)
    ORDER BY tasks.updated_at DESC
  `).all({ project_id: req.query.project_id || '' });
  res.json(rows);
});

app.post('/api/tasks', (req, res) => {
  const { project_id, title, description = '', assignee, priority, status, due_date = null } = req.body;
  if (!project_id || !title || !assignee || !priority || !status) {
    return res.status(400).json({ error: 'Project, title, assignee, priority, and status are required.' });
  }
  db.prepare(`
    INSERT INTO tasks (project_id, title, description, assignee, priority, status, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(project_id, title, description, assignee, priority, status, due_date || null);
  const task = db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 1').get();
  logActivity({ projectId: task.project_id, actor: actorName(req), action: 'created', entityType: 'Task', entityId: task.id, summary: `Created task "${task.title}"`, details: task });
  res.status(201).json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const { project_id, title, description = '', assignee, priority, status, due_date = null } = req.body;
  const result = db.prepare(`
    UPDATE tasks
    SET project_id = ?, title = ?, description = ?, assignee = ?, priority = ?, status = ?, due_date = ?, updated_at = ?
    WHERE id = ?
  `).run(project_id, title, description, assignee, priority, status, due_date || null, now(), req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Task not found.' });
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  logActivity({ projectId: task.project_id, actor: actorName(req), action: 'updated', entityType: 'Task', entityId: task.id, summary: `Updated task "${task.title}"`, details: task });
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  if (!requireManager(req, res)) return;
  const id = Number(req.params.id);
  const task = db.prepare('SELECT * FROM tasks').all().find((row) => Number(row.id) === id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const snapshot = {
    task,
    workLogs: db.prepare('SELECT * FROM work_logs').all().filter((row) => Number(row.task_id) === id),
    notes: db.prepare('SELECT * FROM notes').all().filter((row) => Number(row.task_id) === id)
  };
  db.exec(`DELETE FROM tasks WHERE id = ${id}`);
  logActivity({ projectId: task.project_id, actor: actorName(req), action: 'deleted', entityType: 'Task', entityId: task.id, summary: `Deleted task "${task.title}"`, details: snapshot });
  res.status(204).end();
});

app.get('/api/work-logs', (req, res) => {
  const rows = db.prepare(`
    SELECT work_logs.*, tasks.title AS task_title, projects.name AS project_name, tasks.project_id
    FROM work_logs
    JOIN tasks ON tasks.id = work_logs.task_id
    JOIN projects ON projects.id = tasks.project_id
    WHERE (@project_id = '' OR tasks.project_id = @project_id)
    ORDER BY log_date DESC, work_logs.updated_at DESC
  `).all({ project_id: req.query.project_id || '' });
  res.json(rows);
});

app.post('/api/work-logs', (req, res) => {
  const { task_id, author, work_description, time_spent, log_date, notes = '' } = req.body;
  if (!task_id || !author || !work_description || !log_date) {
    return res.status(400).json({ error: 'Task, author, work description, and date are required.' });
  }
  db.prepare(`
    INSERT INTO work_logs (task_id, author, work_description, time_minutes, log_date, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(task_id, author, work_description, parseTimeToMinutes(time_spent), log_date, notes);
  const log = db.prepare('SELECT * FROM work_logs ORDER BY id DESC LIMIT 1').get();
  const task = db.prepare('SELECT project_id, title FROM tasks WHERE id = ?').get(log.task_id);
  logActivity({ projectId: task?.project_id, actor: actorName(req), action: 'created', entityType: 'Work Log', entityId: log.id, summary: `Logged work on "${task?.title || 'Task'}"`, details: log });
  res.status(201).json(log);
});

app.put('/api/work-logs/:id', (req, res) => {
  const { task_id, author, work_description, time_spent, log_date, notes = '' } = req.body;
  const result = db.prepare(`
    UPDATE work_logs
    SET task_id = ?, author = ?, work_description = ?, time_minutes = ?, log_date = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(task_id, author, work_description, parseTimeToMinutes(time_spent), log_date, notes, now(), req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Work log not found.' });
  const log = db.prepare('SELECT * FROM work_logs WHERE id = ?').get(req.params.id);
  const task = db.prepare('SELECT project_id, title FROM tasks WHERE id = ?').get(log.task_id);
  logActivity({ projectId: task?.project_id, actor: actorName(req), action: 'updated', entityType: 'Work Log', entityId: log.id, summary: `Updated work log on "${task?.title || 'Task'}"`, details: log });
  res.json(log);
});

app.delete('/api/work-logs/:id', (req, res) => {
  if (!requireManager(req, res)) return;
  const id = Number(req.params.id);
  const log = db.prepare('SELECT * FROM work_logs').all().find((row) => Number(row.id) === id);
  if (!log) return res.status(404).json({ error: 'Work log not found.' });
  const task = db.prepare('SELECT project_id, title FROM tasks WHERE id = ?').get(log.task_id);
  db.exec(`DELETE FROM work_logs WHERE id = ${id}`);
  logActivity({ projectId: task?.project_id, actor: actorName(req), action: 'deleted', entityType: 'Work Log', entityId: log.id, summary: `Deleted work log on "${task?.title || 'Task'}"`, details: log });
  res.status(204).end();
});

app.get('/api/notes', (req, res) => {
  const rows = db.prepare(`
    SELECT notes.*, tasks.title AS task_title, projects.name AS project_name, tasks.project_id
    FROM notes
    JOIN tasks ON tasks.id = notes.task_id
    JOIN projects ON projects.id = tasks.project_id
    WHERE (@project_id = '' OR tasks.project_id = @project_id)
    ORDER BY note_date DESC, notes.updated_at DESC
  `).all({ project_id: req.query.project_id || '' });
  res.json(rows);
});

app.post('/api/notes', (req, res) => {
  const { task_id, author, content, note_date } = req.body;
  if (!task_id || !author || !content || !note_date) {
    return res.status(400).json({ error: 'Task, author, content, and date are required.' });
  }
  db.prepare('INSERT INTO notes (task_id, author, content, note_date) VALUES (?, ?, ?, ?)').run(task_id, author, content, note_date);
  const note = db.prepare('SELECT * FROM notes ORDER BY id DESC LIMIT 1').get();
  const task = db.prepare('SELECT project_id, title FROM tasks WHERE id = ?').get(note.task_id);
  logActivity({ projectId: task?.project_id, actor: actorName(req), action: 'created', entityType: 'Note', entityId: note.id, summary: `Added note on "${task?.title || 'Task'}"`, details: note });
  res.status(201).json(note);
});

app.put('/api/notes/:id', (req, res) => {
  const { task_id, author, content, note_date } = req.body;
  const result = db.prepare(`
    UPDATE notes SET task_id = ?, author = ?, content = ?, note_date = ?, updated_at = ?
    WHERE id = ?
  `).run(task_id, author, content, note_date, now(), req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Note not found.' });
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  const task = db.prepare('SELECT project_id, title FROM tasks WHERE id = ?').get(note.task_id);
  logActivity({ projectId: task?.project_id, actor: actorName(req), action: 'updated', entityType: 'Note', entityId: note.id, summary: `Updated note on "${task?.title || 'Task'}"`, details: note });
  res.json(note);
});

app.delete('/api/notes/:id', (req, res) => {
  if (!requireManager(req, res)) return;
  const id = Number(req.params.id);
  const note = db.prepare('SELECT * FROM notes').all().find((row) => Number(row.id) === id);
  if (!note) return res.status(404).json({ error: 'Note not found.' });
  const task = db.prepare('SELECT project_id, title FROM tasks WHERE id = ?').get(note.task_id);
  db.exec(`DELETE FROM notes WHERE id = ${id}`);
  logActivity({ projectId: task?.project_id, actor: actorName(req), action: 'deleted', entityType: 'Note', entityId: note.id, summary: `Deleted note on "${task?.title || 'Task'}"`, details: note });
  res.status(204).end();
});

app.get('/api/export/tasks.csv', (_req, res) => {
  const rows = db.prepare(`
    SELECT projects.name AS project_name, tasks.* FROM tasks
    JOIN projects ON projects.id = tasks.project_id
    ORDER BY tasks.created_at DESC
  `).all();
  const csv = new Parser().parse(rows);
  res.header('Content-Type', 'text/csv');
  res.attachment('tasks.csv');
  res.send(csv);
});

app.get('/api/export/work-logs.csv', (_req, res) => {
  const rows = db.prepare(`
    SELECT projects.name AS project_name, tasks.title AS task_title, work_logs.*
    FROM work_logs
    JOIN tasks ON tasks.id = work_logs.task_id
    JOIN projects ON projects.id = tasks.project_id
    ORDER BY log_date DESC
  `).all().map((row) => ({ ...row, time_spent: formatMinutes(row.time_minutes) }));
  const csv = new Parser().parse(rows);
  res.header('Content-Type', 'text/csv');
  res.attachment('work-logs.csv');
  res.send(csv);
});

function parseTimeToMinutes(value) {
  if (typeof value === 'number') return Math.round(value * 60);
  const input = String(value || '').trim().toLowerCase();
  if (!input) return 0;
  const hourMatch = input.match(/(\d+(?:\.\d+)?)\s*h/);
  const minuteMatch = input.match(/(\d+)\s*m/);
  if (hourMatch || minuteMatch) {
    return Math.round(Number(hourMatch?.[1] || 0) * 60) + Number(minuteMatch?.[1] || 0);
  }
  if (input.includes(':')) {
    const [hours, minutes = '0'] = input.split(':');
    return Number(hours || 0) * 60 + Number(minutes || 0);
  }
  return Math.round(Number(input || 0) * 60);
}

function formatMinutes(minutes) {
  const total = Number(minutes || 0);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours && mins) return `${hours}h${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Client build not found. Run npm run build first.');
  });
});

function listen(targetPort, didFallback = false) {
  const server = app.listen(targetPort, () => {
    const note = didFallback ? ' (port 5000 was busy)' : '';
    console.log(`Team Worklog app running on http://localhost:${targetPort}${note}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && !process.env.PORT && targetPort === 5000) {
      listen(5001, true);
      return;
    }
    console.error(error.message);
    process.exitCode = 1;
  });
}

listen(port);
