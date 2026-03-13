/**
 * Web Push: notificaciones en el navegador.
 * Usa VAPID keys de env (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY).
 * Si no están configuradas, no envía push (no bloquea el flujo).
 * Envía también los datos al webhook n8n (NOTIF_WEBHOOK_URL) si está configurado.
 */
'use strict';

const webpush = require('web-push');
const axios = require('axios');
const db = require('../config/mysql-crm');

const NOTIF_WEBHOOK_URL = (process.env.NOTIF_WEBHOOK_URL || 'https://farmadescanso-n8n.6f4r35.easypanel.host/webhook/76e48302-8d17-42fc-bb9e-37865d180728').trim();

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
 * Envía el payload al webhook n8n (fire-and-forget).
 * @param {Object} data - Datos a enviar (se serializa como JSON)
 */
async function sendToWebhook(data) {
  if (!NOTIF_WEBHOOK_URL) return;
  try {
    const res = await axios.post(NOTIF_WEBHOOK_URL, data, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
      validateStatus: () => true
    });
    if (res.status >= 400) {
      console.warn('[WEBHOOK] n8n respondió', res.status, res.statusText, '| URL:', NOTIF_WEBHOOK_URL);
    }
  } catch (err) {
    console.warn('[WEBHOOK] Error enviando a n8n:', err?.message || err, '| URL:', NOTIF_WEBHOOK_URL);
  }
}

/**
 * Envía push a admins (fire-and-forget, no bloquea).
 * Envía también todos los datos al webhook n8n.
 * @param {Object} payload - { title, body, url, ... } - Cualquier campo extra se incluye en el webhook
 */
async function sendPushToAdmins(payload) {
  const p = {
    title: payload.title || 'CRM Gemavip',
    body: payload.body || '',
    url: payload.url || '/notificaciones',
    ...payload
  };
  const pushBody = typeof p.body === 'string' ? p.body : (p.body?.body ?? '');
  const payloadStr = JSON.stringify({ title: p.title, body: pushBody, url: p.url });

  if (ensureVapid()) {
    try {
      const subs = await db.getAdminPushSubscriptions().catch(() => []);
      if (subs.length) {
        await Promise.allSettled(
          subs.map((s) => {
            const sub = typeof s.subscription === 'string' ? JSON.parse(s.subscription) : s.subscription;
            return webpush.sendNotification(sub, payloadStr);
          })
        );
      }
    } catch (_) {}
  }

  if (NOTIF_WEBHOOK_URL) {
    await sendToWebhook({
      ...p,
      timestamp: new Date().toISOString(),
      source: 'crm_gemavip'
    }).catch(() => {});
  }
}

module.exports = {
  getVapidKeys,
  ensureVapid,
  sendPushToAdmins,
  sendToWebhook
};
