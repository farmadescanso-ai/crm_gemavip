/**
 * CPanel: herramientas exclusivas usuario id=1.
 */
'use strict';

const express = require('express');
const db = require('../config/mysql-crm');
const { requireUserId1 } = require('../lib/auth');
const { previewHoldedClientesEs, importHoldedClientesEs, parseSelectedTagsInput } = require('../lib/sync-holded-clientes');

const router = express.Router();

function tagsFromQuery(query) {
  const raw = query.tags;
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  return parseSelectedTagsInput(raw);
}

function tagsFromBody(body) {
  const raw = body?.tags;
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  return parseSelectedTagsInput(raw);
}

function buildHoldedClientesRedirect(tags, extra) {
  const params = new URLSearchParams();
  (Array.isArray(tags) ? tags : []).forEach((t) => {
    if (t != null && String(t).trim() !== '') params.append('tags', String(t).trim());
  });
  if (extra?.success) params.set('success', extra.success);
  if (extra?.error) params.set('error', extra.error);
  const q = params.toString();
  return q ? `/cpanel/holded-clientes?${q}` : '/cpanel/holded-clientes';
}

router.get('/cpanel', requireUserId1, (req, res, next) => {
  try {
    res.render('cpanel', { title: 'CPanel' });
  } catch (e) {
    next(e);
  }
});

router.get('/cpanel/holded-clientes', requireUserId1, async (req, res, next) => {
  try {
    const selectedTags = tagsFromQuery(req.query);
    const result = await previewHoldedClientesEs(db, { selectedTags });
    const success = typeof req.query.success === 'string' ? req.query.success : null;
    const error = typeof req.query.error === 'string' ? req.query.error : (result.error || null);
    res.render('cpanel-holded-clientes', {
      title: 'Importar clientes Holded (España)',
      ...result,
      selectedTags,
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
    const selectedTags = tagsFromBody(req.body);
    const result = await importHoldedClientesEs(db, { dryRun, selectedTags });
    if (result.ok) {
      const msg = dryRun
        ? `Simulación: se importarían ${result.inserted} contacto(s).`
        : `Nuevos: ${result.inserted}. Actualizados: ${result.updated}. Errores: ${result.errors}.`;
      return res.redirect(buildHoldedClientesRedirect(selectedTags, { success: msg }));
    }
    return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: result.error || 'Error' }));
  } catch (e) {
    const selectedTags = tagsFromBody(req.body || {});
    return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: e?.message || 'Error' }));
  }
});

module.exports = router;
