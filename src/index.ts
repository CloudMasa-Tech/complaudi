import type { Server } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { allRules } from './engine/catalog';
import { logger } from './lib/logger';
import { verifyMailer } from './lib/mailer';
import { disconnectPrisma, prisma } from './lib/prisma';
import { startScheduler, stopScheduler } from './jobs/scheduler';
import { refreshOverlays } from './modules/regulatory/regulatory.service';

async function main(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
  logger.info('database connection established');

  if (env.mailDriver === 'smtp') {
    const ok = await verifyMailer();
    logger.info({ smtp: ok ? 'verified' : 'unverified' }, 'mail transport');
  } else {
    logger.warn('SMTP_HOST is not set — reminder emails will be logged, not delivered');
  }

  // Approved regulatory amendments live in the database; the engine holds none
  // until they are pushed in. Load them before the first request, or a replica
  // that just restarted would briefly serve the un-amended catalog.
  const overlays = await refreshOverlays();
  if (overlays.skipped > 0) {
    logger.warn({ ...overlays }, 'some rule overlays could not be applied — see the errors above');
  }

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        rules: allRules.length,
        overlays: overlays.active,
        storage: env.storageDriver,
        regulatoryWatch: env.regulatoryWatchEnabled ? env.ANTHROPIC_MODEL : 'off',
      },
      `compliance API listening on http://localhost:${env.PORT}`,
    );
  });

  // Node closes an idle keep-alive socket after 5 seconds. Anything that pools
  // connections to this server — the dev proxy in front of the web app, a load
  // balancer in production — will now and then put a request onto a socket the
  // server is closing in that same instant. The request is not refused, it is
  // simply lost, and the client hangs until its own timeout: the dev server
  // showed this as the dashboard intermittently never loading.
  //
  // Hold idle sockets open for longer than any sane client keeps them, and give
  // headers a longer budget still, or the header timer fires first and undoes it.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  startScheduler();

  // Finish in-flight requests before closing the database connection.
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopScheduler();
    server.close(() => {
      void disconnectPrisma().finally(() => process.exit(0));
    });
    setTimeout(() => {
      logger.error('forced shutdown after 10s grace period');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled promise rejection'));
}

main().catch((err) => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});
