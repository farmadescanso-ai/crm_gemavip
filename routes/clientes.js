/**
 * Rutas HTML de clientes (CRUD).
 */

const express = require('express');
const db = require('../config/mysql-crm');
const { requireAdmin, _n } = require('../lib/app-helpers');
const { requireLogin, isAdminUser } = require('../lib/auth');
const { parsePagination } = require('../lib/pagination');
const {
  loadSimpleCatalogForSelect,
  loadEstadosClienteForSelect,
  applySpainDefaultsIfEmpty,
  buildClienteFormModel,
  coerceClienteValue
} = require('../lib/cliente-helpers');
const { normalizeTelefonoForDB } = require('../lib/telefono-utils');

/** Obtiene catálogo con fallback si el método principal devuelve vacío (p.ej. timeout en serverless). */
async function getCatalogWithFallback(db, methodName, fallbackFn) {
  const data = await (db[methodName] ? db[methodName]() : Promise.resolve([])).catch(() => []);
  if (Array.isArray(data) && data.length > 0) return data;
  return fallbackFn();
}

function normalizePayloadTelefonos(payload) {
  const telCols = ['cli_telefono', 'cli_movil', 'Telefono', 'Movil', 'telefono', 'movil'];
  for (const col of telCols) {
    if (payload[col] != null && String(payload[col]).trim()) {
      const norm = normalizeTelefonoForDB(payload[col]);
      payload[col] = norm;
    }
  }
}

let sendPushToAdmins = () => Promise.resolve();
try {
  const wp = require('../lib/web-push');
  if (wp && typeof wp.sendPushToAdmins === 'function') sendPushToAdmins = wp.sendPushToAdmins;
} catch (_) {}

const router = express.Router();

router.get('/', requireLogin, async (req, res, next) => {
  try {
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 100 });
    const q = typeof _n(req.query.q, req.query.search) === 'string' ? String(_n(req.query.q, req.query.search)).trim() : '';
    const tipoContacto = typeof req.query.tipo === 'string' ? String(req.query.tipo).trim() : '';
    const order = String(req.query.order || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
    const admin = isAdminUser(res.locals.user);
    const baseFilters = admin ? {} : { comercial: res.locals.user?.id };
    if (!admin && res.locals.user?.id) {
      const poolId = await db.getComercialIdPool();
      if (poolId) baseFilters.comercialPoolId = poolId;
    }
    const filters = { ...baseFilters };
    if (q) filters.q = q;
    if (tipoContacto && ['Empresa', 'Persona', 'Otros'].includes(tipoContacto)) filters.tipoContacto = tipoContacto;
    const [items, total, comerciales] = await Promise.all([
      db.getClientesOptimizadoPaged(filters, { limit, offset, sortBy: 'nombre', order }),
      db.countClientesOptimizado(filters),
      db.getComerciales().catch(() => [])
    ]);
    const poolId = admin ? null : await db.getComercialIdPool();
    const totalPages = Math.max(1, Math.ceil((total || 0) / limit));
    const pageClamped = Math.min(page, totalPages);
    if (page > totalPages && totalPages > 0) {
      const redirectQs = new URLSearchParams({ page: String(totalPages), limit: String(limit), order });
      if (q) redirectQs.set('q', q);
      if (tipoContacto) redirectQs.set('tipo', tipoContacto);
      return res.redirect('/clientes?' + redirectQs.toString());
    }
    res.render('clientes', { items: items || [], comerciales: comerciales || [], q, admin, tipoContacto: tipoContacto || undefined, orderNombre: order, paging: { page: pageClamped, limit, total: total || 0, totalPages }, poolId: poolId || null });
  } catch (e) {
    next(e);
  }
});

router.get('/new', requireLogin, async (_req, res, next) => {
  try {
    const [comerciales, tarifas, provincias, paises, formasPago, tiposClientes, especialidades, idiomas, monedas, estadosCliente, cooperativas, gruposCompras, meta] = await Promise.all([
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      loadSimpleCatalogForSelect(db, 'provincias'),
      loadSimpleCatalogForSelect(db, 'paises'),
      _n(db.getFormasPago && db.getFormasPago().catch(() => []), []),
      getCatalogWithFallback(db, 'getTiposClientes', () => loadSimpleCatalogForSelect(db, 'tipos_clientes', { labelCandidates: ['tipc_tipo', 'tipc_nombre', 'Tipo', 'Nombre'] })),
      getCatalogWithFallback(db, 'getEspecialidades', () => loadSimpleCatalogForSelect(db, 'especialidades', { labelCandidates: ['esp_nombre', 'Nombre', 'nombre', 'Especialidad'] })),
      loadSimpleCatalogForSelect(db, 'idiomas', { labelCandidates: ['Nombre', 'Idioma', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'monedas', { labelCandidates: ['Nombre', 'Moneda', 'Descripcion', 'descripcion', 'Codigo', 'codigo', 'ISO', 'Iso'] }),
      getCatalogWithFallback(db, 'getEstadosCliente', () => loadEstadosClienteForSelect(db)),
      _n(db.getCooperativas && db.getCooperativas().catch(() => []), []),
      _n(db.getGruposCompras && db.getGruposCompras().catch(() => []), []),
      db._ensureClientesMeta().catch(() => null)
    ]);
    const isAdmin = isAdminUser(res.locals.user);
    const baseItem = applySpainDefaultsIfEmpty(
      { OK_KO: 1, Tarifa: 0, Dto: 0 },
      { meta, paises, idiomas, monedas }
    );
    const model = buildClienteFormModel({
      mode: 'create',
      meta,
      item: baseItem,
      comerciales: Array.isArray(comerciales) ? comerciales : [],
      tarifas: Array.isArray(tarifas) ? tarifas : [],
      provincias: Array.isArray(provincias) ? provincias : [],
      paises: Array.isArray(paises) ? paises : [],
      formasPago: Array.isArray(formasPago) ? formasPago : [],
      tiposClientes: Array.isArray(tiposClientes) ? tiposClientes : [],
      especialidades: Array.isArray(especialidades) ? especialidades : [],
      idiomas: Array.isArray(idiomas) ? idiomas : [],
      monedas: Array.isArray(monedas) ? monedas : [],
      estadosCliente: Array.isArray(estadosCliente) ? estadosCliente : [],
      cooperativas: Array.isArray(cooperativas) ? cooperativas : [],
      gruposCompras: Array.isArray(gruposCompras) ? gruposCompras : [],
      canChangeComercial: !!isAdmin
    });
    res.render('cliente-form', { ...model, error: null });
  } catch (e) {
    next(e);
  }
});

router.post('/new', requireLogin, async (req, res, next) => {
  try {
    const [comerciales, tarifas, provincias, paises, formasPago, tiposClientes, especialidades, idiomas, monedas, estadosCliente, cooperativas, gruposCompras, meta] = await Promise.all([
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      loadSimpleCatalogForSelect(db, 'provincias'),
      loadSimpleCatalogForSelect(db, 'paises'),
      _n(db.getFormasPago && db.getFormasPago().catch(() => []), []),
      getCatalogWithFallback(db, 'getTiposClientes', () => loadSimpleCatalogForSelect(db, 'tipos_clientes', { labelCandidates: ['tipc_tipo', 'tipc_nombre', 'Tipo', 'Nombre'] })),
      getCatalogWithFallback(db, 'getEspecialidades', () => loadSimpleCatalogForSelect(db, 'especialidades', { labelCandidates: ['esp_nombre', 'Nombre', 'nombre', 'Especialidad'] })),
      loadSimpleCatalogForSelect(db, 'idiomas', { labelCandidates: ['Nombre', 'Idioma', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'monedas', { labelCandidates: ['Nombre', 'Moneda', 'Descripcion', 'descripcion', 'Codigo', 'codigo', 'ISO', 'Iso'] }),
      getCatalogWithFallback(db, 'getEstadosCliente', () => loadEstadosClienteForSelect(db)),
      _n(db.getCooperativas && db.getCooperativas().catch(() => []), []),
      _n(db.getGruposCompras && db.getGruposCompras().catch(() => []), []),
      db._ensureClientesMeta().catch(() => null)
    ]);
    const isAdmin = isAdminUser(res.locals.user);
    const body = req.body || {};
    const dupConfirmed = String(body.dup_confirmed || '').trim() === '1';
    const cols = Array.isArray(meta?.cols) ? meta.cols : [];
    const pk = meta?.pk || 'Id';
    const colsLower = new Map(cols.map((c) => [String(c).toLowerCase(), c]));
    const payload = {};
    for (const [k, v] of Object.entries(body)) {
      const real = colsLower.get(String(k).toLowerCase());
      if (!real) continue;
      if (String(real).toLowerCase() === String(pk).toLowerCase()) continue;
      if (!isAdmin && meta?.colComercial && String(real).toLowerCase() === String(meta.colComercial).toLowerCase()) continue;
      payload[real] = coerceClienteValue(real, v);
    }

    // Mapear alias del formulario (Nombre_Razon_Social) a columna real (cli_nombre_razon_social)
    const colNombre = meta?.colNombreRazonSocial || 'cli_nombre_razon_social';
    const aliasVal = body.Nombre_Razon_Social ?? body.nombre_razon_social;
    if (colNombre && (aliasVal !== undefined && aliasVal !== null) && (payload[colNombre] === undefined || payload[colNombre] === null || String(payload[colNombre] || '').trim() === '')) {
      payload[colNombre] = coerceClienteValue(colNombre, aliasVal);
    }

    if (meta?.colComercial && res.locals.user?.id) {
      const comVal = payload[meta.colComercial];
      if (!isAdmin || comVal === undefined || comVal === null || String(comVal || '').trim() === '') {
        payload[meta.colComercial] = Number(res.locals.user.id);
      }
    }

    if (payload.OK_KO === null || payload.OK_KO === undefined) payload.OK_KO = 1;
    if (payload.Tarifa === null || payload.Tarifa === undefined) payload.Tarifa = 0;
    applySpainDefaultsIfEmpty(payload, { meta, paises, idiomas, monedas });
    normalizePayloadTelefonos(payload);

    const dup = await db.findPosiblesDuplicadosClientes(
      {
        dniCif: payload.DNI_CIF ?? payload.cli_dni_cif,
        nombre: payload[colNombre] ?? payload.Nombre_Razon_Social ?? payload.cli_nombre_razon_social,
        nombreCial: payload.Nombre_Cial ?? payload.cli_nombre_cial
      },
      { limit: 6, userId: _n(res.locals.user && res.locals.user.id, null), isAdmin }
    );
    const hasDup = (dup && Array.isArray(dup.matches) && dup.matches.length > 0) || (dup && Number(dup.otherCount || 0) > 0);
    if (hasDup && !dupConfirmed) {
      const model = buildClienteFormModel({
        mode: 'create',
        meta,
        item: payload,
        comerciales,
        tarifas,
        provincias,
        paises,
        formasPago,
        tiposClientes,
        idiomas,
        monedas,
        estadosCliente,
        cooperativas,
        gruposCompras,
        canChangeComercial: !!isAdmin,
        missingFields: []
      });
      return res.status(409).render('cliente-form', {
        ...model,
        error: 'Este contacto puede estar ya dado de alta. Revisa coincidencias y confirma si quieres continuar.',
        dupMatches: dup.matches || [],
        dupOtherCount: Number(dup.otherCount || 0) || 0
      });
    }

    const missingFieldsNew = [];
    const nombreVal = payload[colNombre] ?? payload.Nombre_Razon_Social ?? payload.cli_nombre_razon_social;
    if (!nombreVal || !String(nombreVal || '').trim()) {
      missingFieldsNew.push(colNombre);
      if (colNombre !== 'Nombre_Razon_Social') missingFieldsNew.push('Nombre_Razon_Social');
    }
    if (missingFieldsNew.length > 0) {
      const model = buildClienteFormModel({
        mode: 'create',
        meta,
        item: payload,
        comerciales,
        tarifas,
        provincias,
        paises,
        formasPago,
        tiposClientes,
        idiomas,
        monedas,
        estadosCliente,
        cooperativas,
        gruposCompras,
        canChangeComercial: !!isAdmin,
        missingFields: missingFieldsNew
      });
      return res.status(400).render('cliente-form', { ...model, error: 'Completa los campos obligatorios marcados.' });
    }

    await db.createCliente(payload);
    return res.redirect('/clientes');
  } catch (e) {
    next(e);
  }
});

router.get('/:id', requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const admin = isAdminUser(res.locals.user);
    const canEdit = admin || (await db.canComercialEditCliente(id, res.locals.user?.id));
    if (!admin && !canEdit) return res.status(403).send('No tiene permiso para ver este contacto.');
    const [item, comerciales, tarifas, provincias, paises, formasPago, tiposClientes, especialidades, idiomas, monedas, estadosCliente, cooperativas, gruposCompras, meta] = await Promise.all([
      db.getClienteById(id),
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      loadSimpleCatalogForSelect(db, 'provincias'),
      loadSimpleCatalogForSelect(db, 'paises'),
      _n(db.getFormasPago && db.getFormasPago().catch(() => []), []),
      getCatalogWithFallback(db, 'getTiposClientes', () => loadSimpleCatalogForSelect(db, 'tipos_clientes', { labelCandidates: ['tipc_tipo', 'tipc_nombre', 'Tipo', 'Nombre'] })),
      getCatalogWithFallback(db, 'getEspecialidades', () => loadSimpleCatalogForSelect(db, 'especialidades', { labelCandidates: ['esp_nombre', 'Nombre', 'nombre', 'Especialidad'] })),
      loadSimpleCatalogForSelect(db, 'idiomas', { labelCandidates: ['Nombre', 'Idioma', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'monedas', { labelCandidates: ['Nombre', 'Moneda', 'Descripcion', 'descripcion', 'Codigo', 'codigo', 'ISO', 'Iso'] }),
      getCatalogWithFallback(db, 'getEstadosCliente', () => loadEstadosClienteForSelect(db)),
      _n(db.getCooperativas && db.getCooperativas().catch(() => []), []),
      _n(db.getGruposCompras && db.getGruposCompras().catch(() => []), []),
      db._ensureClientesMeta().catch(() => null)
    ]);
    if (!item) return res.status(404).send('No encontrado');
    const puedeSolicitarAsignacion = !admin && res.locals.user?.id && (await db.isContactoAsignadoAPoolOSinAsignar(id));
    const poolId = await db.getComercialIdPool();
    const solicitud = req.query.solicitud === 'ok' ? 'ok' : undefined;
    const [tieneRelaciones, relacionesData] = await Promise.all([
      db.tieneRelaciones(id).catch(() => false),
      db.getRelacionesByCliente(id).catch(() => ({ comoOrigen: [], comoRelacionado: [] }))
    ]);
    const relaciones = [...(relacionesData.comoOrigen || []), ...(relacionesData.comoRelacionado || [])];
    const model = buildClienteFormModel({
      mode: 'view',
      meta,
      item,
      comerciales,
      tarifas,
      provincias,
      paises,
      formasPago,
      tiposClientes,
      especialidades: especialidades || [],
      idiomas,
      monedas,
      estadosCliente,
      cooperativas,
      gruposCompras,
      canChangeComercial: false
    });
    res.render('cliente-view', {
      ...model,
      admin,
      canEdit,
      puedeSolicitarAsignacion,
      poolId,
      solicitud,
      contactoId: id,
      agendaContactos: [],
      agendaRoles: [],
      agendaIncludeHistorico: false,
      agendaOk: false,
      agendaError: false,
      tieneRelaciones: !!tieneRelaciones,
      relaciones: relaciones || []
    });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/edit', requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const admin = isAdminUser(res.locals.user);
    if (!admin && !(await db.canComercialEditCliente(id, res.locals.user?.id))) return res.status(403).send('No tiene permiso para editar este contacto.');
    const [item, comerciales, tarifas, provincias, paises, formasPago, tiposClientes, especialidades, idiomas, monedas, estadosCliente, cooperativas, gruposCompras, meta] = await Promise.all([
      db.getClienteById(id),
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      loadSimpleCatalogForSelect(db, 'provincias'),
      loadSimpleCatalogForSelect(db, 'paises'),
      _n(db.getFormasPago && db.getFormasPago().catch(() => []), []),
      getCatalogWithFallback(db, 'getTiposClientes', () => loadSimpleCatalogForSelect(db, 'tipos_clientes', { labelCandidates: ['tipc_tipo', 'tipc_nombre', 'Tipo', 'Nombre'] })),
      getCatalogWithFallback(db, 'getEspecialidades', () => loadSimpleCatalogForSelect(db, 'especialidades', { labelCandidates: ['esp_nombre', 'Nombre', 'nombre', 'Especialidad'] })),
      loadSimpleCatalogForSelect(db, 'idiomas', { labelCandidates: ['Nombre', 'Idioma', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'monedas', { labelCandidates: ['Nombre', 'Moneda', 'Descripcion', 'descripcion', 'Codigo', 'codigo', 'ISO', 'Iso'] }),
      getCatalogWithFallback(db, 'getEstadosCliente', () => loadEstadosClienteForSelect(db)),
      _n(db.getCooperativas && db.getCooperativas().catch(() => []), []),
      _n(db.getGruposCompras && db.getGruposCompras().catch(() => []), []),
      db._ensureClientesMeta().catch(() => null)
    ]);
    if (!item) return res.status(404).send('No encontrado');
    const puedeSolicitarAsignacion = !admin && res.locals.user?.id && (await db.isContactoAsignadoAPoolOSinAsignar(id));
    const relacionesData = await db.getRelacionesByCliente(id).catch(() => ({ comoOrigen: [], comoRelacionado: [] }));
    const relaciones = [...(relacionesData.comoOrigen || []), ...(relacionesData.comoRelacionado || [])];
    const model = buildClienteFormModel({
      mode: 'edit',
      meta,
      item,
      comerciales,
      tarifas,
      provincias,
      paises,
      formasPago,
      tiposClientes,
      especialidades: especialidades || [],
      idiomas,
      monedas,
      estadosCliente,
      cooperativas,
      gruposCompras,
      canChangeComercial: admin
    });
    res.render('cliente-form', {
      ...model,
      error: null,
      admin,
      puedeSolicitarAsignacion,
      clienteId: id,
      contactoId: id,
      agendaContactos: [],
      agendaIncludeHistorico: false,
      relaciones: relaciones || []
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/edit', requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const admin = isAdminUser(res.locals.user);
    if (!admin && !(await db.canComercialEditCliente(id, res.locals.user?.id))) return res.status(403).send('No tiene permiso para editar este contacto.');
    const [item, meta, provincias, paises, formasPago, tiposClientes, especialidades, idiomas, monedas, estadosCliente, cooperativas, gruposCompras] = await Promise.all([
      db.getClienteById(id),
      db._ensureClientesMeta().catch(() => null),
      loadSimpleCatalogForSelect(db, 'provincias'),
      loadSimpleCatalogForSelect(db, 'paises'),
      _n(db.getFormasPago && db.getFormasPago().catch(() => []), []),
      getCatalogWithFallback(db, 'getTiposClientes', () => loadSimpleCatalogForSelect(db, 'tipos_clientes', { labelCandidates: ['tipc_tipo', 'tipc_nombre', 'Tipo', 'Nombre'] })),
      getCatalogWithFallback(db, 'getEspecialidades', () => loadSimpleCatalogForSelect(db, 'especialidades', { labelCandidates: ['esp_nombre', 'Nombre', 'nombre', 'Especialidad'] })),
      loadSimpleCatalogForSelect(db, 'idiomas', { labelCandidates: ['Nombre', 'Idioma', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'monedas', { labelCandidates: ['Nombre', 'Moneda', 'Descripcion', 'descripcion', 'Codigo', 'codigo', 'ISO', 'Iso'] }),
      getCatalogWithFallback(db, 'getEstadosCliente', () => loadEstadosClienteForSelect(db)),
      _n(db.getCooperativas && db.getCooperativas().catch(() => []), []),
      _n(db.getGruposCompras && db.getGruposCompras().catch(() => []), [])
    ]);
    if (!item) return res.status(404).send('No encontrado');
    const comerciales = await db.getComerciales().catch(() => []);
    const tarifas = await db.getTarifas().catch(() => []);
    const body = req.body || {};
    const canChangeComercial = admin;

    const cols = Array.isArray(meta?.cols) ? meta.cols : [];
    const pk = meta?.pk || 'Id';
    const colsLower = new Map(cols.map((c) => [String(c).toLowerCase(), c]));
    const payload = {};
    for (const [k, v] of Object.entries(body)) {
      const real = colsLower.get(String(k).toLowerCase());
      if (!real) continue;
      if (String(real).toLowerCase() === String(pk).toLowerCase()) continue;
      if (!canChangeComercial && meta?.colComercial && String(real).toLowerCase() === String(meta.colComercial).toLowerCase()) continue;
      payload[real] = coerceClienteValue(real, v);
    }

    normalizePayloadTelefonos(payload);

    const missingFields = [];
    if (payload.Nombre_Razon_Social !== undefined && !String(payload.Nombre_Razon_Social || '').trim()) missingFields.push('Nombre_Razon_Social');
    if (missingFields.length > 0) {
      const puedeSolicitar = !admin && res.locals.user?.id && (await db.isContactoAsignadoAPoolOSinAsignar(id));
      const model = buildClienteFormModel({
        mode: 'edit',
        meta,
        item: { ...item, ...payload },
        comerciales,
        tarifas,
        provincias,
        paises,
        formasPago,
        tiposClientes,
        especialidades: especialidades || [],
        idiomas,
        monedas,
        estadosCliente,
        cooperativas,
        gruposCompras,
        canChangeComercial: !!admin,
        missingFields
      });
      return res.status(400).render('cliente-form', { ...model, error: 'Completa los campos obligatorios marcados.', admin, puedeSolicitarAsignacion: puedeSolicitar, clienteId: id, contactoId: id, agendaContactos: [], agendaIncludeHistorico: false });
    }

    await db.updateCliente(id, payload);
    return res.redirect(`/clientes/${id}`);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/solicitar-asignacion', requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const userId = Number(res.locals.user?.id);
    if (!userId || isAdminUser(res.locals.user)) return res.status(403).send('Solo un comercial puede solicitar que se le asigne un contacto.');
    const item = await db.getClienteById(id);
    if (!item) return res.status(404).send('No encontrado');
    if (!(await db.isContactoAsignadoAPoolOSinAsignar(id))) return res.status(400).send('Este contacto ya está asignado a otro comercial.');
    await db.createSolicitudAsignacion(id, userId);
    const clienteNombre = item?.Nombre_Razon_Social ?? item?.Nombre ?? ('Cliente ' + id);
    sendPushToAdmins({ title: 'Nueva solicitud de asignación', body: `${res.locals.user?.nombre || 'Comercial'} solicita: ${clienteNombre}`, url: '/notificaciones' }).catch(() => {});
    return res.redirect(`/clientes/${id}?solicitud=ok`);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    await db.moverClienteAPapelera(id, res.locals.user?.email || res.locals.user?.id || 'admin');
    return res.redirect('/clientes');
  } catch (e) {
    next(e);
  }
});

module.exports = router;
