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

function parseVistaPreview(query) {
  const raw = String(query?.vista ?? '').trim().toLowerCase();
  const allowed = new Set([
    'todos',
    'importables',
    'omitidos',
    'importados',
    'pendientes_importar',
    'errores'
  ]);
  if (allowed.has(raw)) return raw;
  return 'todos';
}

function filterPreviewRows(rows, vista) {
  const list = Array.isArray(rows) ? rows : [];
  if (vista === 'importables') {
    return list.filter((r) => r.estado === 'importable' || r.estado === 'pte_importar');
  }
  if (vista === 'omitidos') {
    return list.filter((r) => r.estadoBase === 'omitido');
  }
  if (vista === 'importados') {
    return list.filter((r) => r.estado === 'importado');
  }
  if (vista === 'pendientes_importar') {
    return list.filter((r) => r.estado === 'importable' || r.estado === 'pte_importar');
  }
  if (vista === 'errores') {
    return list.filter((r) => r.estado === 'desincronizado' || r.estado === 'pte_exportar');
  }
  return list;
}

function buildHoldedClientesRedirect(tags, extra) {
  const params = new URLSearchParams();
  (Array.isArray(tags) ? tags : []).forEach((t) => {
    if (t != null && String(t).trim() !== '') params.append('tags', String(t).trim());
  });
  if (extra?.vista && extra.vista !== 'todos') params.set('vista', extra.vista);
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
    const vista = parseVistaPreview(req.query);
    const result = await previewHoldedClientesEs(db, { selectedTags });
    const success = typeof req.query.success === 'string' ? req.query.success : null;
    const error = typeof req.query.error === 'string' ? req.query.error : (result.error || null);
    const previewRows = filterPreviewRows(result.rows, vista);
    res.render('cpanel-holded-clientes', {
      title: 'Importar clientes Holded (España)',
      ...result,
      selectedTags,
      vistaPreview: vista,
      previewRows,
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
    const vista = parseVistaPreview(req.body || {});
    const result = await importHoldedClientesEs(db, { dryRun, selectedTags });
    if (result.ok) {
      let msg = dryRun
        ? `Simulación: se importarían ${result.inserted} contacto(s).`
        : `Nuevos: ${result.inserted}. Actualizados: ${result.updated}. Errores CRM: ${result.errors}.`;
      if (!dryRun && Number(result.holdedTagErrors) > 0) {
        msg += ` Avisos tag crm en Holded: ${result.holdedTagErrors}.`;
      }
      if (!dryRun && Number(result.errors) > 0 && result.errorFirst) {
        const hint = String(result.errorFirst).slice(0, 280);
        msg += ` Primer error: ${hint}`;
      }
      return res.redirect(buildHoldedClientesRedirect(selectedTags, { success: msg, vista }));
    }
    return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: result.error || 'Error', vista }));
  } catch (e) {
    const selectedTags = tagsFromBody(req.body || {});
    const vista = parseVistaPreview(req.body || {});
    return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: e?.message || 'Error', vista }));
  }
});

module.exports = router;
