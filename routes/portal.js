/**
 * Área privada /portal — dashboard, pedidos, documentos, comentarios (evolución hacia datos solo CRM).
 */
'use strict';

const express = require('express');
const crypto = require('crypto');
const { requirePortalLogin } = require('../lib/portal-auth');
const { getPortalSessionContext, clientePermitePortal, loadPortalCliente } = require('../lib/portal-auth');
const { DOC_TYPES, listDocumentsForContact, fetchDocumentPdf } = require('../lib/portal-holded-documents');
const { getHoldedApiKeyOptional } = require('../lib/holded-api');
const { getStripePortalStatus } = require('../lib/portal-pagos-stripe');
const { _n } = require('../lib/app-helpers');
const { loadSimpleCatalogForSelect } = require('../lib/cliente-helpers');
const { rejectIfValidationFailsHtml } = require('../lib/validation-handlers');
const { pedidoCreateValidators } = require('../lib/validators/html-pedidos-ui');
const { parseLineasFromBody, isTransferPedido, resolveMayoristaInfo } = require('../lib/pedido-helpers');
const { filterOutTransferOptions } = require('../lib/pedido-form-shared');
const {
  buildPortalPedidoCreatePayload,
  aplicarDtoLineasPortal,
  getClienteTarifaIdNum,
  tarifaNombreById,
  findTransferTipoId,
  portalPedidoEstaPendiente
} = require('../lib/portal-pedido-policy');
const { warn } = require('../lib/logger');
const db = require('../config/mysql-crm');

let sendPushToAdmins = () => Promise.resolve();
try {
  const wp = require('../lib/web-push');
  if (wp && typeof wp.sendPushToAdmins === 'function') sendPushToAdmins = wp.sendPushToAdmins;
} catch (e) {
  warn('[portal-pedidos] web-push load:', e?.message);
}

const router = express.Router();

router.use((req, res, next) => {
  res.locals.portalUser = req.session?.portalUser || null;
  res.locals.headerVariant = 'portal';
  res.locals.portalUserEmail = req.session?.portalUser?.email || '';
  next();
});

router.use(requirePortalLogin);

/** Contexto portal (cliente + flags) una vez por petición — las rutas usan `req.portalCtx`. */
router.use(async (req, res, next) => {
  const cliId = req.session.portalUser.cli_id;
  try {
    const ctx = await getPortalSessionContext(cliId);
    req.portalCtx = ctx;
    res.locals.portalCtx = ctx;
    return next();
  } catch (e) {
    return next(e);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = req.portalCtx;
    if (!clientePermitePortal(ctx.cliente)) {
      delete req.session.portalUser;
      return res.redirect('/login-cliente');
    }

    const pedidos = ctx.flags.ver_pedidos
      ? await db.getPedidosPaged({ clienteId: cliId }, { limit: 10, offset: 0 }).catch(() => [])
      : [];
    const nPed = ctx.flags.ver_pedidos ? await db.countPedidos({ clienteId: cliId }).catch(() => 0) : 0;

    const hid = String(ctx.cliente?.cli_Id_Holded || '').trim();
    const apiKey = getHoldedApiKeyOptional();
    let nInv = 0;
    let nEst = 0;
    let nAlb = 0;
    if (hid && apiKey && ctx.flags.ver_facturas) {
      const inv = await listDocumentsForContact(DOC_TYPES.facturas, hid, apiKey);
      nInv = inv.length;
    }
    if (hid && apiKey && ctx.flags.ver_presupuestos) {
      const est = await listDocumentsForContact(DOC_TYPES.presupuestos, hid, apiKey);
      nEst = est.length;
    }
    if (hid && apiKey && ctx.flags.ver_albaranes) {
      const alb = await listDocumentsForContact(DOC_TYPES.albaranes, hid, apiKey);
      nAlb = alb.length;
    }

    res.render('portal/dashboard', {
      title: 'Tu cuenta · portal',
      ctx,
      stats: { nPedidos: nPed, nFacturas: nInv, nPresupuestos: nEst, nAlbaranes: nAlb },
      pedidosRecientes: pedidos,
      sinHolded: !hid,
      stripe: getStripePortalStatus()
    });
  } catch (e) {
    next(e);
  }
});

async function assertPedidoCliente(pedId, cliId) {
  const p = await db.getPedidoById(pedId);
  if (!p) return null;
  const cid = Number(p.ped_cli_id ?? p.Id_Cliente ?? p.cliente_id ?? 0);
  if (cid !== Number(cliId)) return null;
  return p;
}

/** Locales para `pedido-form` en modo portal: condiciones fijadas en CRM (tarifa y forma de pago del contacto). */
async function getPortalPedidoNuevoLocals(req, { item: itemOverride, lineas: lineasOverride, error } = {}) {
  const cliId = req.session.portalUser.cli_id;
  const clienteRow = req.portalCtx?.cliente || (await db.getClienteById(cliId).catch(() => null));
  const [tarifasIn, formasPagoIn, tiposPedidoIn, descuentosPedido, estadosPedido, estadoPendienteId, provincias, paises] = await Promise.all([
    db.getTarifas().catch(() => []),
    db.getFormasPago().catch(() => []),
    db.getTiposPedido().catch(() => []),
    db.getDescuentosPedidoActivos().catch(() => []),
    db.getEstadosPedidoActivos().catch(() => []),
    db.getEstadoPedidoIdByCodigo('pendiente').catch(() => null),
    loadSimpleCatalogForSelect(db, 'provincias'),
    loadSimpleCatalogForSelect(db, 'paises')
  ]);

  const tarifas = Array.isArray(tarifasIn) ? [...tarifasIn] : [];
  const formasPago = Array.isArray(formasPagoIn) ? [...formasPagoIn] : [];
  const tiposPedido = Array.isArray(tiposPedidoIn) ? [...tiposPedidoIn] : [];

  const tarifaTransfer = await db.ensureTarifaTransfer().catch(() => null);
  if (
    tarifaTransfer &&
    _n(tarifaTransfer.tarcli_id, tarifaTransfer.Id, tarifaTransfer.id) != null &&
    !tarifas.some((t) => Number(_n(t.tarcli_id, t.Id, t.id)) === Number(_n(tarifaTransfer.tarcli_id, tarifaTransfer.Id, tarifaTransfer.id)))
  ) {
    tarifas.push(tarifaTransfer);
  }
  const formaPagoTransfer = await db.ensureFormaPagoTransfer().catch(() => null);
  if (
    formaPagoTransfer &&
    _n(formaPagoTransfer.id, formaPagoTransfer.Id) != null &&
    !formasPago.some((f) => Number(_n(f.id, f.Id)) === Number(_n(formaPagoTransfer.id, formaPagoTransfer.Id)))
  ) {
    formasPago.push(formaPagoTransfer);
  }

  const articulos = await db.getArticulos({}).catch(() => []);
  const _ft = filterOutTransferOptions(formasPago, tiposPedido);

  let comId = Number(clienteRow?.cli_com_id ?? clienteRow?.Id_Cial ?? 0);
  if (!Number.isFinite(comId) || comId <= 0) {
    comId = Number((await db.getComercialIdPool().catch(() => null)) || 0);
  }

  const clienteLabel = String(
    clienteRow?.cli_nombre_razon_social ?? clienteRow?.Nombre_Razon_Social ?? clienteRow?.Nombre ?? ''
  ).trim() || 'Tu empresa';

  const tarifaIdLocked = getClienteTarifaIdNum(clienteRow);
  const tarifaLabel = tarifaIdLocked ? tarifaNombreById(tarifas, tarifaIdLocked) : 'PVL / genérica (sin tarifa asignada en ficha)';
  const transferTarifa = /transfer/i.test(String(tarifaLabel || ''));
  const tipoLocked = transferTarifa ? findTransferTipoId(tiposPedido) : 0;
  const formaLocked = getClienteFormaPagoId(clienteRow);

  const baseItem = {
    Id_Cliente: cliId,
    Id_Cial: comId,
    Id_Tarifa: tarifaIdLocked || 0,
    Serie: 'P',
    EstadoPedido: 'Pendiente',
    Id_EstadoPedido: _n(estadoPendienteId, null),
    Id_FormaPago: formaLocked || null,
    Id_TipoPedido: tipoLocked || null,
    FechaPedido: new Date().toISOString().slice(0, 10),
    Observaciones: ''
  };
  const mergedItem = { ...baseItem, ...(itemOverride && typeof itemOverride === 'object' ? itemOverride : {}) };
  mergedItem.Id_Cliente = cliId;
  mergedItem.Id_Cial = comId;
  mergedItem.Id_Tarifa = tarifaIdLocked || 0;
  mergedItem.Id_FormaPago = formaLocked || null;
  mergedItem.Id_TipoPedido = tipoLocked || null;
  mergedItem.Id_EstadoPedido = _n(estadoPendienteId, null);
  mergedItem.EstadoPedido = 'Pendiente';
  mergedItem.EsEspecial = 0;

  const lineas =
    Array.isArray(lineasOverride) && lineasOverride.length
      ? lineasOverride
      : [{ Id_Articulo: '', Cantidad: 1, Dto: '' }];

  return {
    title: 'Nuevo pedido',
    mode: 'create',
    portalPedidoForm: true,
    portalPedidoCondicionesLocked: true,
    portalTarifaNombre: tarifaLabel,
    portalLockedTarifaIsTransfer: transferTarifa,
    formAction: '/portal/pedidos/nuevo',
    cancelHref: '/portal/pedidos',
    admin: false,
    user: null,
    comerciales: [],
    tarifas,
    formasPago: _ft.formasPago,
    tiposPedido: _ft.tiposPedido,
    descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
    estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
    articulos: Array.isArray(articulos) ? articulos : [],
    provincias: Array.isArray(provincias) ? provincias : [],
    paises: Array.isArray(paises) ? paises : [],
    item: mergedItem,
    lineas,
    clientes: [],
    clienteLabel,
    cliente: clienteRow,
    canEdit: true,
    error: error || null
  };
}

router.get('/pedidos/nuevo', async (req, res, next) => {
  try {
    const ctx = req.portalCtx;
    if (!ctx.flags.ver_pedidos) return res.status(403).send('Pedidos no visibles en el portal.');
    const locals = await getPortalPedidoNuevoLocals(req, {});
    res.render('pedido-form', locals);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/pedidos/nuevo',
  ...pedidoCreateValidators,
  rejectIfValidationFailsHtml('pedido-form', async (req) => {
    const body = req.body || {};
    const lineasRaw = body.lineas || body.Lineas
      ? Array.isArray(body.lineas || body.Lineas)
        ? body.lineas || body.Lineas
        : Object.values(body.lineas || body.Lineas)
      : [{ Id_Articulo: '', Cantidad: 1, Dto: '' }];
    return getPortalPedidoNuevoLocals(req, { item: body, lineas: lineasRaw, error: null });
  }),
  async (req, res, next) => {
    try {
      const cliId = req.session.portalUser.cli_id;
      const ctx = req.portalCtx;
      if (!ctx.flags.ver_pedidos) return res.status(403).send('Pedidos no visibles en el portal.');

      const [tarifas, formasPago, tiposPedido, estadoPendienteId] = await Promise.all([
        db.getTarifas().catch(() => []),
        db.getFormasPago().catch(() => []),
        db.getTiposPedido().catch(() => []),
        db.getEstadoPedidoIdByCodigo('pendiente').catch(() => null)
      ]);
      const body = req.body || {};
      const postedCliente = Number(body.Id_Cliente);
      if (!Number.isFinite(postedCliente) || postedCliente !== cliId) {
        const locals = await getPortalPedidoNuevoLocals(req, {
          item: body,
          lineas: parseLineasFromBody(body),
          error: 'Sesión no coincide con el cliente del pedido.'
        });
        return res.status(400).render('pedido-form', locals);
      }

      const clientePedido = ctx.cliente || (await db.getClienteById(cliId));
      if (!clientePedido) {
        const locals = await getPortalPedidoNuevoLocals(req, {
          item: body,
          lineas: parseLineasFromBody(body),
          error: 'No se encontró tu ficha de cliente.'
        });
        return res.status(400).render('pedido-form', locals);
      }

      let comId = Number(clientePedido.cli_com_id ?? clientePedido.Id_Cial ?? 0);
      if (!Number.isFinite(comId) || comId <= 0) {
        comId = Number((await db.getComercialIdPool().catch(() => null)) || 0);
      }
      if (!Number.isFinite(comId) || comId <= 0) {
        const locals = await getPortalPedidoNuevoLocals(req, {
          item: body,
          lineas: parseLineasFromBody(body),
          error: 'No hay comercial asignado. Contacta con Gemavip.'
        });
        return res.status(400).render('pedido-form', locals);
      }

      const dniCliente = String(_n(_n(clientePedido.cli_dni_cif, clientePedido.DNI_CIF), clientePedido.DniCif) || '').trim();
      const activo =
        Number(_n(_n(_n(clientePedido.cli_ok_ko, clientePedido.OK_KO), clientePedido.ok_ko), 0)) === 1;
      if (!dniCliente || dniCliente.toLowerCase() === 'pendiente') {
        const locals = await getPortalPedidoNuevoLocals(req, {
          item: body,
          lineas: parseLineasFromBody(body),
          error: 'No se pueden crear pedidos sin DNI/CIF en ficha. Contacta con Gemavip.'
        });
        return res.status(400).render('pedido-form', locals);
      }
      if (!activo) {
        const locals = await getPortalPedidoNuevoLocals(req, {
          item: body,
          lineas: parseLineasFromBody(body),
          error: 'Tu cuenta no está activa para pedidos. Contacta con Gemavip.'
        });
        return res.status(400).render('pedido-form', locals);
      }

      let lineas = parseLineasFromBody(body);
      const dtoClientePct = Number(String(clientePedido.cli_dto ?? clientePedido.Dto ?? 0).replace(',', '.')) || 0;
      lineas = aplicarDtoLineasPortal(lineas, dtoClientePct);

      let finalPayload = buildPortalPedidoCreatePayload({
        cliId,
        comId,
        cliente: clientePedido,
        estadoPendienteId,
        body,
        tarifas,
        formasPago,
        tiposPedido
      });

      if (finalPayload.Id_DireccionEnvio) {
        const dirs = await db.getDireccionesEnvioByCliente(cliId).catch(() => []);
        const okDir = (dirs || []).some((d) => Number(d.direnv_id ?? d.Id ?? d.id) === Number(finalPayload.Id_DireccionEnvio));
        if (!okDir) finalPayload.Id_DireccionEnvio = null;
      }

      if (await isTransferPedido(db, finalPayload).catch(() => false)) {
        const mayoristaInfo = await resolveMayoristaInfo(db, finalPayload);
        if (mayoristaInfo && (mayoristaInfo.nombre || mayoristaInfo.codigoAsociado)) {
          const cod = mayoristaInfo.codigoAsociado || String(body.NumAsociadoHefame || '').trim() || null;
          if (mayoristaInfo.nombre) finalPayload.cooperativa_nombre = mayoristaInfo.nombre;
          if (cod) {
            finalPayload.NumAsociadoHefame = cod;
            finalPayload.numero_cooperativa = cod;
          }
        }
      }

      let created;
      try {
        created = await db.createPedido(finalPayload);
      } catch (err) {
        const locals = await getPortalPedidoNuevoLocals(req, {
          item: body,
          lineas,
          error: err?.message || 'No se pudo crear el pedido.'
        });
        return res.status(400).render('pedido-form', locals);
      }

      const pedidoId = _n(_n(created && created.insertId, created && created.Id), created && created.id);
      const pid = Number(pedidoId);
      if (!Number.isFinite(pid) || pid <= 0) {
        const locals = await getPortalPedidoNuevoLocals(req, {
          item: body,
          lineas,
          error: 'No se obtuvo el ID del pedido creado.'
        });
        return res.status(500).render('pedido-form', locals);
      }

      await db.updatePedidoWithLineas(pid, {}, lineas);

      return res.redirect(`/portal/pedidos/${pid}`);
    } catch (e) {
      next(e);
    }
  }
);

router.get('/pedidos', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = req.portalCtx;
    if (!ctx.flags.ver_pedidos) {
      return res.status(403).send('Pedidos no visibles en el portal.');
    }
    const pedidos = await db.getPedidosPaged({ clienteId: cliId }, { limit: 200, offset: 0 }).catch(() => []);
    res.render('portal/pedidos', { title: 'Mis pedidos', ctx, pedidos });
  } catch (e) {
    next(e);
  }
});

router.get('/pedidos/:id/print', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = req.portalCtx;
    if (!ctx.flags.ver_pedidos) return res.status(403).send('No disponible');
    const pedIdNum = Number.parseInt(String(req.params.id).trim(), 10);
    if (!Number.isFinite(pedIdNum) || pedIdNum <= 0) return res.status(404).send('No encontrado');
    const pedido = await assertPedidoCliente(pedIdNum, cliId);
    if (!pedido) return res.status(404).send('No encontrado');
    const lineas = await db.getArticulosByPedido(pedido.ped_id ?? pedido.Id ?? pedIdNum).catch(() => []);
    res.render('portal/pedido-print', {
      title: `Pedido ${pedido.ped_numero || pedido.NumPedido || pedIdNum}`,
      ctx,
      pedido,
      lineas
    });
  } catch (e) {
    next(e);
  }
});

router.get('/pedidos/:id', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = req.portalCtx;
    if (!ctx.flags.ver_pedidos) return res.status(403).send('No disponible');
    const rawId = req.params.id;
    const pedIdNum = Number.parseInt(String(rawId).trim(), 10);
    if (!Number.isFinite(pedIdNum) || pedIdNum <= 0) return res.status(404).send('No encontrado');
    const pedido = await assertPedidoCliente(pedIdNum, cliId);
    if (!pedido) return res.status(404).send('No encontrado');
    const lineas = await db.getArticulosByPedido(pedido.ped_id ?? pedido.Id ?? pedIdNum).catch(() => []);
    const estadoPendienteId = await db.getEstadoPedidoIdByCodigo('pendiente').catch(() => null);
    const portalPedidoEditable = portalPedidoEstaPendiente(pedido, estadoPendienteId);
    res.render('portal/pedido-detail', {
      title: 'Pedido',
      ctx,
      pedido,
      lineas,
      portalPedidoEditable
    });
  } catch (e) {
    next(e);
  }
});

router.get('/catalogo', async (req, res, next) => {
  try {
    const ctx = req.portalCtx;
    if (!ctx.flags.ver_catalogo) return res.status(403).send('Catálogo no disponible en tu portal.');
    const cliente = ctx.cliente;
    const tarifaId = getClienteTarifaIdNum(cliente);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 40;
    const offset = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      db.getArticulos({ search: q || undefined, limit, offset }).catch(() => []),
      db.countArticulos({ search: q || undefined }).catch(() => 0)
    ]);
    const ids = (rows || []).map((r) => Number(r.art_id ?? r.Id ?? r.id)).filter((n) => Number.isFinite(n) && n > 0);
    const precios = ids.length ? await db.getPreciosArticulosParaTarifa(tarifaId, ids).catch(() => ({})) : {};
    const tarifas = await db.getTarifas().catch(() => []);
    const tarifaNombre = tarifaId ? tarifaNombreById(tarifas, tarifaId) : 'PVL / sin tarifa en ficha';
    res.render('portal/catalogo', {
      title: 'Catálogo',
      ctx,
      rows: rows || [],
      precios: precios || {},
      q,
      page,
      total: Number(total) || 0,
      limit,
      tarifaId,
      tarifaNombre
    });
  } catch (e) {
    next(e);
  }
});

router.get('/catalogo/:artId', async (req, res, next) => {
  try {
    const ctx = req.portalCtx;
    if (!ctx.flags.ver_catalogo) return res.status(403).send('Catálogo no disponible.');
    const artId = Number.parseInt(String(req.params.artId).trim(), 10);
    if (!Number.isFinite(artId) || artId <= 0) return res.status(404).send('No encontrado');
    const art = await db.getArticuloById(artId);
    if (!art) return res.status(404).send('No encontrado');
    const tarifaId = getClienteTarifaIdNum(ctx.cliente);
    const precios = await db.getPreciosArticulosParaTarifa(tarifaId, [artId]).catch(() => ({}));
    const precio = precios[String(artId)];
    const tarifas = await db.getTarifas().catch(() => []);
    const tarifaNombre = tarifaId ? tarifaNombreById(tarifas, tarifaId) : 'PVL / sin tarifa en ficha';
    res.render('portal/catalogo-articulo', {
      title: String(art.art_nombre ?? art.Nombre ?? 'Artículo'),
      ctx,
      art,
      precio,
      tarifaId,
      tarifaNombre
    });
  } catch (e) {
    next(e);
  }
});

router.get('/facturas', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = req.portalCtx;
    if (!ctx.flags.ver_facturas) return res.status(403).send('Facturas no visibles.');
    const hid = String(ctx.cliente?.cli_Id_Holded || '').trim();
    const apiKey = getHoldedApiKeyOptional();
    let docs = [];
    if (hid && apiKey) {
      docs = await listDocumentsForContact(DOC_TYPES.facturas, hid, apiKey);
    }
    res.render('portal/facturas', { title: 'Facturas', ctx, docs, sinHolded: !hid, sinApi: !apiKey });
  } catch (e) {
    next(e);
  }
});

router.get('/presupuestos', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = req.portalCtx;
    if (!ctx.flags.ver_presupuestos) return res.status(403).send('No disponible');
    const hid = String(ctx.cliente?.cli_Id_Holded || '').trim();
    const apiKey = getHoldedApiKeyOptional();
    let docs = [];
    if (hid && apiKey) {
      docs = await listDocumentsForContact(DOC_TYPES.presupuestos, hid, apiKey);
    }
    res.render('portal/presupuestos', { title: 'Presupuestos', ctx, docs, sinHolded: !hid, sinApi: !apiKey });
  } catch (e) {
    next(e);
  }
});

router.get('/albaranes', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = req.portalCtx;
    if (!ctx.flags.ver_albaranes) return res.status(403).send('No disponible');
    const hid = String(ctx.cliente?.cli_Id_Holded || '').trim();
    const apiKey = getHoldedApiKeyOptional();
    let docs = [];
    if (hid && apiKey) {
      docs = await listDocumentsForContact(DOC_TYPES.albaranes, hid, apiKey);
    }
    res.render('portal/albaranes', { title: 'Albaranes', ctx, docs, sinHolded: !hid, sinApi: !apiKey });
  } catch (e) {
    next(e);
  }
});

async function assertHoldedDocForCliente(cliId, docType, docId) {
  const cliente = await loadPortalCliente(cliId);
  const hid = String(cliente?.cli_Id_Holded || '').trim();
  if (!hid) return null;
  const apiKey = getHoldedApiKeyOptional();
  if (!apiKey) return null;
  const list = await listDocumentsForContact(docType, hid, apiKey);
  const idStr = String(docId);
  return list.find((d) => String(d.id) === idStr) || null;
}

async function servePortalDocumentoPdf(req, res, next) {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = req.portalCtx;
    const dt = String(req.params.docType || '').toLowerCase();
    const docId = String(req.params.docId || '');
    const allowed = {
      invoice: ctx.flags.ver_facturas,
      estimate: ctx.flags.ver_presupuestos,
      waybill: ctx.flags.ver_albaranes,
      salesorder: ctx.flags.ver_pedidos
    };
    if (!allowed[dt]) return res.status(403).send('No permitido');
    const ok = await assertHoldedDocForCliente(cliId, dt, docId);
    if (!ok) return res.status(404).send('Documento no encontrado');
    const { buffer, contentType } = await fetchDocumentPdf(dt, docId);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${dt}-${docId}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    next(e);
  }
}

/** PDF documento (URL neutra para el portal). Mantiene alias legacy `/holded/`. */
router.get('/doc/:docType/:docId/pdf', servePortalDocumentoPdf);
router.get('/holded/:docType/:docId/pdf', servePortalDocumentoPdf);

router.get('/mensajes', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = req.portalCtx;
    if (!clientePermitePortal(ctx.cliente)) {
      delete req.session.portalUser;
      return res.redirect('/login-cliente');
    }
    const q = req.query || {};
    const sent = q.sent === '1';
    const err = typeof q.err === 'string' ? q.err : null;
    res.render('portal/mensajes', { title: 'Mensajes a Gemavip', ctx, sent, err });
  } catch (e) {
    next(e);
  }
});

router.post('/mensajes', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = req.portalCtx;
    if (!clientePermitePortal(ctx.cliente)) {
      delete req.session.portalUser;
      return res.redirect('/login-cliente');
    }
    const mensaje = String(req.body?.mensaje || '').trim();
    if (mensaje.length < 3) return res.redirect('/portal/mensajes?err=short');
    if (mensaje.length > 2000) return res.redirect('/portal/mensajes?err=long');
    const id = await db.createMensajePortalCliente(cliId, mensaje);
    if (!id) return res.redirect('/portal/mensajes?err=save');
    return res.redirect('/portal/mensajes?sent=1');
  } catch (e) {
    next(e);
  }
});

router.post('/comentario', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const tipo = String(req.body?.tipo_doc || '').trim().slice(0, 32);
    const ref = String(req.body?.ref_externa || '').trim().slice(0, 64);
    const mensaje = String(req.body?.mensaje || '').trim();
    if (!tipo || !ref || !mensaje) {
      return res.status(400).send('Datos incompletos');
    }
    await db.addPortalDocumentoComentario({
      cli_id: cliId,
      tipo_doc: tipo,
      ref_externa: ref,
      mensaje,
      es_cliente: true
    });
    const back = String(req.body?.redirect || '/portal').slice(0, 512);
    if (back.startsWith('/') && !back.includes('//')) return res.redirect(back);
    return res.redirect('/portal');
  } catch (e) {
    next(e);
  }
});

router.get('/pago', async (req, res) => {
  const st = getStripePortalStatus();
  res.render('portal/pago-stripe', { title: 'Pago online', stripe: st });
});

module.exports = router;
