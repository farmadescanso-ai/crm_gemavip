/**
 * CPanel: herramientas exclusivas usuario id=1.
 */
'use strict';

const express = require('express');
const db = require('../config/mysql-crm');
const { requireUserId1 } = require('../lib/auth');
const { previewHoldedClientesEs, importHoldedClientesEs } = require('../lib/sync-holded-clientes');

const router = express.Router();

router.get('/cpanel', requireUserId1, (req, res, next) => {
  try {
    res.render('cpanel', { title: 'CPanel' });
  } catch (e) {
    next(e);
  }
});

router.get('/cpanel/holded-clientes', requireUserId1, async (req, res, next) => {
  try {
    const result = await previewHoldedClientesEs(db);
    const success = typeof req.query.success === 'string' ? req.query.success : null;
    const error = typeof req.query.error === 'string' ? req.query.error : (result.error || null);
    res.render('cpanel-holded-clientes', {
      title: 'Importar clientes Holded (España)',
      ...result,
      success,
      error
    });
  } catch (e) {
    next(e);
  }
});

router.post('/cpanel/holded-clientes/import', requireUserId1, async (req, res, next) => {
  try {
    const dryRun = String(req.body?.dryRun || '').trim() === '1';
    const result = await importHoldedClientesEs(db, { dryRun });
    if (result.ok) {
      const msg = dryRun
        ? `Simulación: se importarían ${result.inserted} contacto(s).`
        : `Nuevos: ${result.inserted}. Actualizados: ${result.updated}. Errores: ${result.errors}.`;
      return res.redirect('/cpanel/holded-clientes?success=' + encodeURIComponent(msg));
    }
    return res.redirect('/cpanel/holded-clientes?error=' + encodeURIComponent(result.error || 'Error'));
  } catch (e) {
    return res.redirect('/cpanel/holded-clientes?error=' + encodeURIComponent(e?.message || 'Error'));
  }
});

module.exports = router;
