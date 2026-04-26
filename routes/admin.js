const express = require('express');
const { createAdminAuthMiddleware } = require('../middleware/adminAuth');

module.exports = function createAdminRouter(deps) {
  const router = express.Router();
  const pool = deps.pool;
  const logger = deps.logger;
  const adminAuth = deps.adminAuth;
  const requireAdmin = createAdminAuthMiddleware(adminAuth);

  router.post('/api/admin/login', async function (req, res) {
    try {
      const username = String((req.body && req.body.username) || '').trim();
      const password = String((req.body && req.body.password) || '');
      const authResult = adminAuth.authenticate(username, password);

      if (!authResult.ok) {
        return res.status(401).json({
          status: 'unauthorized',
          message:
            authResult.error === 'admin_not_configured'
              ? 'Admin password hash is not configured'
              : 'Invalid username or password',
        });
      }

      return res.status(200).json({
        status: 'ok',
        username: username,
        token: authResult.session.token,
        expires_at_utc: authResult.session.expiresAtUtc,
      });
    } catch (err) {
      logger.logError('[ADMIN-LOGIN-ERR]', err);
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        detail: err.message,
      });
    }
  });

  router.get(
    '/api/admin/customer-enrollment/get',
    requireAdmin,
    async function (req, res) {
      try {
        const email = logger.normalizeEmail(req.query.email);
        let result = null;

        if (!email) {
          return res.status(400).json({
            status: 'bad_request',
            message: 'email is required',
          });
        }

        result = await pool.query(
          `
        SELECT email, cohort, is_active, enrolled_utc, free_year_start_utc, free_year_expire_utc,
               first_machine_guid, last_machine_guid, notes, created_by, updated_utc
        FROM customer_enrollment
        WHERE email = $1
        `,
          [email],
        );

        if (!result.rows.length) {
          return res.status(404).json({
            status: 'not_found',
            message: 'Customer enrollment not found',
          });
        }

        return res.status(200).json({
          status: 'ok',
          customer: result.rows[0],
        });
      } catch (err) {
        logger.logError('[ADMIN-GET-ERR]', err);
        return res.status(500).json({
          status: 'error',
          message: 'Internal server error',
          detail: err.message,
        });
      }
    },
  );

  router.get(
    '/api/admin/customer-enrollment/list',
    requireAdmin,
    async function (req, res) {
      try {
        const result = await pool.query(
          `
        SELECT email, cohort, is_active, enrolled_utc,
               free_year_start_utc, free_year_expire_utc,
               first_machine_guid, last_machine_guid,
               notes, created_by, updated_utc
        FROM customer_enrollment
        ORDER BY enrolled_utc DESC, email ASC
        LIMIT 500
        `,
        );

        return res.status(200).json({
          status: 'ok',
          count: result.rows.length,
          customers: result.rows,
        });
      } catch (err) {
        logger.logError('[ADMIN-LIST-ERR]', err);
        return res.status(500).json({
          status: 'error',
          message: 'Internal server error',
          detail: err.message,
        });
      }
    },
  );

  router.post(
    '/api/admin/customer-enrollment/upsert',
    requireAdmin,
    async function (req, res) {
      try {
        const email = logger.normalizeEmail(req.body && req.body.email);
        const cohort = String((req.body && req.body.cohort) || 'NEW')
          .trim()
          .toUpperCase();
        const isActive =
          req.body && req.body.is_active === false ? false : true;
        const notes = String((req.body && req.body.notes) || '').trim();
        const createdBy = String(
          (req.body && req.body.created_by) ||
            (req.adminSession && req.adminSession.username) ||
            '',
        ).trim();
        let result = null;

        if (!email) {
          return res.status(400).json({
            status: 'bad_request',
            message: 'email is required',
          });
        }

        result = await pool.query(
          `
        INSERT INTO customer_enrollment
          (email, cohort, is_active, notes, created_by, updated_utc)
        VALUES
          ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (email)
        DO UPDATE SET
          cohort = EXCLUDED.cohort,
          is_active = EXCLUDED.is_active,
          notes = EXCLUDED.notes,
          created_by = CASE
                         WHEN COALESCE(customer_enrollment.created_by, '') = ''
                         THEN EXCLUDED.created_by
                         ELSE customer_enrollment.created_by
                       END,
          updated_utc = NOW()
        RETURNING email, cohort, is_active, enrolled_utc, free_year_start_utc, free_year_expire_utc,
                  first_machine_guid, last_machine_guid, notes, created_by, updated_utc
        `,
          [email, cohort, isActive, notes, createdBy],
        );

        return res.status(200).json({
          status: 'ok',
          customer: result.rows[0],
        });
      } catch (err) {
        logger.logError('[ADMIN-UPSERT-ERR]', err);
        return res.status(500).json({
          status: 'error',
          message: 'Internal server error',
          detail: err.message,
        });
      }
    },
  );

  return router;
};
