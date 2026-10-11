#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const configPath = resolve(root, 'system-config/system.config.json');
const schemaPath = resolve(root, 'system-config/schema/system-config.schema.json');
const [config, schema] = await Promise.all([
  readFile(configPath, 'utf8').then(JSON.parse),
  readFile(schemaPath, 'utf8').then(JSON.parse),
]);
const errors = [];
const require = (condition, message) => { if (!condition) errors.push(message); };
require(schema.$schema === 'https://json-schema.org/draft/2020-12/schema', 'Unexpected JSON Schema draft');
require(config.schemaVersion === 1, 'schemaVersion must be 1');
require(/^[a-z0-9-]+$/.test(config.app?.slug ?? ''), 'app.slug must be lowercase kebab-case');
require(/^\d+\.\d+\.\d+$/.test(config.app?.version ?? ''), 'app.version must use semantic versioning');
const ports = [config.network?.apiPort, config.network?.adminPort, config.network?.studioPort, config.network?.ktorPort];
require(ports.every(n => Number.isInteger(n) && n >= 1 && n <= 65535), 'All service ports must be integers in 1..65535');
require(new Set(ports).size === ports.length, 'Service ports must be unique');
require(config.network?.maxTrustedProxyHops >= 0 && config.network?.maxTrustedProxyHops <= 5, 'maxTrustedProxyHops must be in 0..5');
for (const key of ['maxUploadBytes', 'maxSubtitleBytes', 'maxImageBytes', 'maxSourceBytesPerRender', 'maxOutputBytes', 'maxClipsPerRender', 'maxUniqueAssetsPerRender', 'maxTimelineSeconds']) {
  require(Number.isSafeInteger(config.media?.[key]) && config.media[key] > 0, `media.${key} must be a positive safe integer`);
}
require(config.media?.maxOutputBytes <= config.media?.maxUploadBytes, 'maxOutputBytes must not exceed maxUploadBytes in this starter profile');
require(config.media?.subtitleRenderFormat === 'srt', 'Compositor currently supports SRT, so subtitleRenderFormat must remain srt');
require(/^\d+[smhd]$/.test(config.security?.jwtAccessTtl ?? ''), 'security.jwtAccessTtl must be a duration such as 15m');
require(config.security?.presignedUrlTtlSeconds >= 60 && config.security?.presignedUrlTtlSeconds <= 900, 'Presigned URL lifetime must be within 60..900 seconds');
require(config.features?.rbac === true && config.features?.auditLog === true, 'RBAC and auditLog must not be disabled in this profile');
if (errors.length) {
  console.error('System configuration invalid:');
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}
console.log(`PASS: ${config.app.name} ${config.app.version} system configuration (${Object.keys(config.features).length} feature flags).`);
console.log(`Schema file parsed: ${schemaPath}. This dependency-free validator enforces critical invariants; use a JSON Schema validator for full schema conformance.`);
