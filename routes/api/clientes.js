const express = require('express');
const db = require('../../config/mysql-crm');
const { asyncHandler, toBool, toInt } = require('./_utils');

const router = express.Router();

/**
 * @openapi
 * /api/clientes:
 *   get:
 *     summary: Listar clientes (paginado por defecto)
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.max(1, Math.min(500, toInt(req.query.limit, 50) ?? 50));
    const page = Math.max(1, toInt(req.query.page, 1) ?? 1);
    const offset = Math.max(0, toInt(req.query.offset, (page - 1) * limit) ?? 0);

    const filters = {
      tipoCliente: req.query.tipoCliente ?? req.query.tipoClienteId,
      provincia: req.query.provincia ?? req.query.provinciaId,
      comercial: req.query.comercial ?? req.query.comercialId,
      comercialIncludePool: toBool(req.query.comercialIncludePool, false),
      conVentas: toBool(req.query.conVentas, false),
      sinVentas: toBool(req.query.sinVentas, false),
      estado: req.query.estado,
      estadoCliente: req.query.estadoCliente ?? req.query.estadoClienteId,
      search: req.query.search ?? req.query.q
    };

    const [items, total] = await Promise.all([
      db.getClientesOptimizadoPaged(filters, { limit, offset }),
      db.countClientesOptimizado(filters)
    ]);

    res.json({ ok: true, items, paging: { limit, offset, total } });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const item = await db.getClienteById(id);
    if (!item) return res.status(404).json({ ok: false, error: 'No encontrado' });
    res.json({ ok: true, item });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = await db.createCliente(req.body || {});
    res.status(201).json({ ok: true, result });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const result = await db.updateCliente(id, req.body || {});
    res.json({ ok: true, result });
  })
);

router.patch(
  '/:id/okko',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const value = req.body?.value;
    if (value === undefined) return res.status(400).json({ ok: false, error: 'Falta body.value' });
    const result = await db.toggleClienteOkKo(id, value);
    res.json({ ok: true, result });
  })
);

router.post(
  '/:id/papelera',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const eliminadoPor = req.body?.eliminadoPor ?? req.body?.user ?? null;
    const result = await db.moverClienteAPapelera(id, eliminadoPor);
    res.json({ ok: true, result });
  })
);

module.exports = router;

