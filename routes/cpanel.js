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
  addCrmTagHoldedToContactsSinAlcanceTags,
  exportCrmClienteToHolded,
  parseSelectedTagsInput,
  MOTIVO_OMITIDO_SIN_CIF_HOLDED
} = require('../lib/sync-holded-clientes');

const router = express.Router();
const ExcelJS = require('exceljs');

function parseHoldedTagsFromCellText(tagsHoldedText) {
  if (tagsHoldedText == null) return [];
  const s = String(tagsHoldedText).trim();
  if (s === '' || s === '—') return [];
  return s.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
}

function hasAnyHoldedTagDisplay(tagsHoldedText) {
  return parseHoldedTagsFromCellText(tagsHoldedText).length > 0;
}

/**
 * Tags del alcance (crm + SYNC_HOLDED_DEFAULT_TAGS, OR) que el contacto aún no tiene en Holded.
 * @param {string} tagsHoldedText
 * @param {{ effectiveTagsDisplay?: string[] }} tagScope
 */
function missingScopeTagsForExcel(tagsHoldedText, tagScope) {
  const have = new Set(parseHoldedTagsFromCellText(tagsHoldedText).map((t) => t.toLowerCase()));
  const display = Array.isArray(tagScope?.effectiveTagsDisplay) ? tagScope.effectiveTagsDisplay : [];
  const out = [];
  for (const req of display) {
    const k = String(req).toLowerCase().trim();
    if (k && !have.has(k)) out.push(String(req).trim());
  }
  return out.join(', ');
}

/**
 * Excel: contactos client/lead sin ninguna tag del alcance (crm, sepa, etc. según env).
 * No incluye filas sin ninguna etiqueta en Holded (— o vacío).
 * @param {object[]} previewRows
 * @param {{ effectiveTagsDisplay?: string[] }} [tagScope]
 */
async function buildHoldedSinTagFiltroExcelBuffer(previewRows, tagScope = {}) {
  const rows = (Array.isArray(previewRows) ? previewRows : []).filter((r) => {
    if (r.coincideTag !== false) return false;
    const txt = r.tagsHoldedText != null ? String(r.tagsHoldedText) : String(r.tags || '');
    return hasAnyHoldedTagDisplay(txt);
  });
  const alcanceTxt = Array.isArray(tagScope.effectiveTagsDisplay)
    ? tagScope.effectiveTagsDisplay.join(', ')
    : 'crm';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM Gemavip';
  const ws = wb.addWorksheet('Sin tag filtro', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'ID Holded', key: 'holdedId', width: 30 },
    { header: 'Nombre', key: 'nombre', width: 38 },
    { header: 'CIF/NIF (code)', key: 'cif', width: 14 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Teléfonos', key: 'tel', width: 22 },
    { header: 'Provincia Holded', key: 'provinciaHolded', width: 22 },
    { header: 'Tags actuales en Holded', key: 'tagsHoldedText', width: 40 },
    { header: 'Alcance CRM (OR)', key: 'alcance', width: 36 },
    { header: 'Faltan añadir (del alcance)', key: 'faltan', width: 44 },
    { header: '¿Ya en CRM?', key: 'yaCrm', width: 12 },
    { header: 'Motivo / notas', key: 'motivo', width: 48 }
  ];
  const hr = ws.getRow(1);
  hr.font = { bold: true };
  hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
  for (const r of rows) {
    const txt = r.tagsHoldedText != null ? String(r.tagsHoldedText) : String(r.tags || '');
    ws.addRow({
      holdedId: r.holdedId || '',
      nombre: r.nombre || '',
      cif: r.cif || '',
      email: r.email || '',
      tel: [r.telefono, r.movil].filter(Boolean).join(' / ') || '',
      provinciaHolded: r.provinciaHolded || '',
      tagsHoldedText: txt,
      alcance: alcanceTxt,
      faltan: missingScopeTagsForExcel(txt, tagScope),
      yaCrm: r.crmYaExisteEnCrm ? 'Sí' : 'No',
      motivo: r.motivo || ''
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Tag `crm` siempre incluida en filtro y formularios. */
function ensureCrmInTags(tags) {
  const base = Array.isArray(tags) ? tags.map((x) => String(x).trim()).filter(Boolean) : [];
  const set = new Set(base.map((t) => t.toLowerCase()));
  set.add('crm');
  return [...set];
}

function tagsFromQuery(query) {
  const raw = query.tags;
  let out = [];
  if (raw == null || raw === '') out = [];
  else if (Array.isArray(raw)) out = raw.map((x) => String(x).trim()).filter(Boolean);
  else out = parseSelectedTagsInput(raw);
  return ensureCrmInTags(out);
}

function tagsFromBody(body) {
  const raw = body?.tags;
  let out = [];
  if (raw == null || raw === '') out = [];
  else if (Array.isArray(raw)) out = raw.map((x) => String(x).trim()).filter(Boolean);
  else out = parseSelectedTagsInput(raw);
  return ensureCrmInTags(out);
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
  if (raw === '') return 'importados';
  return 'todos';
}

function filterPreviewRows(rows, vista) {
  const list = Array.isArray(rows) ? rows : [];
  if (vista === 'importables') {
    return list.filter((r) => r.estado === 'importable' || r.estado === 'pte_importar');
  }
  if (vista === 'omitidos') {
    // Ya vinculados en CRM: no son «omitidos» operativos (misma lógica que errores).
    return list.filter((r) => r.estadoBase === 'omitido' && r.crmYaExisteEnCrm !== true);
  }
  if (vista === 'importados') {
    return list.filter((r) => r.estadoBase === 'importable' && r.crmVinculado === true);
  }
  if (vista === 'pendientes_importar') {
    return list.filter((r) => r.estadoBase === 'importable' && r.crmVinculado === false);
  }
  if (vista === 'errores') {
    // Con tag elegida pero no importables: ver motivo (sin CIF, provincia ES, etc.).
    // No listar contactos ya vinculados en CRM (mismo ID Holded): ya importados.
    return list.filter(
      (r) => r.coincideTag === true && r.estadoBase === 'omitido' && r.crmYaExisteEnCrm !== true
    );
  }
  return list;
}

function buildHoldedClientesRedirect(tags, extra) {
  const params = new URLSearchParams();
  (Array.isArray(tags) ? tags : []).forEach((t) => {
    if (t != null && String(t).trim() !== '') params.append('tags', String(t).trim());
  });
  if (extra?.vista && extra.vista !== 'todos') params.set('vista', extra.vista);
  if (extra?.segment && String(extra.segment).trim() !== '') params.set('segment', String(extra.segment).trim());
  if (extra?.alcance && String(extra.alcance).trim() !== '') params.set('alcance', String(extra.alcance).trim());
  if (extra?.success) params.set('success', extra.success);
  if (extra?.error) params.set('error', extra.error);
  const q = params.toString();
  return q ? `/cpanel/holded-clientes?${q}` : '/cpanel/holded-clientes';
}

/** Filtro opcional al hacer clic en una tarjeta KPI (listado acotado). */
function parseSegmentQuery(query) {
  const raw = String(query?.segment ?? '').trim().toLowerCase();
  const allowed = new Set([
    'con_tag',
    'importables',
    'omit_sin_tag',
    'omit_sin_cif',
    'omit_sin_prov',
    'sync_al_dia',
    'sync_pte_import',
    'sync_pte_export',
    'sync_desinc',
    'importados_vista',
    'pendientes_alta'
  ]);
  return allowed.has(raw) ? raw : '';
}

function applySegmentFilter(rows, segment) {
  if (!segment) return Array.isArray(rows) ? rows : [];
  const list = Array.isArray(rows) ? rows : [];
  const MOT = MOTIVO_OMITIDO_SIN_CIF_HOLDED;
  const omitSinCrm = (r) => r.estadoBase === 'omitido' && r.crmYaExisteEnCrm !== true;
  switch (segment) {
    case 'con_tag':
      return list.filter((r) => r.coincideTag === true);
    case 'importables':
      return list.filter((r) => r.estadoBase === 'importable');
    case 'omit_sin_tag':
      return list.filter((r) => omitSinCrm(r) && r.coincideTag === false);
    case 'omit_sin_cif':
      return list.filter((r) => omitSinCrm(r) && r.motivo === MOT);
    case 'omit_sin_prov':
      return list.filter(
        (r) => omitSinCrm(r) && String(r.motivo || '').toLowerCase().includes('provincia no mapeada')
      );
    case 'sync_al_dia':
      return list.filter((r) => r.estadoBase === 'importable' && r.estado === 'importado');
    case 'sync_pte_import':
      return list.filter((r) => r.estadoBase === 'importable' && r.estado === 'pte_importar');
    case 'sync_pte_export':
      return list.filter((r) => r.estadoBase === 'importable' && r.estado === 'pte_exportar');
    case 'sync_desinc':
      return list.filter((r) => r.estadoBase === 'importable' && r.estado === 'desincronizado');
    case 'importados_vista':
      return list.filter((r) => r.estadoBase === 'importable' && r.crmVinculado === true);
    case 'pendientes_alta':
      return list.filter((r) => r.estadoBase === 'importable' && r.crmVinculado === false);
    default:
      return list;
  }
}

function extraFromHoldedBody(body) {
  return {
    vista: parseVistaPreview(body || {}),
    segment: parseSegmentQuery(body || {}),
    alcance: String(body?.alcance ?? '').trim()
  };
}

router.get('/cpanel', requireUserId1, (req, res, next) => {
  try {
    res.render('cpanel', { title: 'CPanel' });
  } catch (e) {
    next(e);
  }
});

router.get('/cpanel/holded-clientes/sin-tag-filtro.xlsx', requireUserId1, async (req, res, next) => {
  try {
    const selectedTags = tagsFromQuery(req.query);
    const result = await previewHoldedClientesEs(db, { selectedTags, holdedListScope: 'all_cliente_lead' });
    if (!result.ok) {
      return res.redirect(
        buildHoldedClientesRedirect(selectedTags, { error: result.error || 'No se pudo cargar datos de Holded' })
      );
    }
    const buf = await buildHoldedSinTagFiltroExcelBuffer(result.rows, result.tagScope || {});
    const filename = `holded-sin-tag-filtro-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

router.get('/cpanel/holded-clientes', requireUserId1, async (req, res, next) => {
  try {
    const selectedTags = tagsFromQuery(req.query);
    const vista = parseVistaPreview(req.query);
    const segment = parseSegmentQuery(req.query);
    const alcanceRaw = String(req.query?.alcance ?? '').trim().toLowerCase();
    const holdedListScope =
      alcanceRaw === 'completo' || alcanceRaw === 'todos_holded' ? 'all_cliente_lead' : 'crm_only';
    const result = await previewHoldedClientesEs(db, { selectedTags, holdedListScope });
    const success = typeof req.query.success === 'string' ? req.query.success : null;
    const error = typeof req.query.error === 'string' ? req.query.error : (result.error || null);
    let previewRows = filterPreviewRows(result.rows, vista);
    previewRows = applySegmentFilter(previewRows, segment);
    res.render('cpanel-holded-clientes', {
      title: 'Importar clientes Holded (España)',
      ...result,
      tagScope: result.tagScope || { mode: 'filter', effectiveTagsDisplay: [] },
      selectedTags,
      vistaPreview: vista,
      segment,
      alcanceHolded: holdedListScope === 'all_cliente_lead' ? 'completo' : 'crm',
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
    const { vista, segment, alcance } = extraFromHoldedBody(req.body);
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
      return res.redirect(buildHoldedClientesRedirect(selectedTags, { success: msg, vista, segment, alcance }));
    }
    return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: result.error || 'Error', vista, segment, alcance }));
  } catch (e) {
    const selectedTags = tagsFromBody(req.body || {});
    const { vista, segment, alcance } = extraFromHoldedBody(req.body);
    return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: e?.message || 'Error', vista, segment, alcance }));
  }
});

router.post('/cpanel/holded-clientes/export-crm', requireUserId1, async (req, res, next) => {
  try {
    const holdedId = String(req.body?.holdedId || '').trim();
    const selectedTags = tagsFromBody(req.body);
    const { vista, segment, alcance } = extraFromHoldedBody(req.body);
    if (!holdedId) {
      return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: 'Falta ID Holded', vista, segment, alcance }));
    }
    const rows = await db.query(
      'SELECT cli_id FROM clientes WHERE cli_referencia = ? OR cli_Id_Holded = ? LIMIT 1',
      [holdedId, holdedId]
    );
    const cliId = rows?.[0]?.cli_id != null ? Number(rows[0].cli_id) : null;
    if (!cliId || !Number.isFinite(cliId)) {
      return res.redirect(
        buildHoldedClientesRedirect(selectedTags, { error: 'No hay cliente CRM vinculado a ese ID Holded', vista, segment, alcance })
      );
    }
    const result = await exportCrmClienteToHolded(db, cliId);
    if (result.ok) {
      return res.redirect(
        buildHoldedClientesRedirect(selectedTags, { success: `Datos del CRM enviados a Holded (${holdedId}).`, vista, segment, alcance })
      );
    }
    return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: result.error || 'Error al exportar', vista, segment, alcance }));
  } catch (e) {
    const selectedTags = tagsFromBody(req.body || {});
    const { vista, segment, alcance } = extraFromHoldedBody(req.body);
    return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: e?.message || 'Error', vista, segment, alcance }));
  }
});

router.post('/cpanel/holded-clientes/alta-leads-sin-cif', requireUserId1, async (req, res, next) => {
  try {
    const selectedTags = tagsFromBody(req.body);
    const { vista, segment, alcance } = extraFromHoldedBody(req.body);
    const result = await importHoldedSinCifComoLeads(db, { selectedTags });
    if (result.ok) {
      let msg = `Alta como Lead: ${result.inserted} creado(s).`;
      if (Number(result.skipped) > 0) msg += ` Omitidos (ya existían en CRM): ${result.skipped}.`;
      if (Number(result.errors) > 0) {
        msg += ` Errores: ${result.errors}.`;
        if (result.errorFirst) msg += ` Primer error: ${String(result.errorFirst).slice(0, 240)}`;
      }
      return res.redirect(buildHoldedClientesRedirect(selectedTags, { success: msg, vista, segment, alcance }));
    }
    return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: result.error || 'Error', vista, segment, alcance }));
  } catch (e) {
    const selectedTags = tagsFromBody(req.body || {});
    const { vista, segment, alcance } = extraFromHoldedBody(req.body);
    return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: e?.message || 'Error', vista, segment, alcance }));
  }
});

router.post('/cpanel/holded-clientes/ajustar-tags-crm-holded', requireUserId1, async (req, res, next) => {
  try {
    const selectedTags = tagsFromBody(req.body);
    const { vista, segment, alcance } = extraFromHoldedBody(req.body);
    const result = await addCrmTagHoldedToContactsSinAlcanceTags(db, { selectedTags });
    if (result.ok) {
      let msg = `Tag crm en Holded: ${result.tagged} contacto(s) actualizado(s).`;
      if (Number(result.targets) > 0 && result.tagged < result.targets) {
        msg += ` Objetivo: ${result.targets}.`;
      }
      if (Number(result.skipped) > 0) msg += ` Sin ID: ${result.skipped}.`;
      if (Number(result.errors) > 0) {
        msg += ` Errores API: ${result.errors}.`;
        if (result.errorFirst) msg += ` Primer error: ${String(result.errorFirst).slice(0, 240)}`;
      }
      return res.redirect(buildHoldedClientesRedirect(selectedTags, { success: msg, vista, segment, alcance }));
    }
    return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: result.error || 'Error', vista, segment, alcance }));
  } catch (e) {
    const selectedTags = tagsFromBody(req.body || {});
    const { vista, segment, alcance } = extraFromHoldedBody(req.body);
    return res.redirect(buildHoldedClientesRedirect(selectedTags, { error: e?.message || 'Error', vista, segment, alcance }));
  }
});

module.exports = router;
