import app from './app.js';
import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { ensureSpacesCors } from './config/storage.js';
import { logger } from './utils/logger.js';

async function start() {
  await connectDb();
  await ensureSpacesCors();

  app.listen(env.PORT, () => {
    logger.info(`API server running on http://localhost:${env.PORT}`);
  });
}

start().catch((err) => {
  logger.error('Failed to start server', {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
