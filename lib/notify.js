/**
 * Orquestador de notificaciones: Web Push, Email y WhatsApp.
 * Cuando llega una nueva notificación del CRM, envía por todos los canales configurados.
 * Fire-and-forget: no bloquea el flujo principal.
 */
'use strict';

const db = require('../config/mysql-crm');

let sendPushToAdmins = () => Promise.resolve();
try {
  const wp = require('./web-push');
  if (wp && typeof wp.sendPushToAdmins === 'function') sendPushToAdmins = wp.sendPushToAdmins;
} catch (_) {}

async function getNotifyEmail() {
  try {
    const v = await db.getVariableSistema?.('NOTIFY_EMAIL').catch(() => null);
    if (v && String(v).trim()) return String(v).trim();
  } catch (_) {}
  return process.env.NOTIFY_EMAIL || '';
}

/**
 * Envía la notificación por todos los canales configurados.
 * @param {{ title: string, body: string, url?: string }} payload
 */
async function notifyOnNewNotification(payload) {
  const title = String(payload?.title || 'CRM Gemavip').trim();
  const body = String(payload?.body || '').trim();
  const url = String(payload?.url || '/notificaciones').trim();
  const fullUrl = url.startsWith('http') ? url : (process.env.APP_BASE_URL || '').replace(/\/$/, '') + (url.startsWith('/') ? url : '/' + url);

  const pushPayload = { title, body, url: url.startsWith('/') ? url : '/' + url };

  const promises = [];

  // 1. Web Push (siempre, si VAPID configurado)
  promises.push(sendPushToAdmins(pushPayload).catch(() => {}));

  // 2. Email (si NOTIFY_EMAIL configurado)
  const emailTo = await getNotifyEmail();
  if (emailTo) {
    const mailer = require('./mailer');
    if (mailer.sendNotificationEmail) {
      promises.push(
        mailer.sendNotificationEmail(emailTo, { title, body, url: pushPayload.url }).catch(() => {})
      );
    }
  }

  // 3. WhatsApp (si NOTIFY_WHATSAPP_TO configurado)
  const whatsapp = require('./whatsapp');
  const waCfg = await whatsapp.resolveWhatsAppConfig().catch(() => ({ configured: false }));
  if (waCfg.configured) {
    const msg = `${title}\n\n${body}\n\n${fullUrl || 'Ver: /notificaciones'}`;
    promises.push(whatsapp.sendWhatsAppNotification(msg).catch(() => {}));
  }

  await Promise.allSettled(promises);
}

module.exports = {
  notifyOnNewNotification
};
