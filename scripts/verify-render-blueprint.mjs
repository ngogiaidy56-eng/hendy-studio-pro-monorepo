#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.cwd();
const yaml = readFileSync(resolve(root, 'render.yaml'), 'utf8');
const errors = [];
for (const required of ['hendy-studio-api','hendy-studio-render-worker','hendy-home','hendy-admin','hendy-studio-web','hendy-release-center','hendy-redis','hendy-postgres']) {
  if (!yaml.includes(`name: ${required}`)) errors.push(`Blueprint missing resource ${required}`);
}
for (const app of ['marketing-web','admin-web','studio-web','release-center']) {
  if (!existsSync(resolve(root, `apps/${app}/package.json`))) errors.push(`Missing workspace app ${app}`);
  if (!yaml.includes(`bash scripts/render-build-static.sh ${app}`)) errors.push(`Blueprint does not build ${app}`);
  if (!yaml.includes(`staticPublishPath: apps/${app}/dist`)) errors.push(`Blueprint publish path missing for ${app}`);
}
for (const required of ['DATABASE_URL','REDIS_URL','MONGODB_URI','JWT_SECRET','S3_BUCKET','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','ADMIN_EMAIL','ADMIN_PASSWORD']) {
  if (!yaml.includes(`key: ${required}`)) errors.push(`Blueprint does not define ${required}`);
}
if (!yaml.includes('property: connectionString')) errors.push('Expected managed database connection bindings');
if (/name: hendy-studio-render-worker\s*\n[\s\S]{0,80}plan: free/.test(yaml)) errors.push('Render does not offer a Free plan for background workers; select a paid worker plan.');
if (!/name: hendy-redis[\s\S]*?plan: 256mb[\s\S]*?persistenceMode: journal-snapshot/.test(yaml)) errors.push('Production Redis should use a persistent paid Key Value plan.');
if (!/name: hendy-postgres[\s\S]*?plan: basic-1gb/.test(yaml)) errors.push('Production PostgreSQL should use a persistent paid plan, not the expiring Free plan.');
if (!yaml.includes('source: /privacy') || !yaml.includes('destination: /privacy.html')) errors.push('Marketing site must expose the privacy policy route.');
if (!yaml.includes('source: /terms') || !yaml.includes('destination: /terms.html')) errors.push('Marketing site must expose the terms route.');
if (!yaml.includes('source: /support') || !yaml.includes('destination: /support.html')) errors.push('Marketing site must expose the support route.');
for (const service of ['hendy-studio-api','hendy-studio-render-worker','hendy-home','hendy-admin','hendy-studio-web','hendy-release-center']) {
  const section = yaml.split(`name: ${service}`)[1]?.split('\n  - type:')[0] ?? '';
  if (!section.includes('autoDeployTrigger: checksPass')) errors.push(`${service} should deploy only after configured CI checks pass`);
}
if (!yaml.includes('MICROSOFT_STORE_CERTIFICATE_BASE64')) {
  // Store certificate configuration is managed in GitHub Actions secrets, never in Render's environment.
  console.log('NOTE: Microsoft Store signing credentials belong in protected GitHub Actions secrets, not Render environment variables.');
}
if (errors.length) { console.error('Render Blueprint check failed'); for (const e of errors) console.error(`- ${e}`); process.exit(1); }
console.log('PASS: Render Blueprint service list, workspace paths, and required runtime environment references are present.');
console.log('NOTE: Render cloud schema validation and a deploy still require the Render workspace, Git remote source, and configured secrets.');
