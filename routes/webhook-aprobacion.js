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

/**
 * Página HTML mínima que cierra la ventana si se abrió como popup.
 */
function paginaListoHtml() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Listo</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f8f8; color: #1f2a44; }
    .box { padding: 24px; text-align: center; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { font-size: 13px; color: #5b667a; margin: 0; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Listo</h1>
    <p>Esta ventana se puede cerrar.</p>
  </div>
  <script>
    try { if (window.opener) window.close(); } catch(e) {}
  </script>
</body>
</html>`;
}

router.get('/aprobar-asignacion', async (req, res) => {
  try {
    const notifId = Number(req.query.notifId);
    const approvedRaw = req.query.approved;
    const sig = String(req.query.sig || '').trim();

    if (!Number.isFinite(notifId) || notifId <= 0) {
      res.status(400).send('<h1>Enlace inválido</h1><p>Faltan parámetros.</p>');
      return;
    }

    const approved = approvedRaw === '1' || approvedRaw === 'true' || approvedRaw === true;
    const expectedSig = computeSig(notifId, approved);
    if (sig !== expectedSig) {
      res.status(400).send('<h1>Enlace inválido</h1><p>Firma incorrecta.</p>');
      return;
    }

    const result = await db.resolverSolicitudAsignacion(notifId, null, approved);
    if (!result?.ok) {
      res.status(404).send('<h1>Acción no válida</h1><p>' + (result?.message || 'La solicitud ya fue resuelta.') + '</p>');
      return;
    }

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

      if (comercialEmail) {
        await sendAsignacionResultadoEmail(comercialEmail, {
          aprobado: approved,
          clienteNombre: clienteNombre || 'Cliente',
          clienteId: contactoId
        }).catch((e) => console.warn('[APROBACION] Error enviando email:', e?.message));
      }
    } else if (result.tipo === 'pedido_especial') {
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
    res.send(paginaListoHtml());
  } catch (e) {
    console.error('[APROBACION] Error:', e?.message);
    res.status(500).send('<h1>Error</h1><p>No se pudo procesar la solicitud.</p>');
  }
});

module.exports = router;
