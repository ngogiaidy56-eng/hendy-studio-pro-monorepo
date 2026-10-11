#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
console.log('# Paste into a secret manager or .env file. Do not commit generated values.');
console.log(`JWT_SECRET=${randomBytes(48).toString('base64url')}`);
console.log(`POSTGRES_PASSWORD=${randomBytes(32).toString('base64url')}`);
console.log(`ADMIN_PASSWORD=${randomBytes(24).toString('base64url')}`);
console.log(`METRICS_TOKEN=${randomBytes(32).toString('base64url')}`);
console.log(`GRAFANA_ADMIN_PASSWORD=${randomBytes(24).toString('base64url')}`);
