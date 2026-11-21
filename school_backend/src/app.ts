import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Container } from './container.js';
import { createErrorHandler, limiter, noStore, notFoundHandler, requestId } from './shared/http/middleware.js';

/** Builds the Express app from a container (tests pass their own container). */
export function createApp(container: Container) {
  const { env, logger, db } = container.core;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY); // correct client IPs behind nginx (rate limits, sessions)
  app.set('query parser', 'simple');

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as any).id,
      autoLogging: { ignore: (req) => req.url === '/health' },
      // only id/method/url are logged — no headers, so tokens, cookies and API keys never reach the logs
      serializers: { req: (req) => ({ id: req.id, method: req.method, url: req.url }), res: (res) => ({ statusCode: res.statusCode }) },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, // JSON API: nothing to load or frame
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGINS.includes(origin)), // server-to-server calls have no Origin
      credentials: true, // refresh-token cookie
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-API-Key'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(
    express.json({
      limit: '1mb',
      // defence in depth against huge-array DoS: no request legitimately sends >1000 items
      reviver: (_key, value) => {
        if (Array.isArray(value) && value.length > 1000) throw new SyntaxError('Array too large');
        return value;
      },
    }),
  );
  app.use(cookieParser());

  app.get('/health', async (_req, res) => {
    const dbOk = await db.ping();
    res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ok' : 'degraded', db: dbOk ? 'up' : 'down' });
  });

  const api = Router();
  api.use(limiter({ windowMinutes: 1, max: env.API_RATE_LIMIT_PER_MIN, keyPrefix: 'api' })); // general safety net per IP (shared by everyone behind one NAT)
  api.use(noStore); // personal data: never cached (public website routes set their own Cache-Control)
  for (const m of container.modules) {
    for (const r of m.routes) api.use(r.path, ...(r.middleware ?? []), r.router);
  }
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger, env.NODE_ENV === 'production'));
  return app;
}
