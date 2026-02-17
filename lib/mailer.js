/**
 * Envío de emails (recuperación de contraseña, etc.).
 * Si no hay SMTP configurado, no se envía pero no se revela al usuario (anti-phishing).
 */

const nodemailer = require('nodemailer');
const db = require('../config/mysql-crm');

const APP_BASE_URL = process.env.APP_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

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

/** Para diagnóstico en logs (no expone valores sensibles) */
async function getSmtpStatus() {
  const cfg = await resolveSmtpConfig();
  return { configured: cfg.configured, hasHost: cfg.hasHost, hasUser: cfg.hasUser, hasPass: cfg.hasPass, port: cfg.port, secure: cfg.secure };
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

  const { cfg, transporter } = await createTransporterFromConfig();
  if (!transporter) {
    const status = { configured: cfg.configured, hasHost: cfg.hasHost, hasUser: cfg.hasUser, hasPass: cfg.hasPass, port: cfg.port, secure: cfg.secure };
    console.warn('[MAILER] SMTP no configurado. Estado:', JSON.stringify(status), '| Enlace (solo logs):', resetLink);
    return { sent: false };
  }

  try {
    await transporter.sendMail({
      from: cfg.from,
      to,
      subject,
      text
    });
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

  const { cfg, transporter } = await createTransporterFromConfig();
  if (!transporter) {
    const status = { configured: cfg.configured, hasHost: cfg.hasHost, hasUser: cfg.hasUser, hasPass: cfg.hasPass, port: cfg.port, secure: cfg.secure };
    console.warn('[MAILER] SMTP no configurado (pedido especial). Estado:', JSON.stringify(status), '| Para:', to, '| Pedido:', pedidoNum || '(sin num)');
    return { sent: false };
  }

  try {
    await transporter.sendMail({
      from: cfg.from,
      to,
      subject,
      text
    });
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

  const { cfg, transporter } = await createTransporterFromConfig();
  if (!transporter) {
    const status = { configured: cfg.configured, hasHost: cfg.hasHost, hasUser: cfg.hasUser, hasPass: cfg.hasPass, port: cfg.port, secure: cfg.secure };
    console.warn('[MAILER] SMTP no configurado (pedido). Estado:', JSON.stringify(status), '| Para:', to, '| Asunto:', subject);
    return { sent: false, error: 'SMTP no configurado (SMTP_HOST/SMTP_USER/SMTP_PASS)' };
  }

  try {
    await transporter.sendMail({
      from: cfg.from,
      to,
      subject,
      text: text || undefined,
      html: html || undefined,
      attachments
    });
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
  sendPasswordResetEmail,
  sendPedidoEspecialDecisionEmail,
  sendPedidoEmail,
  APP_BASE_URL
};
