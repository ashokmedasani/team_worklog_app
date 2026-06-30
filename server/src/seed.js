import crypto from 'crypto';
import { closeDb, db, initDb } from './db.js';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

await initDb();

const existingAdmin = Number((await db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'Admin'").get()).count);

if (!existingAdmin) {
  await db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role, active)
    VALUES (?, ?, ?, 'Admin', 1)
  `).run('admin', 'System Admin', hashPassword('admin123'));
  console.log('Default admin created: username admin, password admin123');
} else {
  console.log('Admin user already exists.');
}

await closeDb();
console.log('Database ready.');
