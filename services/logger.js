function createLogger(debugEnabled) {
  function safeJson(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (err) {
      return '[unserializable]';
    }
  }

  function log() {
    if (!debugEnabled) {
      return;
    }
    console.log.apply(console, arguments);
  }

  function logError() {
    console.error.apply(console, arguments);
  }

  function nowUtc() {
    return new Date().toISOString();
  }

  function normalizeEmail(email) {
    return String(email || '')
      .trim()
      .toLowerCase();
  }

  return {
    debugEnabled: !!debugEnabled,
    nowUtc: nowUtc,
    normalizeEmail: normalizeEmail,
    safeJson: safeJson,
    log: log,
    logError: logError,
  };
}

module.exports = {
  createLogger,
};
