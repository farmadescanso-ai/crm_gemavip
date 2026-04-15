/**
 * CORS con lista blanca (variable CORS_ORIGINS, separada por comas).
 * Sin CORS_ORIGINS no se envían cabeceras CORS: el navegador solo permite el origen por defecto (mismo sitio).
 * Con orígenes definidos: refleja el Origin si está permitido y habilita credenciales para ese origen.
 */

function parseAllowedOrigins() {
  const raw = process.env.CORS_ORIGINS;
  if (raw == null || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function corsMiddleware(req, res, next) {
  const allowed = parseAllowedOrigins();
  if (!allowed.length) return next();

  const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  const isAllowed = origin && allowed.includes(origin);

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  if ((req.method || '').toUpperCase() === 'OPTIONS') {
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, X-API-Key, X-CSRF-Token, Authorization, Accept'
      );
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    return res.status(204).end();
  }

  return next();
}

module.exports = { corsMiddleware, parseAllowedOrigins };
