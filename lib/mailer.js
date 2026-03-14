/**
 * Envío de emails (recuperación de contraseña, etc.).
 * Si no hay SMTP configurado, no se envía pero no se revela al usuario (anti-phishing).
 */

const nodemailer = require('nodemailer');
const db = require('../config/mysql-crm');
const axios = require('axios');
const { escapeHtml } = require('./utils');

const APP_BASE_URL = process.env.APP_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

// ===========================
// Config resolvers (BD -> .env)
// ===========================
async function resolveSmtpConfig() {
  // Preferir variables del sistema (BD). Fallback a .env.
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'SMTP_FROM'];
  let vals = [];
  try {
    vals = await Promise.all(keys.map((k) => db.getVariableSistema?.(k).catch(() => null)));
  } catch (_) {
    vals = [];
  }
  const fromDb = {};
  keys.forEach((k, i) => {
    const v = vals?.[i];
    if (v !== null && v !== undefined && String(v).trim() !== '') fromDb[k] = String(v);
  });

  const host = String(fromDb.SMTP_HOST || process.env.SMTP_HOST || '').trim();
  const portRaw = String(fromDb.SMTP_PORT || process.env.SMTP_PORT || '').trim();
  let port = Number(portRaw || 587) || 587;
  // Office 365/Outlook: puerto 443 no es válido para SMTP; usar 587 (STARTTLS)
  if (port === 443 && /office365|outlook\.office/i.test(host)) {
    port = 587;
  }
  const secureRaw = String(fromDb.SMTP_SECURE || process.env.SMTP_SECURE || '').trim().toLowerCase();
  let secure = secureRaw === '1' || secureRaw === 'true' || secureRaw === 'yes';
  // Puerto 587 usa STARTTLS (secure: false). SSL directo (secure: true) solo en puerto 465.
  if (port === 587) secure = false;
  const user = String(fromDb.SMTP_USER || process.env.SMTP_USER || '').trim();
  const pass = String(fromDb.SMTP_PASS || process.env.SMTP_PASS || '').trim();
  const from = String(
    fromDb.MAIL_FROM || process.env.MAIL_FROM || fromDb.SMTP_FROM || process.env.SMTP_FROM || user || 'noreply@crm-gemavip.local'
  ).trim();

  const fromDbHost = Boolean(fromDb.SMTP_HOST);
  const fromDbUser = Boolean(fromDb.SMTP_USER);
  const fromDbPass = Boolean(fromDb.SMTP_PASS);
  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
    configured: Boolean(host && user && pass),
    hasHost: Boolean(host),
    hasUser: Boolean(user),
    hasPass: Boolean(pass),
    source: { host: fromDbHost ? 'bd' : 'env', user: fromDbUser ? 'bd' : 'env', pass: fromDbPass ? 'bd' : 'env' }
  };
}

async function resolveGraphConfig() {
  // Microsoft Graph (client credentials)
  const keys = ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'GRAPH_SENDER_UPN'];
  let vals = [];
  try {
    vals = await Promise.all(keys.map((k) => db.getVariableSistema?.(k).catch(() => null)));
  } catch (_) {
    vals = [];
  }
  const fromDb = {};
  keys.forEach((k, i) => {
    const v = vals?.[i];
    if (v !== null && v !== undefined && String(v).trim() !== '') fromDb[k] = String(v);
  });

  const tenantId = String(fromDb.GRAPH_TENANT_ID || process.env.GRAPH_TENANT_ID || '').trim();
  const clientId = String(fromDb.GRAPH_CLIENT_ID || process.env.GRAPH_CLIENT_ID || '').trim();
  const clientSecret = String(fromDb.GRAPH_CLIENT_SECRET || process.env.GRAPH_CLIENT_SECRET || '').trim();
  const senderUpn = String(fromDb.GRAPH_SENDER_UPN || process.env.GRAPH_SENDER_UPN || '').trim();

  const configured = Boolean(tenantId && clientId && clientSecret && senderUpn);
  return {
    tenantId,
    clientId,
    clientSecret,
    senderUpn,
    configured,
    hasTenant: Boolean(tenantId),
    hasClientId: Boolean(clientId),
    hasSecret: Boolean(clientSecret),
    hasSender: Boolean(senderUpn)
  };
}

/** Para diagnóstico en logs (no expone valores sensibles) */
async function getSmtpStatus() {
  const cfg = await resolveSmtpConfig();
  return { configured: cfg.configured, hasHost: cfg.hasHost, hasUser: cfg.hasUser, hasPass: cfg.hasPass, port: cfg.port, secure: cfg.secure };
}

async function getGraphStatus() {
  const cfg = await resolveGraphConfig();
  return {
    configured: cfg.configured,
    hasTenant: cfg.hasTenant,
    hasClientId: cfg.hasClientId,
    hasSecret: cfg.hasSecret,
    hasSender: cfg.hasSender
  };
}

async function createTransporterFromConfig() {
  const cfg = await resolveSmtpConfig();
  if (!cfg.configured) return { cfg, transporter: null };
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass }
  });
  return { cfg, transporter };
}

// ===========================
// Microsoft Graph sender (OAuth2)
// ===========================
const graphTokenCache = { accessToken: null, expiresAtMs: 0 };

async function getGraphAccessToken() {
  const cfg = await resolveGraphConfig();
  if (!cfg.configured) return { cfg, accessToken: null, error: 'Microsoft Graph no configurado' };

  const now = Date.now();
  if (graphTokenCache.accessToken && graphTokenCache.expiresAtMs && now < graphTokenCache.expiresAtMs - 60_000) {
    return { cfg, accessToken: graphTokenCache.accessToken, error: null };
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams();
  body.set('client_id', cfg.clientId);
  body.set('client_secret', cfg.clientSecret);
  body.set('grant_type', 'client_credentials');
  body.set('scope', 'https://graph.microsoft.com/.default');

  try {
    const resp = await axios.post(tokenUrl, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
      validateStatus: () => true
    });
    if (resp.status < 200 || resp.status >= 300) {
      const msg = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data || {});
      return { cfg, accessToken: null, error: `Token Graph HTTP ${resp.status}: ${msg}` };
    }
    const token = String(resp.data?.access_token || '');
    const expiresIn = Number(resp.data?.expires_in || 0) || 0;
    if (!token) return { cfg, accessToken: null, error: 'Token Graph vacío' };
    graphTokenCache.accessToken = token;
    graphTokenCache.expiresAtMs = Date.now() + Math.max(60, expiresIn) * 1000;
    return { cfg, accessToken: token, error: null };
  } catch (e) {
    return { cfg, accessToken: null, error: e?.message || 'Error obteniendo token Graph' };
  }
}

async function sendMailViaGraph(to, { subject, text, html, attachments, cc } = {}) {
  const { cfg, accessToken, error } = await getGraphAccessToken();
  if (!accessToken) return { sent: false, error: error || 'Graph no configurado' };

  const toAddr = String(to || '').trim();
  if (!toAddr) return { sent: false, error: 'Destinatario vacío' };

  const ccAddrs = Array.isArray(cc) ? cc.filter((a) => a && String(a).trim()) : (cc ? [String(cc).trim()].filter(Boolean) : []);

  const atts = Array.isArray(attachments) ? attachments : [];
  // Graph simple attachments: límite práctico ~3MB por attachment (dependiendo del endpoint).
  for (const a of atts) {
    const buf = a?.content;
    if (Buffer.isBuffer(buf) && buf.length > 3 * 1024 * 1024) {
      return { sent: false, error: 'Adjunto demasiado grande para Graph (usa adjuntos grandes / upload session)' };
    }
  }

  const contentType = html ? 'HTML' : 'Text';
  const content = html ? String(html) : String(text || '');

  const graphAttachments = atts
    .filter((a) => a && a.content && (Buffer.isBuffer(a.content) || typeof a.content === 'string'))
    .map((a) => {
      const buf = Buffer.isBuffer(a.content) ? a.content : Buffer.from(String(a.content), 'utf-8');
      return {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: String(a.filename || a.name || 'adjunto.bin'),
        contentType: String(a.contentType || 'application/octet-stream'),
        contentBytes: buf.toString('base64')
      };
    });

  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.senderUpn)}/sendMail`;
  const payload = {
    message: {
      subject: String(subject || ''),
      body: { contentType, content },
      toRecipients: [{ emailAddress: { address: toAddr } }],
      ccRecipients: ccAddrs.map((a) => ({ emailAddress: { address: a } })),
      attachments: graphAttachments
    },
    saveToSentItems: true
  };

  try {
    const resp = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: 30000,
      maxBodyLength: Infinity,
      validateStatus: () => true
    });
    // Graph suele responder 202 Accepted
    if (resp.status < 200 || resp.status >= 300) {
      const msg = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data || {});
      return { sent: false, error: `Graph HTTP ${resp.status}: ${msg}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e?.message || 'Error enviando por Graph' };
  }
}

// Compat: para llamadas antiguas (solo .env). Preferir resolveSmtpConfig() en envíos.
function hasSmtpConfig() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * Envía email de recuperación de contraseña.
 * @param {string} to - Email del destinatario
 * @param {string} resetLink - URL completa para restablecer (con token)
 * @param {string} nombre - Nombre del comercial (opcional)
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
async function sendPasswordResetEmail(to, resetLink, nombre = '') {
  const subject = 'Restablecer contraseña · CRM Gemavip';
  const text = `Hola${nombre ? ' ' + nombre : ''},\n\nHas solicitado restablecer tu contraseña en el CRM Gemavip.\n\nHaz clic en el siguiente enlace (válido 1 hora):\n${resetLink}\n\nSi no has solicitado este cambio, ignora este correo. Tu contraseña no se modificará.\n\nEste enlace es de un solo uso.\n\n— CRM Gemavip`;

  // Preferir Graph si está configurado, si no SMTP.
  const graphStatus = await resolveGraphConfig().catch(() => ({ configured: false }));
  if (graphStatus && graphStatus.configured) {
    const r = await sendMailViaGraph(to, { subject, text });
    if (r.sent) return { sent: true };
    // fallback a SMTP si Graph falla
    console.warn('[MAILER] Graph falló (password reset), intentando SMTP:', r.error);
  }

  const { cfg, transporter } = await createTransporterFromConfig();
  if (!transporter) {
    const status = { configured: cfg.configured, hasHost: cfg.hasHost, hasUser: cfg.hasUser, hasPass: cfg.hasPass, port: cfg.port, secure: cfg.secure };
    console.warn('[MAILER] SMTP no configurado. Estado:', JSON.stringify(status), '| Enlace (solo logs):', resetLink);
    return { sent: false };
  }

  try {
    await transporter.sendMail({ from: cfg.from, to, subject, text });
    console.log('[MAILER] Email de recuperación enviado a', to);
    return { sent: true };
  } catch (err) {
    const errDetail = err?.response || err?.responseCode || err?.code || '';
    const errFull = [err?.message, errDetail].filter(Boolean).join(' | ');
    console.error('[MAILER] Error enviando email:', errFull);
    return { sent: false, error: err?.message, errorCode: err?.code, errorResponse: err?.response };
  }
}

/**
 * Envía un email de prueba (solo para diagnóstico). Devuelve el error completo si falla.
 * @param {string} to - Email destino
 * @returns {Promise<{ sent: boolean, error?: string, errorCode?: string, errorResponse?: string, config?: object }>}
 */
async function sendTestEmail(to) {
  const { cfg, transporter } = await createTransporterFromConfig();
  if (!transporter) {
    return {
      sent: false,
      error: 'SMTP no configurado. Revisa SMTP_HOST, SMTP_USER, SMTP_PASS en Vercel o Admin → Configuración Email.',
      config: { hasHost: cfg.hasHost, hasUser: cfg.hasUser, hasPass: cfg.hasPass, port: cfg.port, source: cfg.source }
    };
  }
  try {
    await transporter.sendMail({
      from: cfg.from,
      to,
      subject: 'Test CRM Gemavip',
      text: 'Email de prueba. Si recibes esto, el SMTP está funcionando correctamente.'
    });
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      error: err?.message || 'Error desconocido',
      errorCode: err?.code,
      errorResponse: typeof err?.response === 'string' ? err.response : (err?.response ? String(err.response).slice(0, 300) : undefined),
      config: { host: cfg.host, port: cfg.port, from: cfg.from, source: cfg.source }
    };
  }
}

/**
 * Email al comercial cuando el admin aprueba/rechaza un pedido especial.
 * @param {string} to
 * @param {{ decision: 'aprobado'|'rechazado', pedidoNum?: string, clienteNombre?: string, pedidoUrl?: string }} data
 */
async function sendPedidoEspecialDecisionEmail(to, data = {}) {
  const decision = String(data.decision || '').toLowerCase() === 'aprobado' ? 'aprobado' : 'rechazado';
  const pedidoNum = String(data.pedidoNum || '').trim();
  const clienteNombre = String(data.clienteNombre || '').trim();
  const pedidoUrl = String(data.pedidoUrl || '').trim();

  const subject = `Pedido especial ${decision.toUpperCase()} · CRM Gemavip`;
  const header = `Tu pedido especial ha sido ${decision.toUpperCase()}.`;
  const detalle = [
    pedidoNum ? `Pedido: ${pedidoNum}` : null,
    clienteNombre ? `Cliente: ${clienteNombre}` : null
  ].filter(Boolean).join('\n');
  const link = pedidoUrl ? `\n\nVer pedido:\n${pedidoUrl}` : '';
  const text = `${header}\n\n${detalle || ''}${link}\n\n— CRM Gemavip`;

  const graphStatus = await resolveGraphConfig().catch(() => ({ configured: false }));
  if (graphStatus && graphStatus.configured) {
    const r = await sendMailViaGraph(to, { subject, text });
    if (r.sent) return { sent: true };
    console.warn('[MAILER] Graph falló (pedido especial), intentando SMTP:', r.error);
  }

  const { cfg, transporter } = await createTransporterFromConfig();
  if (!transporter) {
    const status = { configured: cfg.configured, hasHost: cfg.hasHost, hasUser: cfg.hasUser, hasPass: cfg.hasPass, port: cfg.port, secure: cfg.secure };
    console.warn('[MAILER] SMTP no configurado (pedido especial). Estado:', JSON.stringify(status), '| Para:', to, '| Pedido:', pedidoNum || '(sin num)');
    return { sent: false };
  }

  try {
    await transporter.sendMail({ from: cfg.from, to, subject, text });
    console.log('[MAILER] Email decisión pedido especial enviado a', to);
    return { sent: true };
  } catch (err) {
    console.error('[MAILER] Error enviando email pedido especial:', err?.message, '| Código:', err?.code);
    return { sent: false, error: err?.message };
  }
}

/**
 * Email de pedido a un destinatario (con Excel adjunto).
 * @param {string} to
 * @param {{ subject: string, text: string, html: string, attachments?: any[] }} opts
 */
async function sendPedidoEmail(to, opts = {}) {
  const subject = String(opts.subject || '').trim() || 'Pedido · CRM Gemavip';
  const text = String(opts.text || '').trim();
  const html = String(opts.html || '').trim();
  const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
  const cc = opts.cc;

  const graphStatus = await resolveGraphConfig().catch(() => ({ configured: false }));
  if (graphStatus && graphStatus.configured) {
    const r = await sendMailViaGraph(to, { subject, text, html, attachments, cc });
    if (r.sent) return { sent: true };
    console.warn('[MAILER] Graph falló (pedido), intentando SMTP:', r.error);
  }

  const { cfg, transporter } = await createTransporterFromConfig();
  if (!transporter) {
    const status = { configured: cfg.configured, hasHost: cfg.hasHost, hasUser: cfg.hasUser, hasPass: cfg.hasPass, port: cfg.port, secure: cfg.secure };
    console.warn('[MAILER] SMTP no configurado (pedido). Estado:', JSON.stringify(status), '| Para:', to, '| Asunto:', subject);
    return { sent: false, error: 'SMTP no configurado (SMTP_HOST/SMTP_USER/SMTP_PASS)' };
  }

  try {
    const mailOpts = { from: cfg.from, to, subject, text: text || undefined, html: html || undefined, attachments };
    if (cc) mailOpts.cc = Array.isArray(cc) ? cc : [cc];
    await transporter.sendMail(mailOpts);
    console.log('[MAILER] Email de pedido enviado a', to);
    return { sent: true };
  } catch (err) {
    console.error('[MAILER] Error enviando email de pedido:', err?.message, '| Código:', err?.code);
    return { sent: false, error: err?.message };
  }
}

/**
 * Envía email con Excel Transfer adjunto a p.lara@gemavip.com con copia a info@farmadescanso.com.
 * @param {{ item, cliente, mayoristaInfo, excelBuf, excelFilename }} data
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
async function sendTransferExcelEmail(data = {}) {
  const { item, cliente, mayoristaInfo, excelBuf, excelFilename } = data;
  const numAsociado = String(
    mayoristaInfo?.codigoAsociado ||
    item?.NumAsociadoHefame ||
    item?.num_asociado_hefame ||
    item?.numero_cooperativa ||
    item?.NumeroCooperativa ||
    ''
  ).trim() || '—';
  const subject = `Envio Pedido Transfer Asociado Número ${numAsociado}`;

  const pick = (obj, keys) => {
    if (!obj || typeof obj !== 'object') return '';
    for (const k of keys || []) {
      const v = obj[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };
  const clienteNombre = pick(cliente, ['Nombre_Razon_Social', 'cli_nombre_razon_social', 'Nombre', 'nombre']) || item?.Id_Cliente || '—';
  const numPedido = item?.NumPedido ?? item?.ped_numero ?? item?.Numero_Pedido ?? '—';
  const fecha = item?.FechaPedido ?? item?.ped_fecha ?? item?.Fecha ?? '—';
  const total = item?.TotalPedido ?? item?.ped_total ?? item?.Total ?? '—';

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Poppins, system-ui, -apple-system, Segoe UI, Arial, sans-serif; margin: 0; padding: 24px; color: #1f2a44; background: #f8f8f8; }
    .gv-email { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 14px; padding: 24px; box-shadow: 0 10px 30px rgba(12,20,58,.10); }
    .gv-email h2 { margin: 0 0 16px; font-size: 18px; color: #0c143a; }
    .gv-email .gv-row { margin: 8px 0; display: flex; gap: 12px; }
    .gv-email .gv-label { font-weight: 700; min-width: 120px; color: #5b667a; }
    .gv-email .gv-value { color: #1f2a44; }
    .gv-email .gv-footer { margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #5b667a; }
    .gv-primary { color: #008bd2; }
  </style>
</head>
<body>
  <div class="gv-email">
    <h2>Pedido Transfer · CRM Gemavip</h2>
    <div class="gv-row"><span class="gv-label">Nº Pedido:</span><span class="gv-value">${escapeHtml(String(numPedido))}</span></div>
    <div class="gv-row"><span class="gv-label">Cliente:</span><span class="gv-value">${escapeHtml(String(clienteNombre))}</span></div>
    <div class="gv-row"><span class="gv-label">Nº Asociado:</span><span class="gv-value">${escapeHtml(String(numAsociado))}</span></div>
    <div class="gv-row"><span class="gv-label">Fecha:</span><span class="gv-value">${escapeHtml(String(fecha))}</span></div>
    <div class="gv-row"><span class="gv-label">Total:</span><span class="gv-value">${escapeHtml(String(total))}</span></div>
    <div class="gv-footer">Envío automático desde CRM Gemavip. Fichero Excel adjunto.</div>
  </div>
</body>
</html>
  `.trim();

  const to = 'p.lara@gemavip.com';
  const cc = 'info@farmadescanso.com';
  const attachments = [];
  if (excelBuf && excelFilename) {
    attachments.push({
      filename: excelFilename,
      content: excelBuf,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  const graphStatus = await resolveGraphConfig().catch(() => ({ configured: false }));
  if (graphStatus && graphStatus.configured) {
    const r = await sendMailViaGraph(to, { subject, html, attachments, cc: [cc] });
    if (r.sent) return { sent: true };
    console.warn('[MAILER] Graph falló (Transfer Excel), intentando SMTP:', r.error);
  }

  const { cfg, transporter } = await createTransporterFromConfig();
  if (!transporter) {
    console.warn('[MAILER] SMTP no configurado (Transfer Excel). Para:', to);
    return { sent: false, error: 'SMTP no configurado' };
  }

  try {
    await transporter.sendMail({
      from: cfg.from,
      to,
      cc,
      subject,
      html,
      attachments
    });
    console.log('[MAILER] Email Transfer Excel enviado a', to);
    return { sent: true };
  } catch (err) {
    console.error('[MAILER] Error enviando email Transfer Excel:', err?.message);
    return { sent: false, error: err?.message };
  }
}

/**
 * Email al comercial cuando se aprueba o deniega su solicitud de asignación.
 * @param {string} to - Email del comercial
 * @param {{ aprobado: boolean, clienteNombre: string, clienteId?: number }} data
 */
async function sendAsignacionResultadoEmail(to, data = {}) {
  const aprobado = data.aprobado === true;
  const clienteNombre = String(data.clienteNombre || 'Cliente').trim();
  const clienteId = data.clienteId;
  const clienteUrl = clienteId ? `${APP_BASE_URL}/clientes/${clienteId}` : null;

  const titulo = aprobado ? '✓ Asignación aprobada' : '✗ Asignación denegada';
  const mensaje = aprobado
    ? 'Se ha aprobado tu solicitud de asignación del siguiente cliente. Ya puedes gestionarlo en el CRM.'
    : 'Se ha denegado tu solicitud de asignación del siguiente cliente.';
  const colorBorde = aprobado ? '#16a34a' : '#dc2626';

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(titulo)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Poppins, system-ui, sans-serif; background-color: #f8f8f8; color: #1f2a44; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; box-shadow: 0 10px 30px rgba(12,20,58,0.10); border: 1px solid #e5e5e5;">
    <tr>
      <td style="padding: 32px 40px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-left: 4px solid ${colorBorde}; margin-bottom: 24px;">
          <tr>
            <td style="padding-left: 16px;">
              <h1 style="margin: 0; font-size: 20px; font-weight: 600; color: #0c143a;">${escapeHtml(titulo)}</h1>
              <p style="margin: 8px 0 0 0; font-size: 14px; color: #5b667a;">CRM Gemavip</p>
            </td>
          </tr>
        </table>
        <p style="margin: 0 0 24px 0; font-size: 15px; color: #1f2a44;">${escapeHtml(mensaje)}</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e5e5e5; border-radius: 14px; margin-bottom: 24px;">
          <tr>
            <td style="padding: 20px; background: linear-gradient(135deg, rgba(143,174,27,0.08) 0%, rgba(122,208,58,0.04) 100%);">
              <h2 style="margin: 0 0 16px 0; font-size: 17px; font-weight: 600; color: #0c143a;">${escapeHtml(clienteNombre)}</h2>
              ${clienteUrl ? `<a href="${escapeHtml(clienteUrl)}" style="color: #008bd2; text-decoration: none; font-weight: 500;">Ver en el CRM →</a>` : ''}
            </td>
          </tr>
        </table>
        <p style="margin: 0; font-size: 12px; color: #5b667a;">Correo generado automáticamente por CRM Gemavip.</p>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

  return sendPedidoEmail(to, { subject: titulo, html });
}

async function sendPedidoAprobacionResultadoEmail(to, data = {}) {
  const aprobado = data.aprobado === true;
  const pedidoNum = String(data.pedidoNum || '').trim();
  const clienteNombre = String(data.clienteNombre || '').trim();
  const pedidoUrl = String(data.pedidoUrl || '').trim();

  const titulo = aprobado
    ? `✓ Pedido ${pedidoNum || ''} aprobado · CRM Gemavip`
    : `✗ Pedido ${pedidoNum || ''} denegado · CRM Gemavip`;
  const mensaje = aprobado
    ? 'Tu pedido ha sido <b>aprobado</b> por la dirección comercial.'
    : 'Tu pedido ha sido <b>denegado</b> por la dirección comercial.';
  const colorBorde = aprobado ? '#16a34a' : '#dc2626';
  const iconBg = aprobado ? '#dcfce7' : '#fee2e2';
  const icon = aprobado ? '✓' : '✗';

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0; padding:0; background:#f4f6f9; font-family:'Segoe UI',Roboto,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9; padding:32px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,0.08); overflow:hidden; border-top:4px solid ${colorBorde};">
        <tr><td style="padding:32px 28px; text-align:center;">
          <div style="width:56px;height:56px;border-radius:50%;background:${iconBg};display:inline-flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:${colorBorde};margin-bottom:16px;">${icon}</div>
          <h1 style="margin:0 0 8px;font-size:20px;color:#1f2a44;">${aprobado ? 'Pedido aprobado' : 'Pedido denegado'}</h1>
          <p style="margin:0 0 16px;font-size:14px;color:#5b667a;line-height:1.5;">${mensaje}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:20px;">
            ${pedidoNum ? `<tr><td style="padding:10px 14px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Pedido</td><td style="padding:10px 14px;font-size:13px;font-weight:700;color:#1e293b;border-bottom:1px solid #e2e8f0;">${pedidoNum}</td></tr>` : ''}
            ${clienteNombre ? `<tr><td style="padding:10px 14px;font-size:13px;color:#64748b;">Cliente</td><td style="padding:10px 14px;font-size:13px;font-weight:700;color:#1e293b;">${clienteNombre}</td></tr>` : ''}
          </table>
          ${pedidoUrl ? `<a href="${pedidoUrl}" style="display:inline-block;padding:10px 28px;background:${colorBorde};color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Ver pedido</a>` : ''}
        </td></tr>
        <tr><td style="padding:16px 28px;background:#f8fafc;text-align:center;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Correo generado automáticamente por CRM Gemavip.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`.trim();

  return sendPedidoEmail(to, { subject: titulo, html });
}

module.exports = {
  hasSmtpConfig,
  getSmtpStatus,
  getGraphStatus,
  sendPasswordResetEmail,
  sendPedidoEspecialDecisionEmail,
  sendPedidoAprobacionResultadoEmail,
  sendPedidoEmail,
  sendTransferExcelEmail,
  sendTestEmail,
  sendAsignacionResultadoEmail,
  APP_BASE_URL
};
