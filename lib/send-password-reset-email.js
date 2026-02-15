/**
 * Envío de email para recuperación de contraseña.
 * Requiere: SMTP_HOST, SMTP_USER, SMTP_PASS (o equivalente). Si no están configurados, no envía y devuelve false.
 * Opcional: MAIL_FROM (remitente), APP_URL (base para enlaces).
 */

const nodemailer = require('nodemailer');

function getAppUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'https://crm-gemavip.vercel.app';
}
const APP_URL = getAppUrl();

function getTransporter() {
  const host = process.env.SMTP_HOST || process.env.MAIL_HOST;
  const port = Number(process.env.SMTP_PORT || process.env.MAIL_PORT || 587);
  const user = process.env.SMTP_USER || process.env.MAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.MAIL_PASS;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

/**
 * Envía email con enlace para restablecer contraseña.
 * @param {string} toEmail - Destinatario
 * @param {string} resetLink - URL completa del enlace (restablecer-contrasena?token=xxx)
 * @param {string} [userName] - Nombre del comercial (opcional, para personalizar)
 * @returns {Promise<boolean>} true si se envió, false si no hay SMTP o falló
 */
async function sendPasswordResetEmail(toEmail, resetLink, userName) {
  const transport = getTransporter();
  if (!transport) return false;
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@crm-gemavip.local';
  const subject = 'Restablecer contraseña · CRM Gemavip';
  const text = [
    userName ? `Hola ${userName},` : 'Hola,',
    '',
    'Has solicitado restablecer tu contraseña en el CRM Gemavip.',
    'Tu usuario de acceso es tu email: ' + toEmail,
    '',
    'Para elegir una nueva contraseña, abre este enlace (válido 1 hora):',
    resetLink,
    '',
    'Si no has solicitado este cambio, ignora este mensaje. El enlace caducará solo.',
    '',
    '— CRM Gemavip'
  ].join('\n');
  const html = [
    '<p>' + (userName ? `Hola ${userName},` : 'Hola,') + '</p>',
    '<p>Has solicitado restablecer tu contraseña en el <strong>CRM Gemavip</strong>.</p>',
    '<p>Tu usuario de acceso es tu <strong>email</strong>: ' + escapeHtml(toEmail) + '</p>',
    '<p>Para elegir una nueva contraseña, haz clic en el enlace siguiente (válido 1 hora):</p>',
    '<p><a href="' + escapeHtml(resetLink) + '" style="background:#008bd2;color:#fff;padding:10px 16px;text-decoration:none;border-radius:8px;">Restablecer contraseña</a></p>',
    '<p>Si no has solicitado este cambio, ignora este mensaje. El enlace caducará solo.</p>',
    '<p>— CRM Gemavip</p>'
  ].join('');
  try {
    await transport.sendMail({
      from,
      to: toEmail,
      subject,
      text,
      html
    });
    return true;
  } catch (err) {
    console.error('❌ Error enviando email de recuperación:', err?.message);
    return false;
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  sendPasswordResetEmail,
  getAppUrl,
  APP_URL
};
