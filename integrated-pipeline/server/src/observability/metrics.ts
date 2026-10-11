import { Router } from 'express';
import client from 'prom-client';
import { config } from '../config.js';

export const register = new client.Registry();
register.setDefaultLabels({ service: 'hendy-studio-api', environment: config.NODE_ENV });
client.collectDefaultMetrics({ register });
export const httpRequests = new client.Counter({ name: 'hendy_http_requests_total', help: 'HTTP requests processed', labelNames: ['method', 'route', 'status'] as const, registers: [register] });
export const httpDuration = new client.Histogram({ name: 'hendy_http_request_duration_seconds', help: 'HTTP request duration in seconds', labelNames: ['method', 'route', 'status'] as const, buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], registers: [register] });
export const metricsRouter = Router();
metricsRouter.get('/', async (req, res, next) => {
  if (!config.METRICS_TOKEN || req.header('authorization') !== `Bearer ${config.METRICS_TOKEN}`) {
    res.status(401).json({ error: 'Metrics authentication required' }); return;
  }
  try { res.setHeader('Content-Type', register.contentType); res.end(await register.metrics()); }
  catch (error) { next(error); }
});
