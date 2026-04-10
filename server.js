require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || '';
const DEBUG_LOG = process.env.DEBUG_LOG === '1';

app.use(express.json({ limit: '1mb' }));

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL
    ? {
        require: true,
        rejectUnauthorized: false,
      }
    : false,
});

function nowUtc() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return '[unserializable]';
  }
}

function log() {
  if (!DEBUG_LOG) {
    return;
  }
  console.log.apply(console, arguments);
}

function logError() {
  console.error.apply(console, arguments);
}

/*
 * GLOBAL REQUEST LOGGER
 * Enabled only when DEBUG_LOG=1
 */
app.use(function (req, res, next) {
  const startedAt = Date.now();

  if (DEBUG_LOG) {
    log('');
    log('[REQ] %s %s %s', nowUtc(), req.method, req.originalUrl || req.url);
    log(
      '[REQ] ip=%s',
      req.ip || (req.connection && req.connection.remoteAddress) || '',
    );
    log('[REQ] headers=%s', safeJson(req.headers));

    if (req.method !== 'GET') {
      log('[REQ] body=%s', safeJson(req.body));
    }
  }

  res.on('finish', function () {
    const elapsedMs = Date.now() - startedAt;

    log(
      '[RES] %s %s %s status=%s elapsed_ms=%s',
      nowUtc(),
      req.method,
      req.originalUrl || req.url,
      res.statusCode,
      elapsedMs,
    );
  });

  next();
});

async function initDb() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not set.');
  }

  log('[DB] initDb starting.');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      email TEXT PRIMARY KEY,
      license_key TEXT NOT NULL DEFAULT '',
      received_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      raw_payload JSONB
    )
  `);

  log('[DB] initDb complete.');
}

app.get('/health', async function (req, res) {
  try {
    log('[HEALTH] checking database.');

    const result = await pool.query('SELECT NOW()');

    log('[HEALTH] db ok db_time_utc=%s', result.rows[0].now);

    res.json({
      ok: true,
      service: 'freemius-relay',
      time_utc: new Date().toISOString(),
      db_ok: true,
      db_time_utc: result.rows[0].now,
      debug_log: DEBUG_LOG,
    });
  } catch (err) {
    logError('[HEALTH-ERR]', err);

    res.status(500).json({
      ok: false,
      service: 'freemius-relay',
      error: 'db_unavailable',
      detail: err.message,
      debug_log: DEBUG_LOG,
    });
  }
});

app.post('/webhook/freemius', async function (req, res) {
  try {
    const body = req.body || {};

    const eventType = body.type || '';

    if (
      eventType !== 'subscription.created' &&
      !eventType.startsWith('license')
    ) {
      console.log('[WEBHOOK] Ignoring event type:', eventType);
      return res.json({ ok: true, ignored: true });
    }

    if (
      !eventType.startsWith('license') &&
      !eventType.startsWith('payment') &&
      !eventType.startsWith('subscription')
    ) {
      console.log('[WEBHOOK] Ignoring event type:', eventType);
      return res.json({ ok: true, ignored: true });
    }

    log('[WEBHOOK] /webhook/freemius entered.');

    const email =
      normalizeEmail(body.email) ||
      normalizeEmail(body.user_email) ||
      normalizeEmail(body.customer_email) ||
      normalizeEmail(body.customer && body.customer.email) ||
      normalizeEmail(body.user && body.user.email) ||
      normalizeEmail(
        body.objects && body.objects.user && body.objects.user.email,
      );

    const licenseKey =
      body.license_key ||
      body.licenseKey ||
      body.key ||
      (body.objects &&
        body.objects.license &&
        body.objects.license.secret_key) ||
      '';

    log(
      '[WEBHOOK] parsed email=%s hasKey=%s',
      email,
      licenseKey ? 'yes' : 'no',
    );

    if (!email) {
      log('[WEBHOOK] email not found in payload.');

      return res.status(400).json({
        ok: false,
        error: 'email_not_found_in_payload',
      });
    }

    await pool.query(
      `
      INSERT INTO licenses (email, license_key, received_utc, raw_payload)
      VALUES ($1, $2, NOW(), $3::jsonb)
      ON CONFLICT (email)
      DO UPDATE SET
        license_key = EXCLUDED.license_key,
        received_utc = NOW(),
        raw_payload = EXCLUDED.raw_payload
      `,
      [email, licenseKey, JSON.stringify(body)],
    );

    console.log(
      '[WEBHOOK] stored email=%s hasKey=%s keyLen=%s',
      email,
      licenseKey ? 'yes' : 'no',
      licenseKey ? licenseKey.length : 0,
    );

    res.json({
      ok: true,
      stored: true,
    });
  } catch (err) {
    logError('[WEBHOOK-ERR]', err);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      detail: err.message,
    });
  }
});

app.get('/api/license/latest', async function (req, res) {
  try {
    const email = normalizeEmail(req.query.email);

    log(
      '[API] /api/license/latest entered. rawEmail=%s normalizedEmail=%s',
      req.query.email || '',
      email,
    );

    if (!email) {
      log('[API] email_required.');

      return res.status(400).json({
        ok: false,
        error: 'email_required',
      });
    }

    const result = await pool.query(
      `
      SELECT email, license_key, received_utc
      FROM licenses
      WHERE email = $1
      `,
      [email],
    );

    log('[API] query complete rowCount=%s', result.rows.length);

    if (result.rows.length === 0) {
      log('[API] not_found for email=%s', email);

      return res.status(404).json({
        ok: false,
        error: 'not_found',
      });
    }

    const row = result.rows[0];

    log(
      '[API] returning email=%s hasKey=%s received_utc=%s',
      row.email,
      row.license_key ? 'yes' : 'no',
      row.received_utc,
    );

    res.json({
      ok: true,
      email: row.email,
      license_key: row.license_key || '',
      received_utc: row.received_utc,
    });
  } catch (err) {
    logError('[API-ERR]', err);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      detail: err.message,
    });
  }
});

async function start() {
  try {
    log('[START] DEBUG_LOG=%s', DEBUG_LOG ? '1' : '0');
    await initDb();
    app.listen(PORT, function () {
      console.log('[START] freemius-relay listening on port %s', PORT);
      console.log('[START] DEBUG_LOG=%s', DEBUG_LOG ? '1' : '0');
    });
  } catch (err) {
    logError('[START-ERR]', err);
    process.exit(1);
  }
}

start();
