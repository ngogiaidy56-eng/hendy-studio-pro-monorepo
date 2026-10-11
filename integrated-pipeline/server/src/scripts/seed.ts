import bcrypt from 'bcryptjs';
import { pool } from '../db/postgres.js';
import { config } from '../config.js';

const permissions = [
  ['users:read', 'users'],
  ['users:manage', 'users'],
  ['roles:manage', 'roles'],
  ['audit:read', 'audit'],
  ['config:manage', 'config'],
  ['projects:read:any', 'projects'],
  ['subscriptions:read', 'subscriptions'],
  ['release:manage', 'releases'],
  ['release:read', 'releases'],
] as const;
const roles = [
  ['admin', 'Full administrator access'],
  ['developer', 'Engineering and configuration access'],
  ['support', 'Customer support read access'],
  ['user', 'Standard studio account'],
] as const;
const grants: Record<string, readonly string[]> = {
  admin: permissions.map(([code]) => code),
  developer: ['audit:read', 'config:manage', 'projects:read:any', 'release:read'],
  support: ['users:read', 'subscriptions:read'],
  user: [],
};

const client = await pool.connect();
try {
  // A transaction must use a single checked-out connection; pool.query() does not pin it.
  await client.query('BEGIN');
  for (const [code, module] of permissions) {
    await client.query(
      'INSERT INTO permissions(action_code,module) VALUES($1,$2) ON CONFLICT(action_code) DO NOTHING',
      [code, module],
    );
  }
  for (const [name, description] of roles) {
    await client.query(
      'INSERT INTO roles(name,description) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET description=EXCLUDED.description',
      [name, description],
    );
  }
  for (const [role, codes] of Object.entries(grants)) {
    for (const code of codes) {
      await client.query(
        `INSERT INTO role_permissions(role_id,permission_id)
         SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
         WHERE r.name=$1 AND p.action_code=$2 ON CONFLICT DO NOTHING`,
        [role, code],
      );
    }
  }
  if (config.ADMIN_EMAIL && config.ADMIN_PASSWORD) {
    const email = config.ADMIN_EMAIL.toLowerCase().trim();
    const placeholder = /change-this|replace-with|dev_only|placeholder|example\.(com|net|org)|@local\.test/i;
    if (placeholder.test(email) || placeholder.test(config.ADMIN_PASSWORD)) {
      throw new Error('Refusing to seed an administrator with example/placeholder credentials; set a real ADMIN_EMAIL and unique ADMIN_PASSWORD in .env first.');
    }
    if (config.ADMIN_PASSWORD.length < (config.NODE_ENV === 'production' ? 16 : 12)
      || Buffer.byteLength(config.ADMIN_PASSWORD, 'utf8') > 72) {
      throw new Error(`ADMIN_PASSWORD must be at least ${config.NODE_ENV === 'production' ? 16 : 12} characters and at most 72 UTF-8 bytes`);
    }
    const hash = await bcrypt.hash(config.ADMIN_PASSWORD, 12);
    const admin = await client.query(
      `INSERT INTO users(email,password_hash,status,tier)
       VALUES($1,$2,'active','enterprise')
       ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email
       RETURNING id`,
      [email, hash],
    );
    await client.query(
      `INSERT INTO user_roles(user_id,role_id)
       SELECT $1,id FROM roles WHERE name='admin' ON CONFLICT DO NOTHING`,
      [admin.rows[0].id],
    );
    console.log(`Admin ensured: ${email} (existing password is intentionally not overwritten)`);
  }
  await client.query('COMMIT');
  console.log('Roles and permissions seeded atomically');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
