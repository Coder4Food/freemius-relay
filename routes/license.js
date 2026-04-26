const express = require('express');

module.exports = function createLicenseRouter(deps) {
  const router = express.Router();
  const pool = deps.pool;
  const logger = deps.logger;

  router.get('/api/license/diagnostics', async function (req, res) {
    try {
      logger.log('[DIAG] /api/license/diagnostics entered.');
      let dbOk = false;

      try {
        const result = await pool.query('SELECT 1');
        dbOk = result && result.rows && result.rows.length > 0;
        logger.log('[DIAG] db check ok.');
      } catch (dbErr) {
        logger.logError('[DIAG-DB-ERR]', dbErr);
        dbOk = false;
      }

      return res.status(200).json({
        status: 'ok',
        message: 'relay alive',
        db_ok: dbOk,
        time_utc: logger.nowUtc(),
      });
    } catch (err) {
      logger.logError('[DIAG-ERR]', err);
      return res.status(500).json({
        status: 'error',
        message: 'diagnostics failed',
        detail: err.message,
      });
    }
  });

  router.get('/api/license/latest', async function (req, res) {
    try {
      const email = logger.normalizeEmail(req.query.email);

      logger.log(
        '[API] /api/license/latest entered. rawEmail=%s normalizedEmail=%s',
        req.query.email || '',
        email,
      );

      if (!email) {
        logger.log('[API] email_required.');
        return res.status(400).json({
          status: 'bad_request',
          message: 'email is required',
        });
      }

      const result = await pool.query(
        `
        SELECT email, license_key, received_utc, event_type, environment
        FROM licenses
        WHERE email = $1
        `,
        [email],
      );

      logger.log('[API] query complete rowCount=%s', result.rows.length);

      if (result.rows.length === 0) {
        logger.log('[API] not_found for email=%s', email);
        return res.status(404).json({
          status: 'not_found',
          message: 'No license found for email',
        });
      }

      const row = result.rows[0];

      if (!row || !row.license_key || !String(row.license_key).trim()) {
        logger.log('[API] malformed/empty result for email=%s', email);
        return res.status(500).json({
          status: 'error',
          message: 'License record is malformed or empty',
        });
      }

      logger.log(
        '[API] returning email=%s hasKey=%s keyLen=%s event_type=%s environment=%s received_utc=%s',
        row.email,
        row.license_key ? 'yes' : 'no',
        row.license_key ? String(row.license_key).length : 0,
        row.event_type || '',
        row.environment || '',
        row.received_utc,
      );

      return res.status(200).json({
        status: 'ok',
        message: 'License found',
        email: row.email,
        license_key: row.license_key || '',
        key_length: row.license_key ? String(row.license_key).length : 0,
        event_type: row.event_type || '',
        environment: row.environment || '',
        received_utc: row.received_utc,
      });
    } catch (err) {
      logger.logError('[API-ERR]', err);
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        detail: err.message,
      });
    }
  });

  return router;
};
