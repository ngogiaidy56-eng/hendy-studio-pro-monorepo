#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { chmod, existsSync, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const envPath = resolve(root, '.env');
const examplePath = resolve(root, '.env.example');
if (!existsSync(resolve(root, 'package.json')) || !existsSync(resolve(root, 'docker-compose.yml'))) {
  console.error('Run this from the hendy-wed-server repository root.');
  process.exit(2);
}
if (!existsSync(envPath)) {
  let content = await readFile(examplePath, 'utf8');
  const secrets = {
    JWT_SECRET: randomBytes(48).toString('base64url'),
    POSTGRES_PASSWORD: randomBytes(32).toString('base64url'),
    ADMIN_PASSWORD: randomBytes(24).toString('base64url'),
    METRICS_TOKEN: randomBytes(32).toString('base64url'),
    GRAFANA_ADMIN_PASSWORD: randomBytes(24).toString('base64url'),
  };
  for (const [key, value] of Object.entries(secrets)) {
    const line = new RegExp(`^${key}=.*$`, 'm');
    content = content.replace(line, `${key}=${value}`);
  }
  content = content.replace(/^ADMIN_EMAIL=.*$/m, 'ADMIN_EMAIL=admin@hendy.local');
  content = content.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=postgres://hendy:${secrets.POSTGRES_PASSWORD}@postgres:5432/hendy_studio`);
  await writeFile(envPath, content, { mode: 0o600, flag: 'wx' });
  await chmod(envPath, 0o600);
  console.log('Created .env from example and generated unique development secrets (file mode 0600).');
  console.log('Bootstrap admin: admin@hendy.local; its generated password is stored only in .env.');
} else {
  console.log('.env already exists; no files were overwritten.');
}
const docker = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' });
console.log(docker.status === 0 ? 'Docker Compose is available.' : 'Docker Compose not found; install Docker Desktop / Docker Engine to run services.');
const bun = spawnSync('bun', ['--version'], { encoding: 'utf8' });
console.log(bun.status === 0 ? `Bun ${bun.stdout.trim()} is available.` : 'Bun not found; install Bun 1.2+ for workspace scripts.');
console.log('\nNext steps:');
console.log('  1. Keep .env private. Configure valid S3/R2 bucket credentials before using upload/render.');
console.log('  2. docker compose up --build');
console.log('  3. Visit http://localhost:5173 (Admin), http://localhost:5174 (Studio), http://localhost:8080/healthz (API).');
console.log('  4. Read the bootstrap admin password from your local .env; do not paste it into source control.');
