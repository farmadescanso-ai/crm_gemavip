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
    links.push({ href: '/clientes', label: 'Clientes' });
    links.push({ href: '/agenda', label: 'Agenda' });
    links.push({ href: '/pedidos', label: 'Pedidos' });
    links.push({ href: '/visitas', label: 'Visitas' });
    links.push({ href: '/articulos', label: 'Artículos' });
  }
  return links.sort((a, b) => String(a?.label || '').localeCompare(String(b?.label || ''), 'es', { sensitivity: 'base' }));
}

function getRoleNavLinksForRoles(roles) {
  const has = (name) => (roles || []).some((r) => String(r).toLowerCase().includes(String(name).toLowerCase()));
  const isAdmin = has('admin');
  const isComercial = has('comercial') || !roles || roles.length === 0;
  const links = [];
  if (isAdmin) links.push({ href: '/notificaciones', label: 'Solicitudes' });
  if (!isAdmin && isComercial) links.push({ href: '/mis-notificaciones', label: 'Notificaciones' });
  if (isAdmin) links.push({ href: '/comerciales', label: 'Comerciales' });
  if (isAdmin) links.push({ href: '/admin/descuentos-pedido', label: 'Descuentos' });
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
      const owner = Number(item.Id_Cial ?? item.id_cial ?? item.ComercialId ?? item.comercialId ?? 0) || 0;
      if (owner !== userId) return res.status(404).send('No encontrado');
    }
    res.locals.pedido = item;
    res.locals.pedidoAdmin = admin;
    next();
  };
}

module.exports = {
  isAdminUser,
  normalizeRoles,
  getCommonNavLinksForRoles,
  getRoleNavLinksForRoles,
  requireLogin,
  createLoadPedidoAndCheckOwner
};
