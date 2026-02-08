const express = require('express');
const db = require('../../config/mysql-crm');
const { asyncHandler } = require('./_utils');

const router = express.Router();

/**
 * @openapi
 * /api/db/integrity:
 *   get:
 *     summary: Reporte best-effort de integridad referencial (huérfanos)
 *     description: No modifica datos. Útil para diagnosticar relaciones rotas y rendimiento.
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
 *     description: Intenta crear índices si faltan. Si el usuario MySQL no tiene permisos, no rompe.
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

