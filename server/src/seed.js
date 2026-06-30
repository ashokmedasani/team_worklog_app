import crypto from 'crypto';
import { closeDb, db, initDb } from './db.js';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

await initDb();

const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
const rootUsername = process.env.ROOT_USERNAME || 'root';
const rootPassword = process.env.ROOT_PASSWORD || 'root12345';
const resetRootPassword = process.env.RESET_ROOT_PASSWORD === 'true';

async function findUser(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

async function createAdmin(username, displayName, password) {
  await db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role, active)
    VALUES (?, ?, ?, 'Admin', 1)
  `).run(username, displayName, hashPassword(password));
}

const existingAdmin = Number((await db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'Admin'").get()).count);

if (!existingAdmin) {
  await createAdmin(defaultAdminUsername, 'System Admin', defaultAdminPassword);
  console.log(`Default admin created: username ${defaultAdminUsername}`);
} else {
  console.log('Admin user already exists.');
}

const rootUser = await findUser(rootUsername);

if (!rootUser) {
  await createAdmin(rootUsername, 'Root Admin', rootPassword);
  console.log(`Root admin created: username ${rootUsername}`);
} else if (resetRootPassword) {
  await db.prepare(`
    UPDATE users
    SET password_hash = ?, role = 'Admin', active = 1, updated_at = ?
    WHERE username = ?
  `).run(hashPassword(rootPassword), new Date().toISOString(), rootUsername);
  console.log(`Root admin password reset: username ${rootUsername}`);
} else {
  console.log(`Root admin already exists: username ${rootUsername}`);
}

await closeDb();
console.log('Database ready.');
