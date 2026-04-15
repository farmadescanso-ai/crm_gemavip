/**
 * Rutas para la landing de Ventas Gemavip.
 * Subida de PDFs de ventas y dashboard con gráficas.
 * Los PDFs se guardan en disco; los datos se persisten en ventas_hefame (BD).
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const { requireLogin } = require('../lib/auth');
const { requireAdmin } = require('../lib/app-helpers');
const { parseVentasPdf } = require('../lib/ventas-pdf-parser');
const { savePdf, getCache, saveCache, listSavedPdfs, readSavedPdf, removePdf } = require('../lib/ventas-storage');
const { insertOrUpdateVentasMulti, getVentasFiltradas, getCatalogos, clearAllVentas } = require('../lib/ventas-hefame-db');
const { shouldRejectCsrf, sendCsrfInvalidResponse } = require('../lib/csrf');

const router = express.Router();

// Multer en memoria (max 15MB por archivo, hasta 5 archivos)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    if (ext !== '.pdf') return cb(new Error('Solo se permiten archivos PDF'));
    const mime = String(file.mimetype || '').toLowerCase();
    const mimeOk =
      mime === 'application/pdf' ||
      mime === 'application/x-pdf' ||
      (mime === 'application/octet-stream' && ext === '.pdf');
    if (!mimeOk) return cb(new Error('El archivo no tiene tipo MIME de PDF (application/pdf)'));
    cb(null, true);
  }
});

function buildDashboardData(merged) {
  const byMaterial = {};
  const byProvincia = {};
  const byMes = {};
  const byMaterialMes = {};
  const byProvinciaMes = {};

  for (const v of merged.ventas) {
    const matKey = v.materialCodigo;
    const provKey = v.provinciaCodigo;
    const mesKey = v.mesKey;

    byMaterial[matKey] = (byMaterial[matKey] || 0) + v.cantidad;
    byProvincia[provKey] = (byProvincia[provKey] || 0) + v.cantidad;
    byMes[mesKey] = (byMes[mesKey] || 0) + v.cantidad;

    const mmKey = `${matKey}|${mesKey}`;
    byMaterialMes[mmKey] = (byMaterialMes[mmKey] || 0) + v.cantidad;

    if (!byProvinciaMes[provKey]) byProvinciaMes[provKey] = {};
    byProvinciaMes[provKey][mesKey] = (byProvinciaMes[provKey][mesKey] || 0) + v.cantidad;
  }

  const topMateriales = merged.materiales
    .map((m) => ({ ...m, total: byMaterial[m.codigo] || 0 }))
    .sort((a, b) => (b.total || 0) - (a.total || 0))
    .slice(0, 15);

  const topProvincias = merged.provincias
    .map((p) => ({ ...p, total: byProvincia[p.codigo] || 0 }))
    .sort((a, b) => (b.total || 0) - (a.total || 0))
    .slice(0, 12);

  const evolucionMeses = merged.meses.map((m) => ({
    mes: m,
    total: byMes[m] || 0
  }));

  const evolucionMaterialMes = merged.meses.map((mesKey) => {
    const row = { mes: mesKey };
    for (const m of topMateriales.slice(0, 8)) {
      row[m.codigo] = byMaterialMes[`${m.codigo}|${mesKey}`] || 0;
    }
    return row;
  });

  const topProvinciasEvol = merged.provincias
    .map((p) => ({ ...p, total: byProvincia[p.codigo] || 0 }))
    .sort((a, b) => (b.total || 0) - (a.total || 0))
    .slice(0, 10);

  const evolucionProvinciaMes = topProvinciasEvol.map((p) => ({
    codigo: p.codigo,
    nombre: p.nombre,
    totales: merged.meses.map((m) => byProvinciaMes[p.codigo]?.[m] || 0)
  }));

  const años = [...new Set(merged.ventas.map((v) => v.año).filter(Boolean))].sort((a, b) => b - a);

  const mesesOrdenados = [...merged.meses].sort((a, b) => {
    const [ma, aa] = a.split('.').map(Number);
    const [mb, ab] = b.split('.').map(Number);
    return aa !== ab ? aa - ab : ma - mb;
  });
  const ultimoMes = mesesOrdenados[mesesOrdenados.length - 1];
  const penultimoMes = mesesOrdenados[mesesOrdenados.length - 2];
  const comparacionMes = ultimoMes && penultimoMes
    ? {
        mesActual: ultimoMes,
        mesAnterior: penultimoMes,
        totalActual: byMes[ultimoMes] || 0,
        totalAnterior: byMes[penultimoMes] || 0,
        variacion: byMes[penultimoMes]
          ? (((byMes[ultimoMes] || 0) - (byMes[penultimoMes] || 0)) / byMes[penultimoMes] * 100).toFixed(1)
          : null
      }
    : null;

  const comparacionAnioAnterior = (() => {
    if (años.length < 2) return null;
    const anioActual = Math.max(...años);
    const anioAnt = años.find((a) => a < anioActual) || anioActual - 1;
    const mesesComunes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      .map((m) => ({
        mes: String(m).padStart(2, '0'),
        mesKeyActual: `${String(m).padStart(2, '0')}.${anioActual}`,
        mesKeyAnt: `${String(m).padStart(2, '0')}.${anioAnt}`,
        totalActual: byMes[`${String(m).padStart(2, '0')}.${anioActual}`] || 0,
        totalAnterior: byMes[`${String(m).padStart(2, '0')}.${anioAnt}`] || 0
      }))
      .filter((r) => r.totalActual > 0 || r.totalAnterior > 0);
    const totalActual = mesesComunes.reduce((s, r) => s + r.totalActual, 0);
    const totalAnterior = mesesComunes.reduce((s, r) => s + r.totalAnterior, 0);
    return {
      anioActual,
      anioAnterior: anioAnt,
      mesesComunes,
      totalActual,
      totalAnterior,
      variacionPct: totalAnterior ? (((totalActual - totalAnterior) / totalAnterior) * 100).toFixed(1) : null
    };
  })();

  return {
    ventas: merged.ventas,
    materiales: merged.materiales,
    provincias: merged.provincias,
    meses: merged.meses,
    files: merged.files,
    totalUnidades: merged.ventas.reduce((s, v) => s + (v.cantidad || 0), 0),
    byMaterial,
    byProvincia,
    byMes,
    topMateriales,
    topProvincias,
    evolucionMeses,
    evolucionMaterialMes,
    evolucionProvinciaMes,
    materialLabels: topMateriales.slice(0, 8).map((m) => m.descripcion?.slice(0, 25) || m.codigo),
    años,
    comparacionMes,
    comparacionAnioAnterior,
    byMes
  };
}

// GET /ventas-gemavip - Redirige a subir
router.get('/ventas-gemavip', requireLogin, (req, res) => {
  res.redirect(302, '/ventas-gemavip/subir');
});

// GET /ventas-gemavip/subir - Página para subir PDFs (formulario tradicional, sin JS)
router.get('/ventas-gemavip/subir', requireLogin, async (req, res, next) => {
  try {
    const uploadSuccess = req.query.upload === 'ok' ? 'PDFs subidos y guardados correctamente.' : null;
    const uploadError = req.query.error ? decodeURIComponent(req.query.error) : null;
    res.render('ventas-gemavip-subir', {
      title: 'Subir PDFs - Ventas Gemavip',
      headerVariant: 'ventas',
      extraStyles: ['/assets/styles/ventas-gemavip.css'],
      uploadSuccess,
      uploadError
    });
  } catch (e) {
    next(e);
  }
});

// GET /ventas-gemavip/informes - Dashboard con gráficos (datos desde BD)
router.get('/ventas-gemavip/informes', requireLogin, async (req, res, next) => {
  try {
    const anio = req.query.anio ? Number(req.query.anio) : null;
    const mes = req.query.mes ? Number(req.query.mes) : null;
    const provincia = (req.query.provincia || '').trim() || null;
    const articulo = (req.query.articulo || '').trim() || null;

    const filtros = {};
    if (anio) filtros.anio = anio;
    if (mes) filtros.mes = mes;
    if (provincia) filtros.provinciaCodigo = provincia;
    if (articulo) filtros.materialCodigo = articulo;

    let initialData = null;
    let catalogos = { años: [], meses: [], provincias: [], materiales: [] };
    try {
      const merged = await getVentasFiltradas(filtros);
      if (merged.ventas.length > 0 || merged.files.length > 0) {
        initialData = buildDashboardData(merged);
      }
      catalogos = await getCatalogos();
    } catch (dbErr) {
      const cache = await getCache();
      if (cache?.parsed) {
        initialData = buildDashboardData(cache.parsed);
        catalogos = {
          años: initialData.años || [],
          meses: [...new Set(initialData.ventas?.map((v) => v.mes).filter(Boolean))].sort((a, b) => a - b),
          provincias: initialData.provincias || [],
          materiales: initialData.materiales || []
        };
      }
    }

    const savedFiles = (await listSavedPdfs()).map((f) => (typeof f === 'object' && f.name ? f.name : f)).filter(Boolean);
    const cache = await getCache();
    const fileNames = (cache?.files?.length ? cache.files : savedFiles).map((f) => (typeof f === 'string' ? f : (f && f.name)) || '').filter(Boolean);
    const hasData = !!(initialData || (fileNames && fileNames.length > 0));
    const uploadSuccess = req.query.upload === 'ok';

    res.render('ventas-gemavip-informes', {
      title: 'Informes - Ventas Gemavip',
      headerVariant: 'ventas',
      extraStyles: ['/assets/styles/ventas-gemavip.css'],
      initialData,
      catalogos,
      savedFiles: fileNames,
      hasData,
      uploadSuccess,
      queryParams: { anio, mes, provincia, articulo, view: req.query.view || 'evolucion-mes' }
    });
  } catch (e) {
    next(e);
  }
});

// GET /ventas-gemavip/api/data - Obtener datos desde BD con filtros (anio, mes, provincia, articulo)
router.get('/ventas-gemavip/api/data', requireLogin, async (req, res, next) => {
  try {
    const anio = req.query.anio ? Number(req.query.anio) : null;
    const mes = req.query.mes ? Number(req.query.mes) : null;
    const provincia = (req.query.provincia || '').trim() || null;
    const articulo = (req.query.articulo || '').trim() || null;

    const filtros = {};
    if (anio) filtros.anio = anio;
    if (mes) filtros.mes = mes;
    if (provincia) filtros.provinciaCodigo = provincia;
    if (articulo) filtros.materialCodigo = articulo;

    const merged = await getVentasFiltradas(filtros);
    if (merged.ventas.length === 0 && merged.files.length === 0) {
      return res.json({ ok: true, data: null });
    }
    return res.json({
      ok: true,
      data: buildDashboardData(merged),
      catalogos: await getCatalogos()
    });
  } catch (e) {
    next(e);
  }
});

// POST /ventas-gemavip/upload - Subir y procesar PDFs (guarda en disco)
router.post('/ventas-gemavip/upload', requireLogin, (req, res, next) => {
  upload.array('pdfs', 5)(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Archivo demasiado grande (máx. 15 MB)' : (err.message || 'Error al subir');
      return res.status(400).json({ ok: false, error: msg });
    }
    next();
  });
}, async (req, res, next) => {
  try {
    if (shouldRejectCsrf(req)) {
      return sendCsrfInvalidResponse(req, res);
    }
    const files = req.files || [];
    const wantsRedirect = req.body && req.body.redirect === '1';

    if (files.length === 0) {
      if (wantsRedirect) {
        return res.redirect(302, '/ventas-gemavip/subir?error=' + encodeURIComponent('No se han subido archivos PDF. Selecciona al menos uno.'));
      }
      return res.status(400).json({
        ok: false,
        error: 'No se han subido archivos PDF. Selecciona al menos uno.'
      });
    }

    const results = [];
    const savedNames = [];

    for (const f of files) {
      try {
        try {
          const r = await savePdf(f.buffer, f.originalname);
          if (r?.savedAs) savedNames.push(r.savedAs);
        } catch (_) { /* disco puede fallar en Vercel; continuamos con BD */ }
        const data = await parseVentasPdf(f.buffer, f.originalname);
        results.push(data);
      } catch (err) {
        results.push({
          filename: f.originalname,
          ventas: [],
          materiales: [],
          provincias: [],
          meses: [],
          errores: [err?.message || 'Error al procesar PDF']
        });
      }
    }

    // Insertar en BD (INSERT IGNORE; lotes de hasta 200 filas por query)
    const batches = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const origen = r.filename || savedNames[i] || files[i]?.originalname;
      if (r.ventas?.length) batches.push({ ventas: r.ventas, origen });
    }
    await insertOrUpdateVentasMulti(batches);

    // Actualizar caché de nombres de archivos (para lista PDFs guardados)
    const cache = await getCache();
    const mergedFiles = [...(cache?.files || []), ...savedNames];
    await saveCache({ files: mergedFiles, parsed: null, lastUpdated: new Date().toISOString() });

    // Obtener datos desde BD (ya incluye todo lo insertado)
    const merged = await getVentasFiltradas({});
    merged.files = mergedFiles;
    const data = buildDashboardData(merged);

    const debug = data.ventas.length === 0 && results.length > 0
      ? { rawTextSample: results.find((r) => r.rawTextSample)?.rawTextSample }
      : undefined;

    if (req.body && req.body.redirect === '1') {
      if (data.ventas.length === 0 && results.length > 0 && debug?.rawTextSample) {
        return res.redirect(302, '/ventas-gemavip/subir?error=' + encodeURIComponent('No se extrajeron ventas del PDF. Verifica el formato.'));
      }
      return res.redirect(302, '/ventas-gemavip/informes?upload=ok');
    }

    return res.json({
      ok: true,
      data,
      debug
    });
  } catch (e) {
    if (req.body && req.body.redirect === '1') {
      return res.redirect(302, '/ventas-gemavip/subir?error=' + encodeURIComponent(e.message || 'Error al procesar'));
    }
    next(e);
  }
});

// POST /ventas-gemavip/reprocess - Reprocesar todos los PDFs guardados e insertar en BD
router.post('/ventas-gemavip/reprocess', requireAdmin, async (req, res, next) => {
  try {
    const cache = await getCache();
    const files = cache?.files?.length ? cache.files : (await listSavedPdfs()).map((f) => f.name);

    if (files.length === 0) {
      return res.json({ ok: true, data: null, message: 'No hay PDFs guardados' });
    }

    const results = [];
    for (const savedAs of files) {
      try {
        const buffer = await readSavedPdf(savedAs);
        const originalName = savedAs.replace(/_\w{12}\.pdf$/, '.pdf');
        const data = await parseVentasPdf(buffer, originalName);
        results.push(data);
      } catch (err) {
        results.push({
          filename: savedAs,
          ventas: [],
          errores: [err?.message || 'Error']
        });
      }
    }

    const batches = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const origen = r.filename || files[i];
      if (r.ventas?.length) batches.push({ ventas: r.ventas, origen });
    }
    await insertOrUpdateVentasMulti(batches);

    await saveCache({ files, parsed: null, lastUpdated: new Date().toISOString() });

    const fromDb = await getVentasFiltradas({});
    fromDb.files = files;
    return res.json({
      ok: true,
      data: buildDashboardData(fromDb)
    });
  } catch (e) {
    next(e);
  }
});

// POST /ventas-gemavip/clear - Vaciar todos los datos de ventas_hefame, caché y PDFs en disco
router.post('/ventas-gemavip/clear', requireAdmin, async (req, res, next) => {
  try {
    await clearAllVentas();
    await saveCache({ files: [], parsed: null, lastUpdated: new Date().toISOString() });
    const pdfs = await listSavedPdfs();
    for (const f of pdfs) {
      try {
        await removePdf(typeof f === 'object' ? f.name : f);
      } catch (_) {}
    }
    return res.json({ ok: true, message: 'Datos de ventas eliminados' });
  } catch (e) {
    next(e);
  }
});

// DELETE /ventas-gemavip/api/file/:name - Eliminar un PDF guardado (solo disco; datos en BD se mantienen)
router.delete('/ventas-gemavip/api/file/:name', requireAdmin, async (req, res, next) => {
  try {
    const name = decodeURIComponent(req.params.name || '');
    if (!name || !name.endsWith('.pdf')) {
      return res.status(400).json({ ok: false, error: 'Nombre inválido' });
    }

    const cache = await getCache();
    const files = (cache?.files || []).filter((f) => f !== name);
    await removePdf(name);

    await saveCache({ files, parsed: null, lastUpdated: new Date().toISOString() });

    if (files.length === 0) {
      return res.json({ ok: true, data: null });
    }

    const merged = await getVentasFiltradas({});
    merged.files = files;
    return res.json({
      ok: true,
      data: buildDashboardData(merged)
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
