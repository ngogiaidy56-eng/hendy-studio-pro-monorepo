#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const raw = process.argv[2] || process.env.RELEASE_VERSION || '';
const version = raw.replace(/^v(?=\d)/, '');
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
if (!semver.test(version)) {
  console.error(`Expected a semantic release version (for example 1.2.0 or 1.2.0-rc.1); received: ${raw || '(empty)'}`);
  process.exit(2);
}
const packagePath = resolve(process.cwd(), 'package.json');
const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
if (pkg.name !== '@hendy/desktop-shell') throw new Error(`Refusing to change unexpected package at ${packagePath}`);
pkg.version = version;
await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log(`Set desktop package version to ${version}`);
