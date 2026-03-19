const crypto = require('crypto');

const CSRF_TOKEN_LENGTH = 32;
const CSRF_FIELD_NAME = '_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

function generateToken() {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/**
 * Middleware que genera un token CSRF por sesión y lo valida en peticiones POST/PUT/DELETE.
 * Patrón: Synchronizer Token (almacenado en sesión, verificado contra body/header).
 *
 * Rutas excluidas: /api/* (protegidas por API key), /webhook/* (tokens propios), /health*.
 */
function csrfProtection(options = {}) {
  const skipPaths = options.skipPaths || ['/api/', '/webhook/', '/health', '/sw.js'];

  return function csrfMiddleware(req, res, next) {
    const shouldSkip = skipPaths.some((p) => req.path.startsWith(p) || req.path === p);
    if (shouldSkip) return next();

    if (!req.session) return next();

    if (!req.session._csrf) {
      req.session._csrf = generateToken();
    }

    res.locals.csrfToken = req.session._csrf;

    const method = (req.method || '').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    // CSRF solo protege sesiones autenticadas; sin usuario no hay sesión que explotar
    if (!req.session.user) return next();

    const tokenFromBody = req.body?.[CSRF_FIELD_NAME];
    const tokenFromHeader = req.headers[CSRF_HEADER_NAME];
    const submitted = tokenFromBody || tokenFromHeader || '';

    if (!submitted || submitted !== req.session._csrf) {
      const wantsJson = /application\/json/i.test(req.headers.accept || '');
      if (wantsJson) {
        return res.status(403).json({ error: 'Token CSRF inválido o ausente. Recarga la página.' });
      }
      return res.status(403).send('Token CSRF inválido o ausente. Recarga la página e inténtalo de nuevo.');
    }

    next();
  };
}

module.exports = { csrfProtection, CSRF_FIELD_NAME, CSRF_HEADER_NAME };
