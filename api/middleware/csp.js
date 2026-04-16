const crypto = require('crypto');
const helmet = require('helmet');

function cspNonceMiddleware(req, res, next) {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64url');
  next();
}

const cspAppMiddleware = helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      (req, res) => `'nonce-${res.locals.cspNonce}'`,
      'https://cdn.jsdelivr.net',
      'https://vercel.live'
    ],
    scriptSrcAttr: ["'unsafe-inline'"],
    styleSrc: [
      "'self'",
      (req, res) => `'nonce-${res.locals.cspNonce}'`,
      'https://fonts.googleapis.com',
      'https://cdn.jsdelivr.net'
    ],
    styleSrcAttr: ["'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://fonts.googleapis.com'],
    connectSrc: ["'self'", 'https://cdn.jsdelivr.net'],
    frameSrc: ["'self'", 'https://vercel.live'],
    frameAncestors: ["'none'"],
    workerSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"]
  }
});

/** Swagger UI inyecta scripts/estilos inline sin nonce. */
const cspSwaggerDocsMiddleware = helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://fonts.googleapis.com'],
    connectSrc: ["'self'"],
    frameAncestors: ["'none'"],
    workerSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"]
  }
});

function cspRoutePickerMiddleware(req, res, next) {
  if (req.path.startsWith('/api/docs')) {
    return cspSwaggerDocsMiddleware(req, res, next);
  }
  return cspAppMiddleware(req, res, next);
}

function helmetWithoutCsp() {
  return helmet({
    contentSecurityPolicy: false
  });
}

module.exports = {
  cspNonceMiddleware,
  cspRoutePickerMiddleware,
  helmetWithoutCsp
};
