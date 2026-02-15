/**
 * Envío de emails (recuperación de contraseña, etc.).
 * Si no hay SMTP configurado, no se envía pero no se revela al usuario (anti-phishing).
 */

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@crm-gemavip.local';
const APP_BASE_URL = process.env.APP_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

function hasSmtpConfig() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

/** Para diagnóstico en logs (no expone valores sensibles) */
function getSmtpStatus() {
  return {
    configured: hasSmtpConfig(),
    hasHost: Boolean(SMTP_HOST),
    hasUser: Boolean(SMTP_USER),
    hasPass: Boolean(SMTP_PASS),
    port: SMTP_PORT,
    secure: SMTP_SECURE
  };
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

  if (!hasSmtpConfig()) {
    const status = getSmtpStatus();
    console.warn('[MAILER] SMTP no configurado. Estado:', JSON.stringify(status), '| Enlace (solo logs):', resetLink);
    return { sent: false };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    await transporter.sendMail({
      from: MAIL_FROM,
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

  if (!hasSmtpConfig()) {
    const status = getSmtpStatus();
    console.warn('[MAILER] SMTP no configurado (pedido especial). Estado:', JSON.stringify(status), '| Para:', to, '| Pedido:', pedidoNum || '(sin num)');
    return { sent: false };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    await transporter.sendMail({
      from: MAIL_FROM,
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

module.exports = {
  hasSmtpConfig,
  getSmtpStatus,
  sendPasswordResetEmail,
  sendPedidoEspecialDecisionEmail,
  APP_BASE_URL
};
