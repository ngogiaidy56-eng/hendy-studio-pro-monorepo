import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { config, allowedOrigins } from './config.js';
import { pool } from './db/postgres.js';
import { closeMongo, connectMongo, mongoDb } from './db/mongo.js';
import { redis, renderQueue } from './queue.js';
import { authRouter } from './routes/auth.js';
import { aiRouter } from './routes/ai.js';
import { adminRouter } from './routes/admin.js';
import { projectsRouter } from './routes/projects.js';
import { renderRouter } from './routes/render.js';
import { assetsRouter } from './routes/assets.js';
import { releasesRouter } from './routes/releases.js';
import { httpDuration, httpRequests, metricsRouter } from './observability/metrics.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.TRUST_PROXY_HOPS > 0 ? config.TRUST_PROXY_HOPS : false);

app.use((req, res, next) => {
  req.requestId = (req.header('x-request-id') ?? '').replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 100) || randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});
app.use(pinoHttp({ redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.x-goog-api-key'] }));
app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.once('finish', () => {
    const route = req.route?.path ? String(req.route.path) : (req.path.startsWith('/api/v1/') ? req.path.replace(/\/[^/0-9a-f-]{8,}/gi, '/:param') : req.path);
    const labels = { method: req.method, route: route.slice(0, 120), status: String(res.statusCode) };
    httpRequests.inc(labels);
    httpDuration.observe(labels, Number(process.hrtime.bigint() - started) / 1e9);
  });
  next();
});
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], imgSrc: ["'self'", 'data:', 'blob:'],
    connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
  } },
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID'],
  maxAge: 600,
}));
app.use(express.json({ limit: '2mb', strict: true }));

app.use('/metrics', metricsRouter);

app.get('/healthz', async (_req, res) => {
  const services: Record<string, string> = { api: 'ok' };
  try { await pool.query('SELECT 1'); services.postgres = 'ok'; } catch { services.postgres = 'error'; }
  try { await redis.ping(); services.redis = 'ok'; } catch { services.redis = 'error'; }
  try { await mongoDb().command({ ping: 1 }); services.mongo = 'ok'; } catch { services.mongo = 'error'; }
  const healthy = Object.values(services).every(value => value === 'ok');
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', services, time: new Date().toISOString() });
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/ai', aiRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/projects', projectsRouter);
app.use('/api/v1/render', renderRouter);
app.use('/api/v1/assets', assetsRouter);
app.use('/api/v1/releases', releasesRouter);
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const err = error as { message?: string; status?: number; statusCode?: number; type?: string };
  const badJson = err?.type === 'entity.parse.failed';
  const knownStatus = Number(err?.statusCode ?? err?.status);
  const status = err?.message === 'Origin not allowed by CORS' ? 403
    : err?.code === '23505' ? 409
    : err?.code === '23503' ? 409
    : badJson ? 400
    : Number.isInteger(knownStatus) && knownStatus >= 400 && knownStatus < 500 ? knownStatus
    : 500;
  if (status >= 500) {
    if (config.NODE_ENV !== 'production') console.error(`[${req.requestId}]`, error);
    else console.error(`[${req.requestId}] request failed`);
  }
  const message = status === 500 ? 'Internal server error'
    : status === 409 ? 'Resource conflict; check for an existing record or dependent resource'
    : badJson ? 'Malformed JSON body'
    : status === 403 ? 'Origin not allowed by CORS'
    : err?.message || 'Request failed';
  res.status(status).json({ error: message, requestId: req.requestId });
});

async function start() {
  if (!config.JWT_SECRET || config.JWT_SECRET.length < 32) throw new Error('JWT_SECRET too short');
  await pool.query('SELECT 1');
  await connectMongo();
  await redis.ping();
  const server = app.listen(config.API_PORT, '0.0.0.0', () => console.log(`Hendy API listening on :${config.API_PORT}`));
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down gracefully');
    await new Promise<void>(resolve => server.close(() => resolve()));
    await renderQueue.close();
    await redis.quit();
    await closeMongo();
    await pool.end();
  };
  process.on('SIGTERM', () => void shutdown().catch(error => { console.error('Shutdown failed', error); process.exitCode = 1; }));
  process.on('SIGINT', () => void shutdown().catch(error => { console.error('Shutdown failed', error); process.exitCode = 1; }));
}

start().catch(error => {
  console.error('API startup failed:', error);
  process.exitCode = 1;
});
