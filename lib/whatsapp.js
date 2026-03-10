/**
 * Envío de notificaciones por WhatsApp vía Twilio.
 * Si no hay credenciales configuradas, no envía (no bloquea el flujo).
 * Variables: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, NOTIFY_WHATSAPP_TO
 * (o equivalentes en variables_sistema).
 */
'use strict';

const db = require('../config/mysql-crm');

const KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'NOTIFY_WHATSAPP_TO'];

async function resolveWhatsAppConfig() {
  let vals = [];
  try {
    vals = await Promise.all(KEYS.map((k) => db.getVariableSistema?.(k).catch(() => null)));
  } catch (_) {
    vals = [];
  }
  const fromDb = {};
  KEYS.forEach((k, i) => {
    const v = vals?.[i];
    if (v !== null && v !== undefined && String(v).trim() !== '') fromDb[k] = String(v).trim();
  });

  const accountSid = fromDb.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID || '';
  const authToken = fromDb.TWILIO_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN || '';
  const from = String(fromDb.TWILIO_WHATSAPP_FROM || process.env.TWILIO_WHATSAPP_FROM || '').trim();
  const to = String(fromDb.NOTIFY_WHATSAPP_TO || process.env.NOTIFY_WHATSAPP_TO || '').trim();

  const configured = Boolean(accountSid && authToken && from && to);
  return {
    accountSid,
    authToken,
    from: from.startsWith('whatsapp:') ? from : (from ? `whatsapp:${from}` : ''),
    to: to.startsWith('whatsapp:') ? to : (to ? `whatsapp:${to.replace(/^\+/, '')}` : ''),
    configured
  };
}

/**
 * Envía un mensaje de WhatsApp al destinatario configurado (NOTIFY_WHATSAPP_TO).
 * @param {string} message - Texto del mensaje
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
async function sendWhatsAppNotification(message) {
  const cfg = await resolveWhatsAppConfig();
  if (!cfg.configured) {
    const missing = [];
    if (!cfg.accountSid) missing.push('TWILIO_ACCOUNT_SID');
    if (!cfg.authToken) missing.push('TWILIO_AUTH_TOKEN');
    if (!cfg.from) missing.push('TWILIO_WHATSAPP_FROM');
    if (!cfg.to) missing.push('NOTIFY_WHATSAPP_TO');
    console.warn('[WHATSAPP] No configurado. Faltan:', missing.join(', ') || 'credenciales');
    return { sent: false, error: `Faltan: ${missing.join(', ')}` };
  }

  try {
    const twilio = require('twilio');
    const client = twilio(cfg.accountSid, cfg.authToken);

    await client.messages.create({
      body: String(message || '').trim() || 'Nueva notificación · CRM Gemavip',
      from: cfg.from,
      to: cfg.to
    });

    console.log('[WHATSAPP] Mensaje enviado a', cfg.to);
    return { sent: true };
  } catch (err) {
    const msg = err?.message || 'Error desconocido';
    console.warn('[WHATSAPP] Error enviando:', msg);
    return { sent: false, error: msg };
  }
}

module.exports = {
  resolveWhatsAppConfig,
  sendWhatsAppNotification
};
