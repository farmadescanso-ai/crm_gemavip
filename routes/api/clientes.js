const express = require('express');
const db = require('../../config/mysql-crm');
const { asyncHandler, toBool, toInt } = require('./_utils');

const router = express.Router();

const { isAdminUser } = require('../../lib/auth');

/**
 * @openapi
 * /api/clientes:
 *   get:
 *     tags:
 *       - Clientes
 *     summary: Listar clientes (paginado por defecto)
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 500
 *           default: 50
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: "Texto de búsqueda (alias: search)"
 *     responses:
 *       200:
 *         description: OK
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminUser(sessionUser);

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
 *     tags:
 *       - Clientes
 *     summary: Autocomplete rápido de clientes (compacto)
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *     responses:
 *       200:
 *         description: OK
 */
router.get(
  '/suggest',
  asyncHandler(async (req, res) => {
    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminUser(sessionUser);
    const limit = Math.max(1, Math.min(50, toInt(req.query.limit, 20) ?? 20));
    const q = typeof req.query.q === 'string' ? String(req.query.q) : typeof req.query.search === 'string' ? String(req.query.search) : '';
    const qq = String(q || '').trim();
    if (!qq) return res.json({ ok: true, items: [] });
    // Búsqueda "inteligente" (evitar consultas caras con entradas muy cortas)
    // - dígitos (ID/CP): >= 1
    // - email: >= 2
    // - múltiples palabras: >= 2
    // - texto general: >= 3
    const isDigitsOnly = /^[0-9]+$/.test(qq);
    const looksLikeEmail = qq.includes('@');
    const hasSpaces = /\s/.test(qq);
    const force = String(req.query.force || '').trim() === '1';
    const minLenText = force ? 2 : 3;
    if (!isDigitsOnly && !looksLikeEmail && !hasSpaces && qq.length < minLenText) return res.json({ ok: true, items: [] });
    if ((looksLikeEmail || hasSpaces) && qq.length < 2) return res.json({ ok: true, items: [] });

    // Scope:
    // - por defecto, si hay sesión comercial, limitar a su cartera
    // - si scope=all y hay sesión, permitir buscar en todos (útil para asociar agenda a clientes)
    const scope = String(req.query.scope || '').trim().toLowerCase();
    const allowAll = !!sessionUser && scope === 'all';

    const filters = {
      q: qq,
      comercial: (sessionUser && !isAdmin && !allowAll) ? sessionUser.id : undefined
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
    res.json({ ok: true, items: Array.isArray(items) ? items : [] });
  })
);

router.get(
  '/duplicates',
  asyncHandler(async (req, res) => {
    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminUser(sessionUser);
    const limit = Math.max(1, Math.min(10, toInt(req.query.limit, 6) ?? 6));
    const dni = typeof req.query.dni === 'string' ? String(req.query.dni) : '';
    const nombre = typeof req.query.nombre === 'string' ? String(req.query.nombre) : '';
    const nombreCial = typeof req.query.nombreCial === 'string' ? String(req.query.nombreCial) : '';

    const result = await db.findPosiblesDuplicadosClientes(
      { dniCif: dni, nombre, nombreCial },
      { limit, userId: sessionUser?.id ?? null, isAdmin }
    );

    res.json({ ok: true, ...result });
  })
);

/**
 * @openapi
 * /api/clientes/{id}/cooperativas:
 *   get:
 *     tags:
 *       - Clientes
 *     summary: Cooperativas del cliente con número de asociado
 *     description: Útil para integraciones tipo Transfer Hefame, etc.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ID no válido
 *       404:
 *         description: No encontrado
 */
router.get(
  '/:id/cooperativas',
  asyncHandler(async (req, res) => {
    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminUser(sessionUser);
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });

    if (sessionUser && !isAdmin) {
      const c = await db.getClienteById(id);
      if (!c) return res.status(404).json({ ok: false, error: 'No encontrado' });
      const cial = toInt(c.cli_com_id ?? c.Id_Cial ?? c.id_cial ?? c.ComercialId ?? c.comercialId ?? c.Id_Comercial ?? c.id_comercial, 0) ?? 0;
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
    const isAdmin = isAdminUser(sessionUser);
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });

    // Seguridad: si no es admin, solo acceder a clientes asignados (o pool Id_Cial=1 / sin asignar).
    if (sessionUser && !isAdmin) {
      const c = await db.getClienteById(id);
      if (!c) return res.status(404).json({ ok: false, error: 'No encontrado' });
      const cial = toInt(c.cli_com_id ?? c.Id_Cial ?? c.id_cial ?? c.ComercialId ?? c.comercialId ?? c.Id_Comercial ?? c.id_comercial, 0) ?? 0;
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

/**
 * @openapi
 * /api/clientes/{id}/direcciones-envio:
 *   get:
 *     tags:
 *       - Clientes
 *     summary: Direcciones de envío del cliente
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: compact
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Si true, devuelve items compactos {id,label}
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ID no válido
 *       404:
 *         description: No encontrado
 */

// Crear 1 dirección de envío desde fiscal si no hay ninguna (best-effort).
router.post(
  '/:id/direcciones-envio/ensure-fiscal',
  asyncHandler(async (req, res) => {
    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminUser(sessionUser);
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });

    // Seguridad: si no es admin, solo acceder a clientes asignados (o pool Id_Cial=1 / sin asignar).
    if (sessionUser && !isAdmin) {
      const c = await db.getClienteById(id);
      if (!c) return res.status(404).json({ ok: false, error: 'No encontrado' });
      const cial = toInt(c.cli_com_id ?? c.Id_Cial ?? c.id_cial ?? c.ComercialId ?? c.comercialId ?? c.Id_Comercial ?? c.id_comercial, 0) ?? 0;
      const selfId = toInt(sessionUser.id, 0) ?? 0;
      if (cial && cial !== 1 && cial !== selfId) return res.status(404).json({ ok: false, error: 'No encontrado' });
    }

    const result = await db.ensureDireccionEnvioFiscal(id);
    return res.json({ ok: true, ...result });
  })
);

/**
 * @openapi
 * /api/clientes/{id}/direcciones-envio/ensure-fiscal:
 *   post:
 *     tags:
 *       - Clientes
 *     summary: Asegura una dirección de envío “fiscal” si no hay ninguna
 *     description: Best-effort. Si el cliente no tiene direcciones, crea una basada en datos fiscales.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ID no válido
 *       404:
 *         description: No encontrado
 */

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

/**
 * @openapi
 * /api/clientes/{id}:
 *   get:
 *     tags:
 *       - Clientes
 *     summary: Obtener cliente por ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ID no válido
 *       404:
 *         description: No encontrado
 */

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = await db.createCliente(req.body || {});
    res.status(201).json({ ok: true, result });
  })
);

/**
 * @openapi
 * /api/clientes:
 *   post:
 *     tags:
 *       - Clientes
 *     summary: Crear cliente
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Created
 */

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminUser(sessionUser);

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
        current.cli_com_id ?? current.Id_Cial ?? current.id_cial ?? current.ComercialId ?? current.comercialId ?? current.Id_Comercial ?? current.id_comercial ?? null;
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

/**
 * @openapi
 * /api/clientes/{id}:
 *   put:
 *     tags:
 *       - Clientes
 *     summary: Actualizar cliente
 *     description: |
 *       Si hay sesión y el usuario NO es admin, solo permite reclamar el cliente asignando `Id_Cial`
 *       a su propio usuario (si estaba libre o en pool).
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ID no válido
 *       403:
 *         description: Forbidden
 *       404:
 *         description: No encontrado
 */

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

/**
 * @openapi
 * /api/clientes/{id}/okko:
 *   patch:
 *     tags:
 *       - Clientes
 *     summary: Marcar cliente OK/KO
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [value]
 *             properties:
 *               value:
 *                 oneOf:
 *                   - type: integer
 *                   - type: boolean
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: Error de validación
 */

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

/**
 * @openapi
 * /api/clientes/{id}/papelera:
 *   post:
 *     tags:
 *       - Clientes
 *     summary: Mover cliente a papelera
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               eliminadoPor:
 *                 type: string
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ID no válido
 */

module.exports = router;

