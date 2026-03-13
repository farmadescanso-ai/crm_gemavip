/**
 * Rutas HTML de notificaciones (admin) y mis-notificaciones (comercial).
 */

const express = require('express');
const db = require('../config/mysql-crm');
const { requireAdmin } = require('../lib/app-helpers');
const { requireLogin } = require('../lib/auth');
const { isAdminUser } = require('../lib/auth');
const { parsePagination } = require('../lib/pagination');
const { sendPedidoEspecialDecisionEmail, sendAsignacionResultadoEmail, APP_BASE_URL } = require('../lib/mailer');

const NOTIF_EMAILS_ENABLED =
  process.env.NOTIF_EMAILS_ENABLED === '1' || String(process.env.NOTIF_EMAILS_ENABLED || '').toLowerCase() === 'true';

const router = express.Router();

router.post('/notificaciones/borrar-historial', requireAdmin, async (req, res, next) => {
  try {
    const result = await db.deleteAllNotificaciones();
    return res.redirect('/notificaciones?borrado=' + (result?.deleted ?? 0));
  } catch (e) {
    next(e);
  }
});

router.get('/notificaciones', requireAdmin, async (req, res, next) => {
  try {
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 100 });
    const [items, total] = await Promise.all([db.getNotificaciones(limit, offset), db.getNotificacionesPendientesCount()]);
    res.render('notificaciones', { items: items || [], paging: { page, limit, total: total || 0 }, resuelto: req.query.resuelto || undefined, borrado: req.query.borrado });
  } catch (e) {
    next(e);
  }
});

router.post('/notificaciones/:id/aprobar', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const resolved = await db.resolverSolicitudAsignacion(id, res.locals.user?.id, true);
    if (resolved?.ok && resolved?.tipo === 'asignacion_contacto') {
      try {
        const comercial = await db.getComercialById(resolved.id_comercial_solicitante).catch(() => null);
        const cliente = resolved.id_contacto ? await db.getClienteById(resolved.id_contacto).catch(() => null) : null;
        const comercialEmail = comercial?.Email ?? comercial?.email ?? null;
        const clienteNombre = cliente?.cli_nombre_razon_social ?? cliente?.Nombre_Razon_Social ?? cliente?.Nombre ?? 'Cliente';
        if (comercialEmail) {
          await sendAsignacionResultadoEmail(comercialEmail, { aprobado: true, clienteNombre, clienteId: resolved.id_contacto }).catch(() => null);
        }
      } catch (_) {}
    } else if (NOTIF_EMAILS_ENABLED && resolved?.ok && resolved?.tipo === 'pedido_especial' && resolved?.comercial_email) {
      const pedidoUrl = resolved?.id_pedido ? `${APP_BASE_URL}/pedidos/${resolved.id_pedido}` : '';
      await sendPedidoEspecialDecisionEmail(String(resolved.comercial_email), {
        decision: 'aprobado',
        pedidoNum: resolved.num_pedido || '',
        clienteNombre: resolved.cliente_nombre || '',
        pedidoUrl
      }).catch(() => null);
    }
    return res.redirect('/notificaciones?resuelto=aprobada');
  } catch (e) {
    next(e);
  }
});

router.post('/notificaciones/:id/rechazar', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const resolved = await db.resolverSolicitudAsignacion(id, res.locals.user?.id, false);
    if (resolved?.ok && resolved?.tipo === 'asignacion_contacto') {
      try {
        const comercial = await db.getComercialById(resolved.id_comercial_solicitante).catch(() => null);
        const cliente = resolved.id_contacto ? await db.getClienteById(resolved.id_contacto).catch(() => null) : null;
        const comercialEmail = comercial?.Email ?? comercial?.email ?? null;
        const clienteNombre = cliente?.cli_nombre_razon_social ?? cliente?.Nombre_Razon_Social ?? cliente?.Nombre ?? 'Cliente';
        if (comercialEmail) {
          await sendAsignacionResultadoEmail(comercialEmail, { aprobado: false, clienteNombre, clienteId: resolved.id_contacto }).catch(() => null);
        }
      } catch (_) {}
    } else if (NOTIF_EMAILS_ENABLED && resolved?.ok && resolved?.tipo === 'pedido_especial' && resolved?.comercial_email) {
      const pedidoUrl = resolved?.id_pedido ? `${APP_BASE_URL}/pedidos/${resolved.id_pedido}` : '';
      await sendPedidoEspecialDecisionEmail(String(resolved.comercial_email), {
        decision: 'rechazado',
        pedidoNum: resolved.num_pedido || '',
        clienteNombre: resolved.cliente_nombre || '',
        pedidoUrl
      }).catch(() => null);
    }
    return res.redirect('/notificaciones?resuelto=rechazada');
  } catch (e) {
    next(e);
  }
});

router.get('/mis-notificaciones', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    if (admin) return res.redirect('/notificaciones');
    const userId = Number(res.locals.user?.id);
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 100 });
    const items = await db.getNotificacionesForComercial(userId, limit, offset).catch(() => []);
    const total = await db.getNotificacionesForComercialCount(userId).catch(() => (items?.length || 0));
    const solicitudOk = req.query.solicitud === 'ok';
    res.render('mis-notificaciones', { items: items || [], paging: { page, limit, total: total || 0 }, solicitudOk });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
