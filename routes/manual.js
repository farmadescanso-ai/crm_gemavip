/**
 * Ruta del manual operativo.
 */

const express = require('express');
const { requireLogin } = require('../lib/auth');

const router = express.Router();

router.get('/', requireLogin, async (_req, res) => {
  return res.render('manual', { title: 'Manual operativo' });
});

module.exports = router;
