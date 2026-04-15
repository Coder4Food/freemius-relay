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

    log('[WEBHOOK] /webhook/freemius entered. type=%s', eventType);

    //
    // Ignore unrelated but valid event families with HTTP 200.
    //
    if (
      !eventType.startsWith('license') &&
      !eventType.startsWith('payment') &&
      !eventType.startsWith('subscription')
    ) {
      log('[WEBHOOK] Ignoring unrelated event type=%s', eventType);
      return res.json({ ok: true, ignored: true });
    }

    const email =
      normalizeEmail(body.email) ||
      normalizeEmail(body.user_email) ||
      normalizeEmail(body.customer_email) ||
      normalizeEmail(body.customer && body.customer.email) ||
      normalizeEmail(body.user && body.user.email) ||
      normalizeEmail(
        body.objects && body.objects.user && body.objects.user.email,
      ) ||
      normalizeEmail(
        body.objects && body.objects.customer && body.objects.customer.email,
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
      '[WEBHOOK] parsed type=%s email=%s hasKey=%s',
      eventType,
      email,
      licenseKey ? 'yes' : 'no',
    );

    //
    // For license-related events, accept even if no email is present.
    // Store only when we have enough identity data.
    //
    if (!email) {
      log(
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

    log(
      '[WEBHOOK] stored type=%s email=%s hasKey=%s keyLen=%s',
      eventType,
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

    const isSandbox =
      body.is_sandbox === true ||
      body.sandbox === true ||
      body.mode === 'sandbox' ||
      body.environment === 'sandbox' ||
      (body.objects &&
        body.objects.install &&
        body.objects.install.is_sandbox === true);

    const environment = isSandbox ? 'sandbox' : 'live';

    log(
      '[WEBHOOK] /webhook/freemius entered. type=%s env=%s',
      eventType,
      environment,
    );

    //
    // Ignore unrelated but valid event families with HTTP 200.
    //
    if (
      !eventType.startsWith('license') &&
      !eventType.startsWith('payment') &&
      !eventType.startsWith('subscription')
    ) {
      log('[WEBHOOK] Ignoring unrelated event type=%s', eventType);
      return res.json({ ok: true, ignored: true });
    }

    const email =
      normalizeEmail(body.email) ||
      normalizeEmail(body.user_email) ||
      normalizeEmail(body.customer_email) ||
      normalizeEmail(body.customer && body.customer.email) ||
      normalizeEmail(body.user && body.user.email) ||
      normalizeEmail(
        body.objects && body.objects.user && body.objects.user.email,
      ) ||
      normalizeEmail(
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

    log(
      '[WEBHOOK] parsed type=%s env=%s email=%s hasKey=%s keyLen=%s',
      eventType,
      environment,
      email,
      licenseKey ? 'yes' : 'no',
      licenseKey ? licenseKey.length : 0,
    );

    //
    // For license-related events, accept even if no email is present.
    // Store only when we have enough identity data.
    //
    if (!email) {
      log(
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

    log(
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
    logError('[WEBHOOK-ERR]', err);
    return res.status(500).json({
      ok: false,
      error: 'internal_error',
      detail: err.message,
    });
  }
});

app.get('/api/license/diagnostics', async function (req, res) {
  try {
    log('[DIAG] /api/license/diagnostics entered.');

    let bDbOk = false;

    try {
      const result = await pool.query('SELECT 1');
      bDbOk = result && result.rows && result.rows.length > 0;
      log('[DIAG] db check ok.');
    } catch (dbErr) {
      logError('[DIAG-DB-ERR]', dbErr);
      bDbOk = false;
    }

    return res.status(200).json({
      status: 'ok',
      message: 'relay alive',
      db_ok: bDbOk,
      time_utc: nowUtc(),
    });
  } catch (err) {
    logError('[DIAG-ERR]', err);

    return res.status(500).json({
      status: 'error',
      message: 'diagnostics failed',
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
        status: 'bad_request',
        message: 'email is required',
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
        status: 'not_found',
        message: 'No license found for email',
      });
    }

    const row = result.rows[0];

    if (!row || !row.license_key || !String(row.license_key).trim()) {
      log('[API] malformed/empty result for email=%s', email);

      return res.status(500).json({
        status: 'error',
        message: 'License record is malformed or empty',
      });
    }

    log(
      '[API] returning email=%s hasKey=%s received_utc=%s',
      row.email,
      row.license_key ? 'yes' : 'no',
      row.received_utc,
    );

    return res.status(200).json({
      status: 'ok',
      message: 'License found',
      email: row.email,
      license_key: row.license_key || '',
      received_utc: row.received_utc,
    });
  } catch (err) {
    logError('[API-ERR]', err);

    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
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
      event_type: eventType,
    });
  } catch (err) {
    logError('[WEBHOOK-ERR]', err);
    return res.status(500).json({
      ok: false,
      error: 'internal_error',
      detail: err.message,
    });
  }
});

app.get('/api/license/diagnostics', async function (req, res) {
  try {
    log('[DIAG] /api/license/diagnostics entered.');

    let bDbOk = false;

    try {
      const result = await pool.query('SELECT 1');
      bDbOk = result && result.rows && result.rows.length > 0;
      log('[DIAG] db check ok.');
    } catch (dbErr) {
      logError('[DIAG-DB-ERR]', dbErr);
      bDbOk = false;
    }

    return res.status(200).json({
      status: 'ok',
      message: 'relay alive',
      db_ok: bDbOk,
      time_utc: nowUtc(),
    });
  } catch (err) {
    logError('[DIAG-ERR]', err);

    return res.status(500).json({
      status: 'error',
      message: 'diagnostics failed',
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
        status: 'bad_request',
        message: 'email is required',
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
        status: 'not_found',
        message: 'No license found for email',
      });
    }

    const row = result.rows[0];

    if (!row || !row.license_key || !String(row.license_key).trim()) {
      log('[API] malformed/empty result for email=%s', email);

      return res.status(500).json({
        status: 'error',
        message: 'License record is malformed or empty',
      });
    }

    log(
      '[API] returning email=%s hasKey=%s received_utc=%s',
      row.email,
      row.license_key ? 'yes' : 'no',
      row.received_utc,
    );

    return res.status(200).json({
      status: 'ok',
      message: 'License found',
      email: row.email,
      license_key: row.license_key || '',
      received_utc: row.received_utc,
    });
  } catch (err) {
    logError('[API-ERR]', err);

    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
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
