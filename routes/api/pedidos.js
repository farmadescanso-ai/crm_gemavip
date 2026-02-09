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

// Precio unitario (PVL) por tarifa para artículos (para formularios HTML)
// Importante: este endpoint debe ir ANTES de '/:id' para no colisionar.
router.get(
  '/precios',
  asyncHandler(async (req, res) => {
    const tarifaId = toInt(req.query.tarifaId, 0);
    const raw = String(req.query.articuloIds || req.query.articulos || '').trim();
    const articuloIds = raw
      ? raw
          .split(',')
          .map((s) => toInt(s, 0))
          .filter((n) => Number.isFinite(n) && n > 0)
          .slice(0, 200)
      : [];
    if (!tarifaId || !articuloIds.length) return res.json({ ok: true, precios: {} });
    const precios = await db.getPreciosArticulosParaTarifa(tarifaId, articuloIds).catch(() => ({}));
    return res.json({ ok: true, tarifaId, precios });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const item = await db.getPedidoById(req.params.id);
    if (!item) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const includeLineas =
      String(req.query.includeLineas || req.query.include_lineas || req.query.include || '').toLowerCase().includes('lineas') ||
      String(req.query.lineas || '').trim() === '1';
    if (includeLineas) {
      const lineas = await db.getArticulosByPedido(item.Id ?? item.id ?? req.params.id);
      return res.json({ ok: true, item, lineas });
    }
    return res.json({ ok: true, item });
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
    // Compatibilidad:
    // - Legacy: body es el pedido "plano"
    // - Nuevo: { pedido: {...}, lineas: [...] }
    const body = req.body || {};
    if (body && typeof body === 'object' && (Array.isArray(body.lineas) || Array.isArray(body.Lineas)) && (body.pedido || body.Pedido)) {
      const pedidoPayload = body.pedido || body.Pedido || {};
      const lineasPayload = body.lineas || body.Lineas || [];
      // Crear cabecera y luego reemplazar líneas con recálculo de totales (tarifa/IVA) en transacción.
      const created = await db.createPedido(pedidoPayload);
      const pedidoId = created?.insertId ?? created?.Id ?? created?.id;
      const result = await db.updatePedidoWithLineas(pedidoId, {}, lineasPayload);
      return res.status(201).json({ ok: true, created, result });
    }
    const result = await db.createPedido(req.body || {});
    res.status(201).json({ ok: true, result });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const body = req.body || {};
    // Opcional: { pedido: {...}, lineas: [...] , replaceLineas: true }
    const hasWrapper = body && typeof body === 'object' && (body.pedido || body.Pedido || Array.isArray(body.lineas) || Array.isArray(body.Lineas));
    const pedidoPayload = hasWrapper ? (body.pedido || body.Pedido || {}) : body;
    const lineasPayload = hasWrapper ? (body.lineas || body.Lineas || null) : null;
    const replaceRaw = hasWrapper ? (body.replaceLineas ?? body.replace_lineas ?? false) : false;
    const replace = replaceRaw === true || replaceRaw === 1 || replaceRaw === '1' || String(replaceRaw).toLowerCase() === 'true';
    if (Array.isArray(lineasPayload) && replace) {
      const result = await db.updatePedidoWithLineas(id, pedidoPayload, lineasPayload);
      return res.json({ ok: true, result, replaced: true });
    }

    const result = await db.updatePedido(id, pedidoPayload);
    return res.json({ ok: true, result });
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

router.put(
  '/lineas/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const result = await db.updatePedidoLinea(id, req.body || {});
    res.json({ ok: true, result });
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

router.get(
  '/tarifas/list',
  asyncHandler(async (_req, res) => {
    const items = await db.getTarifas();
    res.json({ ok: true, items });
  })
);

module.exports = router;

