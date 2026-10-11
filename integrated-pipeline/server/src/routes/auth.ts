import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { pool } from '../db/postgres.js';
import { config } from '../config.js';
import { issueAccessToken } from '../utils/tokens.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimit, registerRateLimit } from '../middleware/rate-limit.js';

export const authRouter = Router();
const passwordSchema = z.string().min(8).max(128)
  .refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes');
const credentials = z.object({
  email: z.string().email().max(254).transform(value => value.toLowerCase().trim()),
  password: passwordSchema,
});
const registerCredentials = credentials.extend({
  password: z.string().min(12, 'Password must contain at least 12 characters').max(128)
    .refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes'),
});

authRouter.post('/register', registerRateLimit, async (req, res, next) => {
  const parsed = registerCredentials.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid registration details', details: parsed.error.flatten() });
    return;
  }
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { email, password } = parsed.data;
    const hash = await bcrypt.hash(password, 12);
    const result = await client.query(
      `INSERT INTO users(email,password_hash,status,tier)
       VALUES($1,$2,'active','free') ON CONFLICT(email) DO NOTHING
       RETURNING id,email,status,tier,created_at`, [email, hash],
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }
    const role = await client.query(
      `INSERT INTO user_roles(user_id,role_id)
       SELECT $1,id FROM roles WHERE name='user' ON CONFLICT DO NOTHING RETURNING user_id`,
      [result.rows[0].id],
    );
    if (!role.rowCount) throw new Error('Default user role is missing; run the database seed command first');
    await client.query('COMMIT');
    res.status(201).json({ user: result.rows[0] });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally { client?.release(); }
});

authRouter.post('/login', authRateLimit, async (req, res, next) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid email or password' }); return; }
  try {
    const { email, password } = parsed.data;
    const result = await pool.query(
      'SELECT id,email,password_hash,status,tier FROM users WHERE email=$1', [email],
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    if (user.status !== 'active') { res.status(403).json({ error: 'Account is not active' }); return; }
    const roles = await pool.query(
      'SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1', [user.id],
    );
    res.json({
      token: issueAccessToken({ sub: user.id, email: user.email }),
      tokenType: 'Bearer', expiresIn: config.JWT_TTL,
      user: { id: user.id, email: user.email, tier: user.tier, roles: roles.rows.map((row: { name: string }) => row.name) },
    });
  } catch (error) { next(error); }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id,u.email,u.status,u.tier,u.created_at,
       COALESCE(array_agg(DISTINCT ro.name) FILTER(WHERE ro.name IS NOT NULL),'{}') AS roles,
       COALESCE(array_agg(DISTINCT p.action_code) FILTER(WHERE p.action_code IS NOT NULL),'{}') AS permissions
       FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id
       LEFT JOIN roles ro ON ro.id=ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id=ro.id
       LEFT JOIN permissions p ON p.id=rp.permission_id
       WHERE u.id=$1 GROUP BY u.id`, [req.auth!.sub],
    );
    if (!result.rowCount) { res.status(401).json({ error: 'Account no longer exists' }); return; }
    res.json({ user: result.rows[0] });
  } catch (error) { next(error); }
});
