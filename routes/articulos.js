/**
 * Rutas HTML de artículos (CRUD).
 */

const express = require('express');
const db = require('../config/mysql-crm');
const { requireAdmin } = require('../lib/app-helpers');
const { requireLogin } = require('../lib/auth');
const { isAdminUser } = require('../lib/auth');
const { _n } = require('../lib/app-helpers');
const { loadMarcasForSelect } = require('../lib/articulo-helpers');

const router = express.Router();

/** Temporal: fijar Marca=Todas para todos los roles. Cambiar a false para reactivar el filtro. */
const FILTRO_MARCA_FIJO = true;

router.get('/', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const rawMarca = String(req.query.marca || req.query.brand || '').trim();
    const parsedMarca = rawMarca && /^\d+$/.test(rawMarca) ? Number(rawMarca) : NaN;
    let selectedMarcaId = Number.isFinite(parsedMarca) && parsedMarca > 0 ? parsedMarca : null;
    if (FILTRO_MARCA_FIJO) selectedMarcaId = null;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 10;
    const offset = (page - 1) * limit;
    const searchQuery = String(req.query.q || '').trim();

    const marcas = await loadMarcasForSelect(db);
    let items = [];
    let total = 0;
    let loadError = null;
    try {
      [items, total] = await Promise.all([
        db.getArticulos({ marcaId: selectedMarcaId, search: searchQuery || null, limit, offset }),
        db.countArticulos({ marcaId: selectedMarcaId, search: searchQuery || null })
      ]);
    } catch (e) {
      console.error('❌ [articulos] Error cargando artículos:', e?.message || e);
      loadError = e?.message || String(e);
    }

    const totalPages = Math.max(1, Math.ceil((total || 0) / limit));

    res.render('articulos', {
      items: items || [],
      loadError,
      admin,
      marcas: Array.isArray(marcas) ? marcas : [],
      selectedMarcaId,
      searchQuery: searchQuery || '',
      filtroMarcaFijo: FILTRO_MARCA_FIJO,
      page,
      totalPages,
      total: total ?? 0,
      limit
    });
  } catch (e) {
    next(e);
  }
});

router.get('/new', requireAdmin, async (_req, res, next) => {
  try {
    const marcas = await loadMarcasForSelect(db);
    res.render('articulo-form', {
      mode: 'create',
      marcas,
      item: { SKU: '', Codigo_Interno: '', Nombre: '', Presentacion: '', Unidades_Caja: 1, PVL: 0, IVA: 21, Imagen: '', Id_Marca: null, EAN13: '', Activo: 1 },
      error: null
    });
  } catch (e) {
    next(e);
  }
});

router.post('/new', requireAdmin, async (req, res, next) => {
  try {
    const marcas = await loadMarcasForSelect(db);
    const body = req.body || {};
    const payload = {
      SKU: String(body.SKU || '').trim(),
      Codigo_Interno: body.Codigo_Interno ? String(body.Codigo_Interno).trim() : null,
      Nombre: String(body.Nombre || '').trim(),
      Presentacion: String(body.Presentacion || '').trim(),
      Unidades_Caja: Number(body.Unidades_Caja || 0) || 0,
      Largo_Unidad: Number(body.Largo_Unidad || 0) || 0,
      Ancho_Unidad: Number(body.Ancho_Unidad || 0) || 0,
      Alto_Unidad: Number(body.Alto_Unidad || 0) || 0,
      Kg_Unidad: Number(body.Kg_Unidad || 0) || 0,
      Largo_Caja: Number(body.Largo_Caja || 0) || 0,
      Alto_Caja: Number(body.Alto_Caja || 0) || 0,
      Ancho_Caja: Number(body.Ancho_Caja || 0) || 0,
      PesoKg_Caja: Number(body.PesoKg_Caja || 0) || 0,
      Cajas_Palet: Number(body.Cajas_Palet || 0) || 0,
      PVL: Number(body.PVL || 0) || 0,
      IVA: Number(_n(body.IVA, 21)) || 0,
      Imagen: String(body.Imagen || '').trim(),
      Id_Marca: body.Id_Marca ? (Number(body.Id_Marca) || null) : null,
      EAN13: body.EAN13 ? String(body.EAN13).trim() : null,
      Activo: String(body.Activo || '1') === '1' ? 1 : 0
    };

    if (!payload.SKU || !payload.Nombre) {
      return res.status(400).render('articulo-form', { mode: 'create', marcas, item: payload, error: 'SKU y Nombre son obligatorios' });
    }

    await db.createArticulo(payload);
    return res.redirect('/articulos');
  } catch (e) {
    next(e);
  }
});

router.get('/:id/edit', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const item = await db.getArticuloById(id);
    if (!item) return res.status(404).send('No encontrado');
    const marcas = await loadMarcasForSelect(db);
    res.render('articulo-form', { mode: 'edit', marcas, item, error: null });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/edit', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const marcas = await loadMarcasForSelect(db);
    const body = req.body || {};

    const payload = {
      SKU: body.SKU !== undefined ? String(body.SKU || '').trim() : undefined,
      Codigo_Interno: body.Codigo_Interno !== undefined ? (body.Codigo_Interno ? String(body.Codigo_Interno).trim() : null) : undefined,
      Nombre: body.Nombre !== undefined ? String(body.Nombre || '').trim() : undefined,
      Presentacion: body.Presentacion !== undefined ? String(body.Presentacion || '').trim() : undefined,
      Unidades_Caja: body.Unidades_Caja !== undefined ? (Number(body.Unidades_Caja || 0) || 0) : undefined,
      Largo_Unidad: body.Largo_Unidad !== undefined ? (Number(body.Largo_Unidad || 0) || 0) : undefined,
      Ancho_Unidad: body.Ancho_Unidad !== undefined ? (Number(body.Ancho_Unidad || 0) || 0) : undefined,
      Alto_Unidad: body.Alto_Unidad !== undefined ? (Number(body.Alto_Unidad || 0) || 0) : undefined,
      Kg_Unidad: body.Kg_Unidad !== undefined ? (Number(body.Kg_Unidad || 0) || 0) : undefined,
      Largo_Caja: body.Largo_Caja !== undefined ? (Number(body.Largo_Caja || 0) || 0) : undefined,
      Alto_Caja: body.Alto_Caja !== undefined ? (Number(body.Alto_Caja || 0) || 0) : undefined,
      Ancho_Caja: body.Ancho_Caja !== undefined ? (Number(body.Ancho_Caja || 0) || 0) : undefined,
      PesoKg_Caja: body.PesoKg_Caja !== undefined ? (Number(body.PesoKg_Caja || 0) || 0) : undefined,
      Cajas_Palet: body.Cajas_Palet !== undefined ? (Number(body.Cajas_Palet || 0) || 0) : undefined,
      PVL: body.PVL !== undefined ? (Number(body.PVL || 0) || 0) : undefined,
      IVA: body.IVA !== undefined ? (Number(body.IVA || 0) || 0) : undefined,
      Imagen: body.Imagen !== undefined ? String(body.Imagen || '').trim() : undefined,
      Id_Marca: body.Id_Marca !== undefined ? (body.Id_Marca ? (Number(body.Id_Marca) || null) : null) : undefined,
      EAN13: body.EAN13 !== undefined ? (String(body.EAN13 || '').trim() || null) : undefined,
      Activo: body.Activo !== undefined ? (String(body.Activo) === '1' ? 1 : 0) : undefined
    };

    if (payload.SKU !== undefined && !payload.SKU) {
      const item = await db.getArticuloById(id);
      return res.status(400).render('articulo-form', { mode: 'edit', marcas, item: { ...item, ...payload }, error: 'SKU es obligatorio' });
    }
    if (payload.Nombre !== undefined && !payload.Nombre) {
      const item = await db.getArticuloById(id);
      return res.status(400).render('articulo-form', { mode: 'edit', marcas, item: { ...item, ...payload }, error: 'Nombre es obligatorio' });
    }

    await db.updateArticulo(id, payload);
    return res.redirect(`/articulos/${id}`);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    await db.deleteArticulo(id);
    return res.redirect('/dashboard');
  } catch (e) {
    next(e);
  }
});

router.post('/:id/toggle', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const value = String(_n(_n(req.body && req.body.Activo, req.body && req.body.activo), '')).toLowerCase();
    const nextVal = value === '0' || value === 'false' || value === 'ko' || value === 'inactivo' ? 0 : 1;
    await db.toggleArticuloOkKo(id, nextVal);
    return res.redirect(`/articulos/${id}`);
  } catch (e) {
    next(e);
  }
});

router.get('/:id', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const item = await db.getArticuloById(id);
    if (!item) return res.status(404).send('No encontrado');
    res.render('articulo', { item, admin });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
