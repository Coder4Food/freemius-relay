require('dotenv').config();

function toBool(value) {
  return String(value || '').trim() === '1';
}

module.exports = {
  port: process.env.PORT || 3000,
  databaseUrl: process.env.DATABASE_URL || '',
  debugLog: toBool(process.env.DEBUG_LOG),
  adminUsername: String(process.env.ADMIN_USERNAME || 'admin').trim(),
  adminPasswordHash: String(process.env.ADMIN_PASSWORD_HASH || '').trim(),
  adminTokenTtlMinutes: parseInt(process.env.ADMIN_TOKEN_TTL_MINUTES || '480', 10) || 480,
};
