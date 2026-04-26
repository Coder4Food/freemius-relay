function createAdminAuthMiddleware(adminAuth) {
  return function (req, res, next) {
    const header = String(req.headers.authorization || '');
    const prefix = 'Bearer ';
    let token = '';
    let session = null;

    if (header.indexOf(prefix) !== 0) {
      return res.status(401).json({
        status: 'unauthorized',
        message: 'Missing bearer token',
      });
    }

    token = header.substring(prefix.length).trim();
    session = adminAuth.validateToken(token);

    if (!session) {
      return res.status(401).json({
        status: 'unauthorized',
        message: 'Invalid or expired bearer token',
      });
    }

    req.adminSession = session;
    return next();
  };
}

module.exports = {
  createAdminAuthMiddleware,
};
