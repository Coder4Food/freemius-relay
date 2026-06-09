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

  // Keap / Infusionsoft REST API settings.
  // Keep this token server-side only. Never send it to MVSW.exe.
  keapAccessToken: String(process.env.KEAP_ACCESS_TOKEN || '').trim(),
  keapBaseUrl: String(
    process.env.KEAP_BASE_URL || 'https://api.infusionsoft.com/crm/rest/v1',
  ).trim().replace(/\/+$/, ''),
  keapCohortFieldLabel: String(
    process.env.KEAP_COHORT_FIELD_LABEL || 'Date 1 year Free Software Ends',
  ).trim(),
  keapCohortFieldId: String(process.env.KEAP_COHORT_FIELD_ID || '').trim(),

  // Optional Keap write-back target used when MVSW starts/uses a cohort free-year.
  keapRegEmailFieldLabel: String(
    process.env.KEAP_REG_EMAIL_FIELD_LABEL || 'SW Reg Key Email:',
  ).trim(),
  keapRegEmailFieldId: String(process.env.KEAP_REG_EMAIL_FIELD_ID || '').trim(),
};
