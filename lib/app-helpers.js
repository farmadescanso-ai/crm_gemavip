/**
 * Helpers compartidos para la app Express (rutas HTML, errores, middleware).
 */

const crypto = require('crypto');
const { isAdminUser } = require('./auth');

/** Helper para Node <14: a ?? b */
function _n(a, b) {
  return a != null ? a : b;
}

/**
 * Extrae contraseña de fila comercial (com_password, Password, etc.)
 * Búsqueda case-insensitive para compatibilidad con distintas configuraciones MySQL
 */
function getStoredPasswordFromRow(row) {
  if (!row || typeof row !== 'object') return '';
  const keys = Object.keys(row);
  const keysLower = new Map(keys.map((k) => [String(k).toLowerCase(), k]));
  const cands = ['com_password', 'password', 'contraseña', 'contrasena', 'pass', 'clave'];
  for (const c of cands) {
    const key = keysLower.get(c.toLowerCase());
    if (key) {
      const val = row[key];
      if (val != null && val !== '') return String(val);
    }
  }
  const pwdKey = keys.find((k) => /password|contraseña|contrasena|pass|clave/i.test(String(k)));
  return pwdKey ? String(row[pwdKey] || '') : '';
}

function makeRequestId() {
  try {
    return crypto.randomUUID();
  } catch (_) {
    return crypto.randomBytes(16).toString('hex');
  }
}

function wantsHtml(req) {
  const accept = String(req.headers?.accept || '');
  return accept.includes('text/html');
}

/**
 * Lee un parámetro de query de forma robusta con rewrites (p. ej. Vercel: `__path` + middleware que ajusta `req.url`).
 * Si `req.query` no incluye el nombre tras mutar la URL, se parsea `req.originalUrl`.
 */
function getQueryParam(req, name) {
  const from = req.query && req.query[name];
  if (from !== undefined && from !== null && String(from).trim() !== '') return String(from).trim();
  const raw = req.originalUrl || req.url || '';
  const qi = raw.indexOf('?');
  if (qi === -1) return '';
  try {
    const sp = new URLSearchParams(raw.slice(qi + 1));
    const v = sp.get(name);
    return v != null ? String(v).trim() : '';
  } catch (_) {
    return '';
  }
}

function buildSupportDetails(req, { status, heading, summary, publicMessage, code } = {}) {
  const user = req.session?.user || null;
  const roles = Array.isArray(user?.roles) ? user.roles.join(', ') : String(user?.roles || '');
  const lines = [
    'CRM Gemavip · Reporte de incidencia',
    `Fecha: ${new Date().toISOString()}`,
    `Request ID: ${req.requestId || '—'}`,
    `Ruta: ${req.method} ${req.originalUrl || req.url || ''}`,
    `Estado: ${status || 500}`,
    `Título: ${heading || '—'}`,
    `Resumen: ${summary || '—'}`,
    `Mensaje: ${publicMessage || '—'}`,
    `Código interno: ${code || '—'}`,
    `Usuario: ${user ? `${user.email || '—'} (id: ${_n(user.id, '—')})` : 'No logueado'}`,
    `Roles: ${roles || '—'}`,
    `User-Agent: ${String(req.headers['user-agent'] || '—')}`
  ];
  return lines.join('\n');
}

function renderErrorPage(req, res, opts) {
  const status = opts?.status || 500;
  const heading = opts?.heading || 'Ha ocurrido un problema';
  const summary = opts?.summary || 'No se ha podido completar la acción.';
  const statusLabel =
    opts?.statusLabel ||
    (status === 404 ? 'Not Found' : status === 403 ? 'Forbidden' : status === 401 ? 'Unauthorized' : 'Error');
  const whatToDo =
    opts?.whatToDo || [
      'Vuelve atrás e inténtalo de nuevo.',
      'Si estabas editando algo, revisa que los datos sean correctos.',
      'Si el problema continúa, copia los detalles y envíalos a soporte.'
    ];
  const primaryAction =
    opts?.primaryAction ||
    (req.session?.user ? { href: '/dashboard', label: 'Ir al Dashboard' } : { href: '/login', label: 'Ir a Login' });
  const supportDetails =
    opts?.supportDetails ||
    buildSupportDetails(req, {
      status,
      heading,
      summary,
      publicMessage: opts?.publicMessage,
      code: opts?.code
    });

  return res.status(status).render('error', {
    title: opts?.title || `Error ${status}`,
    status,
    statusLabel,
    heading,
    summary,
    whatToDo,
    primaryAction,
    requestId: req.requestId,
    when: new Date().toISOString(),
    supportDetails
  });
}

/**
 * Sesión portal del cliente: permite solo endpoints necesarios para el formulario de pedido
 * (precios por tarifa, ficha propia, direcciones de envío, cooperativas).
 */
function portalMayAccessApi(req) {
  const cid = Number(req.session?.portalUser?.cli_id);
  if (!Number.isFinite(cid) || cid <= 0) return false;
  const pathOnly = String(req.originalUrl || req.url || '').split('?')[0];
  const m = String(req.method || 'GET').toUpperCase();
  if (pathOnly === '/api/pedidos/precios' && m === 'GET') return true;
  if (pathOnly === `/api/clientes/${cid}` && m === 'GET') return true;
  if (pathOnly === `/api/clientes/${cid}/cooperativas` && m === 'GET') return true;
  if (pathOnly.startsWith(`/api/clientes/${cid}/direcciones-envio`)) {
    if (m === 'GET') return true;
    if (
      m === 'POST' &&
      (pathOnly === `/api/clientes/${cid}/direcciones-envio` ||
        pathOnly === `/api/clientes/${cid}/direcciones-envio/ensure-fiscal`)
    ) {
      return true;
    }
  }
  return false;
}

function requireApiKeyIfConfigured(req, res, next) {
  if (req.session?.user) return next();
  if (portalMayAccessApi(req)) return next();
  const configured = process.env.API_KEY;
  if (!configured) {
    return res
      .status(401)
      .json({ ok: false, error: 'Login requerido (inicia sesión en la web o configura API_KEY para acceso externo)' });
  }
  const provided = req.header('x-api-key') || req.header('X-API-Key');
  if (provided && provided === configured) return next();
  return res.status(401).json({ ok: false, error: 'API key requerida (X-API-Key)' });
}

function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.redirect('/login');
  if (!isAdminUser(req.session.user)) {
    if (wantsHtml(req)) {
      return renderErrorPage(req, res, {
        status: 403,
        title: 'Acceso restringido',
        heading: 'No tienes permisos para ver esta página',
        summary: 'Esta sección está disponible solo para administradores.',
        statusLabel: 'Forbidden',
        whatToDo: [
          'Si crees que esto es un error, cierra sesión e inicia de nuevo.',
          'Si sigues sin acceso, solicita permisos a un administrador.',
          'Si necesitas ayuda, copia los detalles y envíalos a soporte.'
        ]
      });
    }
    return res.status(403).send('Forbidden');
  }
  return next();
}

/**
 * Pick por nombre exacto, devuelve string trimmed (para labels/display).
 */
function pickStr(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/**
 * Case-insensitive pick: busca la primera key que coincida (ignorando case) y tenga valor no-nulo/vacío.
 */
function pickCI(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  const map = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), obj[k]]));
  for (const k of keys) {
    const v = map.get(k.toLowerCase());
    if (v != null && v !== '') return v;
  }
  return undefined;
}

/**
 * Como pickCI pero devuelve el primer valor numérico > 0 (útil para precios/descuentos con fallback).
 */
function pickNonZero(obj, keys, dflt = 0) {
  if (!obj || typeof obj !== 'object') return dflt;
  const map = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), obj[k]]));
  let first;
  for (const k of keys) {
    const v = map.get(k.toLowerCase());
    if (v != null && v !== '') {
      if (first === undefined) first = v;
      if (Number(v) > 0) return Number(v);
    }
  }
  return first !== undefined ? Number(first) : dflt;
}

module.exports = {
  _n,
  getStoredPasswordFromRow,
  makeRequestId,
  wantsHtml,
  getQueryParam,
  buildSupportDetails,
  renderErrorPage,
  requireApiKeyIfConfigured,
  portalMayAccessApi,
  requireAdmin,
  pickCI,
  pickNonZero,
  pickStr
};
