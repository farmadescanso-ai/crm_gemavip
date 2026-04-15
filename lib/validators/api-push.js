'use strict';
const { body } = require('express-validator');

/** Suscripción Web Push (estructura típica de PushSubscriptionJSON). */
const pushSubscribeBody = [
  body('subscription').isObject().withMessage('subscription debe ser un objeto'),
  body('subscription.endpoint').optional().isString().isLength({ min: 1, max: 4096 }),
  body('subscription.keys').optional().isObject()
];

module.exports = { pushSubscribeBody };
