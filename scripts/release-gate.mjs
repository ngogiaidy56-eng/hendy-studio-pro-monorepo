#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const run = (label, command, args) => {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`Release gate stopped: ${label} failed with exit code ${result.status ?? 1}`);
    process.exit(result.status ?? 1);
  }
};

run('static source audit', process.execPath, [resolve(root, 'scripts/audit-source.mjs')]);
const bun = spawnSync('bun', ['--version'], { encoding: 'utf8' });
if (bun.status !== 0) {
  console.error('\nBun is not installed; dependency-backed checks could not run.');
  console.error('Install Bun 1.2.15, then run: bun install && bun run typecheck && bun run test && bun run build');
  process.exit(2);
}
run('Bun dependency install', 'bun', ['install']);
run('TypeScript typecheck', 'bun', ['run', 'typecheck']);
run('Unit tests', 'bun', ['run', 'test']);
run('Production frontend/API build', 'bun', ['run', 'build']);
run('Python agent tests', 'python', ['-m', 'unittest', 'discover', '-s', 'integrated-pipeline/pipeline-agent/tests', '-v']);
console.log('\nRelease gate passed. Staging/security review remains required.');
