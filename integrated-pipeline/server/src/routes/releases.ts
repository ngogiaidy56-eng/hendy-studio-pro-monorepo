import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db/postgres.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { writeAudit } from '../services/audit.js';
import { createDownloadUrl, createUploadUrl, deleteObject, safeObjectKey, verifyObject } from '../services/storage.js';

export const releasesRouter = Router();
const platformSchema = z.enum(['windows', 'macos', 'linux', 'android', 'ios', 'web']);
const channelSchema = z.enum(['stable', 'beta', 'nightly']);
const statusSchema = z.enum(['draft', 'qa', 'ready', 'published', 'withdrawn']);
const storeSchema = z.enum(['direct', 'microsoft_store', 'google_play', 'apple_app_store', 'github_releases']);
const artifactSchema = z.object({
  platform: platformSchema,
  architecture: z.enum(['x86', 'x64', 'arm64', 'universal', 'web']).default('universal'),
  packageFormat: z.enum(['exe', 'msi', 'appx', 'msix', 'msixbundle', 'appxbundle', 'dmg', 'pkg', 'appimage', 'deb', 'rpm', 'apk', 'aab', 'ipa', 'zip', 'pwa', 'other']),
  fileName: z.string().trim().min(1).max(240).refine((v) => !(/[\\/\u0000-\u001f\u007f]/u.test(v)) && !v.startsWith('.'), 'Invalid filename'),
  contentType: z.string().min(3).max(160).regex(/^[\w.+-]+\/[\w.+-]+$/),
  sizeBytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
});
const createReleaseSchema = z.object({
  productSlug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).default('hendy-studio-pro'),
  productName: z.string().trim().min(2).max(160).default('Hendy Studio Pro'),
  version: z.string().trim().min(1).max(80).regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'Version must be semver-like, e.g. 1.2.3 or 1.2.3-beta.1'),
  channel: channelSchema.default('stable'),
  releaseNotes: z.string().max(20000).default(''),
  minimumOs: z.string().max(120).default(''),
  isSecurityUpdate: z.boolean().default(false),
});
const updateReleaseSchema = createReleaseSchema.omit({ productSlug: true, channel: true, version: true }).partial();
const storeSubmissionSchema = z.object({
  store: storeSchema,
  status: z.enum(['draft', 'prepared', 'submitted', 'in_review', 'approved', 'rejected', 'live']),
  listingUrl: z.string().trim().max(1000).default(''),
  externalVersion: z.string().trim().max(80).default(''),
  reviewerNotes: z.string().max(6000).default(''),
  metadata: z.record(z.unknown()).default({}),
});
const validHttpsUrl = (value: string) => {
  if (!value) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};
const cleanName = (value: string) => value.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+|\.+$/g, '').slice(0, 160) || 'installer';

function errorStatus(error: unknown): number {
  const value = error as { status?: number; statusCode?: number; code?: string };
  if (value?.code === '23505') return 409;
  const status = Number(value?.statusCode ?? value?.status);
  return Number.isInteger(status) && status >= 400 && status < 500 ? status : 500;
}

// Public software catalog. Only releases explicitly marked published are discoverable.
releasesRouter.get('/catalog', async (req, res, next) => {
  try {
    const platform = req.query.platform ? platformSchema.safeParse(req.query.platform) : null;
    if (platform && !platform.success) { res.status(400).json({ error: 'Invalid platform filter' }); return; }
    const channel = req.query.channel ? channelSchema.safeParse(req.query.channel) : null;
    if (channel && !channel.success) { res.status(400).json({ error: 'Invalid release channel' }); return; }
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const result = await pool.query(
      `SELECT r.id,r.product_slug AS "productSlug",r.product_name AS "productName",r.version,r.channel,r.release_notes AS "releaseNotes",
        r.minimum_os AS "minimumOs",r.is_security_update AS "isSecurityUpdate",r.published_at AS "publishedAt",
        COALESCE((SELECT json_agg(json_build_object('id',a.id,'platform',a.platform,'architecture',a.architecture,'packageFormat',a.package_format,'fileName',a.file_name,'contentType',a.content_type,'sizeBytes',a.size_bytes,'sha256',a.sha256,'downloadCount',a.download_count) ORDER BY a.platform,a.architecture,a.package_format)
          FROM app_release_artifacts a WHERE a.release_id=r.id AND a.status='uploaded'), '[]'::json) AS artifacts,
        COALESCE((SELECT json_agg(json_build_object('store',s.store,'status',s.status,'listingUrl',s.listing_url,'externalVersion',s.external_version) ORDER BY s.store)
          FROM app_store_submissions s WHERE s.release_id=r.id AND s.status IN ('approved','live')), '[]'::json) AS stores
       FROM app_releases r
       WHERE r.status='published' AND ($1::text IS NULL OR EXISTS(SELECT 1 FROM app_release_artifacts a WHERE a.release_id=r.id AND a.status='uploaded' AND a.platform=$1))
         AND ($2::text IS NULL OR r.channel=$2)
       ORDER BY CASE r.channel WHEN 'stable' THEN 0 WHEN 'beta' THEN 1 ELSE 2 END, r.published_at DESC LIMIT $3`,
      [platform?.success ? platform.data : null, channel?.success ? channel.data : null, limit],
    );
    res.json({ releases: result.rows });
  } catch (error) { next(error); }
});

// Downloads are only generated for uploaded artifacts on published releases.
releasesRouter.get('/:releaseId/download/:artifactId', async (req, res, next) => {
  try {
    const ids = z.object({ releaseId: z.string().uuid(), artifactId: z.string().uuid() }).safeParse(req.params);
    if (!ids.success) { res.status(400).json({ error: 'Invalid release or artifact id' }); return; }
    const result = await pool.query(
      `SELECT a.id,a.storage_key,a.file_name,r.status AS release_status
       FROM app_release_artifacts a JOIN app_releases r ON r.id=a.release_id
       WHERE r.id=$1 AND a.id=$2 AND r.status='published' AND a.status='uploaded'`,
      [ids.data.releaseId, ids.data.artifactId],
    );
    if (!result.rowCount) { res.status(404).json({ error: 'Published artifact not found' }); return; }
    const row = result.rows[0];
    const downloadUrl = await createDownloadUrl(row.storage_key);
    await pool.query('UPDATE app_release_artifacts SET download_count=download_count+1,updated_at=now() WHERE id=$1', [row.id]);
    res.json({ downloadUrl, fileName: row.file_name, expiresInSeconds: 300 });
  } catch (error) { next(error); }
});

releasesRouter.use('/admin', requireAuth);
releasesRouter.use('/admin', requirePermission('release:manage'));

releasesRouter.get('/admin', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const result = await pool.query(
      `SELECT r.*,r.product_slug AS "productSlug",r.product_name AS "productName",r.release_notes AS "releaseNotes",r.minimum_os AS "minimumOs",
        r.is_security_update AS "isSecurityUpdate",r.created_at AS "createdAt",r.updated_at AS "updatedAt",r.published_at AS "publishedAt",
        COALESCE((SELECT json_agg(json_build_object('id',a.id,'platform',a.platform,'architecture',a.architecture,'packageFormat',a.package_format,'fileName',a.file_name,'contentType',a.content_type,'sizeBytes',a.size_bytes,'sha256',a.sha256,'status',a.status,'downloadCount',a.download_count) ORDER BY a.created_at DESC)
          FROM app_release_artifacts a WHERE a.release_id=r.id AND a.status <> 'deleted'), '[]'::json) AS artifacts,
        COALESCE((SELECT json_agg(json_build_object('id',s.id,'store',s.store,'status',s.status,'listingUrl',s.listing_url,'externalVersion',s.external_version,'reviewerNotes',s.reviewer_notes,'metadata',s.metadata,'updatedAt',s.updated_at) ORDER BY s.store)
          FROM app_store_submissions s WHERE s.release_id=r.id), '[]'::json) AS submissions
       FROM app_releases r ORDER BY r.created_at DESC LIMIT $1`, [limit],
    );
    res.json({ releases: result.rows });
  } catch (error) { next(error); }
});

releasesRouter.post('/admin', async (req, res, next) => {
  const parsed = createReleaseSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid release metadata', details: parsed.error.flatten() }); return; }
  try {
    const r = parsed.data;
    const inserted = await pool.query(
      `INSERT INTO app_releases(product_slug,product_name,version,channel,status,release_notes,minimum_os,is_security_update,created_by)
       VALUES($1,$2,$3,$4,'draft',$5,$6,$7,$8)
       RETURNING id,product_slug AS "productSlug",product_name AS "productName",version,channel,status,release_notes AS "releaseNotes",minimum_os AS "minimumOs",is_security_update AS "isSecurityUpdate",created_at AS "createdAt"`,
      [r.productSlug,r.productName,r.version,r.channel,r.releaseNotes,r.minimumOs,r.isSecurityUpdate,req.auth!.sub],
    );
    await writeAudit(req, 'release.created', null, null, { releaseId: inserted.rows[0].id, version: r.version, channel: r.channel });
    res.status(201).json({ release: inserted.rows[0] });
  } catch (error) {
    if (errorStatus(error) === 409) res.status(409).json({ error: 'This product version and channel already exists' });
    else next(error);
  }
});

releasesRouter.patch('/admin/:releaseId', async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.releaseId);
  const parsed = updateReleaseSchema.strict().safeParse(req.body);
  if (!id.success || !parsed.success || !Object.keys(parsed.data ?? {}).length) { res.status(400).json({ error: 'Invalid release update', details: parsed.success ? undefined : parsed.error.flatten() }); return; }
  try {
    const old = await pool.query('SELECT * FROM app_releases WHERE id=$1', [id.data]);
    if (!old.rowCount) { res.status(404).json({ error: 'Release not found' }); return; }
    if (!['draft','qa'].includes(old.rows[0].status)) { res.status(409).json({ error: 'Only draft or QA releases can have metadata edited' }); return; }
    const next = { ...old.rows[0], ...parsed.data };
    const changed = await pool.query(
      `UPDATE app_releases SET product_name=$2,release_notes=$3,minimum_os=$4,is_security_update=$5,updated_at=now()
       WHERE id=$1 RETURNING id,product_slug AS "productSlug",product_name AS "productName",version,channel,status,release_notes AS "releaseNotes",minimum_os AS "minimumOs",is_security_update AS "isSecurityUpdate",updated_at AS "updatedAt"`,
      [id.data,next.product_name ?? next.productName,next.release_notes ?? next.releaseNotes,next.minimum_os ?? next.minimumOs,next.is_security_update ?? next.isSecurityUpdate],
    );
    await writeAudit(req, 'release.metadata.updated', null, { releaseId: id.data, status: old.rows[0].status }, { releaseId: id.data, fields: Object.keys(parsed.data) });
    res.json({ release: changed.rows[0] });
  } catch (error) { next(error); }
});

releasesRouter.post('/admin/:releaseId/artifacts/presign', async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.releaseId);
  const parsed = artifactSchema.safeParse(req.body);
  if (!id.success || !parsed.success) { res.status(400).json({ error: 'Invalid artifact metadata', details: parsed.success ? undefined : parsed.error.flatten() }); return; }
  try {
    const release = await pool.query('SELECT id,product_slug,status,version FROM app_releases WHERE id=$1', [id.data]);
    if (!release.rowCount) { res.status(404).json({ error: 'Release not found' }); return; }
    if (!['draft','qa'].includes(release.rows[0].status)) { res.status(409).json({ error: 'Artifacts can only be uploaded to draft or QA releases' }); return; }
    const a = parsed.data;
    const extension = a.fileName.toLowerCase().split('.').pop() ?? '';
    if (extension !== a.packageFormat && !(a.packageFormat === 'appimage' && extension === 'appimage') && !(a.packageFormat === 'pwa' && ['zip','webmanifest'].includes(extension))) {
      res.status(400).json({ error: `File extension .${extension} does not match package format ${a.packageFormat}` }); return;
    }
    const key = `releases/${release.rows[0].product_slug}/${id.data}/${randomUUID()}-${cleanName(a.fileName)}`;
    const uploadUrl = await createUploadUrl(key, a.contentType, a.sizeBytes);
    const inserted = await pool.query(
      `INSERT INTO app_release_artifacts(release_id,platform,architecture,package_format,file_name,content_type,storage_key,size_bytes,sha256,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
       ON CONFLICT(release_id,platform,architecture,package_format) DO UPDATE SET
         file_name=EXCLUDED.file_name,content_type=EXCLUDED.content_type,storage_key=EXCLUDED.storage_key,size_bytes=EXCLUDED.size_bytes,sha256=EXCLUDED.sha256,status='pending',updated_at=now()
       RETURNING id,platform,architecture,package_format AS "packageFormat",file_name AS "fileName",size_bytes AS "sizeBytes",sha256,status`,
      [id.data,a.platform,a.architecture,a.packageFormat,a.fileName,a.contentType,key,a.sizeBytes,a.sha256.toLowerCase()],
    );
    await writeAudit(req, 'release.artifact.presigned', null, null, { releaseId: id.data, artifactId: inserted.rows[0].id, platform: a.platform, format: a.packageFormat, sizeBytes: a.sizeBytes });
    res.status(201).json({ artifact: inserted.rows[0], uploadUrl, method: 'PUT', headers: { 'Content-Type': a.contentType }, expiresInSeconds: 300 });
  } catch (error) { next(error); }
});

releasesRouter.post('/admin/:releaseId/artifacts/:artifactId/complete', async (req, res, next) => {
  const ids = z.object({ releaseId: z.string().uuid(), artifactId: z.string().uuid() }).safeParse(req.params);
  if (!ids.success) { res.status(400).json({ error: 'Invalid release or artifact id' }); return; }
  try {
    const found = await pool.query(
      `SELECT id,storage_key,size_bytes,sha256,status FROM app_release_artifacts WHERE id=$1 AND release_id=$2`,
      [ids.data.artifactId,ids.data.releaseId],
    );
    if (!found.rowCount || found.rows[0].status !== 'pending') { res.status(404).json({ error: 'Pending artifact not found' }); return; }
    const row = found.rows[0];
    if (!safeObjectKey(row.storage_key) || !row.storage_key.startsWith(`releases/`)) { res.status(400).json({ error: 'Unsafe release artifact key' }); return; }
    const valid = await verifyObject(row.storage_key, Number(row.size_bytes), row.sha256);
    if (!valid) { res.status(409).json({ error: 'Uploaded object size or SHA-256 checksum does not match the submitted release artifact' }); return; }
    const updated = await pool.query(
      `UPDATE app_release_artifacts SET status='uploaded',updated_at=now() WHERE id=$1 AND release_id=$2 AND status='pending'
       RETURNING id,platform,architecture,package_format AS "packageFormat",file_name AS "fileName",content_type AS "contentType",size_bytes AS "sizeBytes",sha256,status`,
      [ids.data.artifactId,ids.data.releaseId],
    );
    if (!updated.rowCount) { res.status(409).json({ error: 'Artifact state changed while upload was completing' }); return; }
    await writeAudit(req, 'release.artifact.uploaded', null, null, { releaseId: ids.data.releaseId, artifactId: ids.data.artifactId });
    res.json({ artifact: updated.rows[0] });
  } catch (error) { next(error); }
});

releasesRouter.delete('/admin/:releaseId/artifacts/:artifactId', async (req, res, next) => {
  const ids = z.object({ releaseId: z.string().uuid(), artifactId: z.string().uuid() }).safeParse(req.params);
  if (!ids.success) { res.status(400).json({ error: 'Invalid release or artifact id' }); return; }
  try {
    const release = await pool.query('SELECT status FROM app_releases WHERE id=$1', [ids.data.releaseId]);
    if (!release.rowCount) { res.status(404).json({ error: 'Release not found' }); return; }
    if (release.rows[0].status === 'published') { res.status(409).json({ error: 'Withdraw the published release before removing artifacts' }); return; }
    const locked = await pool.query("UPDATE app_release_artifacts SET status='deleting',updated_at=now() WHERE id=$1 AND release_id=$2 AND status IN ('pending','uploaded','failed') RETURNING id,storage_key,status", [ids.data.artifactId,ids.data.releaseId]);
    if (!locked.rowCount) { res.status(404).json({ error: 'Artifact not found or not deletable' }); return; }
    try {
      await deleteObject(locked.rows[0].storage_key);
      await pool.query("UPDATE app_release_artifacts SET status='deleted',updated_at=now() WHERE id=$1 AND status='deleting'", [ids.data.artifactId]);
    } catch (error) {
      await pool.query("UPDATE app_release_artifacts SET status='failed',updated_at=now() WHERE id=$1 AND status='deleting'", [ids.data.artifactId]).catch(() => undefined);
      throw error;
    }
    await writeAudit(req, 'release.artifact.deleted', null, { artifactId: ids.data.artifactId }, { releaseId: ids.data.releaseId });
    res.status(204).end();
  } catch (error) { next(error); }
});

releasesRouter.patch('/admin/:releaseId/status', async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.releaseId);
  const parsed = z.object({ status: statusSchema }).strict().safeParse(req.body);
  if (!id.success || !parsed.success) { res.status(400).json({ error: 'Invalid release status' }); return; }
  const transitions: Record<string, string[]> = { draft: ['qa'], qa: ['draft','ready'], ready: ['qa','published','withdrawn'], published: ['withdrawn'], withdrawn: ['draft'] };
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT * FROM app_releases WHERE id=$1 FOR UPDATE', [id.data]);
      if (!locked.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Release not found' }); return; }
      const old = locked.rows[0];
      const target = parsed.data.status;
      if (!transitions[old.status]?.includes(target)) { await client.query('ROLLBACK'); res.status(409).json({ error: `Invalid transition ${old.status} -> ${target}` }); return; }
      if (target === 'published') {
        const artifacts = await client.query("SELECT count(*)::int AS count FROM app_release_artifacts WHERE release_id=$1 AND status='uploaded' AND sha256 ~ '^[a-fA-F0-9]{64}$'", [id.data]);
        if (Number(artifacts.rows[0].count) < 1) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Upload at least one verified artifact with SHA-256 before publishing' }); return; }
        if (!String(old.release_notes ?? '').trim()) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Release notes are required before publishing' }); return; }
      }
      const updated = await client.query(
        `UPDATE app_releases SET status=$2,updated_at=now(),published_at=CASE WHEN $2='published' THEN now() WHEN $2='withdrawn' THEN NULL ELSE published_at END,
         published_by=CASE WHEN $2='published' THEN $3 WHEN $2='withdrawn' THEN NULL ELSE published_by END
         WHERE id=$1 RETURNING id,product_slug AS "productSlug",product_name AS "productName",version,channel,status,release_notes AS "releaseNotes",minimum_os AS "minimumOs",published_at AS "publishedAt",updated_at AS "updatedAt"`,
        [id.data,target,req.auth!.sub],
      );
      await writeAudit(req, 'release.status.changed', null, { releaseId: id.data, status: old.status }, { releaseId: id.data, status: target }, client);
      await client.query('COMMIT');
      res.json({ release: updated.rows[0] });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  } catch (error) { next(error); }
});

releasesRouter.post('/admin/:releaseId/submissions', async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.releaseId);
  const parsed = storeSubmissionSchema.strict().safeParse(req.body);
  if (!id.success || !parsed.success) { res.status(400).json({ error: 'Invalid store submission', details: parsed.success ? undefined : parsed.error.flatten() }); return; }
  const submission = parsed.data;
  if (!validHttpsUrl(submission.listingUrl)) { res.status(400).json({ error: 'Listing URL must be HTTPS' }); return; }
  const metadata = submission.metadata as Record<string, unknown>;
  if (submission.store !== 'direct' && submission.status !== 'draft' && submission.status !== 'rejected') {
    const requiredText = ['shortDescription','fullDescription','privacyUrl','supportUrl'];
    const missing = requiredText.filter(key => typeof metadata[key] !== 'string' || !String(metadata[key]).trim());
    if (missing.length) { res.status(400).json({ error: `Store metadata is incomplete: ${missing.join(', ')}` }); return; }
    if (!validHttpsUrl(String(metadata.privacyUrl)) || !validHttpsUrl(String(metadata.supportUrl))) { res.status(400).json({ error: 'Privacy and support URLs must be HTTPS' }); return; }
    if (String(metadata.shortDescription).trim().length < 10 || String(metadata.fullDescription).trim().length < 40) { res.status(400).json({ error: 'Store descriptions are too short; provide useful user-facing listing text' }); return; }
  }
  try {
    const release = await pool.query('SELECT status,version FROM app_releases WHERE id=$1', [id.data]);
    if (!release.rowCount) { res.status(404).json({ error: 'Release not found' }); return; }
    const existing = await pool.query('SELECT status FROM app_store_submissions WHERE release_id=$1 AND store=$2', [id.data, submission.store]);
    const current = existing.rows[0]?.status ?? 'none';
    const transitions: Record<string, string[]> = {
      none: ['draft'], draft: ['draft','prepared'], prepared: ['prepared','submitted','draft'], submitted: ['submitted','in_review','rejected'],
      in_review: ['in_review','approved','rejected'], approved: ['approved','live'], rejected: ['rejected','prepared','draft'], live: ['live'],
    };
    if (!transitions[current]?.includes(submission.status)) { res.status(409).json({ error: `Invalid store submission transition ${current} -> ${submission.status}` }); return; }
    if (submission.status === 'submitted' || submission.status === 'in_review' || submission.status === 'approved' || submission.status === 'live') {
      const formats: Record<string, { platform: string; formats: string[] }> = {
        microsoft_store: { platform: 'windows', formats: ['appx','msix','msixbundle','appxbundle'] },
        google_play: { platform: 'android', formats: ['aab'] },
        apple_app_store: { platform: 'ios', formats: ['ipa'] },
      };
      const requirement = formats[submission.store];
      if (requirement) {
        const artifact = await pool.query(`SELECT 1 FROM app_release_artifacts WHERE release_id=$1 AND status='uploaded' AND platform=$2 AND package_format=ANY($3::text[]) LIMIT 1`, [id.data,requirement.platform,requirement.formats]);
        if (!artifact.rowCount) { res.status(409).json({ error: `${submission.store} requires a verified ${requirement.formats.join('/')} artifact for ${requirement.platform}` }); return; }
      }
    }
    if (submission.status === 'live' && (current !== 'approved' || release.rows[0].status !== 'published' || !submission.listingUrl)) {
      res.status(409).json({ error: 'A store listing can be marked live only after review approval, release publication and a HTTPS listing URL' }); return;
    }
    if (submission.store === 'direct' && submission.status === 'live' && release.rows[0].status !== 'published') {
      res.status(409).json({ error: 'Direct download listing requires a published release' }); return;
    }
    const result = await pool.query(
      `INSERT INTO app_store_submissions(release_id,store,status,listing_url,external_version,reviewer_notes,metadata,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       ON CONFLICT(release_id,store) DO UPDATE SET status=EXCLUDED.status,listing_url=EXCLUDED.listing_url,external_version=EXCLUDED.external_version,
        reviewer_notes=EXCLUDED.reviewer_notes,metadata=EXCLUDED.metadata,updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING id,release_id AS "releaseId",store,status,listing_url AS "listingUrl",external_version AS "externalVersion",reviewer_notes AS "reviewerNotes",metadata,updated_at AS "updatedAt"`,
      [id.data,submission.store,submission.status,submission.listingUrl,submission.externalVersion,submission.reviewerNotes,JSON.stringify(submission.metadata),req.auth!.sub],
    );
    await writeAudit(req, 'release.store_submission.updated', null, null, { releaseId: id.data, store: submission.store, status: submission.status });
    res.json({ submission: result.rows[0] });
  } catch (error) { next(error); }
});
