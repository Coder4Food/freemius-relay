function createKeapClient(options) {
  const env = options.env;
  const logger = options.logger;
  const baseUrl = String(env.keapBaseUrl || '').replace(/\/+$/, '');
  const accessToken = String(env.keapAccessToken || '').trim();
  const cohortFieldLabel = String(env.keapCohortFieldLabel || '').trim();
  const cohortFieldId = String(env.keapCohortFieldId || '').trim();
  const regEmailFieldLabel = String(env.keapRegEmailFieldLabel || '').trim();
  const regEmailFieldId = String(env.keapRegEmailFieldId || '').trim();

  function isConfigured() {
    return !!baseUrl && !!accessToken;
  }

  function requireConfigured() {
    if (!isConfigured()) {
      throw new Error('Keap is not configured. Set KEAP_ACCESS_TOKEN first.');
    }
  }

  async function apiGet(path) {
    requireConfigured();

    const url = baseUrl + path;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/json',
      },
    });

    const text = await response.text();
    let body = null;

    try {
      body = text ? JSON.parse(text) : {};
    } catch (err) {
      body = { raw_text: text };
    }

    if (!response.ok) {
      logger.logError('[KEAP-HTTP-ERR] GET %s status=%s body=%s', path, response.status, logger.safeJson(body));
      throw new Error('Keap API request failed: GET ' + path + ' status=' + response.status);
    }

    return body;
  }

  async function apiPatch(path, payload) {
    requireConfigured();

    const url = baseUrl + path;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
    });

    const text = await response.text();
    let body = null;

    try {
      body = text ? JSON.parse(text) : {};
    } catch (err) {
      body = { raw_text: text };
    }

    if (!response.ok) {
      logger.logError('[KEAP-HTTP-ERR] PATCH %s status=%s body=%s', path, response.status, logger.safeJson(body));
      throw new Error('Keap API request failed: PATCH ' + path + ' status=' + response.status);
    }

    return body;
  }

  function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getFieldListFromModel(model) {
    if (!model) {
      return [];
    }

    if (Array.isArray(model.custom_fields)) {
      return model.custom_fields;
    }

    if (model.contact && Array.isArray(model.contact.custom_fields)) {
      return model.contact.custom_fields;
    }

    if (Array.isArray(model.fields)) {
      return model.fields;
    }

    return [];
  }

  async function getContactModel() {
    return apiGet('/contacts/model');
  }

  async function getCohortFieldDefinition() {
    const model = await getContactModel();
    const fields = getFieldListFromModel(model);
    const wantLabel = normalizeText(cohortFieldLabel);
    const wantId = normalizeText(cohortFieldId);
    let i = 0;
    let field = null;

    for (i = 0; i < fields.length; i += 1) {
      const f = fields[i] || {};
      const id = normalizeText(f.id || f.field_id || f.name);
      const label = normalizeText(f.label || f.field_label || f.field_name || f.name);

      if (wantId && id === wantId) {
        field = f;
        break;
      }

      if (wantLabel && label === wantLabel) {
        field = f;
        break;
      }
    }

    return {
      model: model,
      fields: fields,
      field: field,
      requested_label: cohortFieldLabel,
      requested_id: cohortFieldId,
    };
  }

  async function getFieldDefinitionByIdOrLabel(fieldId, fieldLabel) {
    const model = await getContactModel();
    const fields = getFieldListFromModel(model);
    const wantLabel = normalizeText(fieldLabel);
    const wantId = normalizeText(fieldId);
    let i = 0;
    let field = null;

    for (i = 0; i < fields.length; i += 1) {
      const f = fields[i] || {};
      const id = normalizeText(f.id || f.field_id || f.name);
      const label = normalizeText(f.label || f.field_label || f.field_name || f.name);

      if (wantId && id === wantId) {
        field = f;
        break;
      }

      if (wantLabel && label === wantLabel) {
        field = f;
        break;
      }
    }

    return {
      model: model,
      fields: fields,
      field: field,
      requested_label: fieldLabel,
      requested_id: fieldId,
    };
  }

  function getContactArray(body) {
    if (!body) {
      return [];
    }

    if (Array.isArray(body.contacts)) {
      return body.contacts;
    }

    if (Array.isArray(body.items)) {
      return body.items;
    }

    if (Array.isArray(body)) {
      return body;
    }

    return [];
  }

  function extractContactId(contact) {
    return contact && (contact.id || contact.contact_id || contact.Id || contact.ContactId);
  }

  async function findContactByEmail(email) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    let body = null;
    let contacts = [];

    if (!cleanEmail) {
      return null;
    }

    // Keap v1 commonly supports email as a list/search filter. If your app uses
    // a different Keap endpoint version, keep this function as the only place to adjust it.
    body = await apiGet('/contacts?email=' + encodeURIComponent(cleanEmail));
    contacts = getContactArray(body);

    if (!contacts.length) {
      return null;
    }

    return contacts[0];
  }

  async function retrieveContact(contactId) {
    return apiGet('/contacts/' + encodeURIComponent(String(contactId)) + '?optional_properties=custom_fields');
  }

  function extractEmail(contact) {
    const emailAddresses = contact && contact.email_addresses;
    let i = 0;

    if (contact && contact.email) {
      return String(contact.email || '').trim().toLowerCase();
    }

    if (Array.isArray(emailAddresses)) {
      for (i = 0; i < emailAddresses.length; i += 1) {
        if (emailAddresses[i] && emailAddresses[i].email) {
          return String(emailAddresses[i].email || '').trim().toLowerCase();
        }
      }
    }

    return '';
  }

  function extractName(contact) {
    const first = String((contact && (contact.given_name || contact.first_name)) || '').trim();
    const last = String((contact && (contact.family_name || contact.last_name)) || '').trim();
    const full = String((contact && (contact.name || contact.contact_name)) || '').trim();

    return {
      first_name: first,
      last_name: last,
      full_name: full || [first, last].filter(Boolean).join(' '),
    };
  }

  function getContactCustomFields(contact) {
    if (!contact) {
      return [];
    }

    if (Array.isArray(contact.custom_fields)) {
      return contact.custom_fields;
    }

    if (contact.contact && Array.isArray(contact.contact.custom_fields)) {
      return contact.contact.custom_fields;
    }

    return [];
  }

  function extractCustomFieldRawValue(contact, fieldDefinition) {
    const fields = getContactCustomFields(contact);
    const wantId = normalizeText(
      cohortFieldId ||
        (fieldDefinition && (fieldDefinition.id || fieldDefinition.field_id || fieldDefinition.name)),
    );
    const wantLabel = normalizeText(cohortFieldLabel);
    let i = 0;

    for (i = 0; i < fields.length; i += 1) {
      const f = fields[i] || {};
      const id = normalizeText(f.id || f.field_id || f.name);
      const label = normalizeText(f.label || f.field_label || f.field_name || f.name);

      if ((wantId && id === wantId) || (wantLabel && label === wantLabel)) {
        return f.content || f.value || f.values || f.date || '';
      }
    }

    return '';
  }

  function parseKeapDateEndOfDayUtc(value) {
    const text = String(value || '').trim();
    let match = null;
    let d = null;

    if (!text) {
      return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text + 'T23:59:59.000Z';
    }

    match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      return (
        match[3] + '-' +
        String(match[1]).padStart(2, '0') + '-' +
        String(match[2]).padStart(2, '0') +
        'T23:59:59.000Z'
      );
    }

    d = new Date(text);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString();
    }

    return null;
  }

  async function buildCohortContactResult(contactId, fallbackEmail) {
    const fieldInfo = await getCohortFieldDefinition();
    let fullContact = null;
    let rawValue = '';
    let expireUtc = null;

    if (!contactId) {
      return {
        found: false,
        contact: null,
        field: fieldInfo.field,
        raw_value: '',
        expire_utc: null,
      };
    }

    fullContact = await retrieveContact(contactId);
    rawValue = extractCustomFieldRawValue(fullContact, fieldInfo.field);
    expireUtc = parseKeapDateEndOfDayUtc(rawValue);

    return {
      found: true,
      contact: fullContact,
      contact_id: contactId,
      email: extractEmail(fullContact) || String(fallbackEmail || '').trim().toLowerCase(),
      name: extractName(fullContact),
      field: fieldInfo.field,
      raw_value: rawValue,
      expire_utc: expireUtc,
    };
  }

  async function getCohortContactByEmail(email) {
    const found = await findContactByEmail(email);
    const contactId = extractContactId(found);

    return buildCohortContactResult(contactId, email);
  }

  async function getCohortContactById(contactId) {
    const cleanContactId = String(contactId || '').trim();

    if (!cleanContactId) {
      return {
        found: false,
        contact: null,
        field: null,
        raw_value: '',
        expire_utc: null,
      };
    }

    return buildCohortContactResult(cleanContactId, '');
  }


  function extractFieldId(field) {
    return String((field && (field.id || field.field_id || field.name)) || '').trim();
  }

  async function writeRegistrationEmailByEmail(email, registrationEmail) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanRegistrationEmail = String(registrationEmail || email || '').trim().toLowerCase();
    const found = await findContactByEmail(cleanEmail);
    const contactId = extractContactId(found);
    const fieldInfo = await getFieldDefinitionByIdOrLabel(regEmailFieldId, regEmailFieldLabel);
    const fieldId = extractFieldId(fieldInfo.field);
    let updated = null;

    if (!contactId) {
      return {
        ok: false,
        reason: 'contact_not_found',
        email: cleanEmail,
      };
    }

    if (!fieldId) {
      return {
        ok: false,
        reason: 'field_not_found',
        email: cleanEmail,
        contact_id: String(contactId || ''),
        requested_field_id: regEmailFieldId,
        requested_field_label: regEmailFieldLabel,
      };
    }

    updated = await apiPatch('/contacts/' + encodeURIComponent(String(contactId)), {
      custom_fields: [
        {
          id: fieldId,
          content: cleanRegistrationEmail,
        },
      ],
    });

    return {
      ok: true,
      email: cleanEmail,
      registration_email: cleanRegistrationEmail,
      contact_id: String(contactId || ''),
      field_id: fieldId,
      field_label: String((fieldInfo.field && fieldInfo.field.label) || regEmailFieldLabel || ''),
      response: updated,
    };
  }

  return {
    isConfigured: isConfigured,
    getContactModel: getContactModel,
    getCohortFieldDefinition: getCohortFieldDefinition,
    findContactByEmail: findContactByEmail,
    retrieveContact: retrieveContact,
    getCohortContactByEmail: getCohortContactByEmail,
    getCohortContactById: getCohortContactById,
    writeRegistrationEmailByEmail: writeRegistrationEmailByEmail,
  };
}

module.exports = {
  createKeapClient,
};
