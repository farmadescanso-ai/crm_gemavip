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

/**
 * GET /api/clientes/:id/cooperativas
 * Cooperativas del cliente con número de asociado (para Transfer Hefame, etc.)
 */
router.get(
  '/:id/cooperativas',
  asyncHandler(async (req, res) => {
    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminSessionUser(sessionUser);
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });

    if (sessionUser && !isAdmin) {
      const c = await db.getClienteById(id);
      if (!c) return res.status(404).json({ ok: false, error: 'No encontrado' });
      const cial = toInt(c.Id_Cial ?? c.id_cial ?? c.ComercialId ?? c.comercialId ?? c.Id_Comercial ?? c.id_comercial, 0) ?? 0;
      const selfId = toInt(sessionUser.id, 0) ?? 0;
      if (cial && cial !== 1 && cial !== selfId) return res.status(404).json({ ok: false, error: 'No encontrado' });
    }

    const items = await db.getCooperativasByClienteId(id).catch(() => []);
    const arr = Array.isArray(items) ? items : [];
    return res.json({ ok: true, items: arr });
  })
);

router.get(
  '/:id/direcciones-envio',
  asyncHandler(async (req, res) => {
    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminSessionUser(sessionUser);
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });

    // Seguridad: si no es admin, solo acceder a clientes asignados (o pool Id_Cial=1 / sin asignar).
    if (sessionUser && !isAdmin) {
      const c = await db.getClienteById(id);
      if (!c) return res.status(404).json({ ok: false, error: 'No encontrado' });
      const cial = toInt(c.Id_Cial ?? c.id_cial ?? c.ComercialId ?? c.comercialId ?? c.Id_Comercial ?? c.id_comercial, 0) ?? 0;
      const selfId = toInt(sessionUser.id, 0) ?? 0;
      if (cial && cial !== 1 && cial !== selfId) return res.status(404).json({ ok: false, error: 'No encontrado' });
    }

    const compact = toBool(req.query.compact, false) || String(req.query.format || '').toLowerCase() === 'compact';
    const items = await db.getDireccionesEnvioByCliente(id, { compact }).catch(() => []);
    const arr = Array.isArray(items) ? items : [];

    // Respuesta compacta (más rápida para selects): [{id,label}]
    if (compact) {
      res.setHeader('Cache-Control', 'private, max-age=60');
      const out = arr
        .map((d) => {
          const did = d?.id ?? d?.Id ?? null;
          if (!did) return null;
          const alias = d?.Alias ?? '';
          const dest = d?.Nombre_Destinatario ?? '';
          const dir = d?.Direccion ?? '';
          const pob = d?.Poblacion ?? '';
          const cp = d?.CodigoPostal ?? '';
          const label = [alias || dest, dir, [cp, pob].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
          return { id: did, label: label || `Dirección ${did}` };
        })
        .filter(Boolean);
      return res.json({ ok: true, items: out });
    }

    return res.json({ ok: true, items: arr });
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
    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminSessionUser(sessionUser);

    // Seguridad:
    // - Admin: puede actualizar cualquier campo
    // - Comercial: solo puede "reclamar" el cliente (Id_Cial) si está libre o en pool (Id_Cial=1),
    //             y solo para asignárselo a sí mismo.
    if (sessionUser && !isAdmin) {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const keys = Object.keys(body || {});
      if (keys.length !== 1 || !Object.prototype.hasOwnProperty.call(body, 'Id_Cial')) {
        return res.status(403).json({ ok: false, error: 'Solo permitido asignar Id_Cial desde sesión comercial' });
      }
      const requested = toInt(body.Id_Cial, 0);
      const selfId = toInt(sessionUser.id, 0);
      if (!selfId || requested !== selfId) {
        return res.status(403).json({ ok: false, error: 'Solo puedes asignarte el cliente a ti mismo' });
      }

      const current = await db.getClienteById(id);
      if (!current) return res.status(404).json({ ok: false, error: 'No encontrado' });
      const currentCialRaw =
        current.Id_Cial ?? current.id_cial ?? current.ComercialId ?? current.comercialId ?? current.Id_Comercial ?? current.id_comercial ?? null;
      const currentCial = toInt(currentCialRaw, 0) ?? 0;

      // Permitido: sin asignar (0/null) o pool (1) o ya asignado a mí
      if (currentCial && currentCial !== 1 && currentCial !== selfId) {
        return res.status(403).json({ ok: false, error: 'Cliente ya asignado a otro comercial' });
      }

      const result = await db.updateCliente(id, { Id_Cial: selfId });
      return res.json({ ok: true, result, claimed: true, Id_Cial: selfId });
    }

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

