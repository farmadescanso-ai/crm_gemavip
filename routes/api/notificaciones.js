const express = require('express');
const db = require('../../config/mysql-crm');
const { asyncHandler, toInt } = require('./_utils');
const { isAdminUser } = require('../../lib/auth');

const router = express.Router();

/**
 * GET /api/notificaciones
 * Lista notificaciones (solicitudes de asignación). Solo administrador.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = req.session?.user;
    if (!user || !isAdminUser(user)) return res.status(403).json({ ok: false, error: 'Solo administrador' });
    const limit = Math.max(1, Math.min(100, toInt(req.query.limit, 50) ?? 50));
    const page = Math.max(1, toInt(req.query.page, 1) ?? 1);
    const offset = (page - 1) * limit;
    const items = await db.getNotificaciones(limit, offset);
    const total = await db.getNotificacionesPendientesCount();
    res.json({ ok: true, items, paging: { page, limit, offset, total } });
  })
);

/**
 * GET /api/notificaciones/pendientes-count
 * Número de solicitudes pendientes. Solo administrador.
 */
router.get(
  '/pendientes-count',
  asyncHandler(async (req, res) => {
    const user = req.session?.user;
    if (!user || !isAdminUser(user)) return res.status(403).json({ ok: false, error: 'Solo administrador' });
    const count = await db.getNotificacionesPendientesCount();
    res.json({ ok: true, count });
  })
);

module.exports = router;
