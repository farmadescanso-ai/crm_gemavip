/**
 * Autenticación y autorización compartida.
 * Roles: Administrador (admin) ve todo; Comercial solo sus recursos.
 */

const db = require('../config/mysql-crm');

function isAdminUser(user) {
  const roles = user?.roles || [];
  return (roles || []).some((r) => String(r).toLowerCase().includes('admin'));
}

function normalizeRoles(roll) {
  if (!roll) return [];
  if (Array.isArray(roll)) return roll.map(String);
  if (typeof roll === 'string') {
    const s = roll.trim();
    if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch (_) {}
    }
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }
  return [String(roll)];
}

function getCommonNavLinksForRoles(roles) {
  const has = (name) => (roles || []).some((r) => String(r).toLowerCase().includes(String(name).toLowerCase()));
  const isAdmin = has('admin');
  const isComercial = has('comercial') || !roles || roles.length === 0;
  const links = [];
  if (isAdmin || isComercial) {
    links.push({ href: '/clientes', label: 'Contactos' });
    // Agenda desactivada
    links.push({ href: '/pedidos', label: 'Pedidos' });
    links.push({ href: '/visitas', label: 'Visitas' });
    links.push({ href: '/articulos', label: 'Artículos' });
  }
  return links.sort((a, b) => String(a?.label || '').localeCompare(String(b?.label || ''), 'es', { sensitivity: 'base' }));
}

function isUserId1(user) {
  return Number(user?.id) === 1;
}

function getRoleNavLinksForRoles(roles, user) {
  const has = (name) => (roles || []).some((r) => String(r).toLowerCase().includes(String(name).toLowerCase()));
  const isAdmin = has('admin');
  const isComercial = has('comercial') || !roles || roles.length === 0;
  const links = [];
  if (isUserId1(user)) links.push({ href: '/cpanel', label: 'CPanel' });
  // Manual operativo (visible para cualquier usuario logueado)
  if (isAdmin || isComercial) links.push({ href: '/manual', label: 'Manual operativo' });
  if (isAdmin) links.push({ href: '/notificaciones', label: 'Solicitudes' });
  if (!isAdmin && isComercial) links.push({ href: '/mis-notificaciones', label: 'Notificaciones' });
  if (isAdmin) links.push({ href: '/comerciales', label: 'Comerciales' });
  if (isAdmin) links.push({ href: '/admin/descuentos-pedido', label: 'Descuentos' });
  if (isAdmin) links.push({ href: '/admin/normalizar-telefonos-clientes', label: 'Normalizar teléfonos' });
  if (isAdmin) links.push({ href: '/admin/webhooks', label: 'Webhooks' });
  if (isAdmin) links.push({ href: '/admin/configuracion-email', label: 'Configuración Email' });
  if (isAdmin) links.push({ href: '/api/docs/', label: 'API Docs', target: '_blank', rel: 'noopener noreferrer' });
  return links.sort((a, b) => String(a?.label || '').localeCompare(String(b?.label || ''), 'es', { sensitivity: 'base' }));
}

function requireLogin(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/login');
}

/**
 * Igual que requireLogin, pero si el cliente envía Accept: application/json (p. ej. fetch),
 * responde 401 JSON en lugar de redirigir a HTML — evita que el cliente reciba 200 con HTML del login.
 */
function requireLoginJson(req, res, next) {
  if (req.session?.user) return next();
  const accept = String(req.get('Accept') || '');
  if (accept.includes('application/json')) {
    return res.status(401).json({ ok: false, error: 'no_session' });
  }
  return res.redirect('/login');
}

/**
 * Solo el usuario con id comercial = 1 (sesión `user.id`).
 */
function requireUserId1(req, res, next) {
  if (!req.session?.user) {
    const returnTo = encodeURIComponent(req.originalUrl || '/cpanel');
    return res.redirect(`/login?returnTo=${returnTo}`);
  }
  if (!isUserId1(req.session.user)) {
    return res.status(403).send('Acceso restringido. Solo el usuario autorizado puede acceder al CPanel.');
  }
  return next();
}

/** Emails del administrador del sistema (acceso exclusivo a vistas como Importar Holded). */
const DEFAULT_SYSTEM_ADMIN_EMAILS = ['info@farmadescanso.com'];

function getSystemAdminEmails() {
  const env = process.env.SYSTEM_ADMIN_EMAILS;
  if (env && typeof env === 'string') {
    return env.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  }
  return DEFAULT_SYSTEM_ADMIN_EMAILS.map((e) => e.toLowerCase());
}

function isSystemAdminUser(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  return getSystemAdminEmails().includes(email);
}

/**
 * Middleware: solo permite acceso a usuarios administrador del sistema.
 * Por defecto: info@farmadescanso.com. Añadir más con SYSTEM_ADMIN_EMAILS (comma-separated).
 * No aparece en ningún menú; acceso solo por URL directa.
 */
function requireSystemAdmin(req, res, next) {
  if (!req.session?.user) {
    const returnTo = encodeURIComponent(req.originalUrl || '/admin/importar-holded');
    return res.redirect(`/login?returnTo=${returnTo}`);
  }
  if (!isSystemAdminUser(req.session.user)) {
    return res.status(403).send('Acceso restringido. Solo el administrador del sistema puede acceder a esta página.');
  }
  return next();
}

/**
 * Middleware: carga el pedido por id y comprueba que el usuario sea admin o dueño.
 * Si no tiene acceso: 404. Si ok: res.locals.pedido = item, res.locals.pedidoAdmin = admin.
 * @param {string} paramName - nombre del parámetro de ruta (por defecto 'id')
 */
function createLoadPedidoAndCheckOwner(paramName = 'id') {
  return async (req, res, next) => {
    const id = Number(req.params[paramName]);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const item = await db.getPedidoById(id);
    if (!item) return res.status(404).send('No encontrado');
    const admin = isAdminUser(res.locals.user);
    const userId = Number(res.locals.user?.id);
    if (!admin && Number.isFinite(userId) && userId > 0) {
      const owner = Number(item.ped_com_id ?? item.Id_Cial ?? item.id_cial ?? item.ComercialId ?? item.comercialId ?? 0) || 0;
      if (owner !== userId) return res.status(404).send('No encontrado');
    }
    res.locals.pedido = item;
    res.locals.pedidoAdmin = admin;
    next();
  };
}

module.exports = {
  isAdminUser,
  isUserId1,
  isSystemAdminUser,
  requireSystemAdmin,
  requireUserId1,
  normalizeRoles,
  getCommonNavLinksForRoles,
  getRoleNavLinksForRoles,
  requireLogin,
  requireLoginJson,
  createLoadPedidoAndCheckOwner
};
