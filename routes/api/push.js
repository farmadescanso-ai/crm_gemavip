/**
 * API Web Push: VAPID público y suscripción
 */
const express = require('express');
const router = express.Router();
const db = require('../../config/mysql-crm');
let getVapidKeys = () => null;
try {
  const wp = require('../../lib/web-push');
  if (wp && typeof wp.getVapidKeys === 'function') getVapidKeys = wp.getVapidKeys;
} catch (_) {
  // web-push opcional
}

router.get('/vapid-public', (req, res) => {
  const keys = getVapidKeys();
  if (!keys) return res.json({ ok: false, publicKey: null });
  res.json({ ok: true, publicKey: keys.publicKey });
});

router.post('/subscribe', express.json(), async (req, res) => {
  const user = req.session?.user;
  if (!user?.id) return res.status(401).json({ ok: false, error: 'No autenticado' });
  const subscription = req.body?.subscription;
  if (!subscription || typeof subscription !== 'object') {
    return res.status(400).json({ ok: false, error: 'subscription requerido' });
  }
  const userId = Number(user.id);
  const saved = await db.savePushSubscription(userId, subscription).catch(() => false);
  res.json({ ok: !!saved });
});

module.exports = router;
