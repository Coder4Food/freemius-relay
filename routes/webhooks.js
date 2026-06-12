const express = require('express');

module.exports = function createWebhooksRouter(deps) {
  const router = express.Router();
  const env = deps.env;
  const logger = deps.logger;
  const keapCohortSync = deps.keapCohortSync;

  function readWebhookSecret(req) {
    return String(
      (req.get && req.get('X-MVSW-Webhook-Secret')) ||
        (req.query && req.query.secret) ||
        '',
    ).trim();
  }

  function readHookSecret(req) {
    return String((req.get && req.get('X-Hook-Secret')) || '').trim();
  }

  function isKeapHookVerification(req) {
    return readHookSecret(req) !== '';
  }

  function sendKeapHookVerificationResponse(req, res) {
    const hookSecret = readHookSecret(req);

    logger.log('[KEAP-WEBHOOK-VERIFY] X-Hook-Secret received. Echoing verification header.');

    return res
      .status(200)
      .set('X-Hook-Secret', hookSecret)
      .json({
        status: 'ok',
        verified: true,
      });
  }

  function isAuthorized(req) {
    const expected = String((env && env.keapWebhookSecret) || '').trim();
    const received = readWebhookSecret(req);

    return !!expected && !!received && received === expected;
  }

  function firstValue() {
    let i = 0;

    for (i = 0; i < arguments.length; i += 1) {
      if (arguments[i] !== undefined && arguments[i] !== null && String(arguments[i]).trim() !== '') {
        return arguments[i];
      }
    }

    return '';
  }

  function firstObjectKeyId(value) {
    let i = 0;

    if (!Array.isArray(value)) {
      return '';
    }

    for (i = 0; i < value.length; i += 1) {
      if (value[i] && value[i].id !== undefined && value[i].id !== null && String(value[i].id).trim() !== '') {
        return value[i].id;
      }
    }

    return '';
  }

  function extractEmailFromPayload(body) {
    return firstValue(
      body && body.email,
      body && body.email_address,
      body && body.contact && body.contact.email,
      body && body.contact && body.contact.email_address,
      body && body.contact && Array.isArray(body.contact.email_addresses) &&
        body.contact.email_addresses[0] && body.contact.email_addresses[0].email,
      body && body.object && body.object.email,
      body && body.object && body.object.email_address,
      body && body.data && body.data.email,
      body && body.data && body.data.email_address,
      body && body.data && body.data.contact && body.data.contact.email,
    );
  }

  function extractContactIdFromPayload(body) {
    return firstValue(
      body && firstObjectKeyId(body.object_keys),
      body && firstObjectKeyId(body.objectKeys),
      body && body.data && firstObjectKeyId(body.data.object_keys),
      body && body.data && firstObjectKeyId(body.data.objectKeys),
      body && body.contact_id,
      body && body.contactId,
      body && body.id,
      body && body.contact && body.contact.id,
      body && body.contact && body.contact.contact_id,
      body && body.object && body.object.id,
      body && body.object && body.object.contact_id,
      body && body.data && body.data.id,
      body && body.data && body.data.contact_id,
      body && body.data && body.data.contact && body.data.contact.id,
      body && body.data && body.data.contact && body.data.contact.contact_id,
    );
  }

  router.post('/api/webhooks/keap/contact-updated', async function (req, res) {
    try {
      const contactId = String(extractContactIdFromPayload(req.body) || '').trim();
      const email = logger.normalizeEmail(extractEmailFromPayload(req.body));
      let result = null;
      let response = null;

      if (isKeapHookVerification(req)) {
        return sendKeapHookVerificationResponse(req, res);
      }

      if (!isAuthorized(req)) {
        return res.status(401).json({
          status: 'unauthorized',
          message: 'Invalid webhook secret',
        });
      }

      result = await keapCohortSync.syncCohortContact({
        contact_id: contactId,
        email: email,
        deactivate_if_blank: true,
        created_by: 'keap-webhook',
      });

      logger.log(
        '[KEAP-WEBHOOK] status=%s synced=%s email=%s contactId=%s active=%s event=%s objectType=%s',
        String(result.status || ''),
        result.synced ? '1' : '0',
        String(result.email || email || ''),
        String(result.keap_contact_id || contactId || ''),
        result.is_active ? '1' : '0',
        String((req.body && req.body.event_key) || ''),
        String((req.body && req.body.object_type) || ''),
      );

      // Return 200 for well-authenticated webhook deliveries so Keap does not keep retrying
      // because of non-actionable local conditions such as contact not found or blank email.
      response = {
        status: result.status || 'ok',
        synced: !!result.synced,
        email: result.email || email || '',
        is_cohort: !!result.is_cohort,
        is_active: !!result.is_active,
        keap_contact_id: String(result.keap_contact_id || contactId || ''),
        message: result.message || '',
      };

      return res.status(200).json(response);
    } catch (err) {
      logger.logError('[KEAP-WEBHOOK-ERR]', err);
      return res.status(500).json({
        status: 'error',
        message: 'Keap webhook sync failed',
        detail: err.message,
      });
    }
  });

  return router;
};
