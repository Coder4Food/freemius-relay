require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || '';

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

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

async function initDb() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not set.');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      email TEXT PRIMARY KEY,
      license_key TEXT NOT NULL DEFAULT '',
      received_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      raw_payload JSONB
    )
  `);
}

app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');

    res.json({
      ok: true,
      service: 'freemius-relay',
      time_utc: new Date().toISOString(),
      db_ok: true,
      db_time_utc: db.rows[0].now_utc,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      service: 'freemius-relay',
      error: 'db_unavailable',
    });
  }
});

app.post('/webhook/freemius', async function (req, res) {
  try {
    const body = req.body || {};

    const email =
      normalizeEmail(body.email) ||
      normalizeEmail(body.user_email) ||
      normalizeEmail(body.customer_email) ||
      normalizeEmail(body.customer && body.customer.email) ||
      normalizeEmail(body.user && body.user.email);

    const licenseKey = body.license_key || body.licenseKey || body.key || '';

    if (!email) {
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
      [email, licenseKey, JSON.stringify(body)]
    );

    console.log(
      '[WEBHOOK] stored email=%s hasKey=%s',
      email,
      licenseKey ? 'yes' : 'no'
    );

    res.json({
      ok: true,
      stored: true,
    });
  } catch (err) {
    console.error('[WEBHOOK-ERR]', err);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
    });
  }
});

app.get('/api/license/latest', async function (req, res) {
  try {
    const email = normalizeEmail(req.query.email);

    if (!email) {
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
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'not_found',
      });
    }

    const row = result.rows[0];

    res.json({
      ok: true,
      email: row.email,
      license_key: row.license_key || '',
      received_utc: row.received_utc,
    });
  } catch (err) {
    console.error('[API-ERR]', err);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
    });
  }
});

async function start() {
  try {
    await initDb();
    app.listen(PORT, function () {
      console.log('[START] freemius-relay listening on port %s', PORT);
    });
  } catch (err) {
    console.error('[START-ERR]', err);
    process.exit(1);
  }
}

start();
