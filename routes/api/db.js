const express = require('express');
const db = require('../../config/mysql-crm');
const { asyncHandler } = require('./_utils');
const { isAdminUser } = require('../../lib/auth');

const router = express.Router();

function requireAdminApi(req, res, next) {
  const user = req.session?.user || null;
  if (!user) return res.status(401).json({ ok: false, error: 'Login requerido' });
  if (!isAdminUser(user)) return res.status(403).json({ ok: false, error: 'Solo administrador' });
  return next();
}

// Todo el recurso /api/db queda restringido a administradores
router.use(requireAdminApi);

/**
 * @openapi
 * /api/db/integrity:
 *   get:
 *     summary: Reporte best-effort de integridad referencial (huérfanos)
 *     description: No modifica datos. Útil para diagnosticar relaciones rotas y rendimiento. Solo administrador.
 */
router.get(
  '/integrity',
  asyncHandler(async (_req, res) => {
    const report = await db.getIntegrityReport();
    res.json({ ok: true, report });
  })
);

/**
 * @openapi
 * /api/db/ensure-indexes:
 *   post:
 *     summary: Asegura índices recomendados (best-effort)
 *     description: Intenta crear índices si faltan. Si el usuario MySQL no tiene permisos, no rompe. Solo administrador.
 */
router.post(
  '/ensure-indexes',
  asyncHandler(async (_req, res) => {
    await db.ensureVisitasIndexes();
    await db.ensureClientesIndexes();
    await db.ensurePedidosIndexes();
    await db.ensurePedidosArticulosIndexes();
    await db.ensureContactosIndexes();
    res.json({ ok: true });
  })
);

module.exports = router;

