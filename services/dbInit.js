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

  logger.log('[DB] initDb complete.');
}

module.exports = {
  initDb,
};
