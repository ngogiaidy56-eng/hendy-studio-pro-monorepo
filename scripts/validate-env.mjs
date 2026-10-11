#!/usr/bin/env node
/** Validate required configuration without printing secret values. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const envPath = resolve(root, '.env');
const examplePath = resolve(root, '.env.example');
const parse = (text) => Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return [];
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) return [];
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return [[match[1], value]];
}));

if (!existsSync(examplePath)) {
  console.error('Missing .env.example. Run this command from the repository root.');
  process.exit(2);
}
if (!existsSync(envPath) && process.env.CI !== 'true') {
  console.error('Missing .env. Create it with: cp .env.example .env (PowerShell: Copy-Item .env.example .env)');
  process.exit(2);
}
const example = parse(readFileSync(examplePath, 'utf8'));
const fileEnv = existsSync(envPath) ? parse(readFileSync(envPath, 'utf8')) : {};
const env = { ...fileEnv, ...process.env };
const issues = [];
const warnings = [];
const value = (key) => String(env[key] ?? '').trim();
const isPlaceholder = (entry) => /change-this|replace-with|dev_only|placeholder|example\.(com|net|org)|@local\.test/i.test(entry);

for (const key of ['NODE_ENV', 'SERVICE_ROLE', 'JWT_SECRET', 'DATABASE_URL', 'REDIS_URL', 'MONGODB_URI']) {
  if (!value(key)) issues.push(`${key} is required`);
}
if (!['development', 'test', 'production'].includes(value('NODE_ENV'))) issues.push('NODE_ENV must be development, test, or production');
if (!['api', 'worker'].includes(value('SERVICE_ROLE') || 'api')) issues.push('SERVICE_ROLE must be api or worker');
const port = value('API_PORT') || value('PORT') || '8080';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) issues.push('API_PORT/PORT must be an integer between 1 and 65535');
if (!/^\d+[smhd]$/.test(value('JWT_TTL') || '15m')) issues.push('JWT_TTL must be a duration such as 15m, 1h, or 1d');
if (Buffer.byteLength(value('JWT_SECRET'), 'utf8') < 32) issues.push('JWT_SECRET must contain at least 32 UTF-8 bytes');

if (value('NODE_ENV') === 'production') {
  if (isPlaceholder(value('JWT_SECRET'))) issues.push('JWT_SECRET still looks like a placeholder');
  if (value('SERVICE_ROLE') !== 'worker') {
    if (!value('ADMIN_EMAIL') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('ADMIN_EMAIL'))) issues.push('ADMIN_EMAIL must be a valid email for the API role');
    if (isPlaceholder(value('ADMIN_EMAIL'))) issues.push('ADMIN_EMAIL must not use an example domain');
    if (value('ADMIN_PASSWORD').length < 16 || Buffer.byteLength(value('ADMIN_PASSWORD'), 'utf8') > 72 || isPlaceholder(value('ADMIN_PASSWORD'))) {
      issues.push('ADMIN_PASSWORD must be non-placeholder, at least 16 characters and at most 72 UTF-8 bytes');
    }
    if (value('METRICS_TOKEN').length < 24 || isPlaceholder(value('METRICS_TOKEN'))) issues.push('METRICS_TOKEN must be a unique secret of at least 24 characters');
    const origins = value('CORS_ORIGINS').split(',').map(item => item.trim()).filter(Boolean);
    if (!origins.length || origins.some(origin => origin === '*' || origin.includes('localhost') || !/^https:\/\//i.test(origin))) {
      issues.push('CORS_ORIGINS must contain only exact HTTPS production origins; wildcards and localhost are not allowed');
    }
  }
  if (!value('S3_BUCKET') || !value('S3_ACCESS_KEY_ID') || !value('S3_SECRET_ACCESS_KEY')) {
    issues.push('Production requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
  }
  if (value('S3_ENDPOINT') && !/^https:\/\//i.test(value('S3_ENDPOINT'))) issues.push('S3_ENDPOINT must use HTTPS in production');
  if (value('GRAFANA_ADMIN_PASSWORD') && (value('GRAFANA_ADMIN_PASSWORD').length < 20 || isPlaceholder(value('GRAFANA_ADMIN_PASSWORD')))) {
    issues.push('GRAFANA_ADMIN_PASSWORD must be unique and at least 20 characters when configured');
  }
} else {
  if (isPlaceholder(value('JWT_SECRET'))) warnings.push('JWT_SECRET is still a placeholder; do not expose this development configuration to the internet.');
  if (value('SERVICE_ROLE') !== 'worker' && isPlaceholder(value('ADMIN_PASSWORD'))) warnings.push('Replace ADMIN_EMAIL/ADMIN_PASSWORD before seeding a local administrator.');
}

for (const key of Object.keys(example)) {
  if (!(key in env) && !['GEMINI_API_KEY', 'SENTRY_DSN', 'WHISPER_API_URL', 'S3_ENDPOINT', 'S3_PUBLIC_BASE_URL'].includes(key)) {
    warnings.push(`Optional/example environment variable ${key} is not set`);
  }
}
if (issues.length) {
  console.error('Environment validation failed:');
  for (const issue of [...new Set(issues)]) console.error(`  - ${issue}`);
  process.exit(1);
}
for (const warning of [...new Set(warnings)]) console.warn(`WARN ${warning}`);
console.log(`Environment validation passed (${existsSync(envPath) ? '.env' : 'process environment'}).`);
console.log('Note: this validates shape and obvious placeholders; it does not verify that remote services are reachable.');
