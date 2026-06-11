const express = require('express');
const { createAdminAuthMiddleware } = require('../middleware/adminAuth');

module.exports = function createAdminRouter(deps) {
  const router = express.Router();
  const pool = deps.pool;
  const logger = deps.logger;
  const adminAuth = deps.adminAuth;
  const keap = deps.keap;
  const requireAdmin = createAdminAuthMiddleware(adminAuth);

  function extractKeapFieldId(field) {
    return String((field && (field.id || field.field_id || field.name)) || '').trim();
  }

  function extractKeapFieldLabel(field) {
    return String((field && (field.label || field.field_label || field.field_name || field.name)) || '').trim();
  }

  function isFutureOrToday(isoUtc) {
    const d = new Date(String(isoUtc || ''));

    if (Number.isNaN(d.getTime())) {
      return false;
    }

    return d.getTime() >= Date.now();
  }

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
    '/api/admin/keap/contact-model',
    requireAdmin,
    async function (req, res) {
      try {
        if (!keap || !keap.isConfigured()) {
          return res.status(400).json({
            status: 'bad_request',
            message: 'Keap is not configured. Set KEAP_ACCESS_TOKEN first.',
          });
        }

        const fieldInfo = await keap.getCohortFieldDefinition();

        return res.status(200).json({
          status: 'ok',
          requested_label: fieldInfo.requested_label,
          requested_id: fieldInfo.requested_id,
          matched_field: fieldInfo.field || null,
          field_count: fieldInfo.fields.length,
          fields: fieldInfo.fields,
        });
      } catch (err) {
        logger.logError('[ADMIN-KEAP-MODEL-ERR]', err);
        return res.status(500).json({
          status: 'error',
          message: 'Keap contact model lookup failed',
          detail: err.message,
        });
      }
    },
  );

  router.post(
    '/api/admin/keap/sync-cohort-email',
    requireAdmin,
    async function (req, res) {
      try {
        const requestedEmail = logger.normalizeEmail(req.body && req.body.email);
        const deactivateIfBlank =
          req.body && req.body.deactivate_if_blank === false ? false : true;
        const createdBy = String(
          (req.adminSession && req.adminSession.username) || 'keap-sync',
        ).trim();
        const result = await deps.keapCohortSync.syncCohortContact({
          email: requestedEmail,
          deactivate_if_blank: deactivateIfBlank,
          created_by: createdBy,
        });
        const httpStatus = result.http_status || 200;
        const body = Object.assign({}, result);

        delete body.http_status;

        return res.status(httpStatus).json(body);
      } catch (err) {
        logger.logError('[ADMIN-KEAP-SYNC-ERR]', err);
        return res.status(500).json({
          status: 'error',
          message: 'Keap cohort sync failed',
          detail: err.message,
        });
      }
    },
  );

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


  router.get(
    '/api/admin/customers',
    requireAdmin,
    async function (req, res) {
      try {
        const result = await pool.query(
          `
        SELECT id, email, customer_name, first_seen_utc, last_seen_utc, last_public_ip
        FROM customers
        ORDER BY last_seen_utc DESC, email ASC
        LIMIT 500
        `,
        );

        logger.log('[ADMIN-CUSTOMERS] count=%s', result.rows.length);

        return res.status(200).json({
          status: 'ok',
          count: result.rows.length,
          customers: result.rows,
        });
      } catch (err) {
        logger.logError('[ADMIN-CUSTOMERS-ERR]', err);
        return res.status(500).json({
          status: 'error',
          message: 'Internal server error',
          detail: err.message,
        });
      }
    },
  );

  router.get(
    '/api/admin/devices',
    requireAdmin,
    async function (req, res) {
      try {
        const result = await pool.query(
          `
        SELECT d.id, d.customer_id, c.email, c.customer_name,
               d.machine_guid, d.device_serials_csv,
               d.first_seen_utc, d.last_seen_utc, d.last_public_ip
        FROM devices d
        INNER JOIN customers c ON c.id = d.customer_id
        ORDER BY d.last_seen_utc DESC, c.email ASC
        LIMIT 500
        `,
        );

        logger.log('[ADMIN-DEVICES] count=%s', result.rows.length);

        return res.status(200).json({
          status: 'ok',
          count: result.rows.length,
          devices: result.rows,
        });
      } catch (err) {
        logger.logError('[ADMIN-DEVICES-ERR]', err);
        return res.status(500).json({
          status: 'error',
          message: 'Internal server error',
          detail: err.message,
        });
      }
    },
  );

  router.get(
    '/api/admin/purchase-activate-requests',
    requireAdmin,
    async function (req, res) {
      try {
        const result = await pool.query(
          `
        SELECT id, customer_id, device_id, email, customer_name,
               device_serials_csv, machine_guid, public_ip,
               status, message,
               CASE WHEN COALESCE(license_key, '') <> '' THEN LENGTH(license_key) ELSE 0 END AS license_key_length,
               quota_used, quota_limit, event_type, environment,
               created_utc, updated_utc
        FROM purchase_activate_requests
        ORDER BY created_utc DESC
        LIMIT 500
        `,
        );

        logger.log('[ADMIN-PAS-LIST] count=%s', result.rows.length);

        return res.status(200).json({
          status: 'ok',
          count: result.rows.length,
          requests: result.rows,
        });
      } catch (err) {
        logger.logError('[ADMIN-PAS-LIST-ERR]', err);
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
