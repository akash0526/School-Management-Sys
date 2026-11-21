import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { AppError, forbidden, fromDatabaseError } from '../errors.js';

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const rid = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  (req as any).id = rid;
  res.setHeader('X-Request-Id', rid);
  next();
};

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
};

/** Central error handler: consistent JSON, no stack traces or SQL leaked to clients. */
export function createErrorHandler(logger: Logger, isProduction: boolean): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let appError: AppError | null = null;

    if (err instanceof AppError) appError = err;
    else if (err instanceof ZodError) {
      appError = new AppError(
        400,
        'VALIDATION_ERROR',
        'Invalid request data',
        err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    } else if (err?.type === 'entity.too.large') appError = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
    else if (err?.type === 'entity.parse.failed') appError = new AppError(400, 'INVALID_JSON', 'Malformed JSON body');
    else appError = fromDatabaseError(err);

    if (!appError) {
      logger.error({ err, reqId: (req as any).id, path: req.path }, 'Unhandled error');
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Something went wrong',
          requestId: (req as any).id,
          ...(isProduction ? {} : { debug: String(err?.message ?? err) }),
        },
      });
      return;
    }

    if (appError.status >= 500) logger.error({ err, reqId: (req as any).id }, appError.message);
    else if (appError.status === 403) {
      // visible trail of authorization probing (who tried what)
      logger.warn({ reqId: (req as any).id, method: req.method, path: req.path, userId: req.auth?.userId, apiClient: req.apiClient?.name, code: appError.code }, 'Forbidden');
    }
    res.status(appError.status).json({
      error: { code: appError.code, message: appError.message, details: appError.details, requestId: (req as any).id },
    });
  };
}

/** Rate limiter factory (in-memory; use a Redis store when running several instances). */
export function limiter(opts: { windowMinutes: number; max: number; keyPrefix: string; key?: (req: any) => string }) {
  return rateLimit({
    windowMs: opts.windowMinutes * 60_000,
    limit: opts.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: opts.key ? (req) => `${opts.keyPrefix}:${opts.key!(req)}` : undefined,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later' } });
    },
  });
}

/**
 * Defence-in-depth CSRF guard for COOKIE-authenticated endpoints (refresh / logout).
 * SameSite=Strict already blocks cross-SITE requests, but www.school.edu.np and
 * portal.school.edu.np are the same "site" — so a browser request must also come from
 * an allow-listed ORIGIN. Requests without Origin (mobile apps, curl, server-to-server)
 * carry no ambient browser cookies and are allowed.
 */
export function requireTrustedOrigin(allowed: string[]): RequestHandler {
  return (req, _res, next) => {
    const origin = req.get('origin');
    if (origin && !allowed.includes(origin)) throw forbidden('Request origin not allowed', 'ORIGIN_NOT_ALLOWED');
    next();
  };
}

/** Personal data must never be stored by browsers or shared proxies. Public routes override this. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
};
