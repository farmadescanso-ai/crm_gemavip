/**
 * Webhook público para aprobar/rechazar asignaciones desde el email.
 * Evita que se abra la ventana de n8n: los enlaces del email van al CRM.
 * GET /webhook/aprobar-asignacion?notifId=X&approved=1&sig=XXX
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../config/mysql-crm');
const { sendAsignacionResultadoEmail } = require('../lib/mailer');

const router = express.Router();
const APP_BASE_URL = process.env.APP_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
const APROBACION_SECRET = (process.env.APROBACION_SECRET || process.env.API_KEY || 'crm-gemavip-aprobacion').trim();

function computeSig(notifId, approved) {
  const msg = `notifId=${notifId}&approved=${approved}`;
  return crypto.createHmac('sha256', APROBACION_SECRET).update(msg).digest('hex');
}

function computeSigSyncCliente(notifId, accion) {
  const msg = `notifId=${notifId}&accion=${accion}`;
  return crypto.createHmac('sha256', APROBACION_SECRET).update(msg).digest('hex');
}

/**
 * Página landing atractiva tras aprobar/rechazar. Cierra la ventana si se abrió como popup.
 * @param {boolean} approved - true si aprobado, false si rechazado
 * @param {string} [clienteNombre] - Nombre del cliente (opcional)
 */
function paginaListoHtml(approved, label = '', opts = {}) {
  const isAprobado = approved === true;
  const tipo = opts.tipo || 'solicitud';
  const pedidoUrl = opts.pedidoUrl || null;
  const fichaClienteUrl = opts.fichaClienteUrl || null;

  let titulo, mensaje;
  if (tipo === 'pedido') {
    titulo = isAprobado ? 'Pedido aprobado' : 'Pedido denegado';
    mensaje = isAprobado
      ? (label ? `El pedido <strong>${escapeHtml(label)}</strong> ha sido aprobado. Se ha notificado al comercial.` : 'El pedido ha sido aprobado correctamente.')
      : (label ? `El pedido <strong>${escapeHtml(label)}</strong> ha sido denegado. Se ha notificado al comercial.` : 'El pedido ha sido denegado.');
  } else if (tipo === 'sync_holded') {
    titulo = opts.syncTitulo || (isAprobado ? 'Sincronización aplicada' : 'Marcado para revisión');
    mensaje =
      opts.syncMensajeHtml ||
      (isAprobado
        ? 'La acción de sincronización Holded se ha registrado correctamente.'
        : 'Puede cerrar esta ventana y revisar el contacto en el CRM cuando quiera.');
  } else {
    titulo = isAprobado ? 'Solicitud aprobada' : 'Solicitud rechazada';
    mensaje = isAprobado
      ? (label ? `El cliente <strong>${escapeHtml(label)}</strong> ha sido asignado al comercial.` : 'La asignación ha sido aprobada correctamente.')
      : (label ? `La solicitud para <strong>${escapeHtml(label)}</strong> ha sido rechazada.` : 'La solicitud ha sido rechazada.');
  }

  const icono = isAprobado ? '✓' : '✕';
  const colorPrincipal = isAprobado ? '#198754' : '#dc3545';
  const btnLink =
    tipo === 'sync_holded'
      ? fichaClienteUrl || `${APP_BASE_URL}/clientes`
      : pedidoUrl || `${APP_BASE_URL}/pedidos`;
  const btnLabel =
    tipo === 'sync_holded'
      ? 'Ver contacto en el CRM'
      : pedidoUrl
        ? 'Ver pedido en el CRM'
        : 'Ir al CRM';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${titulo} · CRM Gemavip</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=Outfit:wght@500;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'DM Sans', system-ui, sans-serif; min-height: 100vh; background: linear-gradient(160deg, #f0f7ff 0%, #f8f8f8 50%, #fff5f0 100%); color: #1f2a44; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { max-width: 420px; width: 100%; background: #fff; border-radius: 20px; box-shadow: 0 20px 60px rgba(12,20,58,0.12); overflow: hidden; border: 1px solid rgba(0,0,0,0.06); }
    .card-bar { height: 4px; background: linear-gradient(90deg, #008bd2, #2ea3f2, #ffba00, #8fae1b); }
    .card-body { padding: 40px 32px; text-align: center; }
    .icon-wrap { width: 72px; height: 72px; border-radius: 50%; margin: 0 auto 24px; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 700; color: #fff; background: ${colorPrincipal}; box-shadow: 0 8px 24px ${colorPrincipal}40; }
    .card-body h1 { font-family: 'Outfit', sans-serif; font-size: 22px; font-weight: 600; margin: 0 0 12px; color: #0c143a; }
    .card-body p { font-size: 15px; line-height: 1.6; color: #5b667a; margin: 0 0 24px; }
    .card-body p strong { color: #1f2a44; }
    .hint { font-size: 13px; color: #8b95a5; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; }
    .btn-crm { display: inline-block; padding: 12px 28px; background: #008bd2; color: #fff !important; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 14px; transition: transform 0.2s, box-shadow 0.2s; }
    .btn-crm:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,139,210,0.30); }
    .brand { font-size: 11px; color: #8b95a5; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-bar"></div>
    <div class="card-body">
      <p class="brand">CRM Gemavip</p>
      <div class="icon-wrap">${icono}</div>
      <h1>${titulo}</h1>
      ${tipo === 'sync_holded' ? `<div class="sync-msg" style="text-align:left;">${mensaje}</div>` : `<p>${mensaje}</p>`}
      <a href="${btnLink}" class="btn-crm">${btnLabel}</a>
      <p class="hint">Ya puedes cerrar esta pestaña.</p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
  if (!s || typeof s !== 'string') return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Página de error con formato consistente.
 */
function paginaErrorHtml(titulo, mensaje) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(titulo)} · CRM Gemavip</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&family=Outfit:wght@600&display=swap" rel="stylesheet">
  <style>
    body { margin: 0; font-family: 'DM Sans', system-ui, sans-serif; min-height: 100vh; background: linear-gradient(160deg, #fff5f5 0%, #f8f8f8 100%); display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { max-width: 400px; background: #fff; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.08); padding: 40px; text-align: center; border-left: 4px solid #dc3545; }
    h1 { font-family: 'Outfit', sans-serif; font-size: 20px; color: #0c143a; margin: 0 0 12px; }
    p { font-size: 15px; color: #5b667a; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(titulo)}</h1>
    <p>${escapeHtml(mensaje)}</p>
  </div>
</body>
</html>`;
}

router.get('/aprobar-asignacion', async (req, res) => {
  try {
    const notifId = Number(req.query.notifId);
    const approvedRaw = req.query.approved;
    const sig = String(req.query.sig || '').trim();

    if (!Number.isFinite(notifId) || notifId <= 0) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.status(400).send(paginaErrorHtml('Enlace inválido', 'Faltan parámetros.'));
      return;
    }

    const approved = approvedRaw === '1' || approvedRaw === 'true' || approvedRaw === true;
    const expectedSig = computeSig(notifId, approved);
    if (sig !== expectedSig) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.status(400).send(paginaErrorHtml('Enlace inválido', 'Firma incorrecta.'));
      return;
    }

    const result = await db.resolverSolicitudAsignacion(notifId, null, approved);
    if (!result?.ok) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.status(404).send(paginaErrorHtml('Acción no válida', result?.message || 'La solicitud ya fue resuelta.'));
      return;
    }

    let clienteNombreParaPagina = '';
    if (result.tipo === 'asignacion_contacto' || !result.tipo) {
      const contactoId = result.id_contacto;
      const comercialId = result.id_comercial_solicitante;
      let comercialEmail = null;
      let clienteNombre = null;
      try {
        const [comercial, cliente] = await Promise.all([
          db.getComercialById(comercialId).catch(() => null),
          contactoId ? db.getClienteById(contactoId).catch(() => null) : null
        ]);
        comercialEmail = comercial?.Email ?? comercial?.email ?? null;
        clienteNombre = cliente?.cli_nombre_razon_social ?? cliente?.Nombre_Razon_Social ?? cliente?.Nombre ?? 'Cliente';
      } catch (_) {}
      clienteNombreParaPagina = clienteNombre || '';

      if (comercialEmail) {
        await sendAsignacionResultadoEmail(comercialEmail, {
          aprobado: approved,
          clienteNombre: clienteNombre || 'Cliente',
          clienteId: contactoId
        }).catch((e) => console.warn('[APROBACION] Error enviando email:', e?.message));
      }
    } else if (result.tipo === 'pedido_especial') {
      clienteNombreParaPagina = result.cliente_nombre || '';
      const comercialEmail = result.comercial_email;
      if (comercialEmail) {
        const { sendPedidoEspecialDecisionEmail } = require('../lib/mailer');
        await sendPedidoEspecialDecisionEmail(comercialEmail, {
          decision: approved ? 'aprobado' : 'rechazado',
          pedidoNum: result.num_pedido,
          clienteNombre: result.cliente_nombre,
          pedidoUrl: result.id_pedido ? `${APP_BASE_URL}/pedidos/${result.id_pedido}` : null
        }).catch((e) => console.warn('[APROBACION] Error email pedido especial:', e?.message));
      }
    }

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(paginaListoHtml(approved, clienteNombreParaPagina));
  } catch (e) {
    console.error('[APROBACION] Error:', e?.message);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(paginaErrorHtml('Error', 'No se pudo procesar la solicitud.'));
  }
});

router.get('/aprobar-pedido', async (req, res) => {
  try {
    const notifId = Number(req.query.notifId);
    const approvedRaw = req.query.approved;
    const sig = String(req.query.sig || '').trim();

    if (!Number.isFinite(notifId) || notifId <= 0) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(paginaErrorHtml('Enlace inválido', 'Faltan parámetros.'));
    }

    const approved = approvedRaw === '1' || approvedRaw === 'true' || approvedRaw === true;
    const expectedSig = computeSig(notifId, approved);
    if (sig !== expectedSig) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(paginaErrorHtml('Enlace inválido', 'Firma incorrecta.'));
    }

    const result = await db.resolverSolicitudAsignacion(notifId, null, approved);
    if (!result?.ok) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(paginaErrorHtml('Acción no válida', result?.message || 'La solicitud ya fue resuelta.'));
    }

    if (approved && result.tipo === 'aprobacion_pedido' && result.id_pedido) {
      try {
        const { pushPedidoToHolded } = require('../lib/holded-export');
        await pushPedidoToHolded(result.id_pedido, result.id_comercial_solicitante);
      } catch (e) {
        console.warn('[APROBACION-PEDIDO] Error enviando a Holded:', e?.message);
      }
    }

    const pedidoNum = result.num_pedido || '';
    const clienteNombre = result.cliente_nombre || '';
    const comercialEmail = result.comercial_email;

    if (comercialEmail) {
      const { sendPedidoAprobacionResultadoEmail } = require('../lib/mailer');
      await sendPedidoAprobacionResultadoEmail(comercialEmail, {
        aprobado: approved,
        pedidoNum,
        clienteNombre,
        pedidoUrl: result.id_pedido ? `${APP_BASE_URL}/pedidos/${result.id_pedido}` : null
      }).catch((e) => console.warn('[APROBACION-PEDIDO] Error email resultado:', e?.message));
    }

    const label = pedidoNum ? `Pedido ${pedidoNum}` : (clienteNombre || 'Pedido');
    const pedidoUrl = result.id_pedido ? `${APP_BASE_URL}/pedidos/${result.id_pedido}` : null;
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(paginaListoHtml(approved, label, { tipo: 'pedido', pedidoUrl }));
  } catch (e) {
    console.error('[APROBACION-PEDIDO] Error:', e?.message);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(paginaErrorHtml('Error', 'No se pudo procesar la solicitud.'));
  }
});

router.get('/aprobar-sync-cliente', async (req, res) => {
  try {
    const notifId = Number(req.query.notifId);
    const accion = String(req.query.accion || '').trim().toLowerCase();
    const sig = String(req.query.sig || '').trim();
    const allowed = new Set(['crm_to_holded', 'holded_to_crm', 'revisar']);

    if (!Number.isFinite(notifId) || notifId <= 0 || !allowed.has(accion)) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(paginaErrorHtml('Enlace inválido', 'Parámetros incorrectos.'));
    }

    const expectedSig = computeSigSyncCliente(notifId, accion);
    if (sig !== expectedSig) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(paginaErrorHtml('Enlace inválido', 'Firma incorrecta.'));
    }

    const m = await db._ensureNotificacionesMeta();
    const rows = await db.query(
      `SELECT \`${m.pk}\` AS nid, \`${m.colTipo}\` AS tipo, \`${m.colContacto}\` AS id_contacto, \`${m.colEstado}\` AS estado FROM \`notificaciones\` WHERE \`${m.pk}\` = ? AND \`${m.colEstado}\` = 'pendiente'`,
      [notifId]
    );
    const notif = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!notif || String(notif.tipo || '').toLowerCase() !== 'aprobacion_sync_cliente') {
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(paginaErrorHtml('Acción no válida', 'La solicitud ya fue resuelta o no existe.'));
    }

    const cliId = Number(notif.id_contacto);
    if (!Number.isFinite(cliId) || cliId <= 0) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(paginaErrorHtml('Error', 'Notificación sin cliente válido.'));
    }

    const ahora = new Date().toISOString().slice(0, 19).replace('T', ' ');

    if (accion === 'revisar') {
      await db.query(
        `UPDATE \`notificaciones\` SET \`${m.colEstado}\` = 'rechazada', \`${m.colFechaResolucion}\` = ? WHERE \`${m.pk}\` = ?`,
        [ahora, notifId]
      );
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(
        paginaListoHtml(true, '', {
          tipo: 'sync_holded',
          syncTitulo: 'Listo',
          syncMensajeHtml:
            '<p>Puedes revisar el contacto en el CRM cuando quieras. No se ha aplicado ninguna sincronización automática desde este enlace.</p>',
          fichaClienteUrl: `${APP_BASE_URL}/clientes/${cliId}`
        })
      );
    }

    const { exportCrmClienteToHolded, importCrmClienteFromHolded } = require('../lib/holded-sync');
    let syncResult =
      accion === 'crm_to_holded'
        ? await exportCrmClienteToHolded(db, cliId)
        : await importCrmClienteFromHolded(db, cliId);

    if (!syncResult.ok) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(500).send(paginaErrorHtml('Error de sincronización', syncResult.error || 'No se pudo completar.'));
    }

    await db.query(
      `UPDATE \`notificaciones\` SET \`${m.colEstado}\` = 'aprobada', \`${m.colFechaResolucion}\` = ? WHERE \`${m.pk}\` = ?`,
      [ahora, notifId]
    );

    try {
      const cr = await db.getClienteById(cliId).catch(() => null);
      const nombre = String(cr?.cli_nombre_razon_social ?? cr?.Nombre_Razon_Social ?? '').trim();
      const hid = String(cr?.cli_Id_Holded ?? cr?.cli_referencia ?? syncResult.holdedId ?? '').trim();
      const { sendHoldedSyncAppliedNotifyEmail } = require('../lib/mailer');
      const betacourt = String(process.env.HOLDED_SYNC_BETACOURT_EMAIL || 'c.betacourt@gemavip.com').trim();
      if (betacourt) {
        await sendHoldedSyncAppliedNotifyEmail(betacourt, {
          accion,
          cliId,
          clienteNombre: nombre,
          holdedId: hid
        }).catch((e) => console.warn('[APROBACION-SYNC] email betacourt:', e?.message));
      }
    } catch (e) {
      console.warn('[APROBACION-SYNC] post-sync notify:', e?.message);
    }

    const msgOk =
      accion === 'crm_to_holded'
        ? '<p>Los datos del CRM se han enviado a Holded y el hash de sincronización está alineado.</p>'
        : '<p>Los datos de Holded se han aplicado al CRM y el hash de sincronización está alineado.</p>';

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(
      paginaListoHtml(true, '', {
        tipo: 'sync_holded',
        syncTitulo: 'Sincronización aplicada',
        syncMensajeHtml: msgOk,
        fichaClienteUrl: `${APP_BASE_URL}/clientes/${cliId}`
      })
    );
  } catch (e) {
    console.error('[APROBACION-SYNC] Error:', e?.message);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(paginaErrorHtml('Error', 'No se pudo procesar la solicitud.'));
  }
});

module.exports = router;
