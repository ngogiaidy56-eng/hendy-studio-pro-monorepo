import { pool } from '../db/postgres.js';
import { deleteObject, safeObjectKey } from '../services/storage.js';

/** Retry output deletions interrupted by a worker/process restart. */
async function main() {
  const limit = Math.min(500, Math.max(1, Number(process.env.CLEANUP_BATCH_SIZE) || 100));
  let cleaned = 0;
  let failed = 0;
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const stale = await client.query(
        `SELECT id,user_id,output_key FROM render_jobs
         WHERE status='deleting' AND updated_at < now() - interval '15 minutes'
         ORDER BY updated_at LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit],
      );
      for (const row of stale.rows) {
        if (!safeObjectKey(row.output_key) || !String(row.output_key).startsWith(`users/${row.user_id}/renders/`)) {
          console.error(`Refusing unsafe render output key for job ${row.id}`);
          failed++;
          continue;
        }
        try {
          await deleteObject(row.output_key);
          await client.query(
            `UPDATE render_jobs SET status='deleted',size_bytes=0,updated_at=now() WHERE id=$1 AND status='deleting'`, [row.id],
          );
          cleaned++;
        } catch (error) {
          failed++;
          console.error(`Could not clean render output ${row.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
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
  console.error('Stale render cleanup failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
