import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from '../db/postgres.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { writeAudit } from '../services/audit.js';

export const adminRouter = Router();
adminRouter.use(requireAuth);
const ADMIN_MUTATION_LOCK = 7261802027;

adminRouter.get('/users', requirePermission('users:read'), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const result = await pool.query(
      `SELECT u.id,u.email,u.status,u.tier,u.created_at,
       COALESCE(array_agg(DISTINCT ro.name) FILTER(WHERE ro.name IS NOT NULL),'{}') AS roles
       FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id
       LEFT JOIN roles ro ON ro.id=ur.role_id GROUP BY u.id
       ORDER BY u.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset],
    );
    res.json({ users: result.rows, limit, offset });
  } catch (error) { next(error); }
});

adminRouter.patch('/users/:id/status', requirePermission('users:manage'), async (req, res, next) => {
  const parsed = z.object({ status: z.enum(['active', 'suspended', 'pending']) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid status' }); return; }
  if (req.params.id === req.auth!.sub) { res.status(400).json({ error: 'You cannot change your own account status' }); return; }
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // All status and role mutations take this same advisory lock, preventing a race that could disable all admins.
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_MUTATION_LOCK]);
    const old = await client.query(
      `SELECT u.id,u.email,u.status,u.tier,
       EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name='admin') AS is_admin
       FROM users u WHERE u.id=$1 FOR UPDATE`, [req.params.id],
    );
    if (!old.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'User not found' }); return; }
    const target = old.rows[0];
    if (target.is_admin && target.status === 'active' && parsed.data.status !== 'active') {
      const activeAdmins = await client.query(
        `SELECT count(DISTINCT u.id)::int AS count FROM users u
         JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
         WHERE r.name='admin' AND u.status='active'`,
      );
      if (Number(activeAdmins.rows[0].count) <= 1) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Cannot suspend the last active administrator' });
        return;
      }
    }
    const updated = await client.query(
      'UPDATE users SET status=$2,updated_at=now() WHERE id=$1 RETURNING id,email,status,tier,updated_at',
      [req.params.id, parsed.data.status],
    );
    await writeAudit(req, 'user.status.updated', req.params.id, target, updated.rows[0], client);
    await client.query('COMMIT');
    res.json({ user: updated.rows[0] });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally { client?.release(); }
});

adminRouter.get('/audit-logs', requirePermission('audit:read'), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const result = await pool.query(
      `SELECT a.id,a.action,a.target_user_id,a.old_data,a.new_data,a.ip_address,a.created_at,u.email AS actor_email
       FROM audit_logs a LEFT JOIN users u ON u.id=a.admin_id
       ORDER BY a.created_at DESC LIMIT $1`, [limit],
    );
    res.json({ logs: result.rows });
  } catch (error) { next(error); }
});

adminRouter.get('/roles', requirePermission('roles:manage'), async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.id,r.name,r.description,
       COALESCE(array_agg(p.action_code) FILTER(WHERE p.action_code IS NOT NULL),'{}') AS permissions
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id
       LEFT JOIN permissions p ON p.id=rp.permission_id GROUP BY r.id ORDER BY r.name`,
    );
    res.json({ roles: result.rows });
  } catch (error) { next(error); }
});

adminRouter.get('/stats', requirePermission('users:read'), async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT count(*)::int AS total_users,
       count(*) FILTER(WHERE status='active')::int AS active_users,
       count(*) FILTER(WHERE status='suspended')::int AS suspended_users,
       count(*) FILTER(WHERE created_at >= now()-interval '7 days')::int AS new_users_7d FROM users`,
    );
    const plans = await pool.query('SELECT code,name,price_cents,currency,active FROM plans ORDER BY price_cents');
    res.json({ stats: result.rows[0], plans: plans.rows });
  } catch (error) { next(error); }
});

adminRouter.put('/users/:id/roles', requirePermission('roles:manage'), async (req, res, next) => {
  const parsed = z.object({ roles: z.array(z.string().trim().min(1).max(80)).min(1).max(10) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid role assignment', details: parsed.error.flatten() }); return; }
  if (req.params.id === req.auth!.sub) { res.status(400).json({ error: 'Self role changes are not allowed from this endpoint' }); return; }
  const names = [...new Set(parsed.data.roles)];
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_MUTATION_LOCK]);
    const target = await client.query('SELECT id,email,status,tier FROM users WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!target.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'User not found' }); return; }
    const found = await client.query('SELECT id,name FROM roles WHERE name=ANY($1::text[]) ORDER BY name', [names]);
    if (found.rowCount !== names.length) { await client.query('ROLLBACK'); res.status(400).json({ error: 'One or more role names do not exist' }); return; }
    const oldRoles = await client.query('SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 ORDER BY r.name', [req.params.id]);
    const oldNames: string[] = oldRoles.rows.map((row: { name: string }) => row.name);
    const targetIsActive = target.rows[0].status === 'active';
    if (targetIsActive && oldNames.includes('admin') && !names.includes('admin')) {
      const admins = await client.query(
        `SELECT count(DISTINCT ur.user_id)::int AS count FROM user_roles ur
         JOIN roles r ON r.id=ur.role_id JOIN users u ON u.id=ur.user_id
         WHERE r.name='admin' AND u.status='active'`,
      );
      if (Number(admins.rows[0].count) <= 1) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Cannot remove the last active administrator' });
        return;
      }
    }
    await client.query('DELETE FROM user_roles WHERE user_id=$1', [req.params.id]);
    await client.query(
      `INSERT INTO user_roles(user_id,role_id,assigned_by)
       SELECT $1,id,$2 FROM roles WHERE name=ANY($3::text[]) ON CONFLICT DO NOTHING`,
      [req.params.id, req.auth!.sub, names],
    );
    const sortedNames = [...names].sort();
    await writeAudit(req, 'user.roles.updated', req.params.id,
      { user: target.rows[0], roles: oldNames }, { user: target.rows[0], roles: sortedNames }, client);
    await client.query('COMMIT');
    res.json({ userId: req.params.id, roles: sortedNames });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally { client?.release(); }
});

const settingKey = z.string().trim().min(2).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
  .refine(key => !/(secret|token|password|credential|api.?key)/i.test(key), 'Do not store secrets in application settings');

function isSafeSettingTree(value: unknown, depth = 0): boolean {
  if (depth > 10) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 8192;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 500 && value.every(item => isSafeSettingTree(item, depth + 1));
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length <= 200 && entries.every(([key, item]) =>
      !/(secret|token|password|credential|api.?key|private.?key|access.?key)/i.test(key)
      && key.length <= 120 && isSafeSettingTree(item, depth + 1));
  }
  return false;
}

const settingValue = z.unknown().refine(value => {
  try {
    const json = JSON.stringify(value);
    return value !== undefined && json !== undefined && Buffer.byteLength(json) <= 65536 && isSafeSettingTree(value);
  } catch { return false; }
}, 'Setting value must be safe JSON, no larger than 64 KiB, without secret-like keys');

adminRouter.get('/settings', requirePermission('config:manage'), async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT key,value,updated_at AS "updatedAt",updated_by AS "updatedBy"
       FROM app_settings ORDER BY key LIMIT 200`,
    );
    res.json({ settings: result.rows });
  } catch (error) { next(error); }
});

adminRouter.put('/settings/:key', requirePermission('config:manage'), async (req, res, next) => {
  const key = settingKey.safeParse(req.params.key);
  const body = z.object({ value: settingValue }).strict().safeParse(req.body);
  if (!key.success || !body.success) {
    res.status(400).json({ error: 'Invalid setting key or value', details: body.success ? undefined : body.error.flatten() });
    return;
  }
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Serialize writes even if the key is not present yet; otherwise parallel first writes can audit stale state.
    await client.query('SELECT pg_advisory_xact_lock(42042, hashtext($1))', [key.data]);
    const before = await client.query('SELECT key,value FROM app_settings WHERE key=$1 FOR UPDATE', [key.data]);
    const result = await client.query(
      `INSERT INTO app_settings(key,value,updated_by,updated_at) VALUES($1,$2::jsonb,$3,now())
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING key,value,updated_at AS "updatedAt",updated_by AS "updatedBy"`,
      [key.data, JSON.stringify(body.data.value), req.auth!.sub],
    );
    await writeAudit(req, 'setting.updated', null, before.rows[0] ?? null, result.rows[0], client);
    await client.query('COMMIT');
    res.json({ setting: result.rows[0] });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally { client?.release(); }
});
