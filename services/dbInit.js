async function initDb(pool, logger) {
  if (!pool) {
    throw new Error('Database pool is not available.');
  }

  logger.log('[DB] initDb starting.');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      email TEXT PRIMARY KEY,
      license_key TEXT NOT NULL DEFAULT '',
      received_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      raw_payload JSONB,
      event_type TEXT NOT NULL DEFAULT '',
      environment TEXT NOT NULL DEFAULT ''
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_enrollment (
      email TEXT PRIMARY KEY,
      cohort TEXT NOT NULL DEFAULT 'NEW',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      enrolled_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      free_year_start_utc TIMESTAMPTZ NULL,
      free_year_expire_utc TIMESTAMPTZ NULL,
      first_machine_guid TEXT NULL,
      last_machine_guid TEXT NULL,
      notes TEXT NULL,
      created_by TEXT NULL,
      updated_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Purchase/Activate support tables are intentionally separate from
  // customer_enrollment so the existing cohort/free-year branch remains isolated.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL DEFAULT '',
      first_seen_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_public_ip TEXT NOT NULL DEFAULT ''
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      machine_guid TEXT NOT NULL DEFAULT '',
      device_serials_csv TEXT NOT NULL DEFAULT '',
      first_seen_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_public_ip TEXT NOT NULL DEFAULT '',
      UNIQUE (customer_id, machine_guid)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_activate_requests (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NULL REFERENCES customers(id) ON DELETE SET NULL,
      device_id BIGINT NULL REFERENCES devices(id) ON DELETE SET NULL,
      email TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '',
      device_serials_csv TEXT NOT NULL DEFAULT '',
      machine_guid TEXT NOT NULL DEFAULT '',
      public_ip TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      license_key TEXT NOT NULL DEFAULT '',
      quota_used INTEGER NULL,
      quota_limit INTEGER NULL,
      event_type TEXT NOT NULL DEFAULT '',
      environment TEXT NOT NULL DEFAULT '',
      created_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_purchase_activate_requests_email_created
    ON purchase_activate_requests (email, created_utc DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_devices_customer_id
    ON devices (customer_id)
  `);

  logger.log('[DB] initDb complete.');
}

module.exports = {
  initDb,
};
