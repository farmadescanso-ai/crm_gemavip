const express = require('express');
const db = require('../../config/mysql-crm');
const { asyncHandler, toBool, toInt, parsePagination } = require('./_utils');
const { isAdminUser } = require('../../lib/auth');

const router = express.Router();

function pickAgendaPayload(body) {
  const b = body && typeof body === 'object' ? body : {};
  const out = {};
  const take = (k, maxLen) => {
    if (b[k] === undefined) return;
    const v = b[k];
    if (v === null) {
      out[k] = null;
      return;
    }
    const s = String(v).trim();
    out[k] = maxLen ? s.slice(0, maxLen) : s;
  };
  take('Nombre', 120);
  take('Apellidos', 180);
  take('Cargo', 120);
  take('Especialidad', 120);
  // Nuevo modelo relacional (si existe en BD)
  if (b.Id_TipoCargoRol !== undefined) out.Id_TipoCargoRol = toInt(b.Id_TipoCargoRol, null);
  if (b.Id_Especialidad !== undefined) out.Id_Especialidad = toInt(b.Id_Especialidad, null);
  take('Empresa', 180);
  take('Email', 255);
  take('Movil', 20);
  take('Telefono', 20);
  take('Extension', 10);
  take('Notas', 2000);
  if (b.Activo !== undefined) out.Activo = toBool(b.Activo, true) ? 1 : 0;
  return out;
}

/**
 * @openapi
 * /api/agenda:
 *   get:
 *     tags:
 *       - Agenda
 *     summary: Listar contactos de agenda (paginado)
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 500, default: 50 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, default: 0 }
 *       - in: query
 *         name: includeInactivos
 *         schema: { type: boolean, default: false }
 *     responses:
 *       200:
 *         description: OK
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 500, useOffsetFromQuery: true });
    const q = typeof (req.query.q ?? req.query.search) === 'string' ? String(req.query.q ?? req.query.search) : '';
    const includeInactivos = toBool(req.query.includeInactivos, false);
    const items = await db.getContactos({ search: q, limit, offset, includeInactivos });
    // No tenemos COUNT optimizado aún; devolver paging parcial.
    res.json({ ok: true, items: items || [], paging: { limit, offset } });
  })
);

/**
 * @openapi
 * /api/agenda/suggest:
 *   get:
 *     tags:
 *       - Agenda
 *     summary: Autocomplete rápido de agenda
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200:
 *         description: OK
 */
router.get(
  '/suggest',
  asyncHandler(async (req, res) => {
    const { limit } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });
    const q = typeof req.query.q === 'string' ? String(req.query.q) : typeof req.query.search === 'string' ? String(req.query.search) : '';
    const qq = String(q || '').trim();
    if (!qq) return res.json({ ok: true, items: [] });
    if (qq.length < 2) return res.json({ ok: true, items: [] });
    const rows = await db.getContactos({ search: qq, limit, offset: 0, includeInactivos: false }).catch(() => []);
    const items = (rows || [])
      .map((r) => {
        const id = r?.Id ?? r?.id ?? null;
        if (!id) return null;
        const nombre = [r?.Nombre, r?.Apellidos].filter(Boolean).join(' ').trim();
        const empresa = String(r?.Empresa || '').trim();
        const extra = [empresa, r?.Email, r?.Movil].filter(Boolean).join(' · ');
        return { id, label: extra ? `${nombre}${nombre && extra ? ' · ' : ''}${extra}` : (nombre || `Contacto ${id}`) };
      })
      .filter(Boolean);
    res.json({ ok: true, items });
  })
);

router.get(
  '/roles',
  asyncHandler(async (_req, res) => {
    const items = await db.getAgendaRoles().catch(() => []);
    res.json({ ok: true, items: items || [] });
  })
);

router.get(
  '/especialidades',
  asyncHandler(async (_req, res) => {
    const items = await db.getAgendaEspecialidades().catch(() => []);
    res.json({ ok: true, items: items || [] });
  })
);

router.post(
  '/roles',
  asyncHandler(async (req, res) => {
    const user = req.session?.user || null;
    if (!user || !isAdminUser(user)) return res.status(403).json({ ok: false, error: 'Solo administrador' });
    const nombre = String(req.body?.Nombre ?? req.body?.nombre ?? '').trim();
    const result = await db.createAgendaRol(nombre);
    res.status(201).json({ ok: true, result });
  })
);

// Catálogo (uso UI): permite a usuarios con sesión añadir opciones "al vuelo"
router.post(
  '/catalog/roles',
  asyncHandler(async (req, res) => {
    const user = req.session?.user || null;
    if (!user) return res.status(403).json({ ok: false, error: 'Requiere sesión' });
    const nombre = String(req.body?.Nombre ?? req.body?.nombre ?? '').trim();
    const result = await db.createAgendaRol(nombre);
    res.status(201).json({ ok: true, result });
  })
);

router.post(
  '/catalog/especialidades',
  asyncHandler(async (req, res) => {
    const user = req.session?.user || null;
    if (!user) return res.status(403).json({ ok: false, error: 'Requiere sesión' });
    const nombre = String(req.body?.Nombre ?? req.body?.nombre ?? '').trim();
    const result = await db.createAgendaEspecialidad(nombre);
    res.status(201).json({ ok: true, result });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const item = await db.getContactoById(id);
    if (!item) return res.status(404).json({ ok: false, error: 'No encontrado' });
    res.json({ ok: true, item });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const payload = pickAgendaPayload(req.body);
    const result = await db.createContacto(payload);
    res.status(201).json({ ok: true, result });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const payload = pickAgendaPayload(req.body);
    const result = await db.updateContacto(id, payload);
    res.json({ ok: true, result });
  })
);

router.get(
  '/:id/clientes',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const includeHistorico = toBool(req.query.includeHistorico, false);
    const items = await db.getClientesByContacto(id, { includeHistorico });
    res.json({ ok: true, items: items || [] });
  })
);

router.post(
  '/:id/clientes/:clienteId',
  asyncHandler(async (req, res) => {
    const contactoId = toInt(req.params.id, 0);
    const clienteId = toInt(req.params.clienteId, 0);
    if (!contactoId || !clienteId) return res.status(400).json({ ok: false, error: 'ID no válido' });

    // Seguridad: si hay sesión y no es admin, solo permitir si el comercial puede editar/ver el cliente.
    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminUser(sessionUser);
    if (sessionUser && !isAdmin) {
      const can = await db.canComercialEditCliente(clienteId, sessionUser.id).catch(() => false);
      if (!can) return res.status(404).json({ ok: false, error: 'No encontrado' });
    }

    let rol = (req.body?.Rol ?? req.body?.rol ?? null) ? String(req.body?.Rol ?? req.body?.rol).trim().slice(0, 120) : null;
    const notas = (req.body?.Notas ?? req.body?.notas ?? null) ? String(req.body?.Notas ?? req.body?.notas).trim().slice(0, 500) : null;
    const esPrincipal = toBool(req.body?.Es_Principal ?? req.body?.es_principal ?? req.body?.esPrincipal, false);
    if (rol) {
      const r = await db.createAgendaRol(rol).catch(() => null);
      if (r?.nombre) rol = r.nombre;
    } else {
      // Si no se indica rol en el vínculo, usar Cargo del contacto como valor por defecto.
      const contacto = await db.getContactoById(contactoId).catch(() => null);
      rol = contacto?.Cargo ? String(contacto.Cargo).trim().slice(0, 120) : null;
    }
    const result = await db.vincularContactoACliente(clienteId, contactoId, { Rol: rol, Notas: notas, Es_Principal: esPrincipal });
    res.status(201).json({ ok: true, result });
  })
);

router.delete(
  '/:id/clientes/:clienteId',
  asyncHandler(async (req, res) => {
    const contactoId = toInt(req.params.id, 0);
    const clienteId = toInt(req.params.clienteId, 0);
    if (!contactoId || !clienteId) return res.status(400).json({ ok: false, error: 'ID no válido' });

    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminUser(sessionUser);
    if (sessionUser && !isAdmin) {
      const can = await db.canComercialEditCliente(clienteId, sessionUser.id).catch(() => false);
      if (!can) return res.status(404).json({ ok: false, error: 'No encontrado' });
    }

    const motivo = (req.body?.MotivoBaja ?? req.body?.motivo ?? null) ? String(req.body?.MotivoBaja ?? req.body?.motivo).trim().slice(0, 200) : null;
    const result = await db.cerrarVinculoContactoCliente(clienteId, contactoId, { MotivoBaja: motivo });
    res.json({ ok: true, result });
  })
);

module.exports = router;

