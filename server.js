const express = require('express');
const env = require('./config/env');
const pool = require('./config/db');
const { createLogger } = require('./services/logger');
const { initDb } = require('./services/dbInit');
const { verifyPassword } = require('./services/passwords');
const { createAdminAuth } = require('./services/adminAuth');
const { createRequestLogger } = require('./middleware/requestLogger');
const createHealthRouter = require('./routes/health');
const createLicenseRouter = require('./routes/license');
const createFreemiusRouter = require('./routes/freemius');
const createCustomerRouter = require('./routes/customer');
const createAdminRouter = require('./routes/admin');

const app = express();
const logger = createLogger(env.debugLog);
const adminAuth = createAdminAuth({
  logger: logger,
  verifyPassword: verifyPassword,
  adminUsername: env.adminUsername,
  adminPasswordHash: env.adminPasswordHash,
  tokenTtlMinutes: env.adminTokenTtlMinutes,
});

app.use(express.json({ limit: '1mb' }));
app.use(createRequestLogger(logger));

const deps = {
  pool: pool,
  logger: logger,
  adminAuth: adminAuth,
};

app.use(createHealthRouter(deps));
app.use(createLicenseRouter(deps));
app.use(createCustomerRouter(deps));
app.use(createAdminRouter(deps));
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
