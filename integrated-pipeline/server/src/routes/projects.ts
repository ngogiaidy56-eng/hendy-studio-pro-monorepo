import { Router } from 'express';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { requireAuth } from '../middleware/auth.js';
import { mongoDb } from '../db/mongo.js';
import { pool } from '../db/postgres.js';
import type { PoolClient } from 'pg';
import { buildRenderManifest, validateTimelineDocument } from '@hendy/core-utils';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const timelineSchema = z.unknown().optional().refine(
  value => value === undefined || validateTimelineDocument(value), 'Invalid timeline document',
);
const createSchema = z.object({ title: z.string().trim().min(1).max(120), timeline: timelineSchema });
const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  timeline: timelineSchema,
}).strict().refine(value => Object.keys(value).length > 0);

async function timelineReferencesOwnedAssets(timeline: unknown, userId: string, client?: PoolClient): Promise<boolean> {
  if (!timeline || !validateTimelineDocument(timeline)) return true;
  const keys = [...new Set(timeline.tracks.flatMap(track => track.clips.map(clip => clip.assetKey)))];
  if (keys.length === 0) return true;
  if (keys.some(key => !key.startsWith(`users/${userId}/assets/`))) return false;
  // Keep uploaded asset rows locked until the Mongo project write commits. The delete endpoint
  // takes FOR UPDATE, so a concurrent project save cannot create a dangling asset reference.
  const query = `SELECT object_key FROM assets WHERE user_id=$1 AND status='uploaded' AND object_key=ANY($2::text[])${client ? ' FOR KEY SHARE' : ''}`;
  const result = client ? await client.query(query, [userId, keys]) : await pool.query(query, [userId, keys]);
  return result.rowCount === keys.length;
}

projectsRouter.get('/', async (req, res, next) => {
  try {
    const docs = await mongoDb().collection('projects')
      .find({ ownerId: req.auth!.sub }, { projection: { _id: 1, title: 1, updatedAt: 1, createdAt: 1, timeline: 1 } })
      .sort({ updatedAt: -1 }).limit(100).toArray();
    res.json({ projects: docs.map(doc => ({ ...doc, id: String(doc._id), _id: undefined })) });
  } catch (error) { next(error); }
});

projectsRouter.post('/', async (req, res, next) => {
  let client: PoolClient | undefined;
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid project', details: parsed.error.flatten() }); return; }
    const timeline = parsed.data.timeline ?? {
      version: 1, fps: 30, resolution: { width: 1920, height: 1080 }, tracks: [],
    };
    client = await pool.connect();
    await client.query('BEGIN');
    if (!await timelineReferencesOwnedAssets(timeline, req.auth!.sub, client)) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'Timeline contains media not uploaded by this account' });
      return;
    }
    // Serialize project creation per account so parallel requests cannot bypass the plan quota.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`project-quota:${req.auth!.sub}`]);
    const account = await client.query(
      `SELECT u.tier,COALESCE((p.features->>'maxProjects')::int,
       CASE u.tier WHEN 'free' THEN 3 WHEN 'creator' THEN 50 WHEN 'studio' THEN 500 ELSE 5000 END) AS max_projects
       FROM users u LEFT JOIN plans p ON p.code=u.tier AND p.active=true WHERE u.id=$1`, [req.auth!.sub],
    );
    if (!account.rowCount) {
      await client.query('ROLLBACK');
      res.status(401).json({ error: 'Account not found' });
      return;
    }
    const count = await mongoDb().collection('projects').countDocuments({ ownerId: req.auth!.sub });
    if (count >= Number(account.rows[0].max_projects)) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Project quota reached for your plan', tier: account.rows[0].tier, limit: Number(account.rows[0].max_projects) });
      return;
    }
    const now = new Date();
    const document = { ownerId: req.auth!.sub, title: parsed.data.title, timeline, createdAt: now, updatedAt: now };
    const inserted = await mongoDb().collection('projects').insertOne(document);
    await client.query('COMMIT');
    res.status(201).json({ project: { ...document, id: inserted.insertedId.toString() } });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally { client?.release(); }
});

projectsRouter.get('/:id/manifest', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) { res.status(400).json({ error: 'Invalid project id' }); return; }
    const doc = await mongoDb().collection('projects').findOne({ _id: new ObjectId(req.params.id), ownerId: req.auth!.sub });
    if (!doc) { res.status(404).json({ error: 'Project not found' }); return; }
    if (!validateTimelineDocument(doc.timeline) || !await timelineReferencesOwnedAssets(doc.timeline, req.auth!.sub)) {
      res.status(409).json({ error: 'Project timeline is invalid or references unavailable assets' });
      return;
    }
    res.json({ manifest: buildRenderManifest(String(doc._id), doc.timeline) });
  } catch (error) { next(error); }
});

projectsRouter.get('/:id', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) { res.status(400).json({ error: 'Invalid project id' }); return; }
    const doc = await mongoDb().collection('projects').findOne({ _id: new ObjectId(req.params.id), ownerId: req.auth!.sub });
    if (!doc) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json({ project: { ...doc, id: String(doc._id) } });
  } catch (error) { next(error); }
});

projectsRouter.patch('/:id', async (req, res, next) => {
  let client: PoolClient | undefined;
  try {
    if (!ObjectId.isValid(req.params.id)) { res.status(400).json({ error: 'Invalid project id' }); return; }
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid project update', details: parsed.error.flatten() }); return; }
    client = await pool.connect();
    await client.query('BEGIN');
    if (parsed.data.timeline !== undefined && !await timelineReferencesOwnedAssets(parsed.data.timeline, req.auth!.sub, client)) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'Timeline contains media not uploaded by this account' });
      return;
    }
    const doc = await mongoDb().collection('projects').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), ownerId: req.auth!.sub },
      { $set: { ...parsed.data, updatedAt: new Date() } },
      { returnDocument: 'after', includeResultMetadata: false },
    );
    if (!doc) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Project not found' }); return; }
    await client.query('COMMIT');
    res.json({ project: { ...doc, id: String(doc._id) } });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally { client?.release(); }
});

projectsRouter.delete('/:id', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) { res.status(400).json({ error: 'Invalid project id' }); return; }
    const result = await mongoDb().collection('projects').deleteOne({ _id: new ObjectId(req.params.id), ownerId: req.auth!.sub });
    if (!result.deletedCount) { res.status(404).json({ error: 'Project not found' }); return; }
    res.status(204).end();
  } catch (error) { next(error); }
});
