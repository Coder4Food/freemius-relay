const express = require('express');

module.exports = function createHealthRouter(deps) {
  const router = express.Router();
  const pool = deps.pool;
  const logger = deps.logger;

  router.get('/health', async function (req, res) {
    try {
      logger.log('[HEALTH] checking database.');
      const result = await pool.query('SELECT NOW()');
      logger.log('[HEALTH] db ok db_time_utc=%s', result.rows[0].now);
      return res.json({
        ok: true,
        service: 'freemius-relay',
        time_utc: new Date().toISOString(),
        db_ok: true,
        db_time_utc: result.rows[0].now,
        debug_log: logger.debugEnabled,
      });
    } catch (err) {
      logger.logError('[HEALTH-ERR]', err);
      return res.status(500).json({
        ok: false,
        service: 'freemius-relay',
        error: 'db_unavailable',
        detail: err.message,
        debug_log: logger.debugEnabled,
      });
    }
  });

  return router;
};
