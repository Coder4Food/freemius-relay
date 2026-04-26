const express = require('express');

module.exports = function createFreemiusRouter(deps) {
  const router = express.Router();
  const pool = deps.pool;
  const logger = deps.logger;

  router.post('/webhook/freemius', async function (req, res) {
    try {
      logger.log('[WEBHOOK-TEST-1] hit freemius webhook'); // ← ADD

      logger.log('[WEBHOOK-TEST-2] headers=%s', JSON.stringify(req.headers)); // ← ADD

      logger.log('[WEBHOOK-TEST-3] raw body=%s', JSON.stringify(req.body)); // ← ADD
      const body = req.body || {};
      const eventType = body.type || '';
      const licenseEnvironment =
        body.objects &&
        body.objects.license &&
        body.objects.license.environment;

      const isSandbox =
        body.is_sandbox === true ||
        body.sandbox === true ||
        body.mode === 'sandbox' ||
        body.environment === 'sandbox' ||
        body.is_live === false ||
        licenseEnvironment === 2 ||
        String(licenseEnvironment) === '2' ||
        (body.objects &&
          body.objects.install &&
          body.objects.install.is_sandbox === true);

      const environment = isSandbox ? 'sandbox' : 'live';

      logger.log(
        '[WEBHOOK] env-check is_live=%s is_sandbox=%s sandbox=%s mode=%s environment=%s license.environment=%s',
        String(body.is_live),
        String(body.is_sandbox),
        String(body.sandbox),
        String(body.mode),
        String(body.environment),
        String(licenseEnvironment),
      );

      if (
        eventType.indexOf('license') !== 0 &&
        eventType.indexOf('payment') !== 0 &&
        eventType.indexOf('subscription') !== 0
      ) {
        logger.log('[WEBHOOK] Ignoring unrelated event type=%s', eventType);
        return res.json({ ok: true, ignored: true });
      }

      const email =
        logger.normalizeEmail(body.email) ||
        logger.normalizeEmail(body.user_email) ||
        logger.normalizeEmail(body.customer_email) ||
        logger.normalizeEmail(body.customer && body.customer.email) ||
        logger.normalizeEmail(body.user && body.user.email) ||
        logger.normalizeEmail(
          body.objects && body.objects.user && body.objects.user.email,
        ) ||
        logger.normalizeEmail(
          body.objects && body.objects.customer && body.objects.customer.email,
        );

      const licenseKeyRaw =
        body.license_key ||
        body.licenseKey ||
        body.key ||
        (body.license && body.license.secret_key) ||
        (body.objects &&
          body.objects.license &&
          (body.objects.license.secret_key ||
            body.objects.license.license_key ||
            body.objects.license.key)) ||
        '';

      const licenseKey = String(licenseKeyRaw || '').trim();

      logger.log(
        '[WEBHOOK] parsed type=%s env=%s email=%s hasKey=%s keyLen=%s',
        eventType,
        environment,
        email,
        licenseKey ? 'yes' : 'no',
        licenseKey ? licenseKey.length : 0,
      );

      if (!email) {
        logger.log(
          '[WEBHOOK] No email found for type=%s. Accepting webhook without storage.',
          eventType,
        );

        return res.json({
          ok: true,
          ignored: true,
          reason: 'email_not_found_in_payload',
          event_type: eventType,
        });
      }

      await pool.query(
        `
        INSERT INTO licenses
          (email, license_key, received_utc, raw_payload, event_type, environment)
        VALUES
          ($1, $2, NOW(), $3::jsonb, $4, $5)
        ON CONFLICT (email)
        DO UPDATE SET
          license_key = CASE
                          WHEN EXCLUDED.license_key IS NOT NULL
                           AND EXCLUDED.license_key <> ''
                          THEN EXCLUDED.license_key
                          ELSE licenses.license_key
                        END,
          received_utc = NOW(),
          raw_payload = EXCLUDED.raw_payload,
          event_type = EXCLUDED.event_type,
          environment = EXCLUDED.environment
        `,
        [email, licenseKey, JSON.stringify(body), eventType, environment],
      );

      logger.log(
        '[WEBHOOK] stored type=%s env=%s email=%s hasKey=%s keyLen=%s',
        eventType,
        environment,
        email,
        licenseKey ? 'yes' : 'no',
        licenseKey ? licenseKey.length : 0,
      );

      return res.json({
        ok: true,
        stored: true,
        event_type: eventType,
        environment: environment,
      });
    } catch (err) {
      logger.logError('[WEBHOOK-ERR]', err);
      return res.status(500).json({
        ok: false,
        error: 'internal_error',
        detail: err.message,
      });
    }
  });

  return router;
};
