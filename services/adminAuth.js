const crypto = require('crypto');

function createAdminAuth(options) {
  const logger = options.logger;
  const verifyPassword = options.verifyPassword;
  const adminUsername = String(options.adminUsername || 'admin').trim();
  const adminPasswordHash = String(options.adminPasswordHash || '').trim();
  const tokenTtlMinutes = options.tokenTtlMinutes || 480;
  const sessions = {};

  function purgeExpiredSessions() {
    const nowMs = Date.now();
    Object.keys(sessions).forEach(function (token) {
      if (!sessions[token] || sessions[token].expiresAtMs <= nowMs) {
        delete sessions[token];
      }
    });
  }

  function issueToken(username) {
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAtMs = Date.now() + tokenTtlMinutes * 60 * 1000;

    purgeExpiredSessions();
    sessions[token] = {
      username: username,
      issuedAtMs: Date.now(),
      expiresAtMs: expiresAtMs,
    };

    return {
      token: token,
      expiresAtUtc: new Date(expiresAtMs).toISOString(),
    };
  }

  function authenticate(username, password) {
    const normalizedUsername = String(username || '').trim();
    const normalizedPassword = String(password || '');

    if (!adminPasswordHash) {
      logger.logError('[AUTH-ERR] ADMIN_PASSWORD_HASH is not configured.');
      return {
        ok: false,
        error: 'admin_not_configured',
      };
    }

    if (normalizedUsername !== adminUsername) {
      logger.log('[AUTH] invalid username=%s', normalizedUsername);
      return {
        ok: false,
        error: 'invalid_credentials',
      };
    }

    if (!verifyPassword(normalizedPassword, adminPasswordHash)) {
      logger.log('[AUTH] password verification failed username=%s', normalizedUsername);
      return {
        ok: false,
        error: 'invalid_credentials',
      };
    }

    return {
      ok: true,
      session: issueToken(normalizedUsername),
    };
  }

  function validateToken(token) {
    const text = String(token || '').trim();
    let session = null;

    purgeExpiredSessions();
    session = sessions[text] || null;

    if (!session) {
      return null;
    }

    return {
      username: session.username,
      expiresAtUtc: new Date(session.expiresAtMs).toISOString(),
    };
  }

  return {
    authenticate: authenticate,
    validateToken: validateToken,
  };
}

module.exports = {
  createAdminAuth,
};
