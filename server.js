const express = require('express');
const env = require('./config/env');
const pool = require('./config/db');
const { createLogger } = require('./services/logger');
const { initDb } = require('./services/dbInit');
const { verifyPassword } = require('./services/passwords');
const { createAdminAuth } = require('./services/adminAuth');
const { createKeapClient } = require('./services/keap');
const { createKeapCohortSync } = require('./services/keapCohortSync');
const { createRequestLogger } = require('./middleware/requestLogger');
const createHealthRouter = require('./routes/health');
const createLicenseRouter = require('./routes/license');
const createFreemiusRouter = require('./routes/freemius');
const createCustomerRouter = require('./routes/customer');
const createAdminRouter = require('./routes/admin');
const createWebhooksRouter = require('./routes/webhooks');

const app = express();
const logger = createLogger(env.debugLog);
const adminAuth = createAdminAuth({
  logger: logger,
  verifyPassword: verifyPassword,
  adminUsername: env.adminUsername,
  adminPasswordHash: env.adminPasswordHash,
  tokenTtlMinutes: env.adminTokenTtlMinutes,
});
const keap = createKeapClient({
  env: env,
  logger: logger,
});
const keapCohortSync = createKeapCohortSync({
  pool: pool,
  logger: logger,
  keap: keap,
});

app.use(express.json({ limit: '1mb' }));
app.use(createRequestLogger(logger));

const deps = {
  pool: pool,
  logger: logger,
  env: env,
  adminAuth: adminAuth,
  keap: keap,
  keapCohortSync: keapCohortSync,
};

app.use(createHealthRouter(deps));
app.use(createLicenseRouter(deps));
app.use(createCustomerRouter(deps));
app.use(createAdminRouter(deps));
app.use(createWebhooksRouter(deps));
app.use(createFreemiusRouter(deps));

async function start() {
  try {
    logger.log('[START] DEBUG_LOG=%s', logger.debugEnabled ? '1' : '0');
    await initDb(pool, logger);
    app.listen(env.port, function () {
      console.log('[START] freemius-relay listening on port %s', env.port);
      console.log('[START] DEBUG_LOG=%s', logger.debugEnabled ? '1' : '0');
    });
  } catch (err) {
    logger.logError('[START-ERR]', err);
    process.exit(1);
  }
}

start();
