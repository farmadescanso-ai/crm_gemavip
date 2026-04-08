const crypto = require('crypto');

const CSRF_TOKEN_LENGTH = 32;
const CSRF_FIELD_NAME = '_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

function generateToken() {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

function submittedCsrfToken(req) {
  let tokenFromBody = req.body?.[CSRF_FIELD_NAME];
  if (Array.isArray(tokenFromBody)) tokenFromBody = tokenFromBody[0];
  const tokenFromHeader =
    req.headers[CSRF_HEADER_NAME] || req.headers['x-csrf-token'];
  return tokenFromBody || tokenFromHeader || '';
}

/**
 * True si la petición autenticada debe rechazarse por CSRF (token ausente o distinto de sesión).
 * multipart/form-data: llamar solo después de multer u otro parser que rellene req.body.
 */
function shouldRejectCsrf(req) {
  if (!req.session) return false;
  if (!req.session.user) return false;
  const submitted = submittedCsrfToken(req);
  return !submitted || submitted !== req.session._csrf;
}

function sendCsrfInvalidResponse(req, res) {
  const wantsJson = /application\/json/i.test(req.headers.accept || '');
  if (wantsJson) {
    return res.status(403).json({ error: 'Token CSRF inválido o ausente. Recarga la página.' });
  }
  return res.status(403).send('Token CSRF inválido o ausente. Recarga la página e inténtalo de nuevo.');
}

/**
 * Middleware que genera un token CSRF por sesión y lo valida en peticiones POST/PUT/DELETE.
 * Patrón: Synchronizer Token (almacenado en sesión, verificado contra body/header).
 *
 * Rutas excluidas: /api/* (protegidas por API key), /webhook/* (tokens propios), /health*.
 * `deferValidationPaths`: no validar aquí (p. ej. multipart antes de multer); la ruta debe
 * llamar a shouldRejectCsrf tras parsear el body. Sigue aplicándose generación de token en sesión.
 */
function csrfProtection(options = {}) {
  const skipPaths = options.skipPaths || ['/api/', '/webhook/', '/health', '/sw.js'];
  const deferValidationPaths = options.deferValidationPaths || [];

  function pathMatches(list, pathname) {
    return list.some((p) => pathname.startsWith(p) || pathname === p);
  }

  return function csrfMiddleware(req, res, next) {
    const pathname = req.path || '';
    if (pathMatches(skipPaths, pathname)) return next();

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

    if (pathMatches(deferValidationPaths, pathname)) {
      return next();
    }

    if (shouldRejectCsrf(req)) {
      return sendCsrfInvalidResponse(req, res);
    }

    next();
  };
}

module.exports = {
  csrfProtection,
  CSRF_FIELD_NAME,
  CSRF_HEADER_NAME,
  shouldRejectCsrf,
  sendCsrfInvalidResponse
};
