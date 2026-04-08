require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const STORE_PATH = path.join(__dirname, 'data', 'licenses.json');

app.use(express.json({ limit: '1mb' }));

function ensureStore() {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(
      STORE_PATH,
      JSON.stringify({ licenses: [] }, null, 2),
      'utf8'
    );
  }
}

function loadStore() {
  ensureStore();
  const raw = fs.readFileSync(STORE_PATH, 'utf8');
  return JSON.parse(raw);
}

function saveStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

app.get('/health', function (req, res) {
  res.json({
    ok: true,
    service: 'freemius-relay',
    time_utc: new Date().toISOString(),
  });
});

app.post('/webhook/freemius', function (req, res) {
  try {
    const body = req.body || {};

    const email =
      normalizeEmail(body.email) ||
      normalizeEmail(body.user_email) ||
      normalizeEmail(body.customer_email) ||
      normalizeEmail(body.customer && body.customer.email) ||
      normalizeEmail(body.user && body.user.email);

    const licenseKey = body.license_key || body.licenseKey || body.key || '';

    const payloadToStore = {
      received_utc: new Date().toISOString(),
      email: email,
      license_key: licenseKey,
      body: body,
    };

    const store = loadStore();

    if (email) {
      const idx = store.licenses.findIndex(function (x) {
        return normalizeEmail(x.email) === email;
      });

      if (idx >= 0) {
        store.licenses[idx] = payloadToStore;
      } else {
        store.licenses.push(payloadToStore);
      }

      saveStore(store);
    }

    console.log(
      '[WEBHOOK] received email=%s hasKey=%s',
      email || '(none)',
      licenseKey ? 'yes' : 'no'
    );

    res.json({
      ok: true,
      stored: email ? true : false,
    });
  } catch (err) {
    console.error('[WEBHOOK-ERR]', err);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
    });
  }
});

app.get('/api/license/latest', function (req, res) {
  try {
    const email = normalizeEmail(req.query.email);

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: 'email_required',
      });
    }

    const store = loadStore();
    const item = store.licenses.find(function (x) {
      return normalizeEmail(x.email) === email;
    });

    if (!item) {
      return res.status(404).json({
        ok: false,
        error: 'not_found',
      });
    }

    res.json({
      ok: true,
      email: item.email,
      license_key: item.license_key || '',
      received_utc: item.received_utc,
    });
  } catch (err) {
    console.error('[API-ERR]', err);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
    });
  }
});

app.listen(PORT, function () {
  ensureStore();
  console.log('[START] freemius-relay listening on port %s', PORT);
});
