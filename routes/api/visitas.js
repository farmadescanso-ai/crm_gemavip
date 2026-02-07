const express = require('express');
const db = require('../../config/mysql-crm');
const { asyncHandler, toInt } = require('./_utils');

const router = express.Router();

/**
 * @openapi
 * /api/visitas:
 *   get:
 *     summary: Listar visitas (opcionalmente filtrar por comercialId/clienteId)
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const comercialId = toInt(req.query.comercialId, null);
    const clienteId = toInt(req.query.clienteId, null);

    if (clienteId) {
      const items = await db.getVisitasByCliente(clienteId);
      return res.json({ ok: true, items });
    }
    if (comercialId) {
      const items = await db.getVisitasByComercial(comercialId);
      return res.json({ ok: true, items });
    }

    const items = await db.getVisitas(null);
    return res.json({ ok: true, items });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const item = await db.getVisitaById(id);
    if (!item) return res.status(404).json({ ok: false, error: 'No encontrado' });
    res.json({ ok: true, item });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = await db.createVisita(req.body || {});
    res.status(201).json({ ok: true, result });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const result = await db.updateVisita(id, req.body || {});
    res.json({ ok: true, result });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const result = await db.deleteVisita(id);
    res.json({ ok: true, result });
  })
);

module.exports = router;

