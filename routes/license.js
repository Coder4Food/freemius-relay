const express = require('express');

module.exports = function createLicenseRouter(deps) {
  const router = express.Router();
  const pool = deps.pool;
  const logger = deps.logger;

  function getPublicIp(req) {
    const forwardedFor = String(req.headers['x-forwarded-for'] || '').trim();

    if (forwardedFor) {
      return String(forwardedFor.split(',')[0] || '').trim();
    }

    return String(
      (req.socket && req.socket.remoteAddress) ||
        (req.connection && req.connection.remoteAddress) ||
        '',
    ).trim();
  }

  function asCleanString(value, maxLen) {
    const cleaned = String(value || '').trim();
    if (!maxLen || cleaned.length <= maxLen) {
      return cleaned;
    }

    return cleaned.substring(0, maxLen);
  }

  function getNestedValue(obj, paths) {
    let i = 0;

    if (!obj) {
      return null;
    }

    for (i = 0; i < paths.length; i += 1) {
      const path = paths[i];
      const parts = path.split('.');
      let cur = obj;
      let j = 0;

      for (j = 0; j < parts.length; j += 1) {
        if (cur === null || cur === undefined) {
          cur = null;
          break;
        }
        cur = cur[parts[j]];
      }

      if (cur !== null && cur !== undefined && cur !== '') {
        return cur;
      }
    }

    return null;
  }

  function toNullableInteger(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }

  function extractQuota(row) {
    const payload = row && row.raw_payload ? row.raw_payload : null;
    const quotaUsed = toNullableInteger(
      getNestedValue(payload, [
        'objects.license.activations_count',
        'objects.license.activation_count',
        'objects.license.installs_count',
        'objects.license.active_installs_count',
        'license.activations_count',
        'license.activation_count',
        'license.installs_count',
        'activations_count',
        'activation_count',
        'installs_count',
      ]),
    );
    const quotaLimit = toNullableInteger(
      getNestedValue(payload, [
        'objects.license.activation_limit',
        'objects.license.activations_limit',
        'objects.license.installs_limit',
        'objects.license.install_limit',
        'license.activation_limit',
        'license.activations_limit',
        'license.installs_limit',
        'activation_limit',
        'activations_limit',
        'installs_limit',
      ]),
    );

    return {
      quota_used: quotaUsed,
      quota_limit: quotaLimit,
    };
  }

  async function upsertCustomer(client, email, customerName, publicIp) {
    const result = await client.query(
      `
      INSERT INTO customers
        (email, customer_name, first_seen_utc, last_seen_utc, last_public_ip)
      VALUES
        ($1, $2, NOW(), NOW(), $3)
      ON CONFLICT (email)
      DO UPDATE SET
        customer_name = CASE
                          WHEN EXCLUDED.customer_name <> ''
                          THEN EXCLUDED.customer_name
                          ELSE customers.customer_name
                        END,
        last_seen_utc = NOW(),
        last_public_ip = EXCLUDED.last_public_ip
      RETURNING id, email, customer_name, first_seen_utc, last_seen_utc, last_public_ip
      `,
      [email, customerName, publicIp],
    );

    return result.rows[0];
  }

  async function upsertDevice(client, customerId, machineGuid, deviceSerialsCsv, publicIp) {
    const result = await client.query(
      `
      INSERT INTO devices
        (customer_id, machine_guid, device_serials_csv, first_seen_utc, last_seen_utc, last_public_ip)
      VALUES
        ($1, $2, $3, NOW(), NOW(), $4)
      ON CONFLICT (customer_id, machine_guid)
      DO UPDATE SET
        device_serials_csv = CASE
                               WHEN EXCLUDED.device_serials_csv <> ''
                               THEN EXCLUDED.device_serials_csv
                               ELSE devices.device_serials_csv
                             END,
        last_seen_utc = NOW(),
        last_public_ip = EXCLUDED.last_public_ip
      RETURNING id, customer_id, machine_guid, device_serials_csv, first_seen_utc, last_seen_utc, last_public_ip
      `,
      [customerId, machineGuid, deviceSerialsCsv, publicIp],
    );

    return result.rows[0];
  }

  async function insertPurchaseActivateRequest(client, data) {
    const result = await client.query(
      `
      INSERT INTO purchase_activate_requests
        (customer_id, device_id, email, customer_name, device_serials_csv,
         machine_guid, public_ip, status, message, license_key, quota_used,
         quota_limit, event_type, environment, created_utc, updated_utc)
      VALUES
        ($1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11,
         $12, $13, $14, NOW(), NOW())
      RETURNING id, status, message, created_utc
      `,
      [
        data.customer_id,
        data.device_id,
        data.email,
        data.customer_name,
        data.device_serials_csv,
        data.machine_guid,
        data.public_ip,
        data.status,
        data.message,
        data.license_key,
        data.quota_used,
        data.quota_limit,
        data.event_type,
        data.environment,
      ],
    );

    return result.rows[0];
  }

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

  router.post('/api/license/purchase-activate-start', async function (req, res) {
    const client = await pool.connect();

    try {
      const body = req.body || {};
      const email = logger.normalizeEmail(body.email);
      const customerName = asCleanString(body.customer_name || body.name, 200);
      const deviceSerialsCsv = asCleanString(body.device_serials_csv, 1000);
      const machineGuid = asCleanString(body.machine_guid, 120);
      const publicIp = asCleanString(getPublicIp(req), 120);

      logger.log(
        '[PAS-1] /api/license/purchase-activate-start entered email=%s nameLen=%s serialsLen=%s machineGuidLen=%s ip=%s',
        email,
        customerName.length,
        deviceSerialsCsv.length,
        machineGuid.length,
        publicIp,
      );

      if (!email) {
        logger.log('[PAS-2] email_required.');
        return res.status(400).json({
          status: 'bad_request',
          message: 'email is required',
        });
      }

      await client.query('BEGIN');

      const customer = await upsertCustomer(client, email, customerName, publicIp);
      const device = await upsertDevice(
        client,
        customer.id,
        machineGuid || 'UNKNOWN',
        deviceSerialsCsv,
        publicIp,
      );

      const licenseResult = await client.query(
        `
        SELECT email, license_key, received_utc, raw_payload, event_type, environment
        FROM licenses
        WHERE email = $1
        `,
        [email],
      );

      let status = 'needs_purchase';
      let message = 'No license found. Open checkout.';
      let licenseKey = '';
      let eventType = '';
      let environment = '';
      let quotaUsed = null;
      let quotaLimit = null;

      if (licenseResult.rows.length > 0) {
        const licenseRow = licenseResult.rows[0];
        const quota = extractQuota(licenseRow);

        licenseKey = String(licenseRow.license_key || '').trim();
        eventType = licenseRow.event_type || '';
        environment = licenseRow.environment || '';
        quotaUsed = quota.quota_used;
        quotaLimit = quota.quota_limit;

        if (licenseKey) {
          if (quotaUsed !== null && quotaLimit !== null && quotaLimit > 0 && quotaUsed >= quotaLimit) {
            status = 'quota_full';
            message = 'License found, but activation quota appears full.';
          } else {
            status = 'activate_now';
            message = 'Existing license found. Activate now.';
          }
        } else {
          status = 'needs_purchase';
          message = 'License record found, but no usable license key is stored.';
        }
      }

      const auditRow = await insertPurchaseActivateRequest(client, {
        customer_id: customer.id,
        device_id: device.id,
        email: email,
        customer_name: customerName,
        device_serials_csv: deviceSerialsCsv,
        machine_guid: machineGuid,
        public_ip: publicIp,
        status: status,
        message: message,
        license_key: licenseKey,
        quota_used: quotaUsed,
        quota_limit: quotaLimit,
        event_type: eventType,
        environment: environment,
      });

      await client.query('COMMIT');

      logger.log(
        '[PAS-3] decision email=%s status=%s requestId=%s hasKey=%s keyLen=%s quotaUsed=%s quotaLimit=%s',
        email,
        status,
        auditRow.id,
        licenseKey ? 'yes' : 'no',
        licenseKey ? licenseKey.length : 0,
        quotaUsed === null ? '' : quotaUsed,
        quotaLimit === null ? '' : quotaLimit,
      );

      return res.status(200).json({
        status: status,
        message: message,
        email: email,
        request_id: auditRow.id,
        license_key: licenseKey,
        key_length: licenseKey ? licenseKey.length : 0,
        quota_used: quotaUsed,
        quota_limit: quotaLimit,
        event_type: eventType,
        environment: environment,
      });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.logError('[PAS-ROLLBACK-ERR]', rollbackErr);
      }

      logger.logError('[PAS-ERR]', err);
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        detail: err.message,
      });
    } finally {
      client.release();
    }
  });

  return router;
};
