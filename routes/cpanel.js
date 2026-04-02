/**
 * CPanel: herramientas exclusivas usuario id=1.
 */
'use strict';

const express = require('express');
const db = require('../config/mysql-crm');
const { requireUserId1 } = require('../lib/auth');
const {
  previewHoldedClientesEs,
  importHoldedClientesEs,
  importHoldedSinCifComoLeads,
  exportCrmClienteToHolded,
  parseSelectedTagsInput,
  MOTIVO_OMITIDO_SIN_CIF_HOLDED
} = require('../lib/sync-holded-clientes');

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
    return list.filter((r) => r.estadoBase === 'importable' && r.crmVinculado === true);
  }
  if (vista === 'pendientes_importar') {
    return list.filter((r) => r.estadoBase === 'importable' && r.crmVinculado === false);
  }
  if (vista === 'errores') {
    // Con tag elegida pero no importables: ver motivo (sin CIF, provincia ES, etc.)
    return list.filter((r) => r.coincideTag === true && r.estadoBase === 'omitido');
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
      tagScope: result.tagScope || { mode: 'filter', effectiveTagsDisplay: [] },
      selectedTags,
      vistaPreview: vista,
      previewRows,
      success,
      error,
      motivoSinCifHolded: MOTIVO_OMITIDO_SIN_CIF_HOLDED
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

router.post('/cpanel/holded-clientes/export-crm', requireUserId1, async (req, res, next) => {
  try {
    const holdedId = String(req.body?.holdedId || '').trim();
    const selectedTags = tagsFromBody(req.body);
    const vista = parseVistaPreview(req.body || {});
    if (!holdedId) {
      return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: 'Falta ID Holded', vista }));
    }
    const rows = await db.query(
      'SELECT cli_id FROM clientes WHERE cli_referencia = ? OR cli_Id_Holded = ? LIMIT 1',
      [holdedId, holdedId]
    );
    const cliId = rows?.[0]?.cli_id != null ? Number(rows[0].cli_id) : null;
    if (!cliId || !Number.isFinite(cliId)) {
      return res.redirect(
        buildHoldedClientesRedirect(selectedTags, { error: 'No hay cliente CRM vinculado a ese ID Holded', vista })
      );
    }
    const result = await exportCrmClienteToHolded(db, cliId);
    if (result.ok) {
      return res.redirect(
        buildHoldedClientesRedirect(selectedTags, { success: `Datos del CRM enviados a Holded (${holdedId}).`, vista })
      );
    }
    return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: result.error || 'Error al exportar', vista }));
  } catch (e) {
    const selectedTags = tagsFromBody(req.body || {});
    const vista = parseVistaPreview(req.body || {});
    return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: e?.message || 'Error', vista }));
  }
});

router.post('/cpanel/holded-clientes/alta-leads-sin-cif', requireUserId1, async (req, res, next) => {
  try {
    const selectedTags = tagsFromBody(req.body);
    const vista = parseVistaPreview(req.body || {});
    const result = await importHoldedSinCifComoLeads(db, { selectedTags });
    if (result.ok) {
      let msg = `Alta como Lead: ${result.inserted} creado(s).`;
      if (Number(result.skipped) > 0) msg += ` Omitidos (ya existían en CRM): ${result.skipped}.`;
      if (Number(result.errors) > 0) {
        msg += ` Errores: ${result.errors}.`;
        if (result.errorFirst) msg += ` Primer error: ${String(result.errorFirst).slice(0, 240)}`;
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
