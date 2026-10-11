#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve, relative } from 'node:path';

const args = process.argv.slice(2);
const value = key => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined; };
const versionRaw = value('--version') || process.env.RELEASE_VERSION || process.env.GITHUB_REF_NAME || '0.0.0-local';
const version = versionRaw.replace(/^v(?=\d)/, '');
const product = value('--product') || 'Hendy Studio Pro';
const channel = value('--channel') || process.env.RELEASE_CHANNEL || 'stable';
const output = resolve(value('--output') || 'release-out/release-manifest.json');
const notesFile = value('--notes-file');
const fileArgs = args.filter((arg, i) => !['--version','--product','--channel','--output','--notes-file'].includes(arg) && args[i - 1] !== '--version' && args[i - 1] !== '--product' && args[i - 1] !== '--channel' && args[i - 1] !== '--output' && args[i - 1] !== '--notes-file' && !arg.startsWith('--'));
const files = fileArgs;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
if (!semver.test(version) && !version.endsWith('-local')) { console.error(`Version must be semantic version: ${version}`); process.exit(2); }
if (!['stable','beta','nightly'].includes(channel)) { console.error(`Unsupported channel: ${channel}`); process.exit(2); }
async function hashFile(file) { const hash=createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
const artifacts=[];
for (const raw of files) {
  const file=resolve(raw); const info=await stat(file);
  if (!info.isFile() || info.size <= 0) throw new Error(`Invalid artifact: ${raw}`);
  artifacts.push({ fileName: basename(file), path: relative(process.cwd(), file).replaceAll('\\','/'), sizeBytes: info.size, sha256: await hashFile(file) });
}
const notes = notesFile ? (await (await import('node:fs/promises')).readFile(resolve(notesFile),'utf8')).trim() : '';
const manifest={ schemaVersion:1, productName:product, version, channel, createdAt:new Date().toISOString(), commit:process.env.GITHUB_SHA||null, sourceRef:process.env.GITHUB_REF||null, releaseNotes:notes, artifacts };
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(manifest,null,2)+'\n','utf8');
console.log(`Wrote ${output} with ${artifacts.length} verified artifact(s).`);
