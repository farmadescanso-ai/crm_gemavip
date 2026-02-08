const express = require('express');
const db = require('../../config/mysql-crm');
const { asyncHandler, toBool, toInt } = require('./_utils');

const router = express.Router();

function isAdminSessionUser(user) {
  const roles = user?.roles || [];
  return (roles || []).some((r) => String(r).toLowerCase().includes('admin'));
}

/**
 * @openapi
 * /api/clientes:
 *   get:
 *     summary: Listar clientes (paginado por defecto)
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminSessionUser(sessionUser);

    const limit = Math.max(1, Math.min(500, toInt(req.query.limit, 50) ?? 50));
    const page = Math.max(1, toInt(req.query.page, 1) ?? 1);
    const offset = Math.max(0, toInt(req.query.offset, (page - 1) * limit) ?? 0);

    const q = typeof (req.query.q ?? req.query.search) === 'string' ? String(req.query.q ?? req.query.search) : '';

    const filters = {
      tipoCliente: req.query.tipoCliente ?? req.query.tipoClienteId,
      provincia: req.query.provincia ?? req.query.provinciaId,
      // Seguridad/alcance: si hay usuario en sesión y no es admin, solo sus clientes asignados.
      comercial: sessionUser && !isAdmin ? sessionUser.id : (req.query.comercial ?? req.query.comercialId),
      comercialIncludePool: toBool(req.query.comercialIncludePool, false),
      conVentas: toBool(req.query.conVentas, false),
      sinVentas: toBool(req.query.sinVentas, false),
      estado: req.query.estado,
      estadoCliente: req.query.estadoCliente ?? req.query.estadoClienteId,
      // compat: admitir q o search (la implementación usa filters.q)
      q
    };

    const [items, total] = await Promise.all([
      db.getClientesOptimizadoPaged(filters, { limit, offset }),
      db.countClientesOptimizado(filters)
    ]);

    res.json({ ok: true, items, paging: { limit, offset, total } });
  })
);

/**
 * @openapi
 * /api/clientes/suggest:
 *   get:
 *     summary: Autocomplete rápido de clientes (compacto)
 */
router.get(
  '/suggest',
  asyncHandler(async (req, res) => {
    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminSessionUser(sessionUser);
    const limit = Math.max(1, Math.min(50, toInt(req.query.limit, 20) ?? 20));
    const q = typeof req.query.q === 'string' ? String(req.query.q) : typeof req.query.search === 'string' ? String(req.query.search) : '';
    // A partir de 3 caracteres (texto) o 1 (solo dígitos: ID/CP)
    const qq = String(q || '').trim();
    const isDigitsOnly = /^[0-9]+$/.test(qq);
    if (!qq) return res.json({ ok: true, items: [] });
    if (!isDigitsOnly && qq.length < 3) return res.json({ ok: true, items: [] });

    const filters = {
      q: qq,
      comercial: sessionUser && !isAdmin ? sessionUser.id : undefined
    };

    const items = await db.getClientesOptimizadoPaged(filters, {
      limit,
      offset: 0,
      compact: true,
      compactSearch: true,
      order: 'desc',
      // sugerencia: limitar campos buscados a lo más relevante (la query ya usa FULLTEXT si existe)
      // la lógica en DB prioriza Nombre_Razon_Social / Nombre_Cial / DNI_CIF de forma natural por índice.
    });
    res.json({ ok: true, items: items || [] });
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

