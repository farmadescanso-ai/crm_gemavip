/**
 * Web Push: notificaciones en el navegador.
 * Usa VAPID keys de env (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY).
 * Si no están configuradas, no envía push (no bloquea el flujo).
 */
'use strict';

const webpush = require('web-push');
const db = require('../config/mysql-crm');

let vapidConfigured = false;

function getVapidKeys() {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (publicKey && privateKey) {
    return { publicKey, privateKey };
  }
  return null;
}

function ensureVapid() {
  if (vapidConfigured) return true;
  const keys = getVapidKeys();
  if (!keys) return false;
  try {
    webpush.setVapidDetails(
      'mailto:soporte@gemavip.com',
      keys.publicKey,
      keys.privateKey
    );
    vapidConfigured = true;
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Envía push a admins (fire-and-forget, no bloquea).
 * @param {Object} payload - { title, body, url }
 */
async function sendPushToAdmins(payload) {
  if (!ensureVapid()) return;
  try {
    const subs = await db.getAdminPushSubscriptions().catch(() => []);
    if (!subs.length) return;
    const p = {
      title: payload.title || 'CRM Gemavip',
      body: payload.body || '',
      url: payload.url || '/notificaciones'
    };
    const payloadStr = JSON.stringify(p);
    await Promise.allSettled(
      subs.map((s) => {
        const sub = typeof s.subscription === 'string' ? JSON.parse(s.subscription) : s.subscription;
        return webpush.sendNotification(sub, payloadStr);
      })
    );
  } catch (_) {
    // Silencioso: no romper el flujo
  }
}

module.exports = {
  getVapidKeys,
  ensureVapid,
  sendPushToAdmins
};
