#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const args = process.argv.slice(2);
let manifestPath = '';
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--manifest') {
    if (!args[i + 1]) { console.error('Missing path after --manifest'); process.exit(2); }
    manifestPath = args[++i];
  } else files.push(args[i]);
}
if (files.length === 0) {
  console.error('Usage: node scripts/validate-release-artifact.mjs [--manifest FILE] ARTIFACT...');
  process.exit(2);
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function verifyMagic(file) {
  const ext = basename(file).toLowerCase().split('.').slice(1).join('.');
  const h = await open(file, 'r');
  try {
    const b = Buffer.alloc(8);
    const { bytesRead } = await h.read(b, 0, 8, 0);
    const start = b.subarray(0, bytesRead);
    const checks = {
      exe: start.subarray(0, 2).toString() === 'MZ',
      apk: start.subarray(0, 4).toString('hex') === '504b0304',
      aab: start.subarray(0, 4).toString('hex') === '504b0304',
      appx: start.subarray(0, 4).toString('hex') === '504b0304',
      msix: start.subarray(0, 4).toString('hex') === '504b0304',
      msixupload: start.subarray(0, 4).toString('hex') === '504b0304',
      msixbundle: start.subarray(0, 4).toString('hex') === '504b0304',
      appxbundle: start.subarray(0, 4).toString('hex') === '504b0304',
      ipa: start.subarray(0, 4).toString('hex') === '504b0304',
      zip: start.subarray(0, 4).toString('hex') === '504b0304',
      appimage: start.subarray(0, 4).toString() === '\x7fELF',
      deb: start.subarray(0, 8).toString() === '!<arch>\n',
      rpm: start.subarray(0, 4).toString('hex') === 'edabeedb',
      pkg: start.subarray(0, 4).toString() === 'xar!',
      'tar.gz': start.subarray(0, 2).toString('hex') === '1f8b',
      tgz: start.subarray(0, 2).toString('hex') === '1f8b',
      dmg: true, // DMG is a block-offset disk image; shallow header validation would be misleading.
      msi: true, // Windows Installer is an OLE compound file; validate with platform tooling.
      blockmap: true,
      yml: true,
      yaml: true,
      txt: true,
      json: true,
      html: true,
      js: true,
      css: true,
      svg: true,
      png: start.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    };
    const normalized = ext === 'tar.gz' ? 'tar.gz' : ext;
    if (normalized in checks && checks[normalized] === false) throw new Error(`Unexpected file signature for .${normalized}`);
  } finally { await h.close(); }
}

const records = [];
for (const raw of files) {
  const file = resolve(raw);
  const info = await stat(file).catch(err => { throw new Error(`${raw}: ${err.message}`); });
  if (!info.isFile()) throw new Error(`${raw}: not a regular file`);
  if (info.size <= 0) throw new Error(`${raw}: empty artifact`);
  await verifyMagic(file);
  const digest = await sha256(file);
  records.push({ path: raw.replaceAll('\\', '/'), sizeBytes: info.size, sha256: digest });
  console.log(`PASS ${raw} (${info.size} bytes) sha256=${digest}`);
}
if (manifestPath) {
  const body = records.map(x => `${x.sha256}  ${x.path}  # size=${x.sizeBytes}`).join('\n') + '\n';
  await writeFile(resolve(manifestPath), body, 'utf8');
  console.log(`Wrote manifest: ${manifestPath}`);
}
