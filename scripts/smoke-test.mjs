#!/usr/bin/env node
const base = (process.env.API_ORIGIN || 'http://127.0.0.1:8080').replace(/\/$/, '');
const routes = ['/healthz'];
let failed = false;
for (const route of routes) {
  try {
    const response = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(5000) });
    const body = await response.json().catch(() => null);
    const ok = response.ok && body?.status === 'ok';
    console.log(`${ok ? 'PASS' : 'FAIL'} ${route} -> HTTP ${response.status}`);
    if (!ok) {
      failed = true;
      console.error(JSON.stringify(body));
    }
  } catch (error) {
    failed = true;
    console.error(`FAIL ${route}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (failed) {
  console.error(`Smoke test failed. Check API_ORIGIN (current: ${base}) and service logs.`);
  process.exit(1);
}
console.log('Smoke test passed.');
