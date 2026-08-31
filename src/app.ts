import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { allRules } from './engine/catalog';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { errorHandler, notFoundHandler } from './middleware/error';
import { auditRouter } from './modules/audit/audit.routes';
import { authRouter } from './modules/auth/auth.routes';
import { companiesRouter } from './modules/companies/companies.routes';
import { complianceRouter } from './modules/compliance/compliance.routes';
import { copilotRouter, rulesRouter } from './modules/copilot/copilot.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { documentsRouter } from './modules/documents/documents.routes';
import { internalRouter } from './modules/internal/internal.routes';
import { lookupRouter } from './modules/lookup/lookup.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { tasksRouter } from './modules/tasks/tasks.routes';

export function createApp(): Express {
  const app = express();

  // Behind a load balancer, express-rate-limit and req.ip need the real client IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || env.corsOrigins.includes(origin) || env.corsOrigins.includes('*')) return cb(null, true);
        cb(new Error(`Origin ${origin} is not allowed`));
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => req.path === '/health' || req.path === '/ready',
    }),
  );

  // ------------------------------------------------------------- index
  // When the dashboard is served from this origin it owns `/`. Otherwise a bare
  // 404 at the root is unhelpful to anyone poking at the API in a browser, so
  // serve a discovery document instead.
  if (!env.SERVE_WEB) app.get('/', (_req, res) => {
    res.json({
      name: 'India Compliance Toolkit API',
      version: '0.1.0',
      status: 'ok',
      rules: allRules.length,
      docs: 'See README.md for the full route reference.',
      authentication: {
        scheme: 'Authorization: Bearer <accessToken>',
        obtain: 'POST /api/v1/auth/login  { "email", "password" }',
        note: 'Only /health, /ready and the auth endpoints are public. A browser address bar cannot send the header, so use curl, Postman or the frontend.',
      },
      health: { liveness: '/health', readiness: '/ready' },
      endpoints: {
        auth: '/api/v1/auth',
        companies: '/api/v1/companies',
        compliance: '/api/v1/compliance',
        tasks: '/api/v1/tasks',
        documents: '/api/v1/documents',
        notifications: '/api/v1/notifications',
        dashboard: '/api/v1/dashboard',
        audit: '/api/v1/audit',
        copilot: '/api/v1/copilot',
        rules: '/api/v1/rules',
        lookup: '/api/v1/lookup',
      },
    });
  });

  // ------------------------------------------------------------- health
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()), rules: allRules.length });
  });

  app.get('/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready', database: 'up', storage: env.storageDriver, mail: env.mailDriver });
    } catch (err) {
      res.status(503).json({ status: 'degraded', database: 'down', detail: (err as Error).message });
    }
  });

  // ------------------------------------------------------------- api
  const api = express.Router();
  api.use('/auth', authRouter);
  api.use('/companies', companiesRouter);
  api.use('/compliance', complianceRouter);
  api.use('/tasks', tasksRouter);
  api.use('/documents', documentsRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/audit', auditRouter);
  api.use('/copilot', copilotRouter);
  api.use('/rules', rulesRouter);
  api.use('/lookup', lookupRouter);

  app.use('/api/v1', api);

  // Not under /api/v1 and not user-authenticated: this is the operator surface
  // for an external scheduler, guarded by JOB_TRIGGER_SECRET.
  app.use('/internal', internalRouter);

  // ------------------------------------------------------------- web app
  // Optional: serve the built SPA from the same origin, so there is no CORS
  // configuration and no API base URL baked into the bundle.
  if (env.SERVE_WEB) {
    const dist = path.resolve(env.WEB_DIST_DIR);
    if (!fs.existsSync(path.join(dist, 'index.html'))) {
      logger.error({ dist }, 'SERVE_WEB is on but no build was found — run `npm run web:build`');
    } else {
      // Hashed asset filenames are safe to cache hard; index.html never is,
      // or clients keep booting the previous release after a deploy.
      app.use(
        express.static(dist, {
          index: false,
          setHeaders: (res, filePath) => {
            res.setHeader(
              'Cache-Control',
              filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
            );
          },
        }),
      );

      // Client-side routes fall through to the shell. API and operator paths
      // must still 404 as JSON, so they are excluded explicitly.
      app.get(/^(?!\/api\/|\/internal\/|\/health$|\/ready$).*/, (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(dist, 'index.html'));
      });

      logger.info({ dist }, 'serving the web dashboard');
    }
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
