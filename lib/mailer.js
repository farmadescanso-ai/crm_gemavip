/**
 * Envío de emails (recuperación de contraseña, etc.).
 * Si no hay SMTP configurado, no se envía pero no se revela al usuario (anti-phishing).
 */

const nodemailer = require('nodemailer');
const db = require('../config/mysql-crm');
const axios = require('axios');

const APP_BASE_URL = process.env.APP_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

// ===========================
// Config resolvers (BD -> .env)
// ===========================
async function resolveSmtpConfig() {
  // Preferir variables del sistema (BD). Fallback a .env.
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'];
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
  const port = Number(portRaw || 587) || 587;
  const secureRaw = String(fromDb.SMTP_SECURE || process.env.SMTP_SECURE || '').trim().toLowerCase();
  const secure = secureRaw === '1' || secureRaw === 'true' || secureRaw === 'yes';
  const user = String(fromDb.SMTP_USER || process.env.SMTP_USER || '').trim();
  const pass = String(fromDb.SMTP_PASS || process.env.SMTP_PASS || '').trim();
  const from = String(fromDb.MAIL_FROM || process.env.MAIL_FROM || user || 'noreply@crm-gemavip.local').trim();

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
    hasPass: Boolean(pass)
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

async function sendMailViaGraph(to, { subject, text, html, attachments } = {}) {
  const { cfg, accessToken, error } = await getGraphAccessToken();
  if (!accessToken) return { sent: false, error: error || 'Graph no configurado' };

  const toAddr = String(to || '').trim();
  if (!toAddr) return { sent: false, error: 'Destinatario vacío' };

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
    console.error('[MAILER] Error enviando email:', err?.message, '| Código:', err?.code);
    return { sent: false, error: err?.message };
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

  const graphStatus = await resolveGraphConfig().catch(() => ({ configured: false }));
  if (graphStatus && graphStatus.configured) {
    const r = await sendMailViaGraph(to, { subject, text, html, attachments });
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
    await transporter.sendMail({ from: cfg.from, to, subject, text: text || undefined, html: html || undefined, attachments });
    console.log('[MAILER] Email de pedido enviado a', to);
    return { sent: true };
  } catch (err) {
    console.error('[MAILER] Error enviando email de pedido:', err?.message, '| Código:', err?.code);
    return { sent: false, error: err?.message };
  }
}

module.exports = {
  hasSmtpConfig,
  getSmtpStatus,
  getGraphStatus,
  sendPasswordResetEmail,
  sendPedidoEspecialDecisionEmail,
  sendPedidoEmail,
  APP_BASE_URL
};
