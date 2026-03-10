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
  loadTiposClientesForSelect,
  loadEspecialidadesForSelect,
  loadEstadosClienteForSelect,
  applySpainDefaultsIfEmpty,
  buildClienteFormModel,
  coerceClienteValue
} = require('../lib/cliente-helpers');
const { normalizeTelefonoForDB } = require('../lib/telefono-utils');

function normalizePayloadTelefonos(payload) {
  const telCols = ['cli_telefono', 'cli_movil', 'Telefono', 'Movil', 'telefono', 'movil'];
  for (const col of telCols) {
    if (payload[col] != null && String(payload[col]).trim()) {
      const norm = normalizeTelefonoForDB(payload[col]);
      payload[col] = norm;
    }
  }
}

function normalizeRelacionRow(r) {
  if (!r || typeof r !== 'object') return r;
  const lower = {};
  for (const k of Object.keys(r)) lower[k.toLowerCase()] = r[k];
  return { ...r, ...lower };
}

let sendPushToAdmins = () => Promise.resolve();
try {
  const wp = require('../lib/web-push');
  if (wp && typeof wp.sendPushToAdmins === 'function') sendPushToAdmins = wp.sendPushToAdmins;
} catch (_) {}

const router = express.Router();

router.get('/duplicados', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const grupos = await db.getClientesDuplicados({});
    res.render('clientes-duplicados', { grupos: grupos || [], admin: true });
  } catch (e) {
    next(e);
  }
});

router.post('/unificar', requireLogin, requireAdmin, async (req, res, next) => {
  const wantsJson = req.get('Accept')?.includes('application/json') || req.get('X-Requested-With') === 'XMLHttpRequest';
  try {
    const raw = req.body.ids;
    const ids = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',').map((x) => parseInt(String(x).trim(), 10)).filter((n) => Number.isFinite(n) && n > 0) : []);
    if (ids.length < 2) {
      if (wantsJson) return res.status(400).json({ error: 'Se necesitan al menos 2 IDs para unificar.' });
      req.flash?.('error', 'Se necesitan al menos 2 IDs para unificar.');
      return res.redirect('/clientes/duplicados');
    }
    const { primaryId } = await db.mergeClientesDuplicados(ids);
    if (wantsJson) return res.json({ ok: true, redirect: `/clientes/${primaryId}` });
    req.flash?.('success', `Clientes unificados correctamente en el registro #${primaryId}.`);
    return res.redirect(`/clientes/${primaryId}`);
  } catch (e) {
    if (wantsJson) return res.status(400).json({ error: e.message || 'Error al unificar clientes.' });
    req.flash?.('error', e.message || 'Error al unificar clientes.');
    return res.redirect('/clientes/duplicados');
  }
});

router.get('/', requireLogin, async (req, res, next) => {
  try {
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 100 });
    const q = typeof _n(req.query.q, req.query.search) === 'string' ? String(_n(req.query.q, req.query.search)).trim() : '';
    const tipoContacto = typeof req.query.tipo === 'string' ? String(req.query.tipo).trim() : '';
    const order = String(req.query.order || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
    const admin = isAdminUser(res.locals.user);
    const baseFilters = admin ? {} : { comercial: res.locals.user?.id };
    // Pool (26) solo al buscar: listado normal = solo asignados; búsqueda = asignados + pendientes para poder asignarlos
    if (!admin && res.locals.user?.id && q) {
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
      db.getComercialesForSelect().catch(() => []),
      db.getTarifas().catch(() => []),
      loadSimpleCatalogForSelect(db, 'provincias'),
      loadSimpleCatalogForSelect(db, 'paises'),
      _n(db.getFormasPago && db.getFormasPago().catch(() => []), []),
      loadTiposClientesForSelect(db).then((r) => (Array.isArray(r) && r.length > 0 ? r : db.getTiposClientes?.().catch(() => []))),
      loadEspecialidadesForSelect(db).then((r) => (Array.isArray(r) && r.length > 0 ? r : db.getEspecialidades?.().catch(() => []))),
      loadSimpleCatalogForSelect(db, 'idiomas', { labelCandidates: ['Nombre', 'Idioma', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'monedas', { labelCandidates: ['Nombre', 'Moneda', 'Descripcion', 'descripcion', 'Codigo', 'codigo', 'ISO', 'Iso'] }),
      loadEstadosClienteForSelect(db).then((r) => (Array.isArray(r) && r.length > 0 ? r : db.getEstadosCliente?.().catch(() => []))).then((r) => (Array.isArray(r) && r.length > 0 ? r : [{ estcli_id: 1, estcli_nombre: 'Lead', id: 1, Nombre: 'Lead', nombre: 'Lead', Estado: 'Lead', estado: 'Lead' }, { estcli_id: 2, estcli_nombre: 'Activo', id: 2, Nombre: 'Activo', nombre: 'Activo', Estado: 'Activo', estado: 'Activo' }, { estcli_id: 3, estcli_nombre: 'Inactivo', id: 3, Nombre: 'Inactivo', nombre: 'Inactivo', Estado: 'Inactivo', estado: 'Inactivo' }])),
      _n(db.getCooperativas && db.getCooperativas().catch(() => []), []),
      _n(db.getGruposCompras && db.getGruposCompras().catch(() => []), []),
      db._ensureClientesMeta().catch(() => null)
    ]);
    const isAdmin = isAdminUser(res.locals.user);
    const baseItem = applySpainDefaultsIfEmpty(
      { OK_KO: 1, Tarifa: 0, Dto: 0 },
      { meta, paises, idiomas, monedas }
    );
    if (!isAdmin && res.locals.user?.id) {
      const comId = Number(res.locals.user.id);
      const colCom = meta?.colComercial || 'cli_com_id';
      baseItem[colCom] = baseItem.cli_com_id = baseItem.Id_Cial = comId;
    }
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
    res.render('cliente-form', { ...model, error: null, admin: isAdmin, canChangeComercial: !!isAdmin });
  } catch (e) {
    next(e);
  }
});

router.post('/new', requireLogin, async (req, res, next) => {
  try {
    const [comerciales, tarifas, provincias, paises, formasPago, tiposClientes, especialidades, idiomas, monedas, estadosCliente, cooperativas, gruposCompras, meta] = await Promise.all([
      db.getComercialesForSelect().catch(() => []),
      db.getTarifas().catch(() => []),
      loadSimpleCatalogForSelect(db, 'provincias'),
      loadSimpleCatalogForSelect(db, 'paises'),
      _n(db.getFormasPago && db.getFormasPago().catch(() => []), []),
      loadTiposClientesForSelect(db).then((r) => (Array.isArray(r) && r.length > 0 ? r : db.getTiposClientes?.().catch(() => []))),
      loadEspecialidadesForSelect(db).then((r) => (Array.isArray(r) && r.length > 0 ? r : db.getEspecialidades?.().catch(() => []))),
      loadSimpleCatalogForSelect(db, 'idiomas', { labelCandidates: ['Nombre', 'Idioma', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'monedas', { labelCandidates: ['Nombre', 'Moneda', 'Descripcion', 'descripcion', 'Codigo', 'codigo', 'ISO', 'Iso'] }),
      loadEstadosClienteForSelect(db).then((r) => (Array.isArray(r) && r.length > 0 ? r : db.getEstadosCliente?.().catch(() => []))).then((r) => (Array.isArray(r) && r.length > 0 ? r : [{ estcli_id: 1, estcli_nombre: 'Lead', id: 1, Nombre: 'Lead', nombre: 'Lead', Estado: 'Lead', estado: 'Lead' }, { estcli_id: 2, estcli_nombre: 'Activo', id: 2, Nombre: 'Activo', nombre: 'Activo', Estado: 'Activo', estado: 'Activo' }, { estcli_id: 3, estcli_nombre: 'Inactivo', id: 3, Nombre: 'Inactivo', nombre: 'Inactivo', Estado: 'Inactivo', estado: 'Inactivo' }])),
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
        dupOtherCount: Number(dup.otherCount || 0) || 0,
        admin: isAdmin,
        canChangeComercial: !!isAdmin
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
      return res.status(400).render('cliente-form', { ...model, error: 'Completa los campos obligatorios marcados.', admin: isAdmin, canChangeComercial: !!isAdmin });
    }

    await db.createCliente(payload);
    return res.redirect('/clientes');
  } catch (e) {
    next(e);
  }
});

router.get('/:id(\\d+)/direcciones/new', requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const admin = isAdminUser(res.locals.user);
    const canEdit = admin || (await db.canComercialEditCliente(id, res.locals.user?.id));
    if (!canEdit) return res.status(403).send('No tiene permiso para editar este contacto.');
    const [cliente, provincias, paises] = await Promise.all([
      db.getClienteById(id),
      loadSimpleCatalogForSelect(db, 'provincias'),
      loadSimpleCatalogForSelect(db, 'paises')
    ]);
    if (!cliente) return res.status(404).send('Cliente no encontrado');
    const clienteNombre = cliente.cli_nombre_razon_social ?? cliente.Nombre_Razon_Social ?? cliente.Nombre ?? cliente.nombre ?? '';
    res.render('direccion-envio-form', {
      clienteId: id,
      clienteNombre,
      item: {},
      provincias: provincias || [],
      paises: paises || [],
      error: null
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:id(\\d+)/direcciones/new', requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const admin = isAdminUser(res.locals.user);
    const canEdit = admin || (await db.canComercialEditCliente(id, res.locals.user?.id));
    if (!canEdit) return res.status(403).send('No tiene permiso para editar este contacto.');
    const cliente = await db.getClienteById(id);
    if (!cliente) return res.status(404).send('Cliente no encontrado');
    const body = req.body || {};
    const payload = {
      Id_Cliente: id,
      Alias: body.Alias ? String(body.Alias).trim() : null,
      Nombre_Destinatario: body.Nombre_Destinatario ? String(body.Nombre_Destinatario).trim() : null,
      Direccion: body.Direccion ? String(body.Direccion).trim() : null,
      Direccion2: body.Direccion2 ? String(body.Direccion2).trim() : null,
      Poblacion: body.Poblacion ? String(body.Poblacion).trim() : null,
      CodigoPostal: body.CodigoPostal ? String(body.CodigoPostal).trim() : null,
      Id_Provincia: body.Id_Provincia ? (Number(body.Id_Provincia) || null) : null,
      Id_Pais: body.Id_Pais ? (Number(body.Id_Pais) || null) : null,
      Pais: body.Pais ? String(body.Pais).trim() : null,
      Telefono: body.Telefono ? String(body.Telefono).trim() : null,
      Movil: body.Movil ? String(body.Movil).trim() : null,
      Email: body.Email ? String(body.Email).trim() : null,
      Observaciones: body.Observaciones ? String(body.Observaciones).trim() : null,
      Es_Principal: body.Es_Principal === '1' ? 1 : 0,
      Activa: 1
    };
    normalizePayloadTelefonos(payload);
    await db.createDireccionEnvio(payload);
    return res.redirect('/clientes/' + id + '/edit#tab_direccion');
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
      db.getComercialesForSelect().catch(() => []),
      db.getTarifas().catch(() => []),
      loadSimpleCatalogForSelect(db, 'provincias'),
      loadSimpleCatalogForSelect(db, 'paises'),
      _n(db.getFormasPago && db.getFormasPago().catch(() => []), []),
      loadTiposClientesForSelect(db).then((r) => (Array.isArray(r) && r.length > 0 ? r : db.getTiposClientes?.().catch(() => []))),
      loadEspecialidadesForSelect(db).then((r) => (Array.isArray(r) && r.length > 0 ? r : db.getEspecialidades?.().catch(() => []))),
      loadSimpleCatalogForSelect(db, 'idiomas', { labelCandidates: ['Nombre', 'Idioma', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'monedas', { labelCandidates: ['Nombre', 'Moneda', 'Descripcion', 'descripcion', 'Codigo', 'codigo', 'ISO', 'Iso'] }),
      loadEstadosClienteForSelect(db).then((r) => (Array.isArray(r) && r.length > 0 ? r : db.getEstadosCliente?.().catch(() => []))).then((r) => (Array.isArray(r) && r.length > 0 ? r : [{ estcli_id: 1, estcli_nombre: 'Lead', id: 1, Nombre: 'Lead', nombre: 'Lead', Estado: 'Lead', estado: 'Lead' }, { estcli_id: 2, estcli_nombre: 'Activo', id: 2, Nombre: 'Activo', nombre: 'Activo', Estado: 'Activo', estado: 'Activo' }, { estcli_id: 3, estcli_nombre: 'Inactivo', id: 3, Nombre: 'Inactivo', nombre: 'Inactivo', Estado: 'Inactivo', estado: 'Inactivo' }])),
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
    const relaciones = [
      ...(relacionesData.comoOrigen || []).map(normalizeRelacionRow),
      ...(relacionesData.comoRelacionado || []).map(normalizeRelacionRow)
    ];
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
      db.getComercialesForSelect().catch(() => []),
      db.getTarifas().catch(() => []),
      loadSimpleCatalogForSelect(db, 'provincias'),
      loadSimpleCatalogForSelect(db, 'paises'),
      _n(db.getFormasPago && db.getFormasPago().catch(() => []), []),
      loadTiposClientesForSelect(db).then((r) => (Array.isArray(r) && r.length > 0 ? r : db.getTiposClientes?.().catch(() => []))),
      loadEspecialidadesForSelect(db).then((r) => (Array.isArray(r) && r.length > 0 ? r : db.getEspecialidades?.().catch(() => []))),
      loadSimpleCatalogForSelect(db, 'idiomas', { labelCandidates: ['Nombre', 'Idioma', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'monedas', { labelCandidates: ['Nombre', 'Moneda', 'Descripcion', 'descripcion', 'Codigo', 'codigo', 'ISO', 'Iso'] }),
      loadEstadosClienteForSelect(db).then((r) => (Array.isArray(r) && r.length > 0 ? r : db.getEstadosCliente?.().catch(() => []))).then((r) => (Array.isArray(r) && r.length > 0 ? r : [{ estcli_id: 1, estcli_nombre: 'Lead', id: 1, Nombre: 'Lead', nombre: 'Lead', Estado: 'Lead', estado: 'Lead' }, { estcli_id: 2, estcli_nombre: 'Activo', id: 2, Nombre: 'Activo', nombre: 'Activo', Estado: 'Activo', estado: 'Activo' }, { estcli_id: 3, estcli_nombre: 'Inactivo', id: 3, Nombre: 'Inactivo', nombre: 'Inactivo', Estado: 'Inactivo', estado: 'Inactivo' }])),
      _n(db.getCooperativas && db.getCooperativas().catch(() => []), []),
      _n(db.getGruposCompras && db.getGruposCompras().catch(() => []), []),
      db._ensureClientesMeta().catch(() => null)
    ]);
    if (!item) return res.status(404).send('No encontrado');
    const puedeSolicitarAsignacion = !admin && res.locals.user?.id && (await db.isContactoAsignadoAPoolOSinAsignar(id));
    const relacionesData = await db.getRelacionesByCliente(id).catch(() => ({ comoOrigen: [], comoRelacionado: [] }));
    const relaciones = [
      ...(relacionesData.comoOrigen || []).map(normalizeRelacionRow),
      ...(relacionesData.comoRelacionado || []).map(normalizeRelacionRow)
    ];
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
      canChangeComercial: admin,
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
      loadTiposClientesForSelect(db).then((r) => (Array.isArray(r) && r.length > 0 ? r : db.getTiposClientes?.().catch(() => []))),
      loadEspecialidadesForSelect(db).then((r) => (Array.isArray(r) && r.length > 0 ? r : db.getEspecialidades?.().catch(() => []))),
      loadSimpleCatalogForSelect(db, 'idiomas', { labelCandidates: ['Nombre', 'Idioma', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'monedas', { labelCandidates: ['Nombre', 'Moneda', 'Descripcion', 'descripcion', 'Codigo', 'codigo', 'ISO', 'Iso'] }),
      loadEstadosClienteForSelect(db).then((r) => (Array.isArray(r) && r.length > 0 ? r : db.getEstadosCliente?.().catch(() => []))).then((r) => (Array.isArray(r) && r.length > 0 ? r : [{ estcli_id: 1, estcli_nombre: 'Lead', id: 1, Nombre: 'Lead', nombre: 'Lead', Estado: 'Lead', estado: 'Lead' }, { estcli_id: 2, estcli_nombre: 'Activo', id: 2, Nombre: 'Activo', nombre: 'Activo', Estado: 'Activo', estado: 'Activo' }, { estcli_id: 3, estcli_nombre: 'Inactivo', id: 3, Nombre: 'Inactivo', nombre: 'Inactivo', Estado: 'Inactivo', estado: 'Inactivo' }])),
      _n(db.getCooperativas && db.getCooperativas().catch(() => []), []),
      _n(db.getGruposCompras && db.getGruposCompras().catch(() => []), [])
    ]);
    if (!item) return res.status(404).send('No encontrado');
    const comerciales = await db.getComercialesForSelect().catch(() => []);
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
    if (admin && 'cli_com_id' in body) {
      payload.cli_com_id = coerceClienteValue('cli_com_id', body.cli_com_id);
    }
    if ('cli_prov_id' in body || 'Id_Provincia' in body) {
      payload.cli_prov_id = coerceClienteValue('cli_prov_id', body.cli_prov_id ?? body.Id_Provincia);
    }
    if ('cli_mon_id' in body || 'Id_Moneda' in body) {
      payload.cli_mon_id = coerceClienteValue('cli_mon_id', body.cli_mon_id ?? body.Id_Moneda);
    }
    if ('cli_idiom_id' in body || 'Id_Idioma' in body) {
      payload.cli_idiom_id = coerceClienteValue('cli_idiom_id', body.cli_idiom_id ?? body.Id_Idioma);
    }
    if ('cli_RE' in body || 'cli_re' in body) {
      payload.cli_RE = coerceClienteValue('cli_RE', body.cli_RE ?? body.cli_re);
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
      return res.status(400).render('cliente-form', { ...model, error: 'Completa los campos obligatorios marcados.', admin, canChangeComercial: admin, puedeSolicitarAsignacion: puedeSolicitar, clienteId: id, contactoId: id, agendaContactos: [], agendaIncludeHistorico: false });
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
