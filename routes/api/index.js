const express = require('express');

const router = express.Router();

/**
 * @openapi
 * /api:
 *   get:
 *     tags:
 *       - Meta
 *     summary: Raíz de la API
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/', (_req, res) => {
  res.json({ ok: true, service: 'crm_gemavip', api: true });
});

router.use('/comerciales', require('./comerciales'));
router.use('/clientes', require('./clientes'));
router.use('/db', require('./db'));
router.use('/notificaciones', require('./notificaciones'));
router.use('/pedidos', require('./pedidos'));
router.use('/visitas', require('./visitas'));

module.exports = router;

