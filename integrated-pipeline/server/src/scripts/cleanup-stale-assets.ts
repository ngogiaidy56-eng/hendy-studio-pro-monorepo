import { pool } from '../db/postgres.js';
import { deleteObject, safeObjectKey } from '../services/storage.js';

/** Remove expired direct uploads and retry interrupted object deletions. */
async function main() {
  const limit = Math.min(500, Math.max(1, Number(process.env.CLEANUP_BATCH_SIZE) || 100));
  let cleaned = 0;
  let failed = 0;
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const stale = await client.query(
        `SELECT id, user_id, object_key, status FROM assets
         WHERE (status='pending' AND created_at < now() - interval '24 hours')
            OR (status='deleting' AND updated_at < now() - interval '15 minutes')
         ORDER BY updated_at LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit],
      );
      for (const row of stale.rows) {
        if (!safeObjectKey(row.object_key) || !String(row.object_key).startsWith(`users/${row.user_id}/assets/`)) {
          console.error(`Refusing unsafe stale asset key for asset ${row.id}`);
          failed++;
          continue;
        }
        try {
          // S3 DeleteObject is idempotent for a missing key; only close the row after it succeeds.
          await deleteObject(row.object_key);
          const replacementStatus = row.status === 'deleting' ? 'deleted' : 'failed';
          await client.query(
            `UPDATE assets SET status=$2,updated_at=now() WHERE id=$1 AND status=$3`, [row.id, replacementStatus, row.status],
          );
          cleaned++;
        } catch (error) {
          failed++;
          console.error(`Could not clean stale asset ${row.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }
      await client.query('COMMIT');
      console.log(JSON.stringify({ scanned: stale.rows.length, cleaned, failed, batchLimit: limit }));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error('Stale asset cleanup failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
