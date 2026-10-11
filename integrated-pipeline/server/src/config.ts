import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

dotenv.config({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')] });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE_ROLE: z.enum(['api', 'worker']).default('api'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(Number(process.env.PORT) || 8080),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must contain at least 32 characters'),
  JWT_TTL: z.string().regex(/^\d+[smhd]$/, 'JWT_TTL must be a duration such as 15m, 1h, or 1d').default('15m'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  WHISPER_API_URL: z.string().optional().default(''),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  MONGODB_URI: z.string().min(1),
  MONGODB_DATABASE: z.string().default('hendy_studio'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
  ADMIN_WEB_ORIGIN: z.string().optional().default(''),
  STUDIO_WEB_ORIGIN: z.string().optional().default(''),
  MARKETING_WEB_ORIGIN: z.string().optional().default(''),
  RELEASE_CENTER_ORIGIN: z.string().optional().default(''),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional().default(''),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  S3_PUBLIC_BASE_URL: z.string().optional().default(''),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  METRICS_TOKEN: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Server configuration invalid. Check .env.example.');
}

export const config = parsed.data;
const looksLikePlaceholder = (value: string) => /change-this|replace-with|dev_only|placeholder|example\.com/i.test(value);

if (config.NODE_ENV === 'production') {
  if (looksLikePlaceholder(config.JWT_SECRET)) throw new Error('Production JWT_SECRET must not be a placeholder');
  if (Buffer.byteLength(config.JWT_SECRET, 'utf8') < 32) throw new Error('Production JWT_SECRET must contain at least 32 UTF-8 bytes');
  if (config.SERVICE_ROLE === 'api') {
    if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
      throw new Error('Production API requires ADMIN_EMAIL and ADMIN_PASSWORD to bootstrap the first administrator');
    }
    if (config.ADMIN_PASSWORD.length < 16 || Buffer.byteLength(config.ADMIN_PASSWORD, 'utf8') > 72 || looksLikePlaceholder(config.ADMIN_PASSWORD)) {
      throw new Error('Production ADMIN_PASSWORD must be non-placeholder, 16+ characters and at most 72 UTF-8 bytes');
    }
    if (config.CORS_ORIGINS.split(',').some(origin => origin.trim() === '*' || origin.includes('localhost'))) {
      throw new Error('Production CORS_ORIGINS must contain only exact deployed origins');
    }
    if (!config.METRICS_TOKEN || config.METRICS_TOKEN.length < 24 || looksLikePlaceholder(config.METRICS_TOKEN)) {
      throw new Error('Production METRICS_TOKEN must be a unique secret of at least 24 characters');
    }
  }
  if (!config.S3_BUCKET || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
    throw new Error('Production requires an object storage bucket and S3-compatible access credentials');
  }
  if (config.S3_ENDPOINT && !config.S3_ENDPOINT.startsWith('https://')) {
    throw new Error('Production S3_ENDPOINT must use HTTPS when specified');
  }
}

export const allowedOrigins = [...new Set([...config.CORS_ORIGINS.split(','), config.ADMIN_WEB_ORIGIN, config.STUDIO_WEB_ORIGIN, config.MARKETING_WEB_ORIGIN, config.RELEASE_CENTER_ORIGIN].map(value => value.trim().replace(/\/$/, '')).filter(Boolean))];
export const storageConfigured = Boolean(config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY);
