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
const db = require('../config/mysql-crm');

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

router.get('/pedidos/nuevo', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = await getPortalSessionContext(cliId);
    if (!ctx.flags.ver_pedidos) return res.status(403).send('Pedidos no visibles en el portal.');
    res.render('portal/pedido-nuevo', {
      title: 'Nuevo pedido',
      ctx,
      error: null,
      observaciones: ''
    });
  } catch (e) {
    next(e);
  }
});

router.post('/pedidos/nuevo', async (req, res, next) => {
  try {
    const cliId = req.session.portalUser.cli_id;
    const ctx = await getPortalSessionContext(cliId);
    if (!ctx.flags.ver_pedidos) return res.status(403).send('Pedidos no visibles en el portal.');

    const observaciones = String(req.body?.observaciones || '').trim().slice(0, 2000);
    const cliente = await db.getClienteById(cliId);
    if (!cliente) {
      return res.status(400).render('portal/pedido-nuevo', {
        title: 'Nuevo pedido',
        ctx,
        error: 'No se encontró tu ficha de cliente.',
        observaciones
      });
    }

    let comId = Number(cliente.cli_com_id ?? cliente.Id_Cial ?? cliente.ped_com_id ?? 0);
    if (!Number.isFinite(comId) || comId <= 0) {
      comId = Number((await db.getComercialIdPool().catch(() => null)) || 0);
    }
    if (!Number.isFinite(comId) || comId <= 0) {
      return res.status(400).render('portal/pedido-nuevo', {
        title: 'Nuevo pedido',
        ctx,
        error: 'No hay comercial asignado. Contacta con Gemavip.',
        observaciones
      });
    }

    const [tipos, formas] = await Promise.all([db.getTiposPedido().catch(() => []), db.getFormasPago().catch(() => [])]);
    const t0 = Array.isArray(tipos) && tipos.length ? tipos[0] : null;
    const f0 = Array.isArray(formas) && formas.length ? formas[0] : null;
    const tippId = Number(t0?.tipp_id ?? t0?.Id ?? t0?.id ?? 0);
    const formpId = Number(f0?.formp_id ?? f0?.id ?? f0?.Id ?? 0);

    if (!Number.isFinite(tippId) || tippId <= 0 || !Number.isFinite(formpId) || formpId <= 0) {
      return res.status(400).render('portal/pedido-nuevo', {
        title: 'Nuevo pedido',
        ctx,
        error: 'Faltan datos de configuración (tipo o forma de pago). Contacta con Gemavip.',
        observaciones
      });
    }

    const obsText =
      observaciones ||
      'Pedido solicitado desde el portal del cliente. Completa líneas y condiciones en el CRM si hace falta.';
    const payload = {
      Id_Cliente: cliId,
      Id_Cial: comId,
      Id_TipoPedido: tippId,
      Id_FormaPago: formpId,
      Serie: 'P',
      EstadoPedido: 'Pendiente',
      Observaciones: obsText
    };

    let result;
    try {
      result = await db.createPedido(payload);
    } catch (err) {
      return res.status(400).render('portal/pedido-nuevo', {
        title: 'Nuevo pedido',
        ctx,
        error: err?.message || 'No se pudo crear el pedido. Contacta con Gemavip.',
        observaciones
      });
    }

    const newId = result?.insertId ?? result?.Id ?? result?.id;
    const pid = Number(newId);
    if (!Number.isFinite(pid) || pid <= 0) {
      return res.status(500).render('portal/pedido-nuevo', {
        title: 'Nuevo pedido',
        ctx,
        error: 'El pedido no se ha podido registrar correctamente.',
        observaciones
      });
    }

    return res.redirect(`/portal/pedidos/${pid}`);
  } catch (e) {
    next(e);
  }
});

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
