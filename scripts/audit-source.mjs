#!/usr/bin/env node
/** Dependency-free source audit for CI and local release checks. */
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative, dirname, extname, join } from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];
const files = [];
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.gradle', '.kotlin', '__pycache__', '.venv', 'venv', 'backups']);

async function walk(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { errors.push(`Cannot list ${relative(root, directory)}: ${error.message}`); return; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await walk(join(directory, entry.name));
      continue;
    }
    if (entry.isFile()) files.push(join(directory, entry.name));
  }
}

function resolveLocalImport(importer, specifier) {
  const base = resolve(dirname(importer), specifier);
  const candidates = [base];
  const suffix = extname(base);
  if (suffix === '.js') candidates.push(base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx', base.slice(0, -3) + '.d.ts', base.slice(0, -3) + '.mjs');
  if (suffix === '.jsx') candidates.push(base.slice(0, -4) + '.tsx', base.slice(0, -4) + '.ts');
  if (!suffix) candidates.push(...['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs'].map(ext => base + ext), join(base, 'index.ts'), join(base, 'index.tsx'));
  return candidates.some(candidate => existsSync(candidate));
}

const requiredFiles = [
  'package.json', '.env.example', '.gitignore', '.dockerignore', 'Dockerfile', 'Dockerfile.api', 'docker-compose.yml',
  'database/postgres-rbac/migrations/001_init.sql',
  'database/postgres-rbac/migrations/002_security_and_indexes.sql',
  'database/postgres-rbac/migrations/003_plan_storage_quotas.sql',
  'database/postgres-rbac/migrations/004_asset_media_metadata.sql',
  'database/postgres-rbac/migrations/005_render_output_lifecycle.sql',
  'database/postgres-rbac/migrations/006_asset_output_deletion_lifecycle.sql',
  'database/postgres-rbac/migrations/007_app_release_center.sql', 'database/postgres-rbac/migrations/008_appx_package_format.sql',
  'integrated-pipeline/server/src/server.ts',
  'integrated-pipeline/server/src/routes/auth.ts',
  'integrated-pipeline/server/src/routes/admin.ts',
  'integrated-pipeline/server/src/routes/projects.ts',
  'integrated-pipeline/server/src/routes/assets.ts',
  'integrated-pipeline/server/src/routes/render.ts',
  'integrated-pipeline/server/src/routes/ai.ts',
  'integrated-pipeline/server/src/workers/render.worker.ts',
  'integrated-pipeline/server/src/workers/timeline-compositor.ts',
  'integrated-pipeline/server/src/workers/srt.ts',
  'integrated-pipeline/server/src/tests/srt.test.ts',
  'integrated-pipeline/server/src/scripts/migrate.ts',
  'integrated-pipeline/server/src/scripts/seed.ts',
  'integrated-pipeline/server/src/scripts/cleanup-stale-assets.ts',
  'integrated-pipeline/server/src/scripts/cleanup-stale-renders.ts',
  'system-config/system.config.json', 'system-config/schema/system-config.schema.json',
  'packages/core-utils/src/system-config.generated.ts', 'scripts/validate-system-config.mjs', 'scripts/generate-system-config.mjs',
  'integrated-pipeline/pipeline-agent/src/transcribe.py',
  'integrated-pipeline/cloudflare/src/index.ts',
  'apps/admin-web/src/App.tsx', 'apps/studio-web/src/App.tsx',
  'apps/marketing-web/src/App.tsx', 'apps/release-center/src/App.tsx',
  'apps/marketing-web/src/styles.css', 'apps/release-center/src/styles.css', 'apps/desktop-shell/package.json',
  'integrated-pipeline/server/src/routes/releases.ts', 'scripts/verify-render-blueprint.mjs',
  '.github/workflows/release-master.yml', '.github/workflows/app-release.yml', 'scripts/validate-release-artifact.mjs', 'scripts/package-release-metadata.mjs', 'scripts/store-release-preflight.mjs', 'store-assets/STORE_LISTING_VI.md', 'store-assets/RELEASE_CHECKLIST.md', 'apps/marketing-web/public/privacy.html', 'apps/marketing-web/public/terms.html', 'apps/marketing-web/public/support.html', 'scripts/backup-postgres.sh', 'scripts/restore-postgres.sh',
  'scripts/audit-source.mjs', 'scripts/setup-dev.mjs', 'scripts/validate-env.mjs',
  'scripts/verify-render-runtime.mjs', 'README.md', 'DEPLOYMENT.md', 'SECURITY.md',
  'docs/API_REFERENCE.md', 'docs/INTEGRATION_STATUS.md',
];
for (const path of requiredFiles) if (!existsSync(resolve(root, path))) errors.push(`Missing required file: ${path}`);

await walk(root);
const packageFiles = files.filter(path => path.endsWith('package.json'));
const packageByName = new Map();
for (const path of packageFiles) {
  try {
    const json = JSON.parse(await readFile(path, 'utf8'));
    if (json.name) packageByName.set(json.name, { path, json });
  } catch (error) { errors.push(`Invalid JSON ${relative(root, path)}: ${error.message}`); }
}

for (const path of files) {
  const rel = relative(root, path).replaceAll('\\', '/');
  const filename = path.split(/[\\/]/).pop();
  if (filename === '.env') errors.push('Refusing to package a real .env file');
  if (rel.includes('__pycache__/') || rel.endsWith('.pyc') || rel.endsWith('.pyo')) errors.push(`Python bytecode should not be committed: ${rel}`);
  if (rel.startsWith('.secrets/')) errors.push(`Local secrets must not be committed: ${rel}`);

  if (filename.endsWith('.json') || filename === 'package.json') {
    try { JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { errors.push(`Invalid JSON ${rel}: ${error.message}`); }
  }

  if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(filename)) {
    const content = await readFile(path, 'utf8');
    const importPattern = /(?:\bfrom\s*|\bimport\s*\()\s*['"](\.[^'"]+)['"]/g;
    for (const match of content.matchAll(importPattern)) {
      if (!resolveLocalImport(path, match[1])) errors.push(`Broken relative import in ${rel}: ${match[1]}`);
    }
    const leakedKey = content.match(/(?:AIza[0-9A-Za-z_-]{30,}|sk_live_[0-9A-Za-z]{16,}|gh[pousr]_[A-Za-z0-9_]{25,}|xox[baprs]-[A-Za-z0-9-]{20,})/);
    if (leakedKey) errors.push(`Possible credential literal in ${rel}; review before publishing`);
  }
}

// Check that each workspace dependency points at a package present in this monorepo.
for (const [name, entry] of packageByName.entries()) {
  const dependencies = { ...entry.json.dependencies, ...entry.json.devDependencies, ...entry.json.peerDependencies };
  for (const [dep, version] of Object.entries(dependencies)) {
    if (version === 'workspace:*' && !packageByName.has(dep)) {
      errors.push(`${relative(root, entry.path)} depends on missing workspace ${dep}`);
    }
  }
}

// Basic repository safety check: only the example environment file should be checked in.
const ignorePath = resolve(root, '.gitignore');
if (existsSync(ignorePath)) {
  const ignore = await readFile(ignorePath, 'utf8');
  for (const pattern of [/^\.env\s*$/m, /^\.secrets\/?\s*$/m, /^__pycache__\/?\s*$/m, /^\*\.py\[cod\]\s*$/m]) {
    if (!pattern.test(ignore)) warnings.push(`Consider adding ignore pattern ${pattern.source} to .gitignore`);
  }
} else errors.push('Missing .gitignore');

const summary = {
  filesScanned: files.length,
  packageManifests: packageFiles.length,
  workspaces: packageByName.size,
  errors: errors.length,
  warnings: warnings.length,
};
console.log('Hendy Studio Pro source audit');
console.log(JSON.stringify(summary, null, 2));
for (const warning of warnings) console.warn(`WARN ${warning}`);
for (const error of errors) console.error(`FAIL ${error}`);
if (errors.length) process.exit(1);
console.log('PASS: required files, manifests, local imports, workspace links, and credential-pattern scan.');
console.log('NOTE: this is a static source audit; it does not compile TypeScript or test live services.');
