#!/usr/bin/env node
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = process.cwd();
const envText = await readFile(resolve(root, '.env'), 'utf8').catch(() => { throw new Error('Missing .env; copy .env.example and set METRICS_TOKEN first.'); });
const env = Object.fromEntries(envText.split(/\r?\n/).flatMap(line => { const m=line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); return m ? [[m[1],m[2].replace(/^['"]|['"]$/g,'')]] : []; }));
const token = env.METRICS_TOKEN || '';
const grafanaPassword = env.GRAFANA_ADMIN_PASSWORD || '';
if (token.length < 24 || /replace-with|placeholder|change-this/i.test(token)) throw new Error('METRICS_TOKEN must be a unique secret of at least 24 characters.');
if (grafanaPassword.length < 20 || /replace-with|placeholder|change-this/i.test(grafanaPassword)) throw new Error('GRAFANA_ADMIN_PASSWORD must be a unique secret of at least 20 characters.');
const secretsDir=resolve(root,'.secrets'); await mkdir(secretsDir,{recursive:true,mode:0o700});
const tokenPath=resolve(secretsDir,'metrics_token'); await writeFile(tokenPath,token+'\n',{mode:0o600}); await chmod(tokenPath,0o600);
console.log('Monitoring secret file prepared at .secrets/metrics_token.');
console.log('Start optional local monitoring with: docker compose --profile observability up -d prometheus grafana');
