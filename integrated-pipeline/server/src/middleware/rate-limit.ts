import { rateLimit } from 'express-rate-limit';

/** Process-local limit. Use a Redis-backed store when scaling across replicas. */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' },
  skipSuccessfulRequests: true,
});

// Registration counts successful requests too, preventing unlimited account creation from one source.
export const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Registration rate limit reached. Try again later.' },
});

export const aiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'AI request rate limit reached. Try again shortly.' },
});
