function extractKeapFieldId(field) {
  return String((field && (field.id || field.field_id || field.name)) || '').trim();
}

function extractKeapFieldLabel(field) {
  return String((field && (field.label || field.field_label || field.field_name || field.name)) || '').trim();
}

function isFutureOrToday(isoUtc) {
  const d = new Date(String(isoUtc || ''));

  if (Number.isNaN(d.getTime())) {
    return false;
  }

  return d.getTime() >= Date.now();
}

function createKeapCohortSync(deps) {
  const pool = deps.pool;
  const logger = deps.logger;
  const keap = deps.keap;

  async function syncCohortContact(options) {
    const requestedEmail = logger.normalizeEmail(options && options.email);
    const requestedContactId = String((options && options.contact_id) || '').trim();
    const deactivateIfBlank = options && options.deactivate_if_blank === false ? false : true;
    const createdBy = String((options && options.created_by) || 'keap-sync').trim();
    let keapResult = null;
    let email = '';
    let isActive = false;
    let result = null;

    if (!requestedEmail && !requestedContactId) {
      return {
        http_status: 400,
        status: 'bad_request',
        message: 'email or contact_id is required',
      };
    }

    if (!keap || !keap.isConfigured()) {
      return {
        http_status: 400,
        status: 'bad_request',
        message: 'Keap is not configured. Set KEAP_ACCESS_TOKEN first.',
      };
    }

    if (requestedContactId) {
      keapResult = await keap.getCohortContactById(requestedContactId);
    } else {
      keapResult = await keap.getCohortContactByEmail(requestedEmail);
    }

    if (!keapResult.found) {
      return {
        http_status: 404,
        status: 'not_found',
        message: requestedContactId ? 'Keap contact not found for contact_id' : 'Keap contact not found for email',
        email: requestedEmail,
        keap_contact_id: requestedContactId,
      };
    }

    email = logger.normalizeEmail(keapResult.email || requestedEmail);

    if (!email) {
      return {
        http_status: 422,
        status: 'unprocessable_entity',
        message: 'Keap contact did not contain a usable email address',
        keap_contact_id: String(keapResult.contact_id || requestedContactId || ''),
      };
    }

    if (!keapResult.raw_value || !keapResult.expire_utc) {
      if (!deactivateIfBlank) {
        return {
          http_status: 200,
          status: 'ok',
          synced: false,
          email: email,
          is_cohort: false,
          message: 'Keap cohort date field is blank or invalid. Database was not changed.',
          keap_contact_id: String(keapResult.contact_id || ''),
          keap_raw_value: String(keapResult.raw_value || ''),
        };
      }

      result = await pool.query(
        `
        UPDATE customer_enrollment
        SET
          is_active = FALSE,
          cohort_source = 'keap',
          keap_contact_id = $2,
          keap_cohort_field_id = $3,
          keap_cohort_field_label = $4,
          keap_cohort_field_raw = $5,
          keap_synced_utc = NOW(),
          notes = 'Keap cohort date field blank or invalid',
          updated_utc = NOW()
        WHERE email = $1
        RETURNING email, cohort, is_active, enrolled_utc, free_year_start_utc, free_year_expire_utc,
                  first_machine_guid, last_machine_guid, notes, created_by, updated_utc,
                  cohort_source, keap_contact_id, keap_cohort_field_id,
                  keap_cohort_field_label, keap_cohort_field_raw, keap_synced_utc
        `,
        [
          email,
          String(keapResult.contact_id || ''),
          extractKeapFieldId(keapResult.field),
          extractKeapFieldLabel(keapResult.field),
          String(keapResult.raw_value || ''),
        ],
      );

      logger.log(
        '[KEAP-COHORT-SYNC] email=%s contactId=%s cohort=0 active=0 raw=%s',
        email,
        String(keapResult.contact_id || ''),
        String(keapResult.raw_value || ''),
      );

      return {
        http_status: 200,
        status: 'ok',
        synced: true,
        email: email,
        is_cohort: false,
        message: 'Keap cohort date field is blank or invalid. Existing enrollment was deactivated if present.',
        keap_contact_id: String(keapResult.contact_id || ''),
        keap_raw_value: String(keapResult.raw_value || ''),
        customer: result.rows[0] || null,
      };
    }

    isActive = isFutureOrToday(keapResult.expire_utc);

    result = await pool.query(
      `
      INSERT INTO customer_enrollment
        (email, cohort, is_active, free_year_expire_utc, notes, created_by, updated_utc,
         cohort_source, keap_contact_id, keap_cohort_field_id, keap_cohort_field_label,
         keap_cohort_field_raw, keap_synced_utc)
      VALUES
        ($1, 'NEW', $2, $3::timestamptz, $4, $5, NOW(),
         'keap', $6, $7, $8, $9, NOW())
      ON CONFLICT (email)
      DO UPDATE SET
        cohort = 'NEW',
        is_active = EXCLUDED.is_active,
        free_year_expire_utc = EXCLUDED.free_year_expire_utc,
        notes = EXCLUDED.notes,
        created_by = CASE
                       WHEN COALESCE(customer_enrollment.created_by, '') = ''
                       THEN EXCLUDED.created_by
                       ELSE customer_enrollment.created_by
                     END,
        updated_utc = NOW(),
        cohort_source = 'keap',
        keap_contact_id = EXCLUDED.keap_contact_id,
        keap_cohort_field_id = EXCLUDED.keap_cohort_field_id,
        keap_cohort_field_label = EXCLUDED.keap_cohort_field_label,
        keap_cohort_field_raw = EXCLUDED.keap_cohort_field_raw,
        keap_synced_utc = NOW()
      RETURNING email, cohort, is_active, enrolled_utc, free_year_start_utc, free_year_expire_utc,
                first_machine_guid, last_machine_guid, notes, created_by, updated_utc,
                cohort_source, keap_contact_id, keap_cohort_field_id,
                keap_cohort_field_label, keap_cohort_field_raw, keap_synced_utc
      `,
      [
        email,
        isActive,
        keapResult.expire_utc,
        isActive
          ? 'Keap cohort sync: active free-year date'
          : 'Keap cohort sync: expired free-year date',
        createdBy,
        String(keapResult.contact_id || ''),
        extractKeapFieldId(keapResult.field),
        extractKeapFieldLabel(keapResult.field),
        String(keapResult.raw_value || ''),
      ],
    );

    logger.log(
      '[KEAP-COHORT-SYNC] email=%s contactId=%s expire=%s active=%s raw=%s',
      email,
      String(keapResult.contact_id || ''),
      keapResult.expire_utc,
      isActive ? '1' : '0',
      String(keapResult.raw_value || ''),
    );

    return {
      http_status: 200,
      status: 'ok',
      synced: true,
      email: email,
      is_cohort: true,
      is_active: isActive,
      keap_contact_id: String(keapResult.contact_id || ''),
      keap_raw_value: String(keapResult.raw_value || ''),
      free_year_expire_utc: keapResult.expire_utc,
      customer: result.rows[0],
    };
  }

  return {
    syncCohortContact: syncCohortContact,
  };
}

module.exports = {
  createKeapCohortSync,
};
