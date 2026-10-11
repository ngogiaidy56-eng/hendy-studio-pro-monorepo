import { Router } from 'express';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db/postgres.js';
import { requireAuth } from '../middleware/auth.js';
import { createDownloadUrl, createUploadUrl, deleteObject, safeObjectKey, verifyObject } from '../services/storage.js';
import { mongoDb } from '../db/mongo.js';
import { SYSTEM_CONFIG } from '@hendy/core-utils';

export const assetsRouter = Router();
assetsRouter.use(requireAuth);

const assetTypes = [
  'video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/wav',
  'application/x-subrip', 'text/plain', 'image/png', 'image/jpeg',
] as const;

assetsRouter.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id,object_key AS key,file_name AS name,content_type AS "contentType",size_bytes AS size,status,duration_seconds AS "durationSeconds",created_at AS "createdAt"
       FROM assets WHERE user_id=$1 AND status='uploaded' ORDER BY created_at DESC LIMIT 200`,
      [req.auth!.sub],
    );
    res.json({ assets: result.rows.map(row => ({ ...row, size: Number(row.size) })) });
  } catch (error) { next(error); }
});

assetsRouter.post('/presign', async (req, res, next) => {
  let client: PoolClient | undefined;
  try {
    const parsed = z.object({
      fileName: z.string().trim().min(1).max(180).refine(name => !(/[\/\\\u0000-\u001f\u007f]/u.test(name)), 'Filename cannot contain path separators or control characters'),
      contentType: z.enum(assetTypes),
      sizeBytes: z.number().int().positive().max(SYSTEM_CONFIG.media.maxUploadBytes),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid asset metadata', details: parsed.error.flatten() });
      return;
    }
    const { fileName, contentType, sizeBytes } = parsed.data;
    const extension = fileName.toLowerCase().split('.').pop() ?? '';
    if ((['application/x-subrip', 'text/plain'].includes(contentType) && ['srt', 'vtt', 'ass', 'txt'].includes(extension) && sizeBytes > SYSTEM_CONFIG.media.maxSubtitleBytes)
      || (['image/png', 'image/jpeg'].includes(contentType) && sizeBytes > SYSTEM_CONFIG.media.maxImageBytes)) {
      res.status(413).json({ error: 'Subtitle/text assets are limited to 10 MiB and images to 100 MiB' });
      return;
    }
    // Keep the original display name in PostgreSQL, but normalize the S3 key segment.
    const safeFileName = fileName.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+|\.+$/g, '').slice(0, 120) || 'asset';
    const objectKey = `users/${req.auth!.sub}/assets/${Date.now()}-${randomUUID()}-${safeFileName}`;
    if (!safeObjectKey(objectKey)) { res.status(400).json({ error: 'Unsafe asset key' }); return; }

    // Lock the owner row, so concurrent presign requests cannot exceed the storage-plan quota.
    client = await pool.connect();
    await client.query('BEGIN');
    const account = await client.query(
      `SELECT u.tier,COALESCE((p.features->>'maxStorageBytes')::bigint,
       CASE u.tier WHEN 'free' THEN 2147483648::bigint WHEN 'creator' THEN 53687091200::bigint
        WHEN 'studio' THEN 536870912000::bigint ELSE 2199023255552::bigint END) AS max_storage_bytes
       FROM users u LEFT JOIN plans p ON p.code=u.tier AND p.active=true
       WHERE u.id=$1 FOR UPDATE OF u`, [req.auth!.sub],
    );
    if (!account.rowCount) {
      await client.query('ROLLBACK');
      res.status(401).json({ error: 'Account not found' });
      return;
    }
    const usage = await client.query(
      `SELECT
         COALESCE((SELECT sum(size_bytes) FROM assets WHERE user_id=$1 AND status IN ('uploaded','pending','deleting')),0)::bigint
         + COALESCE((SELECT sum(size_bytes) FROM render_jobs WHERE user_id=$1 AND status IN ('completed','deleting')),0)::bigint AS used_bytes`,
      [req.auth!.sub],
    );
    const usedBytes = Number(usage.rows[0].used_bytes);
    const maxBytes = Number(account.rows[0].max_storage_bytes);
    if (!Number.isSafeInteger(usedBytes) || !Number.isSafeInteger(maxBytes) || usedBytes + sizeBytes > maxBytes) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Storage quota reached for this plan', tier: account.rows[0].tier, usedBytes, maxBytes, requestedBytes: sizeBytes });
      return;
    }

    const uploadUrl = await createUploadUrl(objectKey, contentType, sizeBytes);
    const saved = await client.query(
      `INSERT INTO assets(user_id,object_key,file_name,content_type,size_bytes,status)
       VALUES($1,$2,$3,$4,$5,'pending')
       RETURNING id,object_key AS key,file_name AS name,content_type AS "contentType",size_bytes AS size,status`,
      [req.auth!.sub, objectKey, fileName, contentType, sizeBytes],
    );
    await client.query('COMMIT');
    res.json({ uploadUrl, key: objectKey, asset: { ...saved.rows[0], size: Number(saved.rows[0].size) }, method: 'PUT', headers: { 'Content-Type': contentType }, expiresInSeconds: 300, storage: { usedBytes: usedBytes + sizeBytes, maxBytes } });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally { client?.release(); }
});

assetsRouter.post('/complete', async (req, res, next) => {
  try {
    const parsed = z.object({ key: z.string().min(1).max(500) }).safeParse(req.body);
    if (!parsed.success || !safeObjectKey(parsed.data?.key ?? '') || !parsed.data.key.startsWith(`users/${req.auth!.sub}/assets/`)) {
      res.status(400).json({ error: 'Invalid asset completion request' });
      return;
    }
    const asset = await pool.query(
      `SELECT id,size_bytes FROM assets WHERE user_id=$1 AND object_key=$2 AND status='pending'`,
      [req.auth!.sub, parsed.data.key],
    );
    if (!asset.rowCount) { res.status(404).json({ error: 'Pending asset not found' }); return; }
    let verified = false;
    try { verified = await verifyObject(parsed.data.key, Number(asset.rows[0].size_bytes)); }
    catch { verified = false; }
    if (!verified) { res.status(409).json({ error: 'Uploaded object does not match expected file size or cannot be verified' }); return; }
    // Complete only if cleanup/deletion has not already closed this pending upload.
    const updated = await pool.query(
      `UPDATE assets SET status='uploaded',updated_at=now() WHERE id=$1 AND user_id=$2 AND object_key=$3 AND status='pending'
       RETURNING id,object_key AS key,file_name AS name,content_type AS "contentType",size_bytes AS size,status,duration_seconds AS "durationSeconds",created_at AS "createdAt"`,
      [asset.rows[0].id, req.auth!.sub, parsed.data.key],
    );
    if (!updated.rowCount) { res.status(409).json({ error: 'Pending upload expired or was closed; request a new upload URL' }); return; }
    res.status(200).json({ asset: { ...updated.rows[0], size: Number(updated.rows[0].size) } });
  } catch (error) { next(error); }
});

assetsRouter.get('/download-url', async (req, res, next) => {
  try {
    const key = String(req.query.key ?? '');
    if (!safeObjectKey(key) || !key.startsWith(`users/${req.auth!.sub}/`) || (!key.includes('/assets/') && !key.includes('/renders/'))) {
      res.status(403).json({ error: 'Asset key is invalid or not owned by this account' });
      return;
    }
    const [asset, render] = await Promise.all([
      pool.query("SELECT 1 FROM assets WHERE user_id=$1 AND object_key=$2 AND status='uploaded' LIMIT 1", [req.auth!.sub, key]),
      pool.query("SELECT 1 FROM render_jobs WHERE user_id=$1 AND output_key=$2 AND status='completed' LIMIT 1", [req.auth!.sub, key]),
    ]);
    if (!asset.rowCount && !render.rowCount) { res.status(404).json({ error: 'Asset or completed render was not found' }); return; }
    const downloadUrl = await createDownloadUrl(key);
    res.json({ downloadUrl, expiresInSeconds: 300 });
  } catch (error) { next(error); }
});



assetsRouter.put('/:id/metadata', async (req, res, next) => {
  try {
    const id = z.string().uuid().safeParse(req.params.id);
    const body = z.object({ durationSeconds: z.number().finite().positive().max(12 * 60 * 60) }).strict().safeParse(req.body);
    if (!id.success || !body.success) {
      res.status(400).json({ error: 'Invalid media metadata', details: body.success ? undefined : body.error.flatten() });
      return;
    }
    const updated = await pool.query(
      `UPDATE assets SET duration_seconds=$3,updated_at=now()
       WHERE id=$1 AND user_id=$2 AND status='uploaded'
         AND (content_type IN ('video/mp4','video/quicktime','audio/mpeg','audio/wav')
          OR lower(file_name) ~ '\.(srt|vtt|ass)$')
       RETURNING id,object_key AS key,file_name AS name,content_type AS "contentType",size_bytes AS size,
         duration_seconds AS "durationSeconds",status`,
      [id.data, req.auth!.sub, body.data.durationSeconds],
    );
    if (!updated.rowCount) { res.status(404).json({ error: 'Uploaded asset not found or media type does not support duration metadata' }); return; }
    res.json({ asset: { ...updated.rows[0], size: Number(updated.rows[0].size) } });
  } catch (error) { next(error); }
});

assetsRouter.delete('/:id', async (req, res, next) => {
  let client: PoolClient | undefined;
  try {
    const parsed = z.string().uuid().safeParse(req.params.id);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid asset id' }); return; }
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.auth!.sub]);
    const locked = await client.query(
      `SELECT id,object_key AS key,status FROM assets WHERE id=$1 AND user_id=$2 FOR UPDATE`,
      [parsed.data, req.auth!.sub],
    );
    if (!locked.rowCount || !['pending', 'uploaded', 'failed'].includes(locked.rows[0].status)) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    const key = String(locked.rows[0].key);
    const previousStatus = String(locked.rows[0].status);
    if (!safeObjectKey(key) || !key.startsWith(`users/${req.auth!.sub}/assets/`)) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'Asset key is invalid or not owned by this account' });
      return;
    }
    if (previousStatus === 'uploaded') {
      // This check is deliberately performed after acquiring FOR UPDATE. Project create/patch holds
      // FOR KEY SHARE while writing Mongo so a project cannot race a delete into a dangling reference.
      const reference = await mongoDb().collection('projects').findOne(
        { ownerId: req.auth!.sub, 'timeline.tracks.clips.assetKey': key },
        { projection: { _id: 1, title: 1 } },
      );
      if (reference) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Asset is used by a project. Remove its timeline references before deleting it.', projectId: String(reference._id) });
        return;
      }
    }
    await client.query("UPDATE assets SET status='deleting',updated_at=now() WHERE id=$1 AND user_id=$2", [parsed.data, req.auth!.sub]);
    await client.query('COMMIT');
    client.release();
    client = undefined;
    let objectDeleted = false;
    try {
      await deleteObject(key);
      objectDeleted = true;
      await pool.query("UPDATE assets SET status='deleted',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='deleting'", [parsed.data, req.auth!.sub]);
    } catch (error) {
      // Only restore the previous state if storage deletion failed. If the object is gone but the
      // DB update failed, leave deleting for the idempotent stale-asset cleanup to finalize.
      if (!objectDeleted) {
        await pool.query("UPDATE assets SET status=$3,updated_at=now() WHERE id=$1 AND user_id=$2 AND status='deleting'", [parsed.data, req.auth!.sub, previousStatus]).catch(() => undefined);
      }
      throw error;
    }
    res.status(204).end();
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally { client?.release(); }
});
