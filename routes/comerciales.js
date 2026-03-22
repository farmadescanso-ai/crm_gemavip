/**
 * Rutas HTML de comerciales (CRUD).
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/mysql-crm');
const { requireAdmin } = require('../lib/app-helpers');
const { _n } = require('../lib/app-helpers');
const { normalizeTelefonoForDB } = require('../lib/telefono-utils');
const {
  loadComercialesTableMeta,
  sanitizeComercialForView,
  parseMoneyLike,
  parseIntLike,
  normalizeCp,
  rolesFromBody,
  normalizeRoles
} = require('../lib/comercial-helpers');

const router = express.Router();

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? String(req.query.q) : '';
    const created = String(req.query.created || '') === '1';
    const updated = String(req.query.updated || '') === '1';
    const deleted = String(req.query.deleted || '') === '1';
    const error = typeof req.query.error === 'string' ? String(req.query.error) : '';

    const items = await db.getComerciales();
    const sanitized = (items || []).map((c) => {
      if (!c || typeof c !== 'object') return c;
      // eslint-disable-next-line no-unused-vars
      const { Password, password, ...rest } = c;
      return rest;
    });

    const qq = String(q || '').trim().toLowerCase();
    const filtered = qq
      ? sanitized.filter((c) => {
          const nombre = String(_n(c && c.Nombre, '')).toLowerCase();
          const email = String(_n(_n(c && c.Email, c && c.email), '')).toLowerCase();
          const dni = String(_n(c && c.DNI, '')).toLowerCase();
          const movil = String(_n(c && c.Movil, '')).toLowerCase();
          return [nombre, email, dni, movil].some((s) => s.includes(qq));
        })
      : sanitized;

    res.render('comerciales', { items: filtered, q, created, updated, deleted, error });
  } catch (e) {
    next(e);
  }
});

router.get('/new', requireAdmin, async (_req, res, next) => {
  try {
    const [provincias, meta] = await Promise.all([db.getProvincias().catch(() => []), loadComercialesTableMeta()]);
    return res.render('comercial-form', {
      mode: 'create',
      item: {
        Nombre: '',
        Email: '',
        DNI: '',
        Movil: '',
        Direccion: '',
        CodigoPostal: '',
        Poblacion: '',
        Id_Provincia: '',
        Roll: ['Comercial']
      },
      provincias: provincias || [],
      meta,
      error: null
    });
  } catch (e) {
    next(e);
  }
});

router.post('/new', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const [provincias, meta] = await Promise.all([db.getProvincias().catch(() => []), loadComercialesTableMeta()]);

    const Nombre = String(_n(body.Nombre, '')).trim();
    const Email = String(_n(body.Email, '')).trim();
    const Password = String(_n(body.Password, '')).trim();
    const DNI = String(_n(body.DNI, '')).trim() || null;
    const Movil = normalizeTelefonoForDB(String(_n(body.Movil, '')).trim() || null) || null;
    const Direccion = String(_n(body.Direccion, '')).trim() || null;
    const CodigoPostal = normalizeCp(body.CodigoPostal);
    const Poblacion = String(_n(body.Poblacion, '')).trim() || null;
    const Id_Provincia = parseIntLike(body.Id_Provincia, null);
    const fijo_mensual = meta && meta.hasFijoMensual ? _n(parseMoneyLike(_n(body.fijo_mensual, body.FijoMensual), 0), 0) : undefined;
    const plataforma_reunion_preferida = meta?.hasPlataforma
      ? String(_n(body.plataforma_reunion_preferida, 'meet')).trim() || 'meet'
      : undefined;

    const roles = rolesFromBody(body);
    const Roll = JSON.stringify(roles);

    const itemEcho = {
      Nombre,
      Email,
      DNI: DNI || '',
      Movil: Movil || '',
      Direccion: Direccion || '',
      CodigoPostal,
      Poblacion: Poblacion || '',
      Id_Provincia: _n(Id_Provincia, ''),
      Roll: roles,
      fijo_mensual: _n(fijo_mensual, 0),
      plataforma_reunion_preferida: _n(plataforma_reunion_preferida, 'meet')
    };

    const emailOk = Email && Email.includes('@') && Email.includes('.');
    if (!Nombre) {
      return res.status(400).render('comercial-form', { mode: 'create', item: itemEcho, provincias, meta, error: 'El nombre es obligatorio.' });
    }
    if (!emailOk) {
      return res.status(400).render('comercial-form', { mode: 'create', item: itemEcho, provincias, meta, error: 'Email no válido.' });
    }
    if (!CodigoPostal || CodigoPostal.length < 4) {
      return res.status(400).render('comercial-form', { mode: 'create', item: itemEcho, provincias, meta, error: 'Código Postal no válido.' });
    }
    if (!Password || Password.length < 6) {
      return res.status(400).render('comercial-form', { mode: 'create', item: itemEcho, provincias, meta, error: 'La contraseña es obligatoria (mínimo 6 caracteres).' });
    }

    const hashed = await bcrypt.hash(Password, 12);
    const payload = {
      Nombre,
      Email,
      DNI,
      Password: hashed,
      Roll,
      Movil,
      Direccion,
      CodigoPostal,
      Poblacion,
      Id_Provincia,
      fijo_mensual,
      plataforma_reunion_preferida
    };

    const result = await db.createComercial(payload);
    const insertId = result?.insertId;
    if (!insertId) return res.redirect('/comerciales?created=1');
    return res.redirect(`/comerciales/${insertId}?created=1`);
  } catch (e) {
    try {
      const [provincias, meta] = await Promise.all([db.getProvincias().catch(() => []), loadComercialesTableMeta()]);
      const body = req.body || {};
      const roles = rolesFromBody(body);
      const itemEcho = {
        ...body,
        CodigoPostal: normalizeCp(body.CodigoPostal),
        Roll: roles
      };
      return res.status(400).render('comercial-form', {
        mode: 'create',
        item: itemEcho,
        provincias,
        meta,
        error: e?.message ? String(e.message) : 'No se pudo crear el comercial.'
      });
    } catch (_) {}
    next(e);
  }
});

router.get('/:id([0-9]+)', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const item = await db.getComercialById(id);
    if (!item) return res.status(404).send('No encontrado');
    const created = String(req.query.created || '') === '1';
    const updated = String(req.query.updated || '') === '1';
    return res.render('comercial-view', { item: sanitizeComercialForView(item), created, updated });
  } catch (e) {
    next(e);
  }
});

router.get('/:id([0-9]+)/edit', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const [item, provincias, meta] = await Promise.all([
      db.getComercialById(id),
      db.getProvincias().catch(() => []),
      loadComercialesTableMeta()
    ]);
    if (!item) return res.status(404).send('No encontrado');
    const safe = sanitizeComercialForView(item);
    const roles = normalizeRoles(_n(_n(safe && safe.Roll, safe && safe.roll), safe && safe.Rol));
    return res.render('comercial-form', {
      mode: 'edit',
      item: { ...safe, Roll: roles },
      provincias: provincias || [],
      meta,
      error: null
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:id([0-9]+)/edit', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const body = req.body || {};
    const [current, provincias, meta] = await Promise.all([
      db.getComercialById(id),
      db.getProvincias().catch(() => []),
      loadComercialesTableMeta()
    ]);
    if (!current) return res.status(404).send('No encontrado');

    const Nombre = String(_n(body.Nombre, '')).trim();
    const Email = String(_n(body.Email, '')).trim();
    const newPassword = String(_n(body.Password, '')).trim();
    const DNI = String(_n(body.DNI, '')).trim() || null;
    const Movil = normalizeTelefonoForDB(String(_n(body.Movil, '')).trim() || null) || null;
    const Direccion = String(_n(body.Direccion, '')).trim() || null;
    const CodigoPostal = normalizeCp(body.CodigoPostal);
    const Poblacion = String(_n(body.Poblacion, '')).trim() || null;
    const Id_Provincia = parseIntLike(body.Id_Provincia, null);
    const fijo_mensual = meta && meta.hasFijoMensual ? _n(parseMoneyLike(_n(body.fijo_mensual, body.FijoMensual), 0), 0) : undefined;
    const plataforma_reunion_preferida = meta?.hasPlataforma
      ? String(_n(body.plataforma_reunion_preferida, 'meet')).trim() || 'meet'
      : undefined;

    const roles = rolesFromBody(body);
    const Roll = JSON.stringify(roles);

    const emailOk = Email && Email.includes('@') && Email.includes('.');
    if (!Nombre) {
      return res.status(400).render('comercial-form', { mode: 'edit', item: { ...sanitizeComercialForView(current), ...body, CodigoPostal, Roll: roles }, provincias, meta, error: 'El nombre es obligatorio.' });
    }
    if (!emailOk) {
      return res.status(400).render('comercial-form', { mode: 'edit', item: { ...sanitizeComercialForView(current), ...body, CodigoPostal, Roll: roles }, provincias, meta, error: 'Email no válido.' });
    }
    if (!CodigoPostal || CodigoPostal.length < 4) {
      return res.status(400).render('comercial-form', { mode: 'edit', item: { ...sanitizeComercialForView(current), ...body, CodigoPostal, Roll: roles }, provincias, meta, error: 'Código Postal no válido.' });
    }
    if (newPassword && newPassword.length < 6) {
      return res.status(400).render('comercial-form', { mode: 'edit', item: { ...sanitizeComercialForView(current), ...body, CodigoPostal, Roll: roles }, provincias, meta, error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    const payload = {
      Nombre,
      Email,
      DNI,
      Roll,
      Movil,
      Direccion,
      CodigoPostal,
      Poblacion,
      Id_Provincia,
      fijo_mensual,
      plataforma_reunion_preferida
    };

    if (meta && meta.hasMeetEmail) payload.meet_email = String(_n(body.meet_email, '')).trim();
    if (meta && meta.hasTeamsEmail) payload.teams_email = String(_n(body.teams_email, '')).trim();

    await db.updateComercial(id, payload);
    if (newPassword) {
      const hashed = await bcrypt.hash(newPassword, 12);
      await db.updateComercialPassword(id, hashed);
    }
    return res.redirect(`/comerciales/${id}?updated=1`);
  } catch (e) {
    next(e);
  }
});

router.post('/:id([0-9]+)/delete', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const selfId = Number(req.session?.user?.id);
    if (Number.isFinite(selfId) && selfId > 0 && id === selfId) {
      return res.redirect('/comerciales?error=' + encodeURIComponent('No puedes eliminar tu propio usuario.'));
    }
    const result = await db.deleteComercial(id);
    const n = Number(_n(result && result.affectedRows, 0));
    if (n <= 0) return res.redirect('/comerciales?error=' + encodeURIComponent('No se pudo eliminar (no encontrado o sin cambios).'));
    return res.redirect('/comerciales?deleted=1');
  } catch (e) {
    next(e);
  }
});

module.exports = router;
