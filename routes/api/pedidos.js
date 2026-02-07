const express = require('express');
const db = require('../../config/mysql-crm');
const { asyncHandler, toInt } = require('./_utils');

const router = express.Router();

/**
 * @openapi
 * /api/pedidos:
 *   get:
 *     summary: Listar pedidos (opcionalmente filtrar por comercialId/clienteId)
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const comercialId = toInt(req.query.comercialId, null);
    const clienteId = toInt(req.query.clienteId, null);

    if (clienteId) {
      const items = await db.getPedidosByCliente(clienteId);
      return res.json({ ok: true, items });
    }
    if (comercialId) {
      const items = await db.getPedidosByComercial(comercialId);
      return res.json({ ok: true, items });
    }

    const items = await db.getPedidos(null);
    return res.json({ ok: true, items });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const item = await db.getPedidoById(req.params.id);
    if (!item) return res.status(404).json({ ok: false, error: 'No encontrado' });
    res.json({ ok: true, item });
  })
);

router.get(
  '/:id/articulos',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const items = await db.getArticulosByPedido(id);
    res.json({ ok: true, items });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = await db.createPedido(req.body || {});
    res.status(201).json({ ok: true, result });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const result = await db.updatePedido(id, req.body || {});
    res.json({ ok: true, result });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const result = await db.deletePedido(id);
    res.json({ ok: true, result });
  })
);

router.post(
  '/:id/lineas',
  asyncHandler(async (req, res) => {
    // El método createPedidoLinea no necesita el ID en la URL, pero lo dejamos para ergonomía
    const payload = { ...(req.body || {}), PedidoId: toInt(req.params.id, undefined) ?? (req.body || {}).PedidoId };
    const result = await db.createPedidoLinea(payload);
    res.status(201).json({ ok: true, result });
  })
);

router.delete(
  '/lineas/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const result = await db.deletePedidoLinea(id);
    res.json({ ok: true, result });
  })
);

module.exports = router;

