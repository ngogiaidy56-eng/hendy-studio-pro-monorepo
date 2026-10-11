import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pool } from '../db/postgres.js';

const directories = [
  resolve(process.cwd(), 'database/postgres-rbac/migrations'),
  resolve(process.cwd(), '../../database/postgres-rbac/migrations'),
];

async function main() {
  let migrationDir: string | undefined;
  for (const candidate of directories) {
    try { await readdir(candidate); migrationDir = candidate; break; }
    catch { /* try the other workspace-relative path */ }
  }
  if (!migrationDir) throw new Error(`Migration folder not found. Tried: ${directories.join(', ')}`);

  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  // One database-level advisory lock prevents multiple API replicas applying the same migration.
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [7261802026]);
    const files = (await readdir(migrationDir)).filter(name => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
    for (const name of files) {
      const sql = await readFile(resolve(migrationDir, name), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const exists = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [name]);
        if (exists.rowCount) {
          await client.query('COMMIT');
          console.log(`Skipping applied migration ${name}`);
          continue;
        }
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [name]);
        await client.query('COMMIT');
        console.log(`Applied migration ${name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }
  } finally {
    try { await lock.query('SELECT pg_advisory_unlock($1)', [7261802026]); }
    finally { lock.release(); }
  }
}

main().catch(error => { console.error('Database migration failed:', error); process.exitCode = 1; })
  .finally(async () => { await pool.end(); });
