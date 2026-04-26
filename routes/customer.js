const express = require('express');

module.exports = function createCustomerRouter(deps) {
  const router = express.Router();
  const pool = deps.pool;
  const logger = deps.logger;

  function buildEnrollmentResponse(row) {
    if (!row) {
      return {
        status: 'ok',
        cohort: 'legacy',
        is_enrolled: false,
      };
    }

    return {
      status: 'ok',
      cohort: String(row.cohort || 'NEW').toLowerCase(),
      is_enrolled: true,
      is_active: row.is_active === true,
      free_year_started: !!row.free_year_start_utc,
      free_year_start_utc: row.free_year_start_utc,
      free_year_expire_utc: row.free_year_expire_utc,
      enrolled_utc: row.enrolled_utc,
    };
  }

  router.post('/api/customer/cohort', async function (req, res) {
    try {
      const email = logger.normalizeEmail(req.body && req.body.email);
      let result = null;

      if (!email) {
        return res.status(400).json({
          status: 'bad_request',
          message: 'email is required',
        });
      }

      result = await pool.query(
        `
        SELECT email, cohort, is_active, enrolled_utc, free_year_start_utc, free_year_expire_utc
        FROM customer_enrollment
        WHERE email = $1
        `,
        [email],
      );

      if (!result.rows.length || result.rows[0].is_active !== true) {
        return res.status(200).json({
          status: 'ok',
          cohort: 'legacy',
          is_enrolled: false,
        });
      }

      return res.status(200).json(buildEnrollmentResponse(result.rows[0]));
    } catch (err) {
      logger.logError('[CUSTOMER-COHORT-ERR]', err);
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        detail: err.message,
      });
    }
  });

  router.post('/api/customer/start-free-year', async function (req, res) {
    try {
      const email = logger.normalizeEmail(req.body && req.body.email);
      const machineGuid = String((req.body && req.body.machine_guid) || '').trim();
      let queryResult = null;
      let row = null;

      if (!email) {
        return res.status(400).json({
          status: 'bad_request',
          message: 'email is required',
        });
      }

      queryResult = await pool.query(
        `
        UPDATE customer_enrollment
        SET
          free_year_start_utc = COALESCE(free_year_start_utc, NOW()),
          free_year_expire_utc = COALESCE(free_year_expire_utc, NOW() + INTERVAL '1 year'),
          first_machine_guid = CASE
                                 WHEN COALESCE(first_machine_guid, '') = ''
                                 THEN NULLIF($2, '')
                                 ELSE first_machine_guid
                               END,
          last_machine_guid = NULLIF($2, ''),
          updated_utc = NOW()
        WHERE email = $1
          AND is_active = TRUE
        RETURNING email, cohort, is_active, enrolled_utc, free_year_start_utc, free_year_expire_utc
        `,
        [email, machineGuid],
      );

      if (!queryResult.rows.length) {
        return res.status(404).json({
          status: 'not_found',
          message: 'Enrollment not found for email',
        });
      }

      row = queryResult.rows[0];
      return res.status(200).json(buildEnrollmentResponse(row));
    } catch (err) {
      logger.logError('[CUSTOMER-START-ERR]', err);
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        detail: err.message,
      });
    }
  });

  return router;
};
