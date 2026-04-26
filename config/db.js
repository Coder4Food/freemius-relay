const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseUrl
    ? {
        require: true,
        rejectUnauthorized: false,
      }
    : false,
});

module.exports = pool;
