const express = require('express');
const db = require('../../config/mysql-crm');
const { asyncHandler, toInt } = require('./_utils');
const { isAdminUser } = require('../../lib/auth');

const router = express.Router();

/**
 * @openapi
 * /api/notificaciones:
 *   get:
 *     tags:
 *       - Notificaciones
 *     summary: Listar notificaciones (solicitudes de asignación)
 *     description: Solo administrador (requiere sesión).
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Tamaño de página
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Número de página
 *     responses:
 *       200:
 *         description: OK
 *       403:
 *         description: Forbidden
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
 * @openapi
 * /api/notificaciones/pendientes-count:
 *   get:
 *     tags:
 *       - Notificaciones
 *     summary: Número de solicitudes pendientes
 *     description: Solo administrador (requiere sesión).
 *     responses:
 *       200:
 *         description: OK
 *       403:
 *         description: Forbidden
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
