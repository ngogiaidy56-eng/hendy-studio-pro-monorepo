import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { renderQueue } from '../queue.js';
import { deleteObject, safeObjectKey } from '../services/storage.js';
import { mongoDb } from '../db/mongo.js';
import { pool } from '../db/postgres.js';
import { SYSTEM_CONFIG, validateTimelineDocument } from '@hendy/core-utils';
import type { TimelineDocument } from '@hendy/core-utils';

export const renderRouter = Router();
renderRouter.use(requireAuth);

const renderSchema = z.object({
  projectId: z.string().min(1).max(80),
  inputKey: z.string().min(1).max(500).optional(),
  options: z.object({
    width: z.number().int().min(320).max(3840).refine(value => value % 2 === 0, 'Width must be even for H.264 output').optional(),
    height: z.number().int().min(240).max(2160).refine(value => value % 2 === 0, 'Height must be even for H.264 output').optional(),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).optional(),
  }).optional(),
});

renderRouter.get('/jobs', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const result = await pool.query(
      `SELECT id,project_id AS "projectId",input_key AS "inputKey",output_key AS "outputKey",status,progress,
       failure_reason AS "failedReason",size_bytes AS "sizeBytes",created_at AS "createdAt",updated_at AS "updatedAt",completed_at AS "completedAt"
       FROM render_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [req.auth!.sub, limit],
    );
    res.json({ jobs: result.rows.map(row => ({ ...row, sizeBytes: row.sizeBytes == null ? null : Number(row.sizeBytes) })) });
  } catch (error) { next(error); }
});

renderRouter.post('/jobs', async (req, res, next) => {
  const parsed = renderSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid render request', details: parsed.error.flatten() }); return; }
  try {
    const { projectId } = parsed.data;
    if (!ObjectId.isValid(projectId)) { res.status(400).json({ error: 'Invalid project id' }); return; }
    const project = await mongoDb().collection('projects').findOne(
      { _id: new ObjectId(projectId), ownerId: req.auth!.sub },
      { projection: { _id: 1, timeline: 1, title: 1 } },
    );
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const rawTimeline = project.timeline;
    const timelineHasClips = Boolean(rawTimeline && typeof rawTimeline === 'object'
      && Array.isArray((rawTimeline as { tracks?: unknown }).tracks)
      && (rawTimeline as { tracks: Array<{ clips?: unknown }> }).tracks.some(track => Array.isArray(track?.clips) && track.clips.length > 0));
    if (timelineHasClips && !validateTimelineDocument(rawTimeline)) {
      res.status(409).json({ error: 'Project timeline is invalid; fix the timeline before rendering.' });
      return;
    }
    const wantsTimeline = Boolean(timelineHasClips && validateTimelineDocument(rawTimeline));
    let timeline: TimelineDocument | undefined;
    let inputKey = parsed.data.inputKey;
    let assetMetadata: Array<{ key: string; fileName: string; contentType: string }> = [];

    if (wantsTimeline) {
      const sourceTimeline = rawTimeline as TimelineDocument;
      const options = parsed.data.options ?? {};
      timeline = {
        ...sourceTimeline,
        fps: (options.fps ?? sourceTimeline.fps) as TimelineDocument['fps'],
        resolution: {
          width: options.width ?? sourceTimeline.resolution.width,
          height: options.height ?? sourceTimeline.resolution.height,
        },
      };
      if (!validateTimelineDocument(timeline)) {
        res.status(400).json({ error: 'Project timeline or output settings are invalid' });
        return;
      }
      const clips = timeline.tracks.flatMap(track => track.clips.map(clip => ({ track, clip })));
      if (clips.length > SYSTEM_CONFIG.media.maxClipsPerRender) { res.status(413).json({ error: 'Timeline exceeds 1,000 clips per render' }); return; }
      const keys = [...new Set(clips.map(({ clip }) => clip.assetKey))];
      if (keys.length > SYSTEM_CONFIG.media.maxUniqueAssetsPerRender) { res.status(413).json({ error: 'A single render may use at most 128 unique source assets' }); return; }
      if (keys.some(key => !safeObjectKey(key) || !key.startsWith(`users/${req.auth!.sub}/assets/`))) {
        res.status(403).json({ error: 'Timeline contains an asset key not owned by this account' }); return;
      }
      const found = await pool.query(
        `SELECT object_key AS key,file_name AS "fileName",content_type AS "contentType",size_bytes AS "sizeBytes"
         FROM assets WHERE user_id=$1 AND status='uploaded' AND object_key=ANY($2::text[])`, 
        [req.auth!.sub, keys],
      );
      if (found.rowCount !== keys.length) { res.status(409).json({ error: 'One or more timeline assets are missing or not uploaded' }); return; }
      const totalInputBytes = found.rows.reduce((sum, asset) => sum + Number(asset.sizeBytes), 0);
      if (!Number.isSafeInteger(totalInputBytes) || totalInputBytes > SYSTEM_CONFIG.media.maxSourceBytesPerRender) { res.status(413).json({ error: 'Combined render source size must not exceed 4 GiB' }); return; }
      assetMetadata = found.rows.map(asset => ({ key: asset.key, fileName: asset.fileName, contentType: asset.contentType }));
      const metaByKey = new Map(assetMetadata.map(asset => [asset.key, asset]));
      const videoTracks = timeline.tracks.filter(track => track.type === 'video' && track.clips.length > 0);
      if (!videoTracks.length) { res.status(400).json({ error: 'Timeline must contain at least one video-track clip' }); return; }
      for (const { track, clip } of clips) {
        const meta = metaByKey.get(clip.assetKey)!;
        const ext = meta.fileName.toLowerCase().split('.').pop() ?? '';
        if (track.type === 'video' && !['video/mp4', 'video/quicktime'].includes(meta.contentType)) {
          res.status(415).json({ error: `Video track asset ${meta.fileName} must be MP4 or MOV` }); return;
        }
        if (track.type === 'audio' && !['audio/mpeg', 'audio/wav', 'video/mp4', 'video/quicktime'].includes(meta.contentType)) {
          res.status(415).json({ error: `Audio track asset ${meta.fileName} must be MP3, WAV, MP4 or MOV with an audio stream` }); return;
        }
        if (track.type === 'overlay' && !['video/mp4', 'video/quicktime', 'image/png', 'image/jpeg'].includes(meta.contentType)) {
          res.status(415).json({ error: `Overlay asset ${meta.fileName} must be MP4, MOV, PNG or JPEG` }); return;
        }
        if (track.type === 'subtitle' && !(ext === 'srt' && ['application/x-subrip', 'text/plain'].includes(meta.contentType))) {
          res.status(415).json({ error: 'The cloud compositor currently accepts SRT files on subtitle tracks; convert VTT/ASS to SRT first' }); return;
        }
        const extensionMatches = meta.contentType === 'video/mp4' ? ext === 'mp4'
          : meta.contentType === 'video/quicktime' ? ext === 'mov'
          : meta.contentType === 'audio/mpeg' ? ext === 'mp3'
          : meta.contentType === 'audio/wav' ? ext === 'wav'
          : meta.contentType === 'image/png' ? ext === 'png'
          : meta.contentType === 'image/jpeg' ? ['jpg', 'jpeg'].includes(ext)
          : true;
        if (!extensionMatches) { res.status(415).json({ error: `Asset filename extension does not match its media type: ${meta.fileName}` }); return; }
        if (clip.sourceOut <= clip.sourceIn || Math.abs((clip.sourceOut - clip.sourceIn) - clip.duration) > 0.06) {
          res.status(400).json({ error: `Clip ${clip.id} source range must match its timeline duration` }); return;
        }
        if (track.type === 'overlay' && clip.transform && (Math.abs(clip.transform.x) > timeline.resolution.width || Math.abs(clip.transform.y) > timeline.resolution.height)) {
          res.status(400).json({ error: `Overlay transform for ${clip.id} is outside the output frame bounds` }); return;
        }
      }
      inputKey = videoTracks[0].clips[0].assetKey;
    } else {
      if (!inputKey || !safeObjectKey(inputKey) || !inputKey.startsWith(`users/${req.auth!.sub}/assets/`)) {
        res.status(400).json({ error: 'Provide an owned video asset or add clips to the project timeline before rendering' }); return;
      }
      const source = await pool.query(
        `SELECT object_key AS key,file_name AS "fileName",content_type AS "contentType"
         FROM assets WHERE user_id=$1 AND object_key=$2 AND status='uploaded'`,
        [req.auth!.sub, inputKey],
      );
      if (!source.rowCount) { res.status(404).json({ error: 'Uploaded input asset was not found in your library' }); return; }
      if (!['video/mp4', 'video/quicktime'].includes(source.rows[0].contentType)) {
        res.status(415).json({ error: 'Single-source mode accepts MP4 and MOV. Add media to a video timeline track for compositor rendering.' });
        return;
      }
      assetMetadata = source.rows;
    }

    const id = randomUUID();
    const outputKey = `users/${req.auth!.sub}/renders/${Date.now()}-${id}.mp4`;
    await pool.query(
      `INSERT INTO render_jobs(id,user_id,project_id,input_key,output_key,status,progress) VALUES($1,$2,$3,$4,$5,'queued',0)`,
      [id, req.auth!.sub, projectId, inputKey, outputKey],
    );
    try {
      await renderQueue.add('render-video', {
        userId: req.auth!.sub, projectId, inputKey, outputKey,
        options: parsed.data.options ?? {},
        ...(timeline ? { timeline, assets: assetMetadata } : {}),
      }, { jobId: id });
    } catch (error) {
      await pool.query("UPDATE render_jobs SET status='failed',failure_reason='Could not enqueue job',updated_at=now() WHERE id=$1", [id]);
      throw error;
    }
    res.status(202).json({ job: { id, status: 'queued', progress: 0, outputKey, mode: timeline ? 'timeline' : 'single-source' } });
  } catch (error) { next(error); }
});

renderRouter.get('/jobs/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id,project_id AS "projectId",output_key AS "outputKey",status,progress,
       failure_reason AS "failedReason",size_bytes AS "sizeBytes",created_at AS "createdAt",updated_at AS "updatedAt",completed_at AS "completedAt"
       FROM render_jobs WHERE id=$1 AND user_id=$2`, [req.params.id, req.auth!.sub],
    );
    if (!result.rowCount) { res.status(404).json({ error: 'Render job not found' }); return; }
    const job = result.rows[0];
    res.json({ job: { ...job, sizeBytes: job.sizeBytes == null ? null : Number(job.sizeBytes), data: job.status === 'completed' ? { outputKey: job.outputKey } : null } });
  } catch (error) { next(error); }
});

renderRouter.delete('/jobs/:id', async (req, res, next) => {
  let client: import('pg').PoolClient | undefined;
  let outputKey: string | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const row = await client.query(
      'SELECT id,status,output_key AS "outputKey" FROM render_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE',
      [req.params.id, req.auth!.sub],
    );
    if (!row.rowCount) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Render job not found' });
      return;
    }
    const status = String(row.rows[0].status);
    if (status === 'queued') {
      const queueJob = await renderQueue.getJob(req.params.id);
      if (queueJob) {
        const state = await queueJob.getState();
        if (!['waiting', 'delayed', 'paused', 'prioritized'].includes(state)) {
          await client.query('ROLLBACK');
          res.status(409).json({ error: 'Render job is no longer waiting', status: state });
          return;
        }
        await queueJob.remove();
      }
      await client.query("UPDATE render_jobs SET status='cancelled',updated_at=now() WHERE id=$1", [req.params.id]);
      await client.query('COMMIT');
      res.status(204).end();
      return;
    }
    if (status !== 'completed') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Only queued jobs can be cancelled or completed outputs can be deleted', status });
      return;
    }
    outputKey = String(row.rows[0].outputKey);
    if (!safeObjectKey(outputKey) || !outputKey.startsWith(`users/${req.auth!.sub}/renders/`)) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Render output key is invalid or not owned by this account' });
      return;
    }
    // Stop issuing download URLs before deleting the object; failed deletions are restored to completed.
    await client.query("UPDATE render_jobs SET status='deleting',updated_at=now() WHERE id=$1", [req.params.id]);
    await client.query('COMMIT');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    next(error);
    return;
  } finally {
    client?.release();
  }

  if (!outputKey) return;
  let objectDeleted = false;
  try {
    await deleteObject(outputKey);
    objectDeleted = true;
    await pool.query("UPDATE render_jobs SET status='deleted',size_bytes=0,updated_at=now() WHERE id=$1 AND user_id=$2 AND status='deleting'", [req.params.id, req.auth!.sub]);
    res.status(204).end();
  } catch (error) {
    // Restore downloadability only when the object deletion itself failed. If the object was
    // deleted but the DB update failed, leave status=deleting so the idempotent cleanup job can finalize it.
    if (!objectDeleted) {
      await pool.query("UPDATE render_jobs SET status='completed',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='deleting'", [req.params.id, req.auth!.sub]).catch(() => undefined);
    }
    next(error);
  }
});
