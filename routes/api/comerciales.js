const express = require('express');
const db = require('../../config/mysql-crm');
const { asyncHandler, toInt } = require('./_utils');

const router = express.Router();

function isAdminSessionUser(user) {
  const roles = user?.roles || [];
  return (roles || []).some((r) => String(r).toLowerCase().includes('admin'));
}

function requireAdminApi(req, res, next) {
  const user = req.session?.user || null;
  if (!user) return res.status(401).json({ ok: false, error: 'Login requerido' });
  if (!isAdminSessionUser(user)) return res.status(403).json({ ok: false, error: 'Forbidden' });
  return next();
}

function sanitizeComercial(row) {
  if (!row || typeof row !== 'object') return row;
  // Nunca exponer Password (en BD legacy a veces contiene DNI en claro)
  // eslint-disable-next-line no-unused-vars
  const { Password, password, ...rest } = row;
  return rest;
}

// Todo el recurso /api/comerciales queda restringido a administradores
router.use(requireAdminApi);

/**
 * @openapi
 * /api/comerciales:
 *   get:
 *     summary: Listar comerciales
 *     responses:
 *       200:
 *         description: OK
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const items = await db.getComerciales();
    res.json({ ok: true, items: (items || []).map(sanitizeComercial) });
  })
);

/**
 * @openapi
 * /api/comerciales/{id}:
 *   get:
 *     summary: Obtener comercial por ID
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const item = await db.getComercialById(id);
    if (!item) return res.status(404).json({ ok: false, error: 'No encontrado' });
    res.json({ ok: true, item: sanitizeComercial(item) });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = await db.createComercial(req.body || {});
    res.status(201).json({ ok: true, result });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const result = await db.updateComercial(id, req.body || {});
    res.json({ ok: true, result });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const result = await db.deleteComercial(id);
    res.json({ ok: true, result });
  })
);

module.exports = router;

