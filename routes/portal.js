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
const { filterOutTransferOptions, ensureTransferTarifaYFormaPago } = require('../lib/pedido-form-shared');
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

router.get('/', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = await getPortalSessionContext(cliId);
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
    if (hid && apiKey && ctx.flags.ver_facturas) {
      const inv = await listDocumentsForContact(DOC_TYPES.facturas, hid, apiKey);
      nInv = inv.length;
    }
    if (hid && apiKey && ctx.flags.ver_presupuestos) {
      const est = await listDocumentsForContact(DOC_TYPES.presupuestos, hid, apiKey);
      nEst = est.length;
    }

    res.render('portal/dashboard', {
      title: 'Tu cuenta · portal',
      ctx,
      stats: { nPedidos: nPed, nFacturas: nInv, nPresupuestos: nEst },
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

/** Locales para `pedido-form` en modo portal (misma lógica de catálogos que /pedidos/new). */
async function getPortalPedidoNuevoLocals(req, { item: itemOverride, lineas: lineasOverride, error } = {}) {
  const cliId = req.session.portalUser.cli_id;
  const [tarifasIn, formasPagoIn, tiposPedidoIn, descuentosPedido, estadosPedido, estadoPendienteId, provincias, paises, clienteRow] =
    await Promise.all([
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => []),
      db.getTiposPedido().catch(() => []),
      db.getDescuentosPedidoActivos().catch(() => []),
      db.getEstadosPedidoActivos().catch(() => []),
      db.getEstadoPedidoIdByCodigo('pendiente').catch(() => null),
      loadSimpleCatalogForSelect(db, 'provincias'),
      loadSimpleCatalogForSelect(db, 'paises'),
      db.getClienteById(cliId)
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

  const baseItem = {
    Id_Cliente: cliId,
    Id_Cial: comId,
    Id_Tarifa: 0,
    Serie: 'P',
    EstadoPedido: 'Pendiente',
    Id_EstadoPedido: _n(estadoPendienteId, null),
    Id_FormaPago: null,
    Id_TipoPedido: null,
    Observaciones: ''
  };
  const mergedItem = { ...baseItem, ...(itemOverride && typeof itemOverride === 'object' ? itemOverride : {}) };
  mergedItem.Id_Cliente = cliId;
  mergedItem.Id_Cial = comId;

  const lineas =
    Array.isArray(lineasOverride) && lineasOverride.length
      ? lineasOverride
      : [{ Id_Articulo: '', Cantidad: 1, Dto: '' }];

  return {
    title: 'Nuevo pedido',
    mode: 'create',
    portalPedidoForm: true,
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
    const cliId = req.session.portalUser.cli_id;
    const ctx = await getPortalSessionContext(cliId);
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
      const ctx = await getPortalSessionContext(cliId);
      if (!ctx.flags.ver_pedidos) return res.status(403).send('Pedidos no visibles en el portal.');

      const [tarifas, formasPago, tiposPedido] = await Promise.all([
        db.getTarifas().catch(() => []),
        db.getFormasPago().catch(() => []),
        db.getTiposPedido().catch(() => [])
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

      const clientePedido = await db.getClienteById(cliId);
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

      const esEspecial =
        body.EsEspecial === '1' ||
        body.EsEspecial === 1 ||
        body.EsEspecial === true ||
        String(body.EsEspecial || '').toLowerCase() === 'on';
      const tarifaIn = Number(body.Id_Tarifa);
      const tarifaId = Number.isFinite(tarifaIn) ? tarifaIn : NaN;

      const pedidoPayload = {
        Id_Cial: comId,
        Id_Cliente: cliId,
        Id_DireccionEnvio: body.Id_DireccionEnvio ? Number(body.Id_DireccionEnvio) || null : null,
        Id_FormaPago: body.Id_FormaPago ? Number(body.Id_FormaPago) || 0 : 0,
        Id_TipoPedido: body.Id_TipoPedido ? Number(body.Id_TipoPedido) || 0 : 0,
        Id_EstadoPedido: body.Id_EstadoPedido ? Number(body.Id_EstadoPedido) || null : null,
        ...(Number.isFinite(tarifaId) && tarifaId > 0 ? { Id_Tarifa: tarifaId } : {}),
        Serie: 'P',
        ...(esEspecial
          ? { EsEspecial: 1, EspecialEstado: 'pendiente', EspecialFechaSolicitud: new Date() }
          : { EsEspecial: 0 }),
        ...(esEspecial ? { Dto: Number(String(body.Dto || '').replace(',', '.')) || 0 } : {}),
        NumPedidoCliente: String(body.NumPedidoCliente || '').trim() || null,
        NumAsociadoHefame: body.NumAsociadoHefame != null ? String(body.NumAsociadoHefame).trim() || null : undefined,
        FechaPedido: body.FechaPedido ? String(body.FechaPedido).slice(0, 10) : undefined,
        FechaEntrega: body.FechaEntrega ? String(body.FechaEntrega).slice(0, 10) : null,
        EstadoPedido: String(body.EstadoPedido || 'Pendiente').trim(),
        Observaciones: String(body.Observaciones || '').trim() || null
      };

      if (!pedidoPayload.EstadoPedido) {
        const locals = await getPortalPedidoNuevoLocals(req, {
          item: body,
          lineas: parseLineasFromBody(body),
          error: 'Estado del pedido obligatorio.'
        });
        return res.status(400).render('pedido-form', locals);
      }

      const lineas = parseLineasFromBody(body);
      let finalPayload = ensureTransferTarifaYFormaPago(pedidoPayload, body, tarifas, formasPago, tiposPedido);
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

      if (esEspecial) {
        await db.ensureNotificacionPedidoEspecial(pid, finalPayload.Id_Cliente, finalPayload.Id_Cial).catch(() => null);
        const clienteNombre =
          clientePedido?.cli_nombre_razon_social ??
          clientePedido?.Nombre_Razon_Social ??
          clientePedido?.Nombre ??
          `Cliente ${finalPayload.Id_Cliente}`;
        await sendPushToAdmins({
          title: 'Nuevo pedido especial (portal)',
          body: `Cliente ${clienteNombre} solicita pedido especial desde el portal`,
          url: '/notificaciones',
          tipo: 'pedido_especial',
          pedidoId: pid,
          clienteId: finalPayload.Id_Cliente,
          clienteNombre,
          cliente: clientePedido,
          userId: null,
          userName: 'Portal cliente',
          userEmail: req.session?.portalUser?.email || null,
          lineas
        }).catch(() => {});
      }

      return res.redirect(`/portal/pedidos/${pid}`);
    } catch (e) {
      next(e);
    }
  }
);

router.get('/pedidos', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = await getPortalSessionContext(cliId);
    if (!ctx.flags.ver_pedidos) {
      return res.status(403).send('Pedidos no visibles en el portal.');
    }
    const pedidos = await db.getPedidosPaged({ clienteId: cliId }, { limit: 200, offset: 0 }).catch(() => []);
    res.render('portal/pedidos', { title: 'Mis pedidos', ctx, pedidos });
  } catch (e) {
    next(e);
  }
});

router.get('/pedidos/:id', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = await getPortalSessionContext(cliId);
    if (!ctx.flags.ver_pedidos) return res.status(403).send('No disponible');
    const rawId = req.params.id;
    const pedIdNum = Number.parseInt(String(rawId).trim(), 10);
    if (!Number.isFinite(pedIdNum) || pedIdNum <= 0) return res.status(404).send('No encontrado');
    const pedido = await assertPedidoCliente(pedIdNum, cliId);
    if (!pedido) return res.status(404).send('No encontrado');
    const lineas = await db.getArticulosByPedido(pedido.ped_id ?? pedido.Id ?? pedIdNum).catch(() => []);
    res.render('portal/pedido-detail', { title: 'Pedido', ctx, pedido, lineas });
  } catch (e) {
    next(e);
  }
});

router.get('/facturas', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = await getPortalSessionContext(cliId);
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
    const ctx = await getPortalSessionContext(cliId);
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
    const ctx = await getPortalSessionContext(cliId);
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
    const ctx = await getPortalSessionContext(cliId);
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
    const ctx = await getPortalSessionContext(cliId);
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
    const ctx = await getPortalSessionContext(cliId);
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
