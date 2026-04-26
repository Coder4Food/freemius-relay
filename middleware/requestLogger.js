function createRequestLogger(logger) {
  return function (req, res, next) {
    const startedAt = Date.now();

    if (logger.debugEnabled) {
      logger.log('');
      logger.log('[REQ] %s %s %s', logger.nowUtc(), req.method, req.originalUrl || req.url);
      logger.log(
        '[REQ] ip=%s',
        req.ip || (req.connection && req.connection.remoteAddress) || '',
      );
      logger.log('[REQ] headers=%s', logger.safeJson(req.headers));

      if (req.method !== 'GET') {
        logger.log('[REQ] body=%s', logger.safeJson(req.body));
      }
    }

    res.on('finish', function () {
      const elapsedMs = Date.now() - startedAt;
      logger.log(
        '[RES] %s %s %s status=%s elapsed_ms=%s',
        logger.nowUtc(),
        req.method,
        req.originalUrl || req.url,
        res.statusCode,
        elapsedMs,
      );
    });

    next();
  };
}

module.exports = {
  createRequestLogger,
};
