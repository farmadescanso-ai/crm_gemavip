const express = require('express');
const fs = require('fs').promises;
const mysql = require('mysql2/promise');
const swaggerUi = require('swagger-ui-express');
const crypto = require('crypto');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const MySQLStoreFactory = require('express-mysql-session');
const ExcelJS = require('exceljs');
const axios = require('axios');
const swaggerSpec = require('../config/swagger');
const apiRouter = require('../routes/api');
const publicRouter = require('../routes/public');
const db = require('../config/mysql-crm');
const {
  isAdminUser,
  normalizeRoles,
  getCommonNavLinksForRoles,
  getRoleNavLinksForRoles,
  requireLogin,
  createLoadPedidoAndCheckOwner
} = require('../lib/auth');
const { toNum: toNumUtil, escapeHtml: escapeHtmlUtil } = require('../lib/utils');
const { sendPasswordResetEmail, sendPedidoEspecialDecisionEmail, sendPedidoEmail, APP_BASE_URL } = require('../lib/mailer');

// Emails de notificaciones: desactivado por defecto (hasta configurar SMTP correctamente).
const NOTIF_EMAILS_ENABLED =
  process.env.NOTIF_EMAILS_ENABLED === '1' ||
  String(process.env.NOTIF_EMAILS_ENABLED || '').toLowerCase() === 'true';

const app = express();
app.set('trust proxy', 1);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use('/assets', express.static(path.join(__dirname, '..', 'public')));

// Sesión por inactividad:
// si el usuario no usa la app durante SESSION_IDLE_TIMEOUT_MINUTES, expira y vuelve a /login.
const idleMinutesRaw = process.env.SESSION_IDLE_TIMEOUT_MINUTES;
const idleMinutes = Number(idleMinutesRaw || 60);

// Compatibilidad: si alguien sigue usando SESSION_MAX_AGE_DAYS, lo respetamos solo si no hay idle timeout.
const sessionMaxAgeDays = Number(process.env.SESSION_MAX_AGE_DAYS || 30);

const sessionMaxAgeMs = Number.isFinite(idleMinutes)
  ? Math.max(5, idleMinutes) * 60 * 1000
  : Number.isFinite(sessionMaxAgeDays)
    ? Math.max(1, sessionMaxAgeDays) * 24 * 60 * 60 * 1000
    : 60 * 60 * 1000;

const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'crm_gemavip',
  // Tabla por defecto: sessions
  createDatabaseTable: true,
  expiration: sessionMaxAgeMs
});

app.use(
  session({
    name: 'crm_session',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: sessionMaxAgeMs
    }
  })
);

function makeRequestId() {
  try {
    return crypto.randomUUID();
  } catch (_) {
    return crypto.randomBytes(16).toString('hex');
  }
}

function wantsHtml(req) {
  const accept = String(req.headers?.accept || '');
  return accept.includes('text/html');
}

function buildSupportDetails(req, { status, heading, summary, publicMessage, code } = {}) {
  const user = req.session?.user || null;
  const roles = Array.isArray(user?.roles) ? user.roles.join(', ') : String(user?.roles || '');
  const lines = [
    'CRM Gemavip · Reporte de incidencia',
    `Fecha: ${new Date().toISOString()}`,
    `Request ID: ${req.requestId || '—'}`,
    `Ruta: ${req.method} ${req.originalUrl || req.url || ''}`,
    `Estado: ${status || 500}`,
    `Título: ${heading || '—'}`,
    `Resumen: ${summary || '—'}`,
    `Mensaje: ${publicMessage || '—'}`,
    `Código interno: ${code || '—'}`,
    `Usuario: ${user ? `${user.email || '—'} (id: ${user.id ?? '—'})` : 'No logueado'}`,
    `Roles: ${roles || '—'}`,
    `User-Agent: ${String(req.headers['user-agent'] || '—')}`
  ];
  return lines.join('\n');
}

function renderErrorPage(req, res, opts) {
  const status = opts?.status || 500;
  const heading = opts?.heading || 'Ha ocurrido un problema';
  const summary = opts?.summary || 'No se ha podido completar la acción.';
  const statusLabel = opts?.statusLabel
    || (status === 404 ? 'Not Found' : status === 403 ? 'Forbidden' : status === 401 ? 'Unauthorized' : 'Error');
  const whatToDo = opts?.whatToDo || [
    'Vuelve atrás e inténtalo de nuevo.',
    'Si estabas editando algo, revisa que los datos sean correctos.',
    'Si el problema continúa, copia los detalles y envíalos a soporte.'
  ];
  const primaryAction = opts?.primaryAction
    || (req.session?.user ? { href: '/dashboard', label: 'Ir al Dashboard' } : { href: '/login', label: 'Ir a Login' });
  const supportDetails = opts?.supportDetails || buildSupportDetails(req, {
    status,
    heading,
    summary,
    publicMessage: opts?.publicMessage,
    code: opts?.code
  });

  return res.status(status).render('error', {
    title: opts?.title || `Error ${status}`,
    status,
    statusLabel,
    heading,
    summary,
    whatToDo,
    primaryAction,
    requestId: req.requestId,
    when: new Date().toISOString(),
    supportDetails
  });
}

// Request ID estándar (útil para soporte)
app.use((req, res, next) => {
  req.requestId = makeRequestId();
  res.locals.requestId = req.requestId;
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

function requireApiKeyIfConfigured(req, res, next) {
  // Si el usuario está logueado por sesión, permitimos acceso a /api desde la propia app
  // (p.ej. autocomplete/búsquedas internas). Para clientes externos seguirá requiriéndose API_KEY.
  if (req.session?.user) return next();
  const configured = process.env.API_KEY;
  if (!configured) return next();
  const provided = req.header('x-api-key') || req.header('X-API-Key');
  if (provided && provided === configured) return next();
  return res.status(401).json({ ok: false, error: 'API key requerida (X-API-Key)' });
}

// Middleware reutilizable: carga pedido y comprueba admin o dueño (evita duplicar lógica en cada ruta)
const loadPedidoAndCheckOwner = createLoadPedidoAndCheckOwner('id');

// requireAdmin sigue aquí porque usa renderErrorPage y wantsHtml de esta app
function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.redirect('/login');
  if (!isAdminUser(req.session.user)) {
    if (wantsHtml(req)) {
      return renderErrorPage(req, res, {
        status: 403,
        title: 'Acceso restringido',
        heading: 'No tienes permisos para ver esta página',
        summary: 'Esta sección está disponible solo para administradores.',
        statusLabel: 'Forbidden',
        whatToDo: [
          'Si crees que esto es un error, cierra sesión e inicia de nuevo.',
          'Si sigues sin acceso, solicita permisos a un administrador.',
          'Si necesitas ayuda, copia los detalles y envíalos a soporte.'
        ]
      });
    }
    return res.status(403).send('Forbidden');
  }
  return next();
}

async function loadMarcasForSelect(db) {
  // Best-effort: si falta permisos/tabla, devolver vacío.
  try {
    const tMarcas = await db._resolveTableNameCaseInsensitive('marcas');
    const cols = await db._getColumns(tMarcas);
    const colsLower = new Set((cols || []).map((c) => String(c).toLowerCase()));
    const pick = (cands) => (cands || []).find((c) => colsLower.has(String(c).toLowerCase())) || null;
    const colId = pick(['id', 'Id']) || 'id';
    const colNombre =
      pick(['Nombre', 'nombre', 'Marca', 'marca', 'Descripcion', 'descripcion', 'NombreMarca', 'nombre_marca']) || null;
    const colActivo = pick(['Activo', 'activo']);

    const selectNombre = colNombre ? `\`${colNombre}\` AS nombre` : `CAST(\`${colId}\` AS CHAR) AS nombre`;
    const whereActivo = colActivo ? `WHERE \`${colActivo}\` = 1` : '';
    const rows = await db.query(`SELECT \`${colId}\` AS id, ${selectNombre} FROM \`${tMarcas}\` ${whereActivo} ORDER BY nombre ASC`);
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

// Locals para todas las vistas
app.use((req, _res, next) => {
  const user = req.session?.user || null;
  req.user = user;
  next();
});
app.use(async (req, res, next) => {
  res.locals.user = req.user || null;
  const roles = res.locals.user?.roles || [];
  res.locals.navLinks = res.locals.user ? getCommonNavLinksForRoles(roles) : [];
  res.locals.roleNavLinks = res.locals.user ? getRoleNavLinksForRoles(roles) : [];
  if (res.locals.user && isAdminUser(res.locals.user)) {
    try {
      res.locals.notificacionesPendientes = await db.getNotificacionesPendientesCount();
    } catch (_) {
      res.locals.notificacionesPendientes = 0;
    }
  } else {
    res.locals.notificacionesPendientes = 0;
  }

  // Helpers globales para EJS (formatos ES)
  res.locals.fmtDateES = (val) => {
    if (!val) return '';
    try {
      // yyyy-mm-dd (o yyyy-mm-ddTHH...)
      const s = String(val);
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[3]}/${m[2]}/${m[1]}`;

      const d = (val instanceof Date) ? val : new Date(val);
      if (!Number.isFinite(d.getTime())) return s;
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yy = String(d.getFullYear());
      return `${dd}/${mm}/${yy}`;
    } catch (_) {
      return String(val);
    }
  };
  res.locals.fmtDateISO = (val) => {
    // Para <input type="date"> y para FullCalendar: YYYY-MM-DD
    if (!val) return '';
    try {
      const s = String(val);
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;

      const d = (val instanceof Date) ? val : new Date(val);
      if (!Number.isFinite(d.getTime())) return '';
      const yy = String(d.getFullYear());
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yy}-${mm}-${dd}`;
    } catch (_) {
      return '';
    }
  };
  res.locals.fmtTimeHM = (val) => {
    if (!val) return '';
    try {
      if (val instanceof Date) return val.toISOString().slice(11, 16);
      const s = String(val);
      const m = s.match(/(\d{2}):(\d{2})/);
      if (m) return `${m[1]}:${m[2]}`;
      return s.slice(0, 5);
    } catch (_) {
      return String(val).slice(0, 5);
    }
  };

  // Formato numérico ES fijo: miles "." y decimales "," (sin depender del locale del runtime)
  res.locals.fmtNumES = (value, decimals = 2) => {
    const x = Number(value);
    if (!Number.isFinite(x)) return '';
    const d = Math.max(0, Math.min(6, Number(decimals) || 0));
    const sign = x < 0 ? '-' : '';
    const abs = Math.abs(x);
    const factor = Math.pow(10, d);
    const rounded = Math.round((abs + Number.EPSILON) * factor) / factor;
    const parts = rounded.toFixed(d).split('.');
    const intPart = String(parts[0] || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const decPart = d ? (',' + String(parts[1] || '').padEnd(d, '0')) : '';
    return sign + intPart + decPart;
  };
  res.locals.fmtEurES = (value) => {
    const x = Number(value);
    if (!Number.isFinite(x)) return '';
    return `${res.locals.fmtNumES(x, 2)}€`;
  };

  next();
});

// Favicon: redirigir al logo de Gemavip
app.get('/favicon.ico', (req, res) => {
  res.redirect(302, '/assets/images/gemavip-logo.svg');
});

// Vistas y endpoints públicos (no requieren login)
app.use('/', publicRouter);

app.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/dashboard');
  const restablecido = req.query?.restablecido === '1';
  res.render('login', { title: 'Login', error: null, restablecido });
});

app.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).render('login', { title: 'Login', error: 'Email y contraseña son obligatorios' });
    }

    const comercial = await db.getComercialByEmail(email);
    if (!comercial) {
      return res.status(401).render('login', { title: 'Login', error: 'Credenciales incorrectas' });
    }

    const stored = String(comercial.Password || comercial.password || '');
    let ok = false;
    if (stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$')) {
      ok = await bcrypt.compare(password, stored);
    } else {
      // Legacy: comparación directa
      ok = password === stored;
    }

    if (!ok) {
      return res.status(401).render('login', { title: 'Login', error: 'Credenciales incorrectas' });
    }

    req.session.user = {
      id: comercial.id ?? comercial.Id,
      nombre: comercial.Nombre || null,
      email: comercial.Email || comercial.email || email,
      roles: normalizeRoles(comercial.Roll || comercial.roll || comercial.Rol)
    };

    return res.redirect('/dashboard');
  } catch (e) {
    next(e);
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Rate limit por IP para "olvidar contraseña" (anti-abuso)
const passwordResetIpAttempts = new Map();
const PASSWORD_RESET_IP_MAX = 10;
const PASSWORD_RESET_IP_WINDOW_MS = 60 * 60 * 1000;
function checkPasswordResetRateLimitIp(ip) {
  const now = Date.now();
  for (const [key, data] of passwordResetIpAttempts.entries()) {
    if (now - data.firstAt > PASSWORD_RESET_IP_WINDOW_MS) passwordResetIpAttempts.delete(key);
  }
  const data = passwordResetIpAttempts.get(ip);
  if (!data) return true;
  if (now - data.firstAt > PASSWORD_RESET_IP_WINDOW_MS) {
    passwordResetIpAttempts.delete(ip);
    return true;
  }
  return data.count < PASSWORD_RESET_IP_MAX;
}
function recordPasswordResetIp(ip) {
  const now = Date.now();
  const data = passwordResetIpAttempts.get(ip);
  if (!data) {
    passwordResetIpAttempts.set(ip, { count: 1, firstAt: now });
  } else {
    data.count += 1;
  }
}

app.get('/login/olvidar-contrasena', (req, res) => {
  if (req.session?.user) return res.redirect('/dashboard');
  res.render('login-olvidar-contrasena', { title: 'Recuperar contraseña', error: null, success: null });
});

app.post('/login/olvidar-contrasena', async (req, res, next) => {
  try {
    if (req.session?.user) return res.redirect('/dashboard');
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!checkPasswordResetRateLimitIp(ip)) {
      return res.status(429).render('login-olvidar-contrasena', {
        title: 'Recuperar contraseña',
        error: 'Demasiados intentos. Espera una hora e inténtalo de nuevo.',
        success: null
      });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).render('login-olvidar-contrasena', {
        title: 'Recuperar contraseña',
        error: 'Introduce tu email.',
        success: null
      });
    }
    const MAX_EMAIL_ATTEMPTS = 3;
    const recentByEmail = await db.countRecentPasswordResetAttempts(email, 1);
    if (recentByEmail >= MAX_EMAIL_ATTEMPTS) {
      return res.render('login-olvidar-contrasena', {
        title: 'Recuperar contraseña',
        error: null,
        success: 'Si existe una cuenta con ese correo, ya has recibido un enlace recientemente. Revisa tu bandeja o espera 1 hora para solicitar otro.'
      });
    }
    const comercial = await db.getComercialByEmail(email);
    if (comercial) {
      const token = crypto.randomBytes(32).toString('hex');
      const comercialId = comercial.id ?? comercial.Id;
      await db.createPasswordResetToken(comercialId, email, token, 1);
      recordPasswordResetIp(ip);
      const resetLink = `${APP_BASE_URL.replace(/\/$/, '')}/login/restablecer-contrasena?token=${encodeURIComponent(token)}`;
      await sendPasswordResetEmail(email, resetLink, comercial.Nombre || '');
    }
    res.render('login-olvidar-contrasena', {
      title: 'Recuperar contraseña',
      error: null,
      success: 'Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña en unos minutos. Revisa la carpeta de spam.'
    });
  } catch (e) {
    next(e);
  }
});

app.get('/login/restablecer-contrasena', (req, res) => {
  if (req.session?.user) return res.redirect('/dashboard');
  const token = String(req.query?.token || '').trim();
  if (!token) {
    return res.redirect('/login/olvidar-contrasena');
  }
  res.render('login-restablecer-contrasena', { title: 'Nueva contraseña', token, error: null });
});

app.post('/login/restablecer-contrasena', async (req, res, next) => {
  try {
    if (req.session?.user) return res.redirect('/dashboard');
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    const passwordConfirm = String(req.body?.password_confirm || '');
    if (!token) return res.redirect('/login/olvidar-contrasena');
    if (!password || password.length < 8) {
      return res.status(400).render('login-restablecer-contrasena', {
        title: 'Nueva contraseña',
        token,
        error: 'La contraseña debe tener al menos 8 caracteres.'
      });
    }
    if (password !== passwordConfirm) {
      return res.status(400).render('login-restablecer-contrasena', {
        title: 'Nueva contraseña',
        token,
        error: 'Las contraseñas no coinciden.'
      });
    }
    const row = await db.findPasswordResetToken(token);
    if (!row) {
      return res.status(400).render('login-restablecer-contrasena', {
        title: 'Nueva contraseña',
        token: '',
        error: 'El enlace ha caducado o ya se ha usado. Solicita uno nuevo desde "¿Olvidaste tu contraseña?".'
      });
    }
    const hashed = await bcrypt.hash(password, 12);
    await db.updateComercialPassword(row.comercial_id, hashed);
    await db.markPasswordResetTokenAsUsed(token);
    res.redirect('/login?restablecido=1');
  } catch (e) {
    next(e);
  }
});

app.get('/cuenta/cambiar-contrasena', requireLogin, (req, res) => {
  res.render('cuenta-cambiar-contrasena', { title: 'Cambiar contraseña', error: null, success: null });
});

app.post('/cuenta/cambiar-contrasena', requireLogin, async (req, res, next) => {
  try {
    const userId = Number(res.locals.user?.id);
    if (!userId) return res.redirect('/login');
    const current = String(req.body?.current_password || '');
    const newPass = String(req.body?.password || '');
    const newPassConfirm = String(req.body?.password_confirm || '');
    if (!current) {
      return res.status(400).render('cuenta-cambiar-contrasena', {
        title: 'Cambiar contraseña',
        error: 'Introduce tu contraseña actual.',
        success: null
      });
    }
    if (!newPass || newPass.length < 8) {
      return res.status(400).render('cuenta-cambiar-contrasena', {
        title: 'Cambiar contraseña',
        error: 'La nueva contraseña debe tener al menos 8 caracteres.',
        success: null
      });
    }
    if (newPass !== newPassConfirm) {
      return res.status(400).render('cuenta-cambiar-contrasena', {
        title: 'Cambiar contraseña',
        error: 'La nueva contraseña y la confirmación no coinciden.',
        success: null
      });
    }
    const comercial = await db.getComercialById(userId);
    if (!comercial) return res.redirect('/login');
    const stored = String(comercial.Password || comercial.password || '');
    let currentOk = false;
    if (stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$')) {
      currentOk = await bcrypt.compare(current, stored);
    } else {
      currentOk = current === stored;
    }
    if (!currentOk) {
      return res.status(401).render('cuenta-cambiar-contrasena', {
        title: 'Cambiar contraseña',
        error: 'La contraseña actual no es correcta.',
        success: null
      });
    }
    const hashed = await bcrypt.hash(newPass, 12);
    await db.updateComercialPassword(userId, hashed);
    res.render('cuenta-cambiar-contrasena', { title: 'Cambiar contraseña', error: null, success: 'Contraseña actualizada correctamente.' });
  } catch (e) {
    next(e);
  }
});

app.get(
  '/',
  async (_req, res) => {
    // En producción no exponemos la home/entrada: vamos a login o dashboard
    if (res.locals.user) return res.redirect('/dashboard');
    return res.redirect('/login');
  }
);

app.get('/comerciales', requireAdmin, async (req, res, next) => {
  try {
    const items = await db.getComerciales();
    // Redactar password por seguridad
    const sanitized = (items || []).map((c) => {
      if (!c || typeof c !== 'object') return c;
      // eslint-disable-next-line no-unused-vars
      const { Password, password, ...rest } = c;
      return rest;
    });
    res.render('comerciales', { items: sanitized });
  } catch (e) {
    next(e);
  }
});

// ===========================
// DESCUENTOS PEDIDO (HTML) - Admin CRUD
// ===========================
app.get('/admin/descuentos-pedido', requireAdmin, async (_req, res, next) => {
  try {
    // Diagnóstico (solo admin) para detectar DB incorrecta o tabla vacía en producción
    let diag = { database: null, count: null };
    try {
      const r = await db.query('SELECT DATABASE() AS db').catch(() => []);
      diag.database = r && r[0] ? (r[0].db ?? r[0].DB ?? r[0].database ?? null) : null;
    } catch (_) {}
    try {
      const c = await db.query('SELECT COUNT(*) AS n FROM `descuentos_pedido`').catch(() => []);
      diag.count = c && c[0] ? Number(c[0].n ?? c[0].N ?? 0) : null;
    } catch (_) {
      diag.count = null;
    }

    const items = await db.getDescuentosPedidoAdmin().catch(() => null);
    if (items === null) {
      return res.render('descuentos-pedido', {
        title: 'Descuentos de pedido',
        items: [],
        error: 'No se pudo leer la tabla descuentos_pedido. ¿Has ejecutado el script scripts/crear-tabla-descuentos-pedido.sql?',
        diag
      });
    }
    return res.render('descuentos-pedido', { title: 'Descuentos de pedido', items: items || [], error: null, diag });
  } catch (e) {
    next(e);
  }
});

app.get('/admin/descuentos-pedido/new', requireAdmin, async (_req, res, next) => {
  try {
    return res.render('descuento-pedido-form', {
      title: 'Nuevo tramo de descuento',
      mode: 'create',
      item: { importe_desde: 0, importe_hasta: null, dto_pct: 0, activo: 1, orden: 10 },
      error: null
    });
  } catch (e) {
    next(e);
  }
});

app.post('/admin/descuentos-pedido/new', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const n = (v) => {
      const s = String(v ?? '').trim();
      if (!s) return null;
      const x = Number(String(s).replace(',', '.'));
      return Number.isFinite(x) ? x : null;
    };
    const i = (v) => {
      const s = String(v ?? '').trim();
      if (!s) return 0;
      const x = parseInt(s, 10);
      return Number.isFinite(x) ? x : 0;
    };

    const payload = {
      importe_desde: n(body.importe_desde),
      importe_hasta: n(body.importe_hasta),
      dto_pct: n(body.dto_pct),
      orden: i(body.orden),
      activo: String(body.activo ?? '1') === '1' ? 1 : 0
    };

    const bad =
      payload.importe_desde === null ||
      payload.dto_pct === null ||
      payload.importe_desde < 0 ||
      payload.dto_pct < 0 ||
      payload.dto_pct > 100 ||
      (payload.importe_hasta !== null && payload.importe_hasta <= payload.importe_desde);
    if (bad) {
      return res.status(400).render('descuento-pedido-form', {
        title: 'Nuevo tramo de descuento',
        mode: 'create',
        item: payload,
        error: 'Revisa los valores: "Desde" es obligatorio, "Hasta" debe ser mayor que "Desde" (o vacío), y el % debe estar entre 0 y 100.'
      });
    }

    await db.createDescuentoPedido(payload);
    return res.redirect('/admin/descuentos-pedido');
  } catch (e) {
    next(e);
  }
});

app.get('/admin/descuentos-pedido/:id(\\d+)/edit', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const item = await db.getDescuentoPedidoById(id);
    if (!item) return res.status(404).send('No encontrado');
    return res.render('descuento-pedido-form', { title: 'Editar tramo de descuento', mode: 'edit', item, error: null });
  } catch (e) {
    next(e);
  }
});

app.post('/admin/descuentos-pedido/:id(\\d+)/edit', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await db.getDescuentoPedidoById(id);
    if (!existing) return res.status(404).send('No encontrado');

    const body = req.body || {};
    const n = (v) => {
      const s = String(v ?? '').trim();
      if (!s) return null;
      const x = Number(String(s).replace(',', '.'));
      return Number.isFinite(x) ? x : null;
    };
    const i = (v) => {
      const s = String(v ?? '').trim();
      if (!s) return 0;
      const x = parseInt(s, 10);
      return Number.isFinite(x) ? x : 0;
    };

    const payload = {
      importe_desde: n(body.importe_desde),
      importe_hasta: n(body.importe_hasta),
      dto_pct: n(body.dto_pct),
      orden: i(body.orden),
      activo: String(body.activo ?? '1') === '1' ? 1 : 0
    };

    const bad =
      payload.importe_desde === null ||
      payload.dto_pct === null ||
      payload.importe_desde < 0 ||
      payload.dto_pct < 0 ||
      payload.dto_pct > 100 ||
      (payload.importe_hasta !== null && payload.importe_hasta <= payload.importe_desde);
    if (bad) {
      return res.status(400).render('descuento-pedido-form', {
        title: 'Editar tramo de descuento',
        mode: 'edit',
        item: { ...existing, ...payload, id },
        error: 'Revisa los valores: "Desde" es obligatorio, "Hasta" debe ser mayor que "Desde" (o vacío), y el % debe estar entre 0 y 100.'
      });
    }

    await db.updateDescuentoPedido(id, payload);
    return res.redirect('/admin/descuentos-pedido');
  } catch (e) {
    next(e);
  }
});

app.post('/admin/descuentos-pedido/:id(\\d+)/toggle', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.toggleDescuentoPedidoActivo(id);
    return res.redirect('/admin/descuentos-pedido');
  } catch (e) {
    next(e);
  }
});

app.post('/admin/descuentos-pedido/:id(\\d+)/delete', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.deleteDescuentoPedido(id);
    return res.redirect('/admin/descuentos-pedido');
  } catch (e) {
    next(e);
  }
});

// ===========================
// VARIABLES DEL SISTEMA (HTML) - Admin
// ===========================
const SYSVAR_N8N_PEDIDOS_WEBHOOK_URL = 'N8N_PEDIDOS_WEBHOOK_URL';
const SYSVAR_PEDIDOS_MAIL_TO = 'PEDIDOS_MAIL_TO';

function buildSysVarMergedList(itemsRaw, knownKeys) {
  const byKey = new Map((itemsRaw || []).map((r) => [String(r?.clave || '').trim(), r]));
  return (knownKeys || []).map((k) => {
    const row = byKey.get(k.clave) || {};
    const dbVal = row.valor === null || row.valor === undefined ? '' : String(row.valor);
    const envVal = String(process.env[k.clave] || '').trim();
    const effectiveValue = (dbVal || '').trim() || envVal || '';
    return {
      id: row.id ?? null,
      clave: k.clave,
      descripcion: row.descripcion || k.descripcion || '',
      valor: dbVal,
      effectiveValue,
      updated_at: row.updated_at ?? null,
      updated_by: row.updated_by ?? null
    };
  });
}

async function loadVariablesSistemaRaw() {
  await db.ensureVariablesSistemaTable?.().catch(() => false);
  return await db.getVariablesSistemaAdmin?.().catch(() => null);
}

app.get('/admin/variables-sistema', requireAdmin, async (req, res, next) => {
  try {
    const itemsRaw = await loadVariablesSistemaRaw();
    if (itemsRaw === null) {
      return res.render('variables-sistema', {
        title: 'Variables del sistema',
        subtitle: 'Configuración centralizada para que no haya que tocar código ni variables de entorno.',
        sections: [],
        error:
          'No se pudo leer/crear la tabla variables_sistema. Si tu entorno no permite CREATE TABLE, crea la tabla manualmente (ver scripts/crear-tabla-variables-sistema.sql) o usa .env como fallback.',
        success: null
      });
    }

    const knownWebhooks = [
      { clave: SYSVAR_N8N_PEDIDOS_WEBHOOK_URL, descripcion: 'Webhook de N8N para envío de pedidos.' }
    ];
    const knownEmail = [
      { clave: SYSVAR_PEDIDOS_MAIL_TO, descripcion: 'Destinatario del email al pulsar ENVIAR en /pedidos.' }
    ];

    const flag = String(req.query.saved || '').trim().toLowerCase();
    const success = flag === '1' ? 'Variable actualizada.' : null;
    const error = flag === '0' ? 'No se pudo guardar la variable.' : null;

    return res.render('variables-sistema', {
      title: 'Variables del sistema',
      subtitle: 'Vista general (agrupada por apartados).',
      sections: [
        { title: 'Webhooks', description: 'Integraciones vía URL.', items: buildSysVarMergedList(itemsRaw, knownWebhooks) },
        { title: 'Configuración Email', description: 'Envío directo por correo.', items: buildSysVarMergedList(itemsRaw, knownEmail) }
      ],
      notes: ['Para SMTP (host/usuario/contraseña) se recomienda usar variables de entorno en Vercel.'],
      updateAction: '/admin/variables-sistema/update',
      returnTo: '/admin/variables-sistema',
      error,
      success
    });
  } catch (e) {
    next(e);
  }
});

app.get('/admin/webhooks', requireAdmin, async (req, res, next) => {
  try {
    const itemsRaw = await loadVariablesSistemaRaw();
    if (itemsRaw === null) {
      return res.render('variables-sistema', {
        title: 'Webhooks',
        subtitle: 'Configura URLs de integraciones (N8N, etc.).',
        sections: [],
        error:
          'No se pudo leer/crear la tabla variables_sistema. Si tu entorno no permite CREATE TABLE, crea la tabla manualmente (ver scripts/crear-tabla-variables-sistema.sql) o usa .env como fallback.',
        success: null,
        returnTo: '/admin/webhooks'
      });
    }
    const known = [{ clave: SYSVAR_N8N_PEDIDOS_WEBHOOK_URL, descripcion: 'Webhook de N8N para envío de pedidos.' }];
    const flag = String(req.query.saved || '').trim().toLowerCase();
    return res.render('variables-sistema', {
      title: 'Webhooks',
      subtitle: 'URLs de integración. Si está vacío en BD, se usa .env.',
      sections: [{ title: null, description: null, items: buildSysVarMergedList(itemsRaw, known) }],
      notes: ['En este momento el envío a N8N está desactivado (código preservado, no se ejecuta).'],
      updateAction: '/admin/variables-sistema/update',
      returnTo: '/admin/webhooks',
      error: flag === '0' ? 'No se pudo guardar la variable.' : null,
      success: flag === '1' ? 'Variable actualizada.' : null
    });
  } catch (e) {
    next(e);
  }
});

app.get('/admin/configuracion-email', requireAdmin, async (req, res, next) => {
  try {
    const itemsRaw = await loadVariablesSistemaRaw();
    if (itemsRaw === null) {
      return res.render('variables-sistema', {
        title: 'Configuración Email',
        subtitle: 'Parámetros para el envío directo por correo.',
        sections: [],
        error:
          'No se pudo leer/crear la tabla variables_sistema. Si tu entorno no permite CREATE TABLE, crea la tabla manualmente (ver scripts/crear-tabla-variables-sistema.sql) o usa .env como fallback.',
        success: null,
        returnTo: '/admin/configuracion-email'
      });
    }
    const known = [{ clave: SYSVAR_PEDIDOS_MAIL_TO, descripcion: 'Destinatario del email al pulsar ENVIAR en /pedidos.' }];
    const flag = String(req.query.saved || '').trim().toLowerCase();
    return res.render('variables-sistema', {
      title: 'Configuración Email',
      subtitle: 'Destinatarios y ajustes funcionales (no incluye credenciales SMTP).',
      sections: [{ title: null, description: null, items: buildSysVarMergedList(itemsRaw, known) }],
      notes: [
        'El envío por email requiere SMTP configurado (SMTP_HOST/SMTP_USER/SMTP_PASS).',
        'Si PEDIDOS_MAIL_TO está vacío, se usa p.lara@gemavip.com.'
      ],
      updateAction: '/admin/variables-sistema/update',
      returnTo: '/admin/configuracion-email',
      error: flag === '0' ? 'No se pudo guardar la variable.' : null,
      success: flag === '1' ? 'Variable actualizada.' : null
    });
  } catch (e) {
    next(e);
  }
});

app.post('/admin/variables-sistema/update', requireAdmin, async (req, res, next) => {
  try {
    const clave = String(req.body?.clave || '').trim();
    const returnTo = String(req.body?.returnTo || '').trim() || '/admin/variables-sistema';
    if (!clave) return res.redirect(`${returnTo}?saved=0`);

    const rawVal = req.body?.valor;
    const val = rawVal === null || rawVal === undefined ? '' : String(rawVal);
    const trimmed = val.trim();

    // Guardamos vacío como NULL para que el fallback a .env funcione.
    const storeVal = trimmed ? trimmed : null;

    const descripcion =
      clave === SYSVAR_N8N_PEDIDOS_WEBHOOK_URL
        ? 'Webhook de N8N para envío de pedidos + Excel (multipart/form-data).'
        : clave === SYSVAR_PEDIDOS_MAIL_TO
          ? 'Destinatario del email al pulsar ENVIAR en /pedidos.'
        : null;

    const updatedBy = res.locals.user?.email || res.locals.user?.id || 'admin';
    await db.upsertVariableSistema(clave, storeVal, { descripcion, updatedBy });
    return res.redirect(`${returnTo}?saved=1`);
  } catch (e) {
    next(e);
  }
});

app.get('/clientes', requireLogin, async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * limit;
    const q = typeof (req.query.q ?? req.query.search) === 'string' ? String(req.query.q ?? req.query.search).trim() : '';
    const tipoContacto = typeof req.query.tipo === 'string' ? String(req.query.tipo).trim() : '';
    const order = String(req.query.order || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
    const admin = isAdminUser(res.locals.user);
    const baseFilters = admin ? {} : { comercial: res.locals.user?.id };
    if (!admin && res.locals.user?.id) {
      const poolId = await db.getComercialIdPool();
      if (poolId) baseFilters.comercialPoolId = poolId;
    }
    const filters = { ...baseFilters };
    if (q) filters.q = q;
    if (tipoContacto && ['Empresa', 'Persona', 'Otros'].includes(tipoContacto)) filters.tipoContacto = tipoContacto;
    const [items, total] = await Promise.all([
      db.getClientesOptimizadoPaged(filters, { limit, offset, sortBy: 'nombre', order }),
      db.countClientesOptimizado(filters)
    ]);
    const poolId = admin ? null : await db.getComercialIdPool();
    res.render('clientes', { items: items || [], q, admin, tipoContacto: tipoContacto || undefined, orderNombre: order, paging: { page, limit, total: total || 0 }, poolId: poolId || null });
  } catch (e) {
    next(e);
  }
});

// ===========================
// CLIENTES (HTML) - Admin CRUD
// ===========================
app.get('/clientes/new', requireAdmin, async (_req, res, next) => {
  try {
    const [comerciales, tarifas] = await Promise.all([db.getComerciales().catch(() => []), db.getTarifas().catch(() => [])]);
    res.render('cliente-form', {
      mode: 'create',
      comerciales: Array.isArray(comerciales) ? comerciales : [],
      tarifas: Array.isArray(tarifas) ? tarifas : [],
      item: { OK_KO: 1, Tarifa: 0, Dto: 0 },
      error: null
    });
  } catch (e) {
    next(e);
  }
});

app.post('/clientes/new', requireAdmin, async (req, res, next) => {
  try {
    const comerciales = await db.getComerciales().catch(() => []);
    const tarifas = await db.getTarifas().catch(() => []);
    const body = req.body || {};
    const dniTrim = String(body.DNI_CIF || '').trim();
    const payload = {
      Id_Cial: body.Id_Cial ? Number(body.Id_Cial) || null : null,
      Nombre_Razon_Social: String(body.Nombre_Razon_Social || '').trim(),
      Nombre_Cial: String(body.Nombre_Cial || '').trim() || null,
      DNI_CIF: dniTrim || null,
      Direccion: String(body.Direccion || '').trim() || null,
      Poblacion: String(body.Poblacion || '').trim() || null,
      CodigoPostal: String(body.CodigoPostal || '').trim() || null,
      Telefono: String(body.Telefono || '').trim() || null,
      Movil: String(body.Movil || '').trim() || null,
      Email: String(body.Email || '').trim() || null,
      Tarifa: body.Tarifa !== undefined ? (Number(body.Tarifa) || 0) : 0,
      Dto: body.Dto !== undefined ? (Number(String(body.Dto).replace(',', '.')) || 0) : undefined,
      OK_KO: (String(body.OK_KO || '1') === '1' && dniTrim) ? 1 : 0,
      Observaciones: String(body.Observaciones || '').trim() || null,
      TipoContacto: (body.TipoContacto === 'Empresa' || body.TipoContacto === 'Persona' || body.TipoContacto === 'Otros') ? body.TipoContacto : null
    };

    const missingFieldsNew = [];
    if (!payload.Nombre_Razon_Social) missingFieldsNew.push('Nombre_Razon_Social');
    if (missingFieldsNew.length > 0) {
      return res.status(400).render('cliente-form', { mode: 'create', comerciales, tarifas, item: payload, error: 'Completa los campos obligatorios marcados.', missingFields: missingFieldsNew });
    }

    await db.createCliente(payload);
    return res.redirect('/clientes');
  } catch (e) {
    next(e);
  }
});

app.get('/clientes/:id', requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const item = await db.getClienteById(id);
    if (!item) return res.status(404).send('No encontrado');
    const admin = isAdminUser(res.locals.user);
    if (!admin && !(await db.canComercialEditCliente(id, res.locals.user?.id))) return res.status(403).send('No tiene permiso para ver este contacto.');
    const puedeSolicitarAsignacion = !admin && res.locals.user?.id && (await db.isContactoAsignadoAPoolOSinAsignar(id));
    const poolId = await db.getComercialIdPool();
    const solicitud = req.query.solicitud === 'ok' ? 'ok' : undefined;
    res.render('cliente', { item, admin, canEdit: admin || (await db.canComercialEditCliente(id, res.locals.user?.id)), puedeSolicitarAsignacion, poolId, solicitud });
  } catch (e) {
    next(e);
  }
});

app.get('/clientes/:id/edit', requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const admin = isAdminUser(res.locals.user);
    if (!admin && !(await db.canComercialEditCliente(id, res.locals.user?.id))) return res.status(403).send('No tiene permiso para editar este contacto.');
    const [item, comerciales, tarifas] = await Promise.all([
      db.getClienteById(id),
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => [])
    ]);
    if (!item) return res.status(404).send('No encontrado');
    const puedeSolicitarAsignacion = !admin && res.locals.user?.id && (await db.isContactoAsignadoAPoolOSinAsignar(id));
    res.render('cliente-form', { mode: 'edit', item, comerciales, tarifas, error: null, admin, canChangeComercial: admin, puedeSolicitarAsignacion, contactoId: id });
  } catch (e) {
    next(e);
  }
});

app.post('/clientes/:id/edit', requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const admin = isAdminUser(res.locals.user);
    if (!admin && !(await db.canComercialEditCliente(id, res.locals.user?.id))) return res.status(403).send('No tiene permiso para editar este contacto.');
    const item = await db.getClienteById(id);
    if (!item) return res.status(404).send('No encontrado');
    const comerciales = await db.getComerciales().catch(() => []);
    const tarifas = await db.getTarifas().catch(() => []);
    const body = req.body || {};
    const canChangeComercial = admin;

    const dniTrimEdit = body.DNI_CIF !== undefined ? String(body.DNI_CIF || '').trim() : (item.DNI_CIF ? String(item.DNI_CIF).trim() : '');
    const payload = {
      Id_Cial: canChangeComercial && body.Id_Cial !== undefined ? (body.Id_Cial ? Number(body.Id_Cial) || null : null) : undefined,
      Nombre_Razon_Social: body.Nombre_Razon_Social !== undefined ? String(body.Nombre_Razon_Social || '').trim() : undefined,
      Nombre_Cial: body.Nombre_Cial !== undefined ? (String(body.Nombre_Cial || '').trim() || null) : undefined,
      DNI_CIF: body.DNI_CIF !== undefined ? (String(body.DNI_CIF || '').trim() || null) : undefined,
      Direccion: body.Direccion !== undefined ? (String(body.Direccion || '').trim() || null) : undefined,
      Poblacion: body.Poblacion !== undefined ? (String(body.Poblacion || '').trim() || null) : undefined,
      CodigoPostal: body.CodigoPostal !== undefined ? (String(body.CodigoPostal || '').trim() || null) : undefined,
      Telefono: body.Telefono !== undefined ? (String(body.Telefono || '').trim() || null) : undefined,
      Movil: body.Movil !== undefined ? (String(body.Movil || '').trim() || null) : undefined,
      Email: body.Email !== undefined ? (String(body.Email || '').trim() || null) : undefined,
      Tarifa: body.Tarifa !== undefined ? (Number(body.Tarifa) || 0) : undefined,
      Dto: body.Dto !== undefined ? (Number(String(body.Dto).replace(',', '.')) || 0) : undefined,
      OK_KO: body.OK_KO !== undefined ? ((String(body.OK_KO || '1') === '1' && dniTrimEdit) ? 1 : 0) : undefined,
      Observaciones: body.Observaciones !== undefined ? (String(body.Observaciones || '').trim() || null) : undefined,
      TipoContacto: (body.TipoContacto === 'Empresa' || body.TipoContacto === 'Persona' || body.TipoContacto === 'Otros') ? body.TipoContacto : (body.TipoContacto !== undefined ? null : undefined)
    };

    const missingFields = [];
    if (payload.Nombre_Razon_Social !== undefined && !String(payload.Nombre_Razon_Social || '').trim()) missingFields.push('Nombre_Razon_Social');
    if (missingFields.length > 0) {
      const puedeSolicitar = !admin && res.locals.user?.id && (await db.isContactoAsignadoAPoolOSinAsignar(id));
      return res.status(400).render('cliente-form', {
        mode: 'edit',
        item: { ...item, ...payload },
        comerciales,
        tarifas,
        error: 'Completa los campos obligatorios marcados.',
        missingFields,
        admin,
        canChangeComercial: !!admin,
        puedeSolicitarAsignacion: puedeSolicitar,
        contactoId: id
      });
    }

    await db.updateCliente(id, payload);
    return res.redirect(`/clientes/${id}`);
  } catch (e) {
    next(e);
  }
});

app.post('/clientes/:id/solicitar-asignacion', requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const userId = Number(res.locals.user?.id);
    if (!userId || isAdminUser(res.locals.user)) return res.status(403).send('Solo un comercial puede solicitar que se le asigne un contacto.');
    const item = await db.getClienteById(id);
    if (!item) return res.status(404).send('No encontrado');
    if (!(await db.isContactoAsignadoAPoolOSinAsignar(id))) return res.status(400).send('Este contacto ya está asignado a otro comercial.');
    await db.createSolicitudAsignacion(id, userId);
    return res.redirect(`/clientes/${id}?solicitud=ok`);
  } catch (e) {
    next(e);
  }
});

app.get('/notificaciones', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * limit;
    const [items, total] = await Promise.all([db.getNotificaciones(limit, offset), db.getNotificacionesPendientesCount()]);
    res.render('notificaciones', { items: items || [], paging: { page, limit, total: total || 0 }, resuelto: req.query.resuelto || undefined });
  } catch (e) {
    next(e);
  }
});

app.post('/notificaciones/:id/aprobar', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const resolved = await db.resolverSolicitudAsignacion(id, res.locals.user?.id, true);
    if (NOTIF_EMAILS_ENABLED && resolved?.ok && resolved?.tipo === 'pedido_especial' && resolved?.comercial_email) {
      const pedidoUrl = resolved?.id_pedido ? `${APP_BASE_URL}/pedidos/${resolved.id_pedido}` : '';
      await sendPedidoEspecialDecisionEmail(String(resolved.comercial_email), {
        decision: 'aprobado',
        pedidoNum: resolved.num_pedido || '',
        clienteNombre: resolved.cliente_nombre || '',
        pedidoUrl
      }).catch(() => null);
    }
    return res.redirect('/notificaciones?resuelto=aprobada');
  } catch (e) {
    next(e);
  }
});

app.post('/notificaciones/:id/rechazar', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const resolved = await db.resolverSolicitudAsignacion(id, res.locals.user?.id, false);
    if (NOTIF_EMAILS_ENABLED && resolved?.ok && resolved?.tipo === 'pedido_especial' && resolved?.comercial_email) {
      const pedidoUrl = resolved?.id_pedido ? `${APP_BASE_URL}/pedidos/${resolved.id_pedido}` : '';
      await sendPedidoEspecialDecisionEmail(String(resolved.comercial_email), {
        decision: 'rechazado',
        pedidoNum: resolved.num_pedido || '',
        clienteNombre: resolved.cliente_nombre || '',
        pedidoUrl
      }).catch(() => null);
    }
    return res.redirect('/notificaciones?resuelto=rechazada');
  } catch (e) {
    next(e);
  }
});

// Notificaciones del comercial (sus propias solicitudes y respuestas)
app.get('/mis-notificaciones', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    if (admin) return res.redirect('/notificaciones');
    const userId = Number(res.locals.user?.id);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * limit;
    const items = await db.getNotificacionesForComercial(userId, limit, offset).catch(() => []);
    const total = await db.getNotificacionesForComercialCount(userId).catch(() => (items?.length || 0));
    res.render('mis-notificaciones', { items: items || [], paging: { page, limit, total: total || 0 } });
  } catch (e) {
    next(e);
  }
});

app.post('/clientes/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    // Preferimos papelera (histórico) en vez de borrado duro
    await db.moverClienteAPapelera(id, res.locals.user?.email || res.locals.user?.id || 'admin');
    return res.redirect('/clientes');
  } catch (e) {
    next(e);
  }
});

app.get('/pedidos', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const userId = Number(res.locals.user?.id);
    const scopeUserId = !admin && Number.isFinite(userId) && userId > 0 ? userId : null;

    // Resolver columnas reales de pedidos (evita errores tipo "Unknown column p.ComercialId")
    const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
    const colFecha = pedidosMeta?.colFecha || 'FechaPedido';
    const colComercial = pedidosMeta?.colComercial || 'Id_Cial';
    const colEstadoTxt = pedidosMeta?.colEstado || 'EstadoPedido';
    const colEstadoId = pedidosMeta?.colEstadoId || 'Id_EstadoPedido';

    // Estado catálogo (best-effort)
    let hasEstadoIdCol = false;
    try {
      const cols = await db._getColumns(pedidosMeta?.tPedidos || 'pedidos').catch(() => []);
      hasEstadoIdCol = (cols || []).some((c) => String(c).toLowerCase() === String(colEstadoId).toLowerCase());
    } catch (_) {}

    const startYear = 2025;
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = currentYear; y >= startYear; y--) years.push(y);

    const rawYear = String(req.query.year || '').trim();
    const parsedYear = rawYear && /^\d{4}$/.test(rawYear) ? Number(rawYear) : NaN;
    const selectedYear =
      Number.isFinite(parsedYear) && parsedYear >= startYear && parsedYear <= currentYear ? parsedYear : currentYear;

    const rawMarca = String(req.query.marca || req.query.brand || '').trim();
    const parsedMarca = rawMarca && /^\d+$/.test(rawMarca) ? Number(rawMarca) : NaN;
    const selectedMarcaId = Number.isFinite(parsedMarca) && parsedMarca > 0 ? parsedMarca : null;

    const marcas = await loadMarcasForSelect(db);

    // Filtrar por año (y opcionalmente marca) usando FechaPedido (datetime)
    let items = [];
    if (selectedMarcaId) {
      items = await db.query(
        `
          SELECT DISTINCT p.*,
            ${hasEstadoIdCol ? 'ep.nombre AS EstadoPedidoNombre, ep.color AS EstadoColor,' : 'NULL AS EstadoPedidoNombre, NULL AS EstadoColor,'}
            c.Nombre_Razon_Social AS ClienteNombre,
            c.Nombre_Cial AS ClienteNombreCial
          FROM pedidos p
          LEFT JOIN clientes c ON (c.Id = p.Id_Cliente OR c.id = p.Id_Cliente)
          ${hasEstadoIdCol ? `LEFT JOIN estados_pedido ep ON ep.id = p.\`${colEstadoId}\`` : ''}
          INNER JOIN pedidos_articulos pa ON pa.Id_NumPedido = p.id
          INNER JOIN articulos a ON a.id = pa.Id_Articulo
          WHERE YEAR(p.\`${colFecha}\`) = ?
            AND a.Id_Marca = ?
            ${scopeUserId ? `AND p.\`${colComercial}\` = ?` : ''}
          ORDER BY p.id DESC
          LIMIT 200
        `,
        scopeUserId
          ? [selectedYear, selectedMarcaId, scopeUserId]
          : [selectedYear, selectedMarcaId]
      );
    } else {
      items = await db.query(
        `
          SELECT p.*,
            ${hasEstadoIdCol ? 'ep.nombre AS EstadoPedidoNombre, ep.color AS EstadoColor,' : 'NULL AS EstadoPedidoNombre, NULL AS EstadoColor,'}
            c.Nombre_Razon_Social AS ClienteNombre,
            c.Nombre_Cial AS ClienteNombreCial
          FROM pedidos p
          LEFT JOIN clientes c ON (c.Id = p.Id_Cliente OR c.id = p.Id_Cliente)
          ${hasEstadoIdCol ? `LEFT JOIN estados_pedido ep ON ep.id = p.\`${colEstadoId}\`` : ''}
          WHERE YEAR(p.\`${colFecha}\`) = ?
            ${scopeUserId ? `AND p.\`${colComercial}\` = ?` : ''}
          ORDER BY p.id DESC
          LIMIT 200
        `,
        scopeUserId ? [selectedYear, scopeUserId] : [selectedYear]
      );
    }

    const n8nFlag = String(req.query.n8n || '').trim().toLowerCase();
    const n8nPid = String(req.query.pid || '').trim();
    const n8nFile = String(req.query.file || '').trim();
    const n8nMsg = String(req.query.msg || '').trim();
    const n8nNotice =
      n8nFlag === 'ok'
        ? {
            ok: true,
            pid: n8nPid || null,
            file: n8nFile || null,
            message: `Pedido${n8nPid ? ` ${n8nPid}` : ''} enviado correctamente${n8nFile ? `.\nExcel: ${n8nFile}` : '.'}${n8nMsg ? `\n${n8nMsg}` : ''}`
          }
        : n8nFlag === 'err'
          ? {
              ok: false,
              pid: n8nPid || null,
              message: `No se pudo enviar el pedido${n8nPid ? ` ${n8nPid}` : ''} a N8N.${n8nMsg ? `\n${n8nMsg}` : ''}`
            }
          : null;

    res.render('pedidos', {
      items: items || [],
      years,
      selectedYear,
      marcas: Array.isArray(marcas) ? marcas : [],
      selectedMarcaId,
      admin,
      userId: res.locals.user?.id ?? null,
      n8nNotice
    });
  } catch (e) {
    next(e);
  }
});

// ===========================
// PEDIDOS (HTML) - Admin CRUD
// ===========================
function parseLineasFromBody(body) {
  const raw = body?.lineas ?? body?.Lineas ?? [];
  const arr = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
  const lineas = [];
  for (const l of (arr || [])) {
    const item = l && typeof l === 'object' ? l : {};
    const idArt = Number(item.Id_Articulo ?? item.id_articulo ?? item.ArticuloId ?? 0) || 0;
    const cantidad = Number(String(item.Cantidad ?? item.Unidades ?? 0).replace(',', '.')) || 0;
    let dto = undefined;
    if (item.Dto !== undefined) {
      const s = String(item.Dto ?? '').trim();
      if (s !== '') {
        const n = Number(String(s).replace(',', '.'));
        if (Number.isFinite(n)) dto = n;
      }
    }
    let precioUnit = undefined;
    if (item.PrecioUnitario !== undefined || item.Precio !== undefined) {
      const s = String(item.PrecioUnitario ?? item.Precio ?? '').trim();
      if (s !== '') {
        const n = Number(String(s).replace(',', '.'));
        if (Number.isFinite(n)) precioUnit = n;
      }
    }
    if (!idArt || cantidad <= 0) continue;
    const clean = { Id_Articulo: idArt, Cantidad: cantidad };
    if (dto !== undefined) clean.Dto = dto;
    if (precioUnit !== undefined) clean.PrecioUnitario = precioUnit;
    lineas.push(clean);
  }
  return lineas;
}

app.get('/pedidos/new', requireLogin, async (_req, res, next) => {
  try {
    const [comerciales, tarifas, formasPago, tiposPedido, descuentosPedido, estadosPedido, estadoPendienteId] = await Promise.all([
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => []),
      db.getTiposPedido().catch(() => []),
      db.getDescuentosPedidoActivos().catch(() => []),
      db.getEstadosPedidoActivos().catch(() => []),
      db.getEstadoPedidoIdByCodigo('pendiente').catch(() => null)
    ]);
    const tarifaTransfer = await db.ensureTarifaTransfer().catch(() => null);
    if (tarifaTransfer && tarifaTransfer.Id != null && !(tarifas || []).some((t) => Number(t.Id ?? t.id) === Number(tarifaTransfer.Id))) tarifas.push(tarifaTransfer);
    const formaPagoTransfer = await db.ensureFormaPagoTransfer().catch(() => null);
    if (formaPagoTransfer && (formaPagoTransfer.id ?? formaPagoTransfer.Id) != null && !(formasPago || []).some((f) => Number(f.id ?? f.Id) === Number(formaPagoTransfer.id ?? formaPagoTransfer.Id))) formasPago.push(formaPagoTransfer);
    // Nota: artículos puede ser grande; lo usamos para selector simple (mejorable con búsqueda más adelante).
    const articulos = await db.getArticulos({}).catch(() => []);
    const clientesRecent = await db
      .getClientesOptimizadoPaged({ comercial: res.locals.user?.id }, { limit: 10, offset: 0, compact: true, order: 'desc' })
      .catch(() => []);
    const admin = isAdminUser(res.locals.user);
    res.render('pedido-form', {
      mode: 'create',
      admin,
      comerciales: Array.isArray(comerciales) ? comerciales : [],
      tarifas: Array.isArray(tarifas) ? tarifas : [],
      formasPago: Array.isArray(formasPago) ? formasPago : [],
      tiposPedido: Array.isArray(tiposPedido) ? tiposPedido : [],
      descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
      estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
      articulos: Array.isArray(articulos) ? articulos : [],
      item: {
        Id_Cial: res.locals.user?.id ?? null,
        Id_Tarifa: 0,
        Serie: 'P',
        EstadoPedido: 'Pendiente',
        Id_EstadoPedido: estadoPendienteId ?? null,
        Id_FormaPago: null,
        Id_TipoPedido: null,
        Observaciones: ''
      },
      lineas: [{ Id_Articulo: '', Cantidad: 1, Dto: '' }],
      clientes: Array.isArray(clientesRecent) ? clientesRecent : [],
      // En creación siempre editable; permite cargar defaults (tarifa/direcciones) al seleccionar cliente.
      canEdit: true,
      error: null
    });
  } catch (e) {
    next(e);
  }
});

app.post('/pedidos/new', requireLogin, async (req, res, next) => {
  try {
    const [comerciales, tarifas, formasPago, tiposPedido, descuentosPedido, estadosPedido] = await Promise.all([
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => []),
      db.getTiposPedido().catch(() => []),
      db.getDescuentosPedidoActivos().catch(() => []),
      db.getEstadosPedidoActivos().catch(() => [])
    ]);
    const articulos = await db.getArticulos({}).catch(() => []);
    const body = req.body || {};
    const admin = isAdminUser(res.locals.user);
    const esEspecial = body.EsEspecial === '1' || body.EsEspecial === 1 || body.EsEspecial === true || String(body.EsEspecial || '').toLowerCase() === 'on';
    const tarifaIn = Number(body.Id_Tarifa);
    const tarifaId = Number.isFinite(tarifaIn) ? tarifaIn : NaN;
    const pedidoPayload = {
      Id_Cial: admin ? (Number(body.Id_Cial) || 0) : (Number(res.locals.user?.id) || 0),
      Id_Cliente: Number(body.Id_Cliente) || 0,
      Id_DireccionEnvio: body.Id_DireccionEnvio ? (Number(body.Id_DireccionEnvio) || null) : null,
      Id_FormaPago: body.Id_FormaPago ? (Number(body.Id_FormaPago) || 0) : 0,
      Id_TipoPedido: body.Id_TipoPedido ? (Number(body.Id_TipoPedido) || 0) : 0,
      Id_EstadoPedido: body.Id_EstadoPedido ? (Number(body.Id_EstadoPedido) || null) : null,
      // Importante: si viene 0 (default de UI), omitimos para que DB aplique tarifa del cliente.
      ...(Number.isFinite(tarifaId) && tarifaId > 0 ? { Id_Tarifa: tarifaId } : {}),
      // Serie fija para pedidos en este CRM
      Serie: 'P',
      // Pedido especial: descuentos manuales (no aplicar tabla descuentos_pedido)
      ...(esEspecial ? { EsEspecial: 1, EspecialEstado: 'pendiente', EspecialFechaSolicitud: new Date() } : { EsEspecial: 0 }),
      ...(esEspecial ? { Dto: Number(String(body.Dto || '').replace(',', '.')) || 0 } : {}),
      NumPedidoCliente: String(body.NumPedidoCliente || '').trim() || null,
      NumAsociadoHefame: body.NumAsociadoHefame != null ? String(body.NumAsociadoHefame).trim() || null : undefined,
      FechaPedido: body.FechaPedido ? String(body.FechaPedido).slice(0, 10) : undefined,
      FechaEntrega: body.FechaEntrega ? String(body.FechaEntrega).slice(0, 10) : null,
      // Legacy: mantener también el texto para instalaciones sin FK/columna
      EstadoPedido: String(body.EstadoPedido || 'Pendiente').trim(),
      Observaciones: String(body.Observaciones || '').trim() || null
    };
    const lineas = parseLineasFromBody(body);

    if (!pedidoPayload.Id_Cial || !pedidoPayload.Id_Cliente) {
      return res.status(400).render('pedido-form', {
        mode: 'create',
        admin,
        comerciales,
        tarifas,
        formasPago,
        tiposPedido: tiposPedido || [],
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        articulos,
        item: pedidoPayload,
        lineas: (body.lineas || body.Lineas) ? (Array.isArray(body.lineas || body.Lineas) ? (body.lineas || body.Lineas) : Object.values(body.lineas || body.Lineas)) : [{ Id_Articulo: '', Cantidad: 1, Dto: '' }],
        clientes: [],
        canEdit: true,
        error: 'Id_Cial e Id_Cliente son obligatorios'
      });
    }
    const clientePedido = await db.getClienteById(pedidoPayload.Id_Cliente);
    const dniCliente = clientePedido ? String(clientePedido.DNI_CIF || '').trim() : '';
    const activo = Number(clientePedido?.OK_KO ?? clientePedido?.ok_ko ?? 0) === 1;
    if (!clientePedido) {
      return res.status(400).render('pedido-form', {
        mode: 'create',
        admin,
        comerciales,
        tarifas,
        formasPago,
        tiposPedido: tiposPedido || [],
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        articulos,
        item: pedidoPayload,
        lineas,
        clientes: [],
        canEdit: true,
        error: 'Cliente no encontrado.'
      });
    }
    if (!dniCliente || dniCliente.toLowerCase() === 'pendiente') {
      return res.status(400).render('pedido-form', {
        mode: 'create',
        admin,
        comerciales,
        tarifas,
        formasPago,
        tiposPedido: tiposPedido || [],
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        articulos,
        item: pedidoPayload,
        lineas,
        clientes: await db.getClientesOptimizadoPaged({ comercial: res.locals.user?.id }, { limit: 10, offset: 0, compact: true, order: 'desc' }).catch(() => []),
        canEdit: true,
        error: 'No se pueden crear pedidos para un cliente sin DNI/CIF. Indica el DNI/CIF del cliente y asígnalo como activo.'
      });
    }
    if (!activo) {
      return res.status(400).render('pedido-form', {
        mode: 'create',
        admin,
        comerciales,
        tarifas,
        formasPago,
        tiposPedido: tiposPedido || [],
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        articulos,
        item: pedidoPayload,
        lineas,
        clientes: await db.getClientesOptimizadoPaged({ comercial: res.locals.user?.id }, { limit: 10, offset: 0, compact: true, order: 'desc' }).catch(() => []),
        canEdit: true,
        error: 'No se pueden crear pedidos para un cliente inactivo. Activa el cliente en Contactos.'
      });
    }
    if (!pedidoPayload.EstadoPedido) {
      return res.status(400).render('pedido-form', {
        mode: 'create',
        admin,
        comerciales,
        tarifas,
        formasPago,
        tiposPedido: tiposPedido || [],
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        articulos,
        item: pedidoPayload,
        lineas,
        clientes: [],
        canEdit: true,
        error: 'EstadoPedido es obligatorio'
      });
    }

    const created = await db.createPedido(pedidoPayload);
    const pedidoId = created?.insertId ?? created?.Id ?? created?.id;
    const result = await db.updatePedidoWithLineas(pedidoId, {}, lineas);
    if (esEspecial && !admin) {
      await db.ensureNotificacionPedidoEspecial(pedidoId, pedidoPayload.Id_Cliente, pedidoPayload.Id_Cial).catch(() => null);
    }
    return res.redirect(`/pedidos/${pedidoId}`);
  } catch (e) {
    next(e);
  }
});

app.get('/pedidos/:id(\\d+)/duplicate', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    const id = Number(req.params.id);
    const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
    const pk = pedidosMeta?.pk || 'id';
    const colNum = pedidosMeta?.colNumPedido || 'NumPedido';
    const cabecera = { ...item };
    delete cabecera[pk];
    delete cabecera.Id;
    delete cabecera.id;
    if (colNum) cabecera[colNum] = '';
    const lineasRaw = await db.getArticulosByPedido(id).catch(() => []);
    const pickRowCI = (row, cands) => {
      const obj = row && typeof row === 'object' ? row : {};
      const map = new Map(Object.keys(obj).map((k) => [String(k).toLowerCase(), k]));
      for (const cand of cands || []) {
        const real = map.get(String(cand).toLowerCase());
        if (real && obj[real] !== undefined) return obj[real];
      }
      return undefined;
    };
    const lineas = Array.isArray(lineasRaw) && lineasRaw.length
      ? lineasRaw.map((l) => ({
          Id_Articulo: pickRowCI(l, ['Id_Articulo', 'id_articulo', 'ArticuloId', 'Articulo_Id']) ?? '',
          Cantidad: pickRowCI(l, ['Cantidad', 'cantidad', 'Unidades', 'Uds']) ?? 1,
          Dto: pickRowCI(l, ['Linea_Dto', 'DtoLinea', 'Dto', 'dto', 'Descuento']) ?? '',
          PrecioUnitario: pickRowCI(l, ['Linea_PVP', 'PVP', 'PrecioUnitario', 'Precio', 'PVL']) ?? ''
        }))
      : [];
    const created = await db.createPedido(cabecera);
    const newId = created?.insertId ?? created?.Id ?? created?.id;
    if (lineas.length) await db.updatePedidoWithLineas(newId, {}, lineas);
    return res.redirect(`/pedidos/${newId}/edit`);
  } catch (e) {
    next(e);
  }
});

// HEFAME solo disponible si forma de pago = Transfer y tipo de pedido incluye "HEFAME" (admin y comercial)
async function canShowHefameForPedido(item) {
  const idFormaPago = Number(item?.Id_FormaPago ?? item?.id_forma_pago ?? 0);
  const idTipoPedido = Number(item?.Id_TipoPedido ?? item?.id_tipo_pedido ?? 0);
  const [formaPago, tipos] = await Promise.all([
    idFormaPago ? db.getFormaPagoById(idFormaPago).catch(() => null) : null,
    db.getTiposPedido().catch(() => [])
  ]);
  const tipo = (tipos || []).find((t) => Number(t.id ?? t.Id) === idTipoPedido) ?? null;
  const formaPagoNombre = String(formaPago?.FormaPago ?? formaPago?.Nombre ?? formaPago?.nombre ?? '').trim();
  const tipoNombre = String(tipo?.Tipo ?? tipo?.Nombre ?? tipo?.nombre ?? '').trim();
  return /transfer/i.test(formaPagoNombre) && /hefame/i.test(tipoNombre);
}

// Para envíos (N8N): usar plantilla "Transfer" en cuanto la forma de pago sea Transfer,
// aunque el tipo no sea HEFAME (si falta, quedará el campo vacío en la plantilla).
async function isTransferPedido(item) {
  const idFormaPago = Number(item?.Id_FormaPago ?? item?.id_forma_pago ?? 0);
  if (!idFormaPago) return false;
  const formaPago = await db.getFormaPagoById(idFormaPago).catch(() => null);
  const formaPagoNombre = String(formaPago?.FormaPago ?? formaPago?.Nombre ?? formaPago?.nombre ?? '').trim();
  return /transfer/i.test(formaPagoNombre);
}

app.get('/pedidos/:id(\\d+)', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    const admin = res.locals.pedidoAdmin;
    const id = Number(req.params.id);
    const [lineas, cliente, canShowHefame] = await Promise.all([
      db.getArticulosByPedido(id).catch(() => []),
      item?.Id_Cliente ? db.getClienteById(Number(item.Id_Cliente)).catch(() => null) : null,
      canShowHefameForPedido(item)
    ]);
    let direccionEnvio = item?.Id_DireccionEnvio
      ? await db.getDireccionEnvioById(Number(item.Id_DireccionEnvio)).catch(() => null)
      : null;
    if (!direccionEnvio && cliente?.Id) {
      const dirs = await db.getDireccionesEnvioByCliente(Number(cliente.Id)).catch(() => []);
      if (Array.isArray(dirs) && dirs.length === 1) direccionEnvio = dirs[0];
    }
    res.render('pedido', { item, lineas: lineas || [], cliente, direccionEnvio, admin, canShowHefame });
  } catch (e) {
    next(e);
  }
});

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function buildStandardPedidoXlsxBuffer({ item, id, lineas, cliente, direccionEnvio, fmtDateES }) {
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const dtoPedidoPct = Math.max(0, Math.min(100, toNumUtil(item.Dto ?? item.Descuento ?? 0, 0)));

  const numPedido = String(item?.NumPedido ?? item?.Num_Pedido ?? item?.Numero_Pedido ?? '').trim();
  const safeNum = (numPedido || `pedido_${id}`).replace(/[^a-zA-Z0-9_-]+/g, '_');

  const wbNew = new ExcelJS.Workbook();
  wbNew.creator = 'CRM Gemavip';
  wbNew.created = new Date();

  const ws = wbNew.addWorksheet('Pedido', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.31, right: 0.31, top: 0.35, bottom: 0.35, header: 0.2, footer: 0.2 }
    }
  });

  // Columnas: A-H (tabla de líneas)
  ws.columns = [
    { key: 'codigo', width: 12 },
    { key: 'concepto', width: 42 },
    { key: 'pvl', width: 11 },
    { key: 'unds', width: 9 },
    { key: 'dto', width: 9 },
    { key: 'subtotal', width: 13 },
    { key: 'iva', width: 9 },
    { key: 'total', width: 13 }
  ];

  const thin = { style: 'thin', color: { argb: 'FFD1D5DB' } };
  const boxBorder = { top: thin, left: thin, bottom: thin, right: thin };
  const titleFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

  // Cabecera (empresa / meta)
  ws.mergeCells('A1:D5');
  ws.mergeCells('E1:H5');
  const cLeft = ws.getCell('A1');
  cLeft.value = 'GEMAVIP ESPAÑA SL.\nB19427004\nCALLE DE LA SEÑA 2\nCARTAGENA (30201), Murcia, España\npedidosespana@gemavip.com · +34 686 48 36 84';
  cLeft.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  cLeft.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF0F172A' } };

  const cRight = ws.getCell('E1');
  const fecha = fmtDateES ? fmtDateES(item.FechaPedido ?? item.Fecha ?? '') : '';
  const entrega = item?.FechaEntrega && fmtDateES ? fmtDateES(item.FechaEntrega) : '';
  const numPedidoCliente = String(item?.NumPedidoCliente ?? item?.Num_Pedido_Cliente ?? '').trim();
  cRight.value =
    `PEDIDO #${numPedido || id}\n` +
    `Fecha: ${fecha || ''}\n` +
    (entrega ? `Entrega: ${entrega}\n` : '') +
    (numPedidoCliente ? `Nº Pedido Cliente: ${numPedidoCliente}\n` : '');
  cRight.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  cRight.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FF0F172A' } };

  ws.getRow(6).height = 6;

  // Direcciones: 50% + 50%
  ws.mergeCells('A7:D12');
  ws.mergeCells('E7:H12');
  const clienteNombre = cliente?.Nombre_Razon_Social || cliente?.Nombre || '';
  const clienteCif = cliente?.DNI_CIF || cliente?.DniCif || '';
  const clienteDir = cliente?.Direccion || '';
  const clientePob = cliente?.Poblacion || '';
  const clienteCp = cliente?.CodigoPostal || '';
  const clienteEmail = cliente?.Email || '';
  const clienteTel = cliente?.Telefono || cliente?.Movil || '';

  const a1 = ws.getCell('A7');
  a1.value =
    `CLIENTE\n` +
    `${clienteNombre || item?.Id_Cliente || ''}\n` +
    (clienteCif ? `${clienteCif}\n` : '') +
    (clienteDir ? `${clienteDir}\n` : '') +
    ([clienteCp, clientePob].filter(Boolean).join(' ') ? `${[clienteCp, clientePob].filter(Boolean).join(' ')}\n` : '') +
    ([clienteEmail, clienteTel].filter(Boolean).join(' · ') ? `${[clienteEmail, clienteTel].filter(Boolean).join(' · ')}` : '');
  a1.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  a1.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F172A' } };

  const b1 = ws.getCell('E7');
  const dir = direccionEnvio || null;
  const envioTitle = 'DIRECCIÓN DE ENVÍO';
  b1.value =
    `${envioTitle}\n` +
    (dir
      ? [
          dir.Alias || dir.Nombre_Destinatario || clienteNombre || '—',
          dir.Nombre_Destinatario && dir.Alias ? dir.Nombre_Destinatario : '',
          dir.Direccion || '',
          dir.Direccion2 || '',
          [dir.CodigoPostal, dir.Poblacion].filter(Boolean).join(' '),
          dir.Pais || '',
          [dir.Email, dir.Telefono, dir.Movil].filter(Boolean).join(' · '),
          dir.Observaciones || ''
        ]
          .filter(Boolean)
          .join('\n')
      : `${clienteNombre || '—'}\n(Sin dirección de envío)`);
  b1.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  b1.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F172A' } };

  // Bordes cajas
  for (const addr of ['A7', 'E7']) {
    ws.getCell(addr).border = boxBorder;
    ws.getCell(addr).fill = titleFill;
  }
  // Excel aplica borde solo a la celda superior izquierda en merged; dibujamos perímetro por rango
  const boxRanges = [
    { r1: 7, c1: 1, r2: 12, c2: 4 },
    { r1: 7, c1: 5, r2: 12, c2: 8 }
  ];
  for (const rg of boxRanges) {
    for (let r = rg.r1; r <= rg.r2; r++) {
      for (let c = rg.c1; c <= rg.c2; c++) {
        const cell = ws.getCell(r, c);
        const b = {};
        if (r === rg.r1) b.top = thin;
        if (r === rg.r2) b.bottom = thin;
        if (c === rg.c1) b.left = thin;
        if (c === rg.c2) b.right = thin;
        cell.border = { ...(cell.border || {}), ...b };
      }
    }
  }

  ws.getRow(13).height = 6;

  // Tabla líneas
  const headerRowNum = 14;
  const header = ws.getRow(headerRowNum);
  header.values = ['CÓDIGO', 'CONCEPTO', 'PVL', 'UNDS', 'DTO', 'SUBTOTAL', 'IVA', 'TOTAL'];
  header.height = 18;
  header.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F172A' } };
    cell.fill = titleFill;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = boxBorder;
  });
  header.getCell(3).alignment = { vertical: 'middle', horizontal: 'right' };
  header.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' };
  header.getCell(5).alignment = { vertical: 'middle', horizontal: 'right' };
  header.getCell(6).alignment = { vertical: 'middle', horizontal: 'right' };
  header.getCell(7).alignment = { vertical: 'middle', horizontal: 'right' };
  header.getCell(8).alignment = { vertical: 'middle', horizontal: 'right' };

  let rowNum = headerRowNum + 1;
  let sumBase = 0;
  let sumIva = 0;
  let sumTotal = 0;

  const moneyFmt = '#,##0.00"€"';
  const pctFmt = '0.00"%"';

  (Array.isArray(lineas) ? lineas : []).forEach((l) => {
    const codigo = String(l.SKU ?? l.Codigo ?? l.Id_Articulo ?? l.id_articulo ?? '').trim();
    const concepto = String(l.Nombre ?? l.Descripcion ?? l.Articulo ?? l.nombre ?? '').trim();
    const qty = Math.max(0, toNumUtil(l.Cantidad ?? l.Unidades ?? 0, 0));
    const pvl = Math.max(0, toNumUtil(l.Linea_PVP ?? l.PVP ?? l.pvp ?? l.PrecioUnitario ?? l.PVL ?? l.Precio ?? l.pvl ?? 0, 0));
    const dto = Math.max(0, Math.min(100, toNumUtil(l.Linea_Dto ?? l.DtoLinea ?? l.dto_linea ?? l.Dto ?? l.dto ?? l.Descuento ?? 0, 0)));
    let ivaPct = toNumUtil(l.Linea_IVA ?? l.IVA ?? l.PorcIVA ?? l.PorcentajeIVA ?? l.TipoIVA ?? 0, 0);
    if (ivaPct > 100) ivaPct = 0;

    const baseCalc = round2(qty * pvl * (1 - dto / 100) * (1 - dtoPedidoPct / 100));
    const ivaCalc = round2(baseCalc * ivaPct / 100);
    const totalCalc = round2(baseCalc + ivaCalc);

    sumBase += baseCalc;
    sumIva += ivaCalc;
    sumTotal += totalCalc;

    const r = ws.getRow(rowNum++);
    r.getCell(1).value = codigo || '';
    r.getCell(2).value = concepto || '';
    r.getCell(3).value = pvl || null;
    r.getCell(4).value = qty || null;
    r.getCell(5).value = dto || null;
    r.getCell(6).value = baseCalc || null;
    r.getCell(7).value = ivaPct || null;
    r.getCell(8).value = totalCalc || null;

    r.getCell(2).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    for (const c of [1, 3, 4, 5, 6, 7, 8]) {
      r.getCell(c).alignment = { vertical: 'top', horizontal: c === 1 ? 'left' : 'right', wrapText: false };
    }
    r.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF111827' } };
      cell.border = boxBorder;
    });
    r.getCell(3).numFmt = moneyFmt;
    r.getCell(6).numFmt = moneyFmt;
    r.getCell(8).numFmt = moneyFmt;
    r.getCell(5).numFmt = pctFmt;
    r.getCell(7).numFmt = pctFmt;
  });

  // Totales
  const totalsStart = rowNum + 1;
  ws.getRow(totalsStart).height = 6;
  const tRow1 = ws.getRow(totalsStart + 1);
  tRow1.getCell(6).value = 'BASE IMPONIBLE';
  tRow1.getCell(8).value = round2(sumBase);
  tRow1.getCell(8).numFmt = moneyFmt;
  const tRow2 = ws.getRow(totalsStart + 2);
  tRow2.getCell(6).value = 'IVA';
  tRow2.getCell(8).value = round2(sumIva);
  tRow2.getCell(8).numFmt = moneyFmt;
  const tRow3 = ws.getRow(totalsStart + 3);
  tRow3.getCell(6).value = 'TOTAL';
  tRow3.getCell(8).value = round2(sumTotal);
  tRow3.getCell(8).numFmt = moneyFmt;

  const styleTotals = (r) => {
    [6, 7, 8].forEach((c) => {
      const cell = r.getCell(c);
      cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF0F172A' } };
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    });
    r.getCell(6).alignment = { vertical: 'middle', horizontal: 'right' };
    r.getCell(8).font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FF0F172A' } };
  };
  styleTotals(tRow1);
  styleTotals(tRow2);
  styleTotals(tRow3);

  if (dtoPedidoPct) {
    const tRow0 = ws.getRow(totalsStart);
    tRow0.getCell(6).value = 'DTO PEDIDO';
    tRow0.getCell(8).value = dtoPedidoPct;
    tRow0.getCell(8).numFmt = pctFmt;
    styleTotals(tRow0);
    tRow0.getCell(8).font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF0F172A' } };
  }

  const endRow = totalsStart + 3;
  ws.pageSetup.printArea = `A1:H${endRow}`;

  const buf = await wbNew.xlsx.writeBuffer();
  return { buf: Buffer.from(buf), filename: `PEDIDO_${safeNum}.xlsx` };
}

app.get('/pedidos/:id(\\d+).xlsx', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    const id = Number(req.params.id);
    const [lineas, cliente] = await Promise.all([
      db.getArticulosByPedido(id).catch(() => []),
      item?.Id_Cliente ? db.getClienteById(Number(item.Id_Cliente)).catch(() => null) : Promise.resolve(null)
    ]);

    let direccionEnvio = item?.Id_DireccionEnvio
      ? await db.getDireccionEnvioById(Number(item.Id_DireccionEnvio)).catch(() => null)
      : null;
    if (!direccionEnvio && cliente?.Id) {
      const dirs = await db.getDireccionesEnvioByCliente(Number(cliente.Id), { compact: false }).catch(() => []);
      if (Array.isArray(dirs) && dirs.length === 1) direccionEnvio = dirs[0];
    }

    const { buf, filename } = await buildStandardPedidoXlsxBuffer({
      item,
      id,
      lineas,
      cliente,
      direccionEnvio,
      fmtDateES: res.locals.fmtDateES
    });

    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.end(buf);
  } catch (e) {
    next(e);
  }
});

// Página Hefame: envío por email deshabilitado; enlace a descargar Excel (se intentará en otro momento)
app.get('/pedidos/:id(\\d+)/hefame-send-email', requireLogin, loadPedidoAndCheckOwner, async (req, res) => {
  const item = res.locals.pedido;
  if (!(await canShowHefameForPedido(item))) {
    res.status(403).send('HEFAME solo disponible para pedidos con forma de pago Transfer y tipo HEFAME.');
    return;
  }
  const id = Number(req.params.id);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderHefameInfoPage(true, 'El envío por email está temporalmente deshabilitado.\n\nPuede descargar la plantilla Excel con los datos del pedido para Hefame usando el enlace siguiente.', id));
});

function renderHefameInfoPage(ok, details, pedidoId) {
  const color = ok ? '#2563eb' : '#dc2626';
  const downloadLink = pedidoId
    ? `<p style="margin-top:20px;"><a href="/pedidos/${pedidoId}/hefame.xlsx" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Descargar plantilla Excel Hefame</a></p>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Export Hefame · CRM Gemavip</title></head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;background:#f3f4f6;">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:24px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <h2 style="margin:0 0 12px;font-size:18px;color:${color};">Export Hefame</h2>
    <div style="white-space:pre-wrap;word-break:break-word;color:#374151;margin:8px 0;line-height:1.5;">${escapeHtmlUtil(details)}</div>
    ${downloadLink}
  </div>
</body></html>`;
}

async function buildHefameXlsxBuffer({ item, id, lineas, cliente }) {
  const numPedido = String(item?.NumPedido ?? item?.Num_Pedido ?? item?.Numero_Pedido ?? '').trim();

  const hefameTemplatePath =
    process.env.HEFAME_EXCEL_TEMPLATE_PATH ||
    path.join(__dirname, '..', 'templates', 'PLANTILLA TRANSFER DIRECTO CRM.xlsx');

  let wb;
  try {
    await fs.access(hefameTemplatePath);
    wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(hefameTemplatePath);
  } catch (e) {
    console.warn('Plantilla Hefame no encontrada:', hefameTemplatePath, e?.message);
    return { ok: false, status: 404, error: 'Plantilla Excel Hefame no encontrada. Coloca PLANTILLA TRANSFER DIRECTO CRM.xlsx en templates/.' };
  }

  if (!wb || !wb.worksheets || wb.worksheets.length === 0) {
    return { ok: false, status: 500, error: 'Plantilla Hefame sin hojas.' };
  }

  const ws = wb.worksheets[0];

  const todayDDMMYYYY = () => {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  };

  const valorF5 = numPedido || todayDDMMYYYY();
  const nombre = cliente?.Nombre_Razon_Social || cliente?.Nombre || item?.Id_Cliente || '';
  const codigoHefame = String(item?.NumAsociadoHefame ?? item?.num_asociado_hefame ?? '').trim();
  const telefono = cliente?.Telefono || cliente?.Movil || cliente?.Teléfono || '';
  const cp = String(cliente?.CodigoPostal ?? '').trim();
  const poblacion = String(cliente?.Poblacion ?? '').trim();
  const poblacionConCP = [cp, poblacion].filter(Boolean).join(' ');

  try {
    ws.getCell('F5').value = valorF5;
    ws.getCell('C13').value = nombre;
    ws.getCell('C14').value = codigoHefame;
    ws.getCell('C15').value = telefono;
    ws.getCell('C16').value = poblacionConCP;
  } catch (e) {
    console.warn('Hefame Excel: error escribiendo cabecera', e?.message);
  }

  const lineasArr = Array.isArray(lineas) ? lineas : [];
  const firstDataRow = 21;
  lineasArr.forEach((l, idx) => {
    const row = firstDataRow + idx;
    const cantidad = Math.max(0, toNumUtil(l.Cantidad ?? l.Unidades ?? 0, 0));
    const cn = String(l.SKU ?? l.Codigo ?? l.Id_Articulo ?? l.id_articulo ?? '').trim();
    const descripcion = String(l.Nombre ?? l.Descripcion ?? l.Articulo ?? l.nombre ?? '').trim();
    const descuentoPct = Math.max(0, Math.min(100, toNumUtil(l.Linea_Dto ?? l.DtoLinea ?? l.Dto ?? l.dto ?? l.Descuento ?? 0, 0)));
    const descuentoExcel = descuentoPct / 100;

    try {
      ws.getRow(row).getCell(2).value = cantidad;
      ws.getRow(row).getCell(3).value = cn;
      ws.getRow(row).getCell(4).value = descripcion;
      ws.getRow(row).getCell(5).value = descuentoExcel;
    } catch (e) {
      console.warn('Hefame Excel: error escribiendo línea', row, e?.message);
    }
  });

  const buf = await wb.xlsx.writeBuffer();

  const today = new Date();
  const yyyymmdd =
    today.getFullYear() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  const nombreClienteRaw = cliente?.Nombre_Razon_Social || cliente?.Nombre || '';
  const nombreClienteSafe = String(nombreClienteRaw)
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s/g, '_')
    .slice(0, 80) || 'cliente';
  const pedidoNum = numPedido || `pedido_${id}`;
  const attachmentFileName = `${yyyymmdd}_${nombreClienteSafe}-${pedidoNum}.xlsx`;

  return { ok: true, buf: Buffer.from(buf), filename: attachmentFileName };
}

app.get('/pedidos/:id(\\d+)/hefame.xlsx', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    if (!(await canShowHefameForPedido(item))) {
      res.status(403).send('HEFAME solo disponible para pedidos con forma de pago Transfer y tipo HEFAME.');
      return;
    }
    const id = Number(req.params.id);
    const lineas = await db.getArticulosByPedido(id).catch(() => []);
    const cliente = item?.Id_Cliente ? await db.getClienteById(Number(item.Id_Cliente)).catch(() => null) : null;
    const built = await buildHefameXlsxBuffer({ item, id, lineas, cliente });
    if (!built.ok) return res.status(built.status || 500).send(built.error || 'No se pudo generar el Excel Hefame.');

    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${built.filename}"`);
    return res.end(built.buf);
  } catch (e) {
    next(e);
  }
});

app.post('/pedidos/:id(\\d+)/enviar-n8n', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    // Webhook N8N (preservado para futuro). No se usa en el flujo actual.
    // const webhookFromDb = await db.getVariableSistema?.(SYSVAR_N8N_PEDIDOS_WEBHOOK_URL).catch(() => null);
    // const webhookUrl = String(webhookFromDb || process.env.N8N_PEDIDOS_WEBHOOK_URL || '').trim();
    const item = res.locals.pedido;
    const id = Number(req.params.id);

    const [lineas, cliente] = await Promise.all([
      db.getArticulosByPedido(id).catch(() => []),
      item?.Id_Cliente ? db.getClienteById(Number(item.Id_Cliente)).catch(() => null) : Promise.resolve(null)
    ]);

    let direccionEnvio = null;
    try {
      direccionEnvio = item?.Id_DireccionEnvio
        ? await db.getDireccionEnvioById(Number(item.Id_DireccionEnvio)).catch(() => null)
        : null;
      if (!direccionEnvio && cliente?.Id) {
        const dirs = await db.getDireccionesEnvioByCliente(Number(cliente.Id), { compact: false }).catch(() => []);
        if (Array.isArray(dirs) && dirs.length === 1) direccionEnvio = dirs[0];
      }
    } catch (_) {
      direccionEnvio = null;
    }

    const isTransfer = await isTransferPedido(item).catch(() => false);
    let excel;
    let excelTipo = 'estandar';
    if (isTransfer) {
      const built = await buildHefameXlsxBuffer({ item, id, lineas, cliente });
      if (!built.ok) {
        return res.redirect(
          `/pedidos?n8n=err&pid=${encodeURIComponent(String(id))}&msg=${encodeURIComponent(built.error || 'No se pudo generar el Excel (Transfer).')}`
        );
      }
      excel = { buf: built.buf, filename: built.filename };
      excelTipo = 'transfer';
    } else {
      const built = await buildStandardPedidoXlsxBuffer({
        item,
        id,
        lineas,
        cliente,
        direccionEnvio,
        fmtDateES: res.locals.fmtDateES
      });
      excel = { buf: built.buf, filename: built.filename };
      excelTipo = 'directo';
    }

    const payload = {
      requestId: req.requestId,
      sentAt: new Date().toISOString(),
      excelTipo,
      pedido: (() => {
        const pedidoId = Number(item?.Id ?? item?.id ?? id) || id;
        const numPedido = String(item?.NumPedido ?? item?.Num_Pedido ?? item?.Numero_Pedido ?? '').trim();
        const numPedidoCliente = String(item?.NumPedidoCliente ?? item?.Num_Pedido_Cliente ?? '').trim();
        const idCliente = Number(item?.Id_Cliente ?? item?.id_cliente ?? cliente?.Id ?? cliente?.id ?? 0) || null;
        const idComercial = Number(item?.Id_Cial ?? item?.id_cial ?? item?.ComercialId ?? item?.comercialId ?? 0) || null;
        const idFormaPago = Number(item?.Id_FormaPago ?? item?.id_forma_pago ?? 0) || null;
        const idTipoPedido = Number(item?.Id_TipoPedido ?? item?.id_tipo_pedido ?? 0) || null;
        const idTarifa = (item?.Id_Tarifa ?? item?.id_tarifa);
        const tarifaIdNum = idTarifa === null || idTarifa === undefined || String(idTarifa).trim() === '' ? null : (Number(idTarifa) || null);
        const idEstado = Number(item?.Id_EstadoPedido ?? item?.id_estado_pedido ?? 0) || null;

        const clienteNombre =
          cliente?.Nombre_Razon_Social || cliente?.Nombre || cliente?.nombre || item?.ClienteNombre || item?.ClienteNombreCial || '';
        const comercialNombre = item?.ComercialNombre || item?.NombreComercial || '';

        // Best-effort: resolver nombres de catálogos (no romper si falla)
        const formaPagoNombre = (item?.FormaPagoNombre || '').toString().trim();
        const tipoPedidoNombre = (item?.TipoPedidoNombre || '').toString().trim();
        const tarifaNombre = (item?.TarifaNombre || '').toString().trim();
        const estadoNombre = (item?.EstadoPedidoNombre || item?.EstadoPedido || item?.Estado || '').toString().trim();

        return {
          id: pedidoId,
          numero: numPedido || String(pedidoId),
          fecha: item?.FechaPedido ?? item?.Fecha ?? null,
          entrega: item?.FechaEntrega ?? null,
          total: item?.TotalPedido ?? item?.Total ?? null,
          subtotal: item?.SubtotalPedido ?? item?.Subtotal ?? null,
          descuentoPct: item?.Dto ?? item?.Descuento ?? null,
          observaciones: item?.Observaciones ?? null,
          numPedidoCliente: numPedidoCliente || null,
          numAsociadoHefame: item?.NumAsociadoHefame ?? item?.num_asociado_hefame ?? null,
          cliente: {
            id: idCliente,
            nombre: clienteNombre || (idCliente ? String(idCliente) : null),
            cif: cliente?.DNI_CIF ?? cliente?.DniCif ?? null,
            poblacion: cliente?.Poblacion ?? null,
            cp: cliente?.CodigoPostal ?? null,
            telefono: cliente?.Telefono ?? cliente?.Movil ?? null,
            email: cliente?.Email ?? null
          },
          comercial: {
            id: idComercial,
            nombre: comercialNombre || (idComercial ? String(idComercial) : null)
          },
          formaPago: { id: idFormaPago, nombre: formaPagoNombre || null },
          tipoPedido: { id: idTipoPedido, nombre: tipoPedidoNombre || null },
          tarifa: { id: tarifaIdNum, nombre: tarifaNombre || null },
          estado: { id: idEstado, nombre: estadoNombre || null }
        };
      })(),
      lineas: (Array.isArray(lineas) ? lineas : []).map((l) => ({
        articuloId: Number(l.Id_Articulo ?? l.id_articulo ?? l.ArticuloId ?? 0) || null,
        codigo: String(l.SKU ?? l.Codigo ?? l.Id_Articulo ?? l.id_articulo ?? '').trim() || null,
        nombre: String(l.Nombre ?? l.Descripcion ?? l.Articulo ?? l.nombre ?? '').trim() || null,
        cantidad: Number(l.Cantidad ?? l.Unidades ?? 0) || 0,
        precioUnitario: Number(l.Linea_PVP ?? l.PVP ?? l.PrecioUnitario ?? l.PVL ?? l.Precio ?? 0) || 0,
        descuentoPct: Number(l.Linea_Dto ?? l.DtoLinea ?? l.Dto ?? l.dto ?? l.Descuento ?? 0) || 0,
        ivaPct: Number(l.Linea_IVA ?? l.IVA ?? l.PorcIVA ?? l.PorcentajeIVA ?? 0) || 0
      })),
      cliente: cliente
        ? {
            id: cliente?.Id ?? cliente?.id ?? null,
            nombre: cliente?.Nombre_Razon_Social ?? cliente?.Nombre ?? cliente?.nombre ?? null,
            cif: cliente?.DNI_CIF ?? cliente?.DniCif ?? null,
            direccion: cliente?.Direccion ?? null,
            poblacion: cliente?.Poblacion ?? null,
            cp: cliente?.CodigoPostal ?? null,
            telefono: cliente?.Telefono ?? cliente?.Movil ?? null,
            email: cliente?.Email ?? null
          }
        : null,
      direccionEnvio,
      excel: {
        filename: excel.filename,
        mime: XLSX_MIME,
        base64: excel.buf.toString('base64')
      }
    };

    // === ENVÍO POR EMAIL (modo actual) ===
    // Nota: mantenemos el código de N8N más abajo, pero no se ejecuta por defecto.
    const mailToFromDb = await db.getVariableSistema?.(SYSVAR_PEDIDOS_MAIL_TO).catch(() => null);
    const mailTo = String(mailToFromDb || process.env.PEDIDOS_MAIL_TO || 'p.lara@gemavip.com').trim() || 'p.lara@gemavip.com';
    const pedidoNum = String(item?.NumPedido ?? item?.Num_Pedido ?? item?.Numero_Pedido ?? id).trim();
    const clienteNombre =
      (payload?.pedido?.cliente?.nombre ? String(payload.pedido.cliente.nombre) : '') ||
      String(item?.ClienteNombre ?? item?.ClienteNombreCial ?? '').trim() ||
      '';
    const totalLabel = item?.TotalPedido ?? item?.Total ?? null;
    const pedidoUrl = `${APP_BASE_URL}/pedidos/${id}`;
    const subject = `Pedido ${pedidoNum}${clienteNombre ? ` · ${clienteNombre}` : ''} · CRM Gemavip`;

    const signatureText = [
      '--',
      'GEMAVIP',
      'Paco Lara',
      'Key Account Manager',
      'GEMAVIP',
      'Email: p.lara@gemavip.com',
      'Tel: +34 610 72 13 69',
      'Web: gemavip.com/es/ | farmadescanso.com',
      'LinkedIn',
      'Valoraciones Trustpilot',
      '',
      'Aviso de confidencialidad: La información contenida en esta comunicación electrónica y en sus archivos adjuntos es confidencial, privilegiada y está dirigida exclusivamente a la persona o entidad a la que va destinada. Si usted no es el destinatario previsto, se le notifica que cualquier lectura, uso, copia, distribución, divulgación o reproducción de este mensaje y sus anexos está estrictamente prohibida y puede constituir un delito. Si ha recibido este correo por error, le rogamos que lo notifique inmediatamente al remitente respondiendo a este mensaje y proceda a su eliminación de su sistema.',
      '',
      'Protección de datos: De conformidad con el Reglamento (UE) 2016/679 del Parlamento Europeo y del Consejo (RGPD) y la Ley Orgánica 3/2018, de 5 de diciembre, de Protección de Datos Personales y garantía de los derechos digitales (LOPDGDD), garantizo la adopción de todas las medidas técnicas y organizativas necesarias para el tratamiento seguro y confidencial de sus datos personales. Puede ejercer sus derechos de acceso, rectificación, supresión, limitación, portabilidad y oposición escribiendo a p.lara@gemavip.com.',
      '',
      'Exención de responsabilidad: No me hago responsable de la transmisión íntegra y puntual de este mensaje, ni de posibles retrasos, errores, alteraciones o pérdidas que pudieran producirse en su recepción. Este mensaje no constituye ningún compromiso, salvo que exista un acuerdo expreso y por escrito entre las partes.'
    ].join('\n');

    const linesText = (payload.lineas || [])
      .slice(0, 60)
      .map((l) => `- ${l.codigo || l.articuloId || '—'} · ${l.nombre || ''} · uds: ${l.cantidad ?? 0}`)
      .join('\n');

    const text = [
      'Pedido enviado desde CRM Gemavip.',
      '',
      `Pedido: ${pedidoNum}`,
      clienteNombre ? `Cliente: ${clienteNombre}` : null,
      totalLabel != null ? `Total: ${String(totalLabel)}` : null,
      `Enlace: ${pedidoUrl}`,
      '',
      (linesText ? `Líneas (resumen):\n${linesText}\n` : ''),
      signatureText
    ]
      .filter(Boolean)
      .join('\n');

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:1.45;color:#111827;">
        <h2 style="margin:0 0 10px 0;font-size:16px;">Pedido enviado desde CRM Gemavip</h2>
        <div style="margin:0 0 12px 0;">
          <div><strong>Pedido:</strong> ${escapeHtmlUtil(pedidoNum)}</div>
          ${clienteNombre ? `<div><strong>Cliente:</strong> ${escapeHtmlUtil(clienteNombre)}</div>` : ''}
          ${totalLabel != null ? `<div><strong>Total:</strong> ${escapeHtmlUtil(String(totalLabel))}</div>` : ''}
          <div><strong>Enlace:</strong> <a href="${escapeHtmlUtil(pedidoUrl)}">${escapeHtmlUtil(pedidoUrl)}</a></div>
        </div>
        ${
          linesText
            ? `<div style="margin: 0 0 12px 0;"><strong>Líneas (resumen)</strong><div style="white-space:pre-wrap;margin-top:6px;">${escapeHtmlUtil(linesText)}</div></div>`
            : ''
        }
        <hr style="border:0;border-top:1px solid #e5e7eb;margin:16px 0;" />
        <div style="white-space:pre-wrap;color:#111827;">${escapeHtmlUtil(signatureText)}</div>
      </div>
    `.trim();

    const mailRes = await sendPedidoEmail(mailTo, {
      subject,
      text,
      html,
      attachments: [
        {
          filename: excel.filename,
          content: excel.buf,
          contentType: XLSX_MIME
        }
      ]
    });

    if (!mailRes?.sent) {
      return res.redirect(
        `/pedidos?n8n=err&pid=${encodeURIComponent(String(id))}&msg=${encodeURIComponent(`No se pudo enviar el email: ${mailRes?.error || 'error desconocido'}`)}`
      );
    }

    // Resultado OK por email
    // (Reutilizamos el aviso existente en /pedidos, aunque internamente no hayamos llamado a N8N)
    /*
    // === CÓDIGO N8N (PRESERVADO, NO EJECUTAR) ===
    // Si se quisiera reactivar en el futuro:
    // 1) resolver webhookUrl (BD o .env)
    // 2) enviar axios.post(webhookUrl, payload, { headers: { 'Content-Type': 'application/json' }, ... })
    */

    return res.redirect(
      `/pedidos?n8n=ok&pid=${encodeURIComponent(String(id))}&file=${encodeURIComponent(excel.filename)}&msg=${encodeURIComponent(`Email enviado a ${mailTo}`)}`
    );
  } catch (e) {
    console.error('Enviar pedido a N8N: error', e?.message);
    return res.redirect(
      `/pedidos?n8n=err&pid=${encodeURIComponent(String(req.params.id || ''))}&msg=${encodeURIComponent('Error enviando a N8N. Revisa logs/soporte.')}`
    );
  }
});

app.get('/pedidos/:id(\\d+)/edit', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    const admin = res.locals.pedidoAdmin;
    const id = Number(req.params.id);
    const [tarifas, formasPago, comerciales, tiposPedido, descuentosPedido, estadosPedido] = await Promise.all([
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => []),
      db.getComerciales().catch(() => []),
      db.getTiposPedido().catch(() => []),
      db.getDescuentosPedidoActivos().catch(() => []),
      db.getEstadosPedidoActivos().catch(() => [])
    ]);
    const tarifaTransfer = await db.ensureTarifaTransfer().catch(() => null);
    if (tarifaTransfer && tarifaTransfer.Id != null && !(tarifas || []).some((t) => Number(t.Id ?? t.id) === Number(tarifaTransfer.Id))) tarifas.push(tarifaTransfer);
    const formaPagoTransfer = await db.ensureFormaPagoTransfer().catch(() => null);
    if (formaPagoTransfer && (formaPagoTransfer.id ?? formaPagoTransfer.Id) != null && !(formasPago || []).some((f) => Number(f.id ?? f.Id) === Number(formaPagoTransfer.id ?? formaPagoTransfer.Id))) formasPago.push(formaPagoTransfer);

    const estadoNorm = String(item.EstadoPedido ?? item.Estado ?? 'Pendiente').trim().toLowerCase() || 'pendiente';
    const especial = Number(item.EsEspecial ?? item.es_especial ?? 0) === 1;
    const especialEstado = String(item.EspecialEstado ?? item.especial_estado ?? '').trim().toLowerCase();
    const especialPendiente = especial && (especialEstado === 'pendiente' || especialEstado === '' || especialEstado === 'solicitado');
    const canEdit = admin ? (estadoNorm !== 'pagado') : ((estadoNorm === 'pendiente') && !especialPendiente);
    if (!canEdit) {
      return renderErrorPage(req, res, {
        status: 403,
        heading: 'No permitido',
        summary: admin
          ? 'Un pedido en estado "Pagado" no se puede modificar.'
          : (especialPendiente ? 'Este pedido especial está pendiente de aprobación del administrador.' : 'Solo puedes modificar pedidos en estado "Pendiente".'),
        publicMessage: especialPendiente
          ? 'Acción requerida: el administrador debe aprobar o rechazar el pedido especial.'
          : `Estado actual: ${String(item.EstadoPedido ?? item.Estado ?? '—')}`
      });
    }

    const cliente = item?.Id_Cliente ? await db.getClienteById(Number(item.Id_Cliente)).catch(() => null) : null;
    const clienteLabel = cliente
      ? (() => {
          const idc = cliente.Id ?? cliente.id ?? item.Id_Cliente ?? '';
          const rs = cliente.Nombre_Razon_Social ?? cliente.Nombre ?? '';
          const nc = cliente.Nombre_Cial ?? '';
          const cif = cliente.DNI_CIF ?? '';
          const pob = cliente.Poblacion ?? '';
          const cp = cliente.CodigoPostal ?? '';
          const parts = [rs, nc].filter(Boolean).join(' / ');
          const extra = [cif, [cp, pob].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
          return `${idc} · ${parts || 'Sin nombre'}${extra ? ` · ${extra}` : ''}`.trim();
        })()
      : '';
    const articulos = await db.getArticulos({}).catch(() => []);
    const clientesRecent = await db
      .getClientesOptimizadoPaged({ comercial: item?.Id_Cial ?? res.locals.user?.id }, { limit: 10, offset: 0, compact: true, order: 'desc' })
      .catch(() => []);
    const lineasRaw = await db.getArticulosByPedido(id).catch(() => []);

    // Helper: leer valores de columnas con nombres variables (case-insensitive)
    const pickRowCI = (row, cands) => {
      const obj = row && typeof row === 'object' ? row : {};
      const map = new Map(Object.keys(obj).map((k) => [String(k).toLowerCase(), k]));
      for (const cand of (cands || [])) {
        const real = map.get(String(cand).toLowerCase());
        if (real && obj[real] !== undefined) return obj[real];
      }
      return undefined;
    };

    const lineas = Array.isArray(lineasRaw) && lineasRaw.length
      ? lineasRaw.map((l) => ({
          Id_Articulo:
            pickRowCI(l, [
              'Id_Articulo',
              'id_articulo',
              'ArticuloId',
              'articuloid',
              'Articulo_Id',
              'articulo_id',
              'IdArticulo',
              'idArticulo'
            ]) ?? '',
          Cantidad:
            pickRowCI(l, ['Cantidad', 'cantidad', 'Unidades', 'unidades', 'Uds', 'uds', 'Cant', 'cant']) ?? 1,
          // DTO puede llamarse Dto/DTO/Descuento/PorcentajeDescuento...
          Dto:
            pickRowCI(l, ['Linea_Dto', 'DtoLinea', 'dto_linea', 'Dto', 'dto', 'DTO', 'Descuento', 'descuento', 'PorcentajeDescuento', 'porcentaje_descuento', 'DtoLinea', 'dto_linea']) ?? '',
          // Mostrar PVL en edición: si viene guardado en línea, precargarlo (si no, el JS lo calcula por tarifa)
          PrecioUnitario:
            pickRowCI(l, ['Linea_PVP', 'PVP', 'pvp', 'PrecioUnitario', 'precio_unitario', 'Precio', 'precio', 'PVL', 'pvl']) ?? ''
        }))
      : [{ Id_Articulo: '', Cantidad: 1, Dto: '' }];
    res.render('pedido-form', {
      mode: 'edit',
      admin,
      item,
      lineas,
      tarifas,
      formasPago,
      tiposPedido: Array.isArray(tiposPedido) ? tiposPedido : [],
      descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
      estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
      comerciales,
      articulos,
      clientes: Array.isArray(clientesRecent) ? clientesRecent : [],
      cliente,
      clienteLabel,
      canEdit,
      error: null
    });
  } catch (e) {
    next(e);
  }
});

app.post('/pedidos/:id(\\d+)/edit', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const existing = res.locals.pedido;
    const admin = res.locals.pedidoAdmin;
    const id = Number(req.params.id);

    const estadoNorm = String(existing.EstadoPedido ?? existing.Estado ?? 'Pendiente').trim().toLowerCase() || 'pendiente';
    const existingEspecial = Number(existing.EsEspecial ?? existing.es_especial ?? 0) === 1;
    const existingEspecialEstado = String(existing.EspecialEstado ?? existing.especial_estado ?? '').trim().toLowerCase();
    const existingEspecialPendiente = existingEspecial && (existingEspecialEstado === 'pendiente' || existingEspecialEstado === '' || existingEspecialEstado === 'solicitado');
    const canEdit = admin ? (estadoNorm !== 'pagado') : ((estadoNorm === 'pendiente') && !existingEspecialPendiente);
    if (!canEdit) {
      return renderErrorPage(req, res, {
        status: 403,
        heading: 'No permitido',
        summary: admin
          ? 'Un pedido en estado "Pagado" no se puede modificar.'
          : (existingEspecialPendiente ? 'Este pedido especial está pendiente de aprobación del administrador.' : 'Solo puedes modificar pedidos en estado "Pendiente".'),
        publicMessage: existingEspecialPendiente
          ? 'Acción requerida: el administrador debe aprobar o rechazar el pedido especial.'
          : `Estado actual: ${String(existing.EstadoPedido ?? existing.Estado ?? '—')}`
      });
    }

    const [tarifas, formasPago, comerciales, tiposPedido, descuentosPedido, estadosPedido] = await Promise.all([
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => []),
      db.getComerciales().catch(() => []),
      db.getTiposPedido().catch(() => []),
      db.getDescuentosPedidoActivos().catch(() => []),
      db.getEstadosPedidoActivos().catch(() => [])
    ]);
    const articulos = await db.getArticulos({}).catch(() => []);

    const body = req.body || {};
    const esEspecial = body.EsEspecial === '1' || body.EsEspecial === 1 || body.EsEspecial === true || String(body.EsEspecial || '').toLowerCase() === 'on';
    const pedidoPayload = {
      Id_Cial: admin ? (Number(body.Id_Cial) || 0) : (Number(res.locals.user?.id) || 0),
      Id_Cliente: Number(body.Id_Cliente) || 0,
      Id_DireccionEnvio: body.Id_DireccionEnvio ? (Number(body.Id_DireccionEnvio) || null) : null,
      Id_FormaPago: body.Id_FormaPago ? (Number(body.Id_FormaPago) || 0) : 0,
      Id_TipoPedido: body.Id_TipoPedido ? (Number(body.Id_TipoPedido) || 0) : 0,
      Id_Tarifa: body.Id_Tarifa ? (Number(body.Id_Tarifa) || 0) : 0,
      Id_EstadoPedido: body.Id_EstadoPedido ? (Number(body.Id_EstadoPedido) || null) : null,
      Serie: 'P',
      ...(esEspecial ? { EsEspecial: 1, EspecialEstado: 'pendiente' } : { EsEspecial: 0 }),
      ...(esEspecial && !existingEspecial ? { EspecialFechaSolicitud: new Date() } : {}),
      ...(esEspecial ? { Dto: Number(String(body.Dto || '').replace(',', '.')) || 0 } : {}),
      NumPedidoCliente: String(body.NumPedidoCliente || '').trim() || null,
      NumAsociadoHefame: body.NumAsociadoHefame != null ? String(body.NumAsociadoHefame).trim() || null : undefined,
      FechaPedido: body.FechaPedido ? String(body.FechaPedido).slice(0, 10) : undefined,
      FechaEntrega: body.FechaEntrega ? String(body.FechaEntrega).slice(0, 10) : null,
      EstadoPedido: String(body.EstadoPedido || '').trim(),
      Observaciones: String(body.Observaciones || '').trim() || null
    };
    const lineas = parseLineasFromBody(body);

    if (!pedidoPayload.Id_Cial || !pedidoPayload.Id_Cliente) {
      return res.status(400).render('pedido-form', {
        mode: 'edit',
        admin,
        item: { ...existing, ...pedidoPayload },
        lineas: (body.lineas || body.Lineas) ? (Array.isArray(body.lineas || body.Lineas) ? (body.lineas || body.Lineas) : Object.values(body.lineas || body.Lineas)) : [{ Id_Articulo: '', Cantidad: 1, Dto: '' }],
        tarifas,
        formasPago,
        tiposPedido: tiposPedido || [],
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        comerciales,
        articulos,
        error: 'Id_Cial e Id_Cliente son obligatorios'
      });
    }

    await db.updatePedidoWithLineas(id, pedidoPayload, lineas);
    if (esEspecial && !admin) {
      await db.ensureNotificacionPedidoEspecial(id, pedidoPayload.Id_Cliente, pedidoPayload.Id_Cial).catch(() => null);
    }
    return res.redirect(`/pedidos/${id}`);
  } catch (e) {
    next(e);
  }
});

app.post('/pedidos/:id(\\d+)/delete', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.deletePedido(id);
    return res.redirect('/pedidos');
  } catch (e) {
    next(e);
  }
});

// ===========================
// ARTÍCULOS (HTML)
// Comerciales: solo lectura (lista + ficha)
// Admin: CRUD completo
// ===========================

app.get('/articulos', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const rawMarca = String(req.query.marca || req.query.brand || '').trim();
    const parsedMarca = rawMarca && /^\d+$/.test(rawMarca) ? Number(rawMarca) : NaN;
    const selectedMarcaId = Number.isFinite(parsedMarca) && parsedMarca > 0 ? parsedMarca : null;

    const marcas = await loadMarcasForSelect(db);
    const items = await db.getArticulos({ marcaId: selectedMarcaId });

    res.render('articulos', {
      items: items || [],
      admin,
      marcas: Array.isArray(marcas) ? marcas : [],
      selectedMarcaId
    });
  } catch (e) {
    next(e);
  }
});

app.get('/articulos/new', requireAdmin, async (_req, res, next) => {
  try {
    const marcas = await loadMarcasForSelect(db);
    res.render('articulo-form', {
      mode: 'create',
      marcas,
      item: { SKU: '', Nombre: '', Presentacion: '', Unidades_Caja: 1, PVL: 0, IVA: 21, Imagen: '', Id_Marca: null, EAN13: '', Activo: 1 },
      error: null
    });
  } catch (e) {
    next(e);
  }
});

app.post('/articulos/new', requireAdmin, async (req, res, next) => {
  try {
    const marcas = await loadMarcasForSelect(db);
    const body = req.body || {};
    const payload = {
      SKU: String(body.SKU || '').trim(),
      Nombre: String(body.Nombre || '').trim(),
      Presentacion: String(body.Presentacion || '').trim(),
      Unidades_Caja: Number(body.Unidades_Caja || 0) || 0,
      PVL: Number(body.PVL || 0) || 0,
      IVA: Number(body.IVA ?? 21) || 0,
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

app.get('/articulos/:id/edit', requireAdmin, async (req, res, next) => {
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

app.post('/articulos/:id/edit', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const marcas = await loadMarcasForSelect(db);
    const body = req.body || {};

    // Solo columnas existentes en tu esquema actual (según SHOW COLUMNS)
    const payload = {
      SKU: body.SKU !== undefined ? String(body.SKU || '').trim() : undefined,
      Nombre: body.Nombre !== undefined ? String(body.Nombre || '').trim() : undefined,
      Presentacion: body.Presentacion !== undefined ? String(body.Presentacion || '').trim() : undefined,
      Unidades_Caja: body.Unidades_Caja !== undefined ? (Number(body.Unidades_Caja || 0) || 0) : undefined,
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

app.post('/articulos/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    await db.deleteArticulo(id);
    return res.redirect('/articulos');
  } catch (e) {
    next(e);
  }
});

app.post('/articulos/:id/toggle', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const value = String(req.body?.Activo ?? req.body?.activo ?? '').toLowerCase();
    const nextVal = value === '0' || value === 'false' || value === 'ko' || value === 'inactivo' ? 0 : 1;
    await db.toggleArticuloOkKo(id, nextVal);
    return res.redirect(`/articulos/${id}`);
  } catch (e) {
    next(e);
  }
});

// IMPORTANTE: esta ruta va DESPUÉS de /new y /:id/edit para no capturar "new" como id.
app.get('/articulos/:id', requireLogin, async (req, res, next) => {
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

app.get('/visitas', requireLogin, async (req, res, next) => {
  try {
    const view = String(req.query.view || 'list').toLowerCase();
    const admin = isAdminUser(res.locals.user);
    const meta = await db._ensureVisitasMeta();
    const clientesMeta = await db._ensureClientesMeta().catch(() => null);
    const comercialesMeta = await db._ensureComercialesMeta().catch(() => null);

    // Filtros opcionales
    const qDate = String(req.query.date || '').trim(); // YYYY-MM-DD
    const qMonth = String(req.query.month || '').trim(); // YYYY-MM

    const where = [];
    const params = [];

    // Seguridad: un comercial solo ve sus visitas.
    if (!admin) {
      const uIdNum = Number(res.locals.user?.id);
      if (meta.colComercial && Number.isFinite(uIdNum) && uIdNum > 0) {
        where.push(`v.\`${meta.colComercial}\` = ?`);
        params.push(uIdNum);
      } else {
        const owner = db._buildVisitasOwnerWhere(meta, res.locals.user, 'v');
        if (!owner.clause) {
          if (view === 'calendar') {
            const now = new Date();
            const month = qMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const initialDate = qDate || `${month}-01`;
            return res.render('visitas-calendar', { month, initialDate, meta, admin });
          }
          return res.render('visitas', {
            items: [],
            admin,
            selectedDate: qDate || null,
            paging: { page: 1, limit: 20, total: 0 },
            id: ''
          });
        }
        where.push(owner.clause);
        params.push(...owner.params);
      }
    }

    if (qDate && meta.colFecha) {
      where.push(`DATE(v.\`${meta.colFecha}\`) = ?`);
      params.push(qDate);
    }

    const tClientes = clientesMeta?.tClientes ? `\`${clientesMeta.tClientes}\`` : '`clientes`';
    const pkClientes = clientesMeta?.pk || 'Id';
    const tComerciales = comercialesMeta?.table ? `\`${comercialesMeta.table}\`` : '`comerciales`';
    const pkComerciales = comercialesMeta?.pk || 'id';

    const joinCliente = meta.colCliente ? `LEFT JOIN ${tClientes} c ON v.\`${meta.colCliente}\` = c.\`${pkClientes}\`` : '';
    const joinComercial = meta.colComercial ? `LEFT JOIN ${tComerciales} co ON v.\`${meta.colComercial}\` = co.\`${pkComerciales}\`` : '';
    const selectClienteNombre = meta.colCliente ? 'c.Nombre_Razon_Social as ClienteNombre' : 'NULL as ClienteNombre';
    const selectClienteRazon = meta.colCliente ? 'c.Nombre_Razon_Social as ClienteRazonSocial' : 'NULL as ClienteRazonSocial';
    const selectComercialNombre = meta.colComercial ? 'co.Nombre as ComercialNombre' : 'NULL as ComercialNombre';

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    if (view === 'calendar') {
      const now = new Date();
      const month = qMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const initialDate = qDate || `${month}-01`;
      let totalMes = 0;
      try {
        if (meta?.table && meta?.colFecha) {
          const m = String(month).match(/^(\d{4})-(\d{2})$/);
          const y = m ? Number(m[1]) : now.getFullYear();
          const mo = m ? Number(m[2]) - 1 : now.getMonth();
          const start = `${y}-${String(mo + 1).padStart(2, '0')}-01`;
          const end = new Date(Date.UTC(y, mo + 1, 1)).toISOString().slice(0, 10);

          const whereCal = [];
          const paramsCal = [];
          if (!admin) {
            const uIdNum = Number(res.locals.user?.id);
            if (meta.colComercial && Number.isFinite(uIdNum) && uIdNum > 0) {
              whereCal.push(`v.\`${meta.colComercial}\` = ?`);
              paramsCal.push(uIdNum);
            }
          }
          whereCal.push(`DATE(v.\`${meta.colFecha}\`) >= ? AND DATE(v.\`${meta.colFecha}\`) < ?`);
          paramsCal.push(start, end);
          const whereCalSql = whereCal.length ? `WHERE ${whereCal.join(' AND ')}` : '';
          const rows = await db.query(`SELECT COUNT(*) as total FROM \`${meta.table}\` v ${whereCalSql}`, paramsCal);
          totalMes = Number(rows?.[0]?.total ?? 0);
        }
      } catch (_) {
        totalMes = 0;
      }

      return res.render('visitas-calendar', { month, initialDate, meta, admin, totalMes });
    }

    // LISTA
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * limit;
    const idFilter = Number(req.query.id || 0) || null;
    const whereList = [...where];
    const paramsList = [...params];
    if (idFilter && meta.pk) {
      whereList.push(`v.\`${meta.pk}\` = ?`);
      paramsList.push(idFilter);
    }

    // Por defecto: próximas visitas (incluye hoy) si hay columna fecha y no hay filtros explícitos
    const hasExplicitFilter = Boolean(qDate || idFilter);
    if (!hasExplicitFilter && meta.colFecha) {
      whereList.push(`DATE(v.\`${meta.colFecha}\`) >= CURDATE()`);
    }
    const whereListSql = whereList.length ? `WHERE ${whereList.join(' AND ')}` : '';

    const sql = `
      SELECT
        v.\`${meta.pk}\` as Id,
        ${meta.colFecha ? `v.\`${meta.colFecha}\` as Fecha,` : 'NULL as Fecha,'}
        ${meta.colHora ? `v.\`${meta.colHora}\` as Hora,` : "'' as Hora,"}
        ${meta.colHoraFinal ? `v.\`${meta.colHoraFinal}\` as HoraFinal,` : "'' as HoraFinal,"}
        ${meta.colTipo ? `v.\`${meta.colTipo}\` as TipoVisita,` : "'' as TipoVisita,"}
        ${meta.colEstado ? `v.\`${meta.colEstado}\` as Estado,` : "'' as Estado,"}
        ${meta.colCliente ? `v.\`${meta.colCliente}\` as ClienteId,` : 'NULL as ClienteId,'}
        ${meta.colComercial ? `v.\`${meta.colComercial}\` as ComercialId,` : 'NULL as ComercialId,'}
        ${selectClienteNombre},
        ${selectClienteRazon},
        ${selectComercialNombre}
      FROM \`${meta.table}\` v
      ${joinCliente}
      ${joinComercial}
      ${whereListSql}
      ORDER BY ${
        meta.colFecha && !hasExplicitFilter
          ? `DATE(v.\`${meta.colFecha}\`) ASC, v.\`${meta.pk}\` ASC`
          : meta.colFecha
            ? `v.\`${meta.colFecha}\` DESC, v.\`${meta.pk}\` DESC`
            : 'v.`' + meta.pk + '` DESC'
      }
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countSql = `SELECT COUNT(*) as total FROM \`${meta.table}\` v ${whereListSql}`;
    const [items, countRows] = await Promise.all([db.query(sql, paramsList), db.query(countSql, paramsList)]);
    const total = Number(countRows?.[0]?.total ?? 0);
    return res.render('visitas', {
      items: items || [],
      admin,
      selectedDate: qDate || null,
      paging: { page, limit, total },
      id: idFilter || ''
    });
  } catch (e) {
    next(e);
  }
});

app.get('/visitas/new', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const meta = await db._ensureVisitasMeta();
    const tiposVisita = await db.getTiposVisita().catch(() => []);
    const estadosVisita = await db.getEstadosVisita().catch(() => []);
    const comerciales = admin ? await db.getComerciales() : [];
    const clientes = await db.query('SELECT Id, Nombre_Razon_Social FROM clientes ORDER BY Id DESC LIMIT 200').catch(() => []);

    const colTipoLower = String(meta.colTipo || '').toLowerCase();
    const tipoIsId = colTipoLower.includes('id_') || colTipoLower.endsWith('id');

    res.render('visita-form', {
      mode: 'create',
      admin,
      meta,
      tiposVisita,
      estadosVisita,
      tipoIsId,
      comerciales,
      clientes,
      item: {
        Fecha: new Date().toISOString().slice(0, 10),
        Hora: '',
        TipoVisita: '',
        Estado: '',
        ClienteId: null,
        ComercialId: res.locals.user.id,
        Notas: ''
      },
      error: null
    });
  } catch (e) {
    next(e);
  }
});

app.post('/visitas/new', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const meta = await db._ensureVisitasMeta();
    const tiposVisita = await db.getTiposVisita().catch(() => []);
    const estadosVisita = await db.getEstadosVisita().catch(() => []);
    const comerciales = admin ? await db.getComerciales() : [];
    // Mantener recientes para el selector (y fallback visual)
    const clientes = await db.query('SELECT Id, Nombre_Razon_Social FROM clientes ORDER BY Id DESC LIMIT 200').catch(() => []);

    const fecha = String(req.body?.Fecha || req.body?.fecha || '').slice(0, 10);
    const hora = String(req.body?.Hora || req.body?.hora || '').slice(0, 5);
    const horaFinalRaw = String(req.body?.Hora_Final || req.body?.hora_final || req.body?.HoraFinal || '').slice(0, 5);
    const tipoRaw = String(req.body?.TipoVisita || req.body?.tipo || '').trim();
    const estado = String(req.body?.Estado || req.body?.estado || '').slice(0, 40);
    const notas = String(req.body?.Notas || req.body?.notas || '').slice(0, 500);
    const clienteId = req.body?.ClienteId ? Number(req.body.ClienteId) : null;
    const comercialId = admin ? Number(req.body?.ComercialId || 0) : Number(res.locals.user.id);

    const addMinutesHHMM = (hhmm, minutes) => {
      const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return '';
      const hh = Number(m[1]);
      const mm = Number(m[2]);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return '';
      const total = (hh * 60 + mm + Number(minutes || 0)) % (24 * 60);
      const outH = String(Math.floor((total + 24 * 60) % (24 * 60) / 60)).padStart(2, '0');
      const outM = String(((total + 24 * 60) % (24 * 60)) % 60).padStart(2, '0');
      return `${outH}:${outM}`;
    };
    const horaFinal = horaFinalRaw || (hora ? addMinutesHHMM(hora, 30) : '');

    const renderError = (message) => {
      const colTipoLower = String(meta.colTipo || '').toLowerCase();
      const tipoIsId = colTipoLower.includes('id_') || colTipoLower.endsWith('id');
      return res.status(400).render('visita-form', {
        mode: 'create',
        admin,
        meta,
        tiposVisita,
        estadosVisita,
        tipoIsId,
        comerciales,
        clientes,
        item: {
          Fecha: fecha || new Date().toISOString().slice(0, 10),
          Hora: hora || '',
          TipoVisita: tipoRaw || '',
          Estado: estado || '',
          ClienteId: clienteId || null,
          ComercialId: comercialId || res.locals.user.id,
          Notas: notas || ''
        },
        error: message
      });
    };

    if (!fecha) return renderError('Fecha obligatoria');
    if (meta.colHora && !hora) return renderError('Hora obligatoria');
    if (meta.colTipo && !tipoRaw) return renderError('Tipo de visita obligatorio');
    if (meta.colEstado && !estado) return renderError('Estado obligatorio');

    const payload = {};
    if (meta.colFecha) payload[meta.colFecha] = fecha;
    if (meta.colHora) payload[meta.colHora] = hora;
    if (meta.colHoraFinal && horaFinal) payload[meta.colHoraFinal] = horaFinal;
    if (meta.colTipo) {
      const colTipoLower = String(meta.colTipo || '').toLowerCase();
      const tipoIsId = colTipoLower.includes('id_') || colTipoLower.endsWith('id');
      payload[meta.colTipo] = tipoIsId ? (Number(tipoRaw) || null) : tipoRaw.slice(0, 80);
    }
    if (meta.colEstado && estado) payload[meta.colEstado] = estado;
    if (meta.colNotas && notas) payload[meta.colNotas] = notas;
    if (meta.colCliente && clienteId) payload[meta.colCliente] = clienteId;
    if (meta.colComercial && comercialId) payload[meta.colComercial] = comercialId;

    await db.createVisita(payload);
    return res.redirect('/visitas');
  } catch (e) {
    next(e);
  }
});

app.get('/visitas/:id', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const meta = await db._ensureVisitasMeta();
    const id = Number(req.params.id);
    const row = await db.getVisitaById(id);
    if (!row) return res.status(404).send('No encontrado');

    if (!admin && meta.colComercial) {
      const owner = Number(row[meta.colComercial]);
      if (owner && owner !== Number(res.locals.user.id)) return res.status(403).send('Forbidden');
    }

    res.render('visita', { item: row, meta, admin });
  } catch (e) {
    next(e);
  }
});

app.get('/visitas/:id/edit', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const meta = await db._ensureVisitasMeta();
    const id = Number(req.params.id);
    const row = await db.getVisitaById(id);
    if (!row) return res.status(404).send('No encontrado');

    if (!admin && meta.colComercial) {
      const owner = Number(row[meta.colComercial]);
      if (owner && owner !== Number(res.locals.user.id)) return res.status(403).send('Forbidden');
    }

    const comerciales = admin ? await db.getComerciales() : [];
    const clientes = await db.query('SELECT Id, Nombre_Razon_Social FROM clientes ORDER BY Id DESC LIMIT 200').catch(() => []);
    const tiposVisita = await db.getTiposVisita().catch(() => []);
    const estadosVisita = await db.getEstadosVisita().catch(() => []);
    const colTipoLower = String(meta.colTipo || '').toLowerCase();
    const tipoIsId = colTipoLower.includes('id_') || colTipoLower.endsWith('id');

    res.render('visita-form', {
      mode: 'edit',
      admin,
      meta,
      tiposVisita,
      estadosVisita,
      tipoIsId,
      comerciales,
      clientes,
      item: row,
      error: null
    });
  } catch (e) {
    next(e);
  }
});

app.post('/visitas/:id/edit', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const meta = await db._ensureVisitasMeta();
    const id = Number(req.params.id);
    const row = await db.getVisitaById(id);
    if (!row) return res.status(404).send('No encontrado');

    if (!admin && meta.colComercial) {
      const owner = Number(row[meta.colComercial]);
      if (owner && owner !== Number(res.locals.user.id)) return res.status(403).send('Forbidden');
    }

    const fecha = String(req.body?.Fecha || req.body?.fecha || '').slice(0, 10);
    const hora = String(req.body?.Hora || req.body?.hora || '').slice(0, 5);
    const horaFinalRaw = String(req.body?.Hora_Final || req.body?.hora_final || req.body?.HoraFinal || '').slice(0, 5);
    const tipoRaw = String(req.body?.TipoVisita || req.body?.tipo || '').trim();
    const estado = String(req.body?.Estado || req.body?.estado || '').slice(0, 40);
    const notas = String(req.body?.Notas || req.body?.notas || '').slice(0, 500);
    const clienteId = req.body?.ClienteId ? Number(req.body.ClienteId) : null;
    const comercialId = admin ? Number(req.body?.ComercialId || 0) : Number(res.locals.user.id);

    const addMinutesHHMM = (hhmm, minutes) => {
      const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return '';
      const hh = Number(m[1]);
      const mm = Number(m[2]);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return '';
      const total = (hh * 60 + mm + Number(minutes || 0)) % (24 * 60);
      const outH = String(Math.floor((total + 24 * 60) % (24 * 60) / 60)).padStart(2, '0');
      const outM = String(((total + 24 * 60) % (24 * 60)) % 60).padStart(2, '0');
      return `${outH}:${outM}`;
    };
    const currentHoraFinal = meta.colHoraFinal ? String(row?.[meta.colHoraFinal] || '').slice(0, 5) : '';
    const horaFinal = horaFinalRaw || (hora ? addMinutesHHMM(hora, 30) : currentHoraFinal);

    const payload = {};
    if (meta.colFecha && fecha) payload[meta.colFecha] = fecha;
    if (meta.colHora) payload[meta.colHora] = hora || null;
    if (meta.colHoraFinal) payload[meta.colHoraFinal] = horaFinal || null;
    if (meta.colTipo) {
      const colTipoLower = String(meta.colTipo || '').toLowerCase();
      const tipoIsId = colTipoLower.includes('id_') || colTipoLower.endsWith('id');
      payload[meta.colTipo] = tipoRaw ? (tipoIsId ? (Number(tipoRaw) || null) : tipoRaw.slice(0, 80)) : null;
    }
    if (meta.colEstado) payload[meta.colEstado] = estado || null;
    if (meta.colNotas) payload[meta.colNotas] = notas || null;
    if (meta.colCliente) payload[meta.colCliente] = clienteId || null;
    if (meta.colComercial && comercialId) payload[meta.colComercial] = comercialId;

    await db.updateVisita(id, payload);
    return res.redirect('/visitas');
  } catch (e) {
    next(e);
  }
});

app.post('/visitas/:id/delete', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const meta = await db._ensureVisitasMeta();
    const id = Number(req.params.id);
    const row = await db.getVisitaById(id);
    if (!row) return res.redirect('/visitas');

    if (!admin && meta.colComercial) {
      const owner = Number(row[meta.colComercial]);
      if (owner && owner !== Number(res.locals.user.id)) return res.status(403).send('Forbidden');
    }

    await db.deleteVisita(id);
    return res.redirect('/visitas');
  } catch (e) {
    next(e);
  }
});

app.get('/dashboard', requireLogin, async (req, res, next) => {
  try {
    const MIN_YEAR = 2025;
    const now = new Date();
    const currentYear = now.getFullYear();
    // A partir del 01/09 del año en curso, habilitamos seleccionar el año siguiente.
    // Ej.: desde 01/09/2026 aparecen 2025, 2026 y 2027.
    const switchDate = new Date(currentYear, 8, 1, 0, 0, 0, 0); // 1 Sep (mes 8)
    const maxYear = now >= switchDate ? currentYear + 1 : currentYear;
    const years = [];
    for (let y = MIN_YEAR; y <= maxYear; y += 1) years.push(y);
    const selectedYearRaw = String(req.query?.year || '').trim().toLowerCase();
    const selectedYearParsed = Number(selectedYearRaw);
    const selectedYear =
      selectedYearRaw === 'all' || selectedYearRaw === 'todos'
        ? 'all'
        : (Number.isFinite(selectedYearParsed) && selectedYearParsed >= MIN_YEAR && selectedYearParsed <= maxYear
            ? selectedYearParsed
            : currentYear);
    const yearFrom = selectedYear === 'all' ? null : `${selectedYear}-01-01`;
    const yearTo = selectedYear === 'all' ? null : `${selectedYear}-12-31`;

    const safeCount = async (table) => {
      try {
        const rows = await db.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
        return Number(rows?.[0]?.n ?? 0);
      } catch (_) {
        return null;
      }
    };

    const admin = isAdminUser(res.locals.user);
    const metaVisitas = await db._ensureVisitasMeta().catch(() => null);
    const visitasTable = metaVisitas?.table ? metaVisitas.table : 'visitas';

    const userId = Number(res.locals.user?.id);
    const hasUserId = Number.isFinite(userId) && userId > 0;

    const countPedidosWithYear = async () => {
      // Best-effort: si no hay columna fecha, contamos todos
      try {
        const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
        const tPedidos = pedidosMeta?.tPedidos || 'pedidos';
        const colFecha = pedidosMeta?.colFecha || null;
        if (selectedYear === 'all' || !colFecha) return await safeCount(tPedidos);
        const rows = await db.query(
          `SELECT COUNT(*) AS n FROM \`${tPedidos}\` WHERE DATE(\`${colFecha}\`) BETWEEN ? AND ?`,
          [yearFrom, yearTo]
        );
        return Number(rows?.[0]?.n ?? 0);
      } catch (_) {
        return null;
      }
    };

    const countVisitasWithYear = async () => {
      try {
        if (!metaVisitas?.table) return await safeCount(visitasTable);
        if (selectedYear === 'all' || !metaVisitas.colFecha) return await safeCount(metaVisitas.table);
        const rows = await db.query(
          `SELECT COUNT(*) AS n FROM \`${metaVisitas.table}\` WHERE DATE(\`${metaVisitas.colFecha}\`) BETWEEN ? AND ?`,
          [yearFrom, yearTo]
        );
        return Number(rows?.[0]?.n ?? 0);
      } catch (_) {
        return null;
      }
    };

    const [clientes, pedidos, visitasTotal, comerciales] = await Promise.all([
      admin
        ? safeCount('clientes')
        : (hasUserId ? db.countClientesOptimizado({ comercial: userId }) : 0),
      admin
        ? countPedidosWithYear()
        : (hasUserId
            ? (selectedYear === 'all' ? db.countPedidos({ comercialId: userId }) : db.countPedidos({ comercialId: userId, from: yearFrom, to: yearTo }))
            : 0),
      countVisitasWithYear(),
      admin ? safeCount('comerciales') : null
    ]);

    let visitas = visitasTotal;
    if (!admin) {
      try {
        const meta = await db._ensureVisitasMeta();
        const owner = db._buildVisitasOwnerWhere(meta, res.locals.user, 'v');
        if (owner.clause) {
          const where = [owner.clause];
          const params = [...(owner.params || [])];
          if (selectedYear !== 'all' && meta.colFecha) {
            where.push(`DATE(v.\`${meta.colFecha}\`) BETWEEN ? AND ?`);
            params.push(yearFrom, yearTo);
          }
          const rows = await db.query(`SELECT COUNT(*) AS n FROM \`${meta.table}\` v WHERE ${where.join(' AND ')}`, params);
          visitas = Number(rows?.[0]?.n ?? 0);
        } else {
          visitas = 0;
        }
      } catch (_) {
        visitas = 0;
      }
    }

    const stats = { clientes, pedidos, visitas, comerciales };

    // Ventas (suma de importes de pedidos)
    // - Comercial: solo sus ventas acumuladas
    // - Admin: total de ventas de todos los comerciales
    let ventas = null;
    try {
      const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
      const tPedidos = pedidosMeta?.tPedidos || 'pedidos';
      const colComercial = pedidosMeta?.colComercial || null;
      const colFecha = pedidosMeta?.colFecha || null;
      const pedidosCols = await db._getColumns(tPedidos).catch(() => []);
      const colTotal =
        db._pickCIFromColumns(pedidosCols, ['TotalPedido', 'Total', 'ImporteTotal', 'total_pedido', 'total']) || null;

      if (colTotal) {
        if (admin) {
          const where = [];
          const params = [];
          if (selectedYear !== 'all' && colFecha) {
            where.push(`DATE(\`${colFecha}\`) BETWEEN ? AND ?`);
            params.push(yearFrom, yearTo);
          }
          const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
          const rows = await db.query(`SELECT COALESCE(SUM(COALESCE(\`${colTotal}\`, 0)), 0) AS total FROM \`${tPedidos}\`${whereSql}`, params);
          ventas = Number(rows?.[0]?.total ?? 0) || 0;
        } else if (hasUserId) {
          if (colComercial) {
            const where = [`\`${colComercial}\` = ?`];
            const params = [userId];
            if (selectedYear !== 'all' && colFecha) {
              where.push(`DATE(\`${colFecha}\`) BETWEEN ? AND ?`);
              params.push(yearFrom, yearTo);
            }
            const rows = await db.query(
              `SELECT COALESCE(SUM(COALESCE(\`${colTotal}\`, 0)), 0) AS total FROM \`${tPedidos}\` WHERE ${where.join(' AND ')}`,
              params
            );
            ventas = Number(rows?.[0]?.total ?? 0) || 0;
          } else {
            // Fallback legacy: usar el método existente (puede ser más costoso, pero evita "Unknown column")
            const rows = await db.getPedidosByComercial(userId).catch(() => []);
            ventas = (Array.isArray(rows) ? rows : []).reduce((acc, r) => {
              const v = Number(r?.[colTotal] ?? r?.TotalPedido ?? r?.Total ?? r?.ImporteTotal ?? 0);
              // Si tenemos fecha en el row, filtramos por año en memoria
              if (selectedYear !== 'all' && colFecha) {
                const fv = r?.[colFecha];
                const year = fv ? Number(String(fv).slice(0, 4)) : NaN;
                if (Number.isFinite(year) && year !== selectedYear) return acc;
              }
              return acc + (Number.isFinite(v) ? v : 0);
            }, 0);
          }
        } else {
          ventas = 0;
        }
      }
    } catch (_) {
      ventas = null;
    }
    stats.ventas = ventas;

    const latest = { clientes: [], pedidos: [], visitas: [] };
    const limitLatest = 8;
    const limitAdmin = 10;
    let dashboardErrors = {}; // para mostrar errores a admin si fallan las consultas

    if (admin) {
      // Admin: 10 clientes con más facturación (SUM de total pedidos); 10 últimos pedidos.
      try {
        const clientesMeta = await db._ensureClientesMeta().catch(() => null);
        const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
        const tClientes = clientesMeta?.tClientes || 'clientes';
        const pkClientes = clientesMeta?.pk || 'Id';
        const colClientePedido = pedidosMeta?.colCliente || 'Id_Cliente';
        const tPedidos = pedidosMeta?.tPedidos || 'pedidos';
        const colFecha = pedidosMeta?.colFecha || null;
        const pedidosCols = await db._getColumns(tPedidos).catch(() => []);
        const colTotal = db._pickCIFromColumns(pedidosCols, ['TotalPedido', 'Total', 'ImporteTotal', 'total_pedido', 'total']) || 'TotalPedido';
        const yearWhere = (selectedYear !== 'all' && colFecha) ? `WHERE DATE(p.\`${colFecha}\`) BETWEEN ? AND ?` : '';
        const yearParams = (selectedYear !== 'all' && colFecha) ? [yearFrom, yearTo] : [];
        latest.clientes = await db.query(
          `SELECT c.\`${pkClientes}\` AS Id, c.Nombre_Razon_Social, c.Poblacion, c.CodigoPostal, c.OK_KO,
            COALESCE(SUM(COALESCE(p.\`${colTotal}\`, 0)), 0) AS TotalFacturado
           FROM \`${tClientes}\` c
           INNER JOIN \`${tPedidos}\` p ON p.\`${colClientePedido}\` = c.\`${pkClientes}\`
           ${yearWhere}
           GROUP BY c.\`${pkClientes}\`, c.Nombre_Razon_Social, c.Poblacion, c.CodigoPostal, c.OK_KO
           ORDER BY TotalFacturado DESC
           LIMIT ${Number(limitAdmin) || 10}`
          , yearParams
        );
        if (!Array.isArray(latest.clientes)) latest.clientes = [];
      } catch (e) {
        console.error('Dashboard [admin] error clientes:', e?.message || e);
        latest.clientes = [];
        dashboardErrors.clientes = e?.message || String(e);
      }
      try {
        const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
        const tPedidos = pedidosMeta?.tPedidos || 'pedidos';
        const pk = pedidosMeta?.pk || 'id';
        const colNum = pedidosMeta?.colNumPedido || 'NumPedido';
        const colFecha = pedidosMeta?.colFecha || 'FechaPedido';
        const pedidosCols = await db._getColumns(tPedidos).catch(() => []);
        const colTotal = db._pickCIFromColumns(pedidosCols, ['TotalPedido', 'Total', 'ImporteTotal']) || 'TotalPedido';
        const colEstado = db._pickCIFromColumns(pedidosCols, ['EstadoPedido', 'Estado', 'estado']) || 'EstadoPedido';
        const where = (selectedYear !== 'all' && colFecha) ? `WHERE DATE(\`${colFecha}\`) BETWEEN ? AND ?` : '';
        const params = (selectedYear !== 'all' && colFecha) ? [yearFrom, yearTo] : [];
        latest.pedidos = await db.query(
          `SELECT \`${pk}\` AS Id, \`${colNum}\` AS NumPedido, \`${colFecha}\` AS FechaPedido, \`${colTotal}\` AS TotalPedido, \`${colEstado}\` AS EstadoPedido FROM \`${tPedidos}\` ${where} ORDER BY \`${pk}\` DESC LIMIT ${Number(limitAdmin) || 10}`,
          params
        );
        if (!Array.isArray(latest.pedidos)) latest.pedidos = [];
      } catch (e) {
        console.error('Dashboard [admin] error pedidos:', e?.message || e);
        latest.pedidos = [];
        dashboardErrors.pedidos = e?.message || String(e);
      }
    } else {
      // Comercial: solo sus últimos clientes y sus últimos pedidos.
      try {
        const list = await db.getClientesOptimizadoPaged(
          { comercial: userId },
          { limit: limitLatest, offset: 0, order: 'desc', compact: true }
        );
        latest.clientes = Array.isArray(list) ? list : [];
      } catch (_) {
        latest.clientes = [];
      }
      try {
        if (hasUserId) {
          const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
          const tPedidos = pedidosMeta?.tPedidos || 'pedidos';
          const pk = pedidosMeta?.pk || 'id';
          const colComercial = pedidosMeta?.colComercial || null;
          const colFecha = pedidosMeta?.colFecha || null;
          if (colComercial && colFecha) {
            const sql =
              selectedYear === 'all'
                ? `SELECT * FROM \`${tPedidos}\` WHERE \`${colComercial}\` = ? ORDER BY \`${pk}\` DESC LIMIT ${Number(limitLatest) || 8}`
                : `SELECT * FROM \`${tPedidos}\` WHERE \`${colComercial}\` = ? AND DATE(\`${colFecha}\`) BETWEEN ? AND ? ORDER BY \`${pk}\` DESC LIMIT ${Number(limitLatest) || 8}`;
            const params = selectedYear === 'all' ? [userId] : [userId, yearFrom, yearTo];
            const rows = await db.query(sql, params);
            latest.pedidos = Array.isArray(rows) ? rows : [];
          } else {
            const rows = await db.getPedidosByComercial(userId).catch(() => []);
            const filtered = (Array.isArray(rows) ? rows : []).filter((r) => {
              if (selectedYear === 'all') return true;
              const fv = r?.FechaPedido ?? r?.Fecha ?? null;
              const y = fv ? Number(String(fv).slice(0, 4)) : NaN;
              return !Number.isFinite(y) ? true : y === selectedYear;
            });
            latest.pedidos = filtered.slice(0, limitLatest);
          }
        } else {
          latest.pedidos = [];
        }
      } catch (_) {
        latest.pedidos = [];
      }
      // Visitas del comercial (mostrar abajo de clientes y pedidos)
      try {
        if (!metaVisitas?.table) throw new Error('Sin meta visitas');
        const clientesMeta = await db._ensureClientesMeta().catch(() => null);
        const comercialesMeta = await db._ensureComercialesMeta().catch(() => null);
        const tClientes = clientesMeta?.tClientes ? `\`${clientesMeta.tClientes}\`` : '`clientes`';
        const pkClientes = clientesMeta?.pk || 'Id';
        const tComerciales = comercialesMeta?.table ? `\`${comercialesMeta.table}\`` : '`comerciales`';
        const pkComerciales = comercialesMeta?.pk || 'id';
        const joinCliente = metaVisitas.colCliente ? `LEFT JOIN ${tClientes} c ON v.\`${metaVisitas.colCliente}\` = c.\`${pkClientes}\`` : '';
        const joinComercial = metaVisitas.colComercial ? `LEFT JOIN ${tComerciales} co ON v.\`${metaVisitas.colComercial}\` = co.\`${pkComerciales}\`` : '';
        const selectClienteNombre = metaVisitas.colCliente ? 'c.Nombre_Razon_Social as ClienteNombre' : 'NULL as ClienteNombre';
        const selectComercialNombre = metaVisitas.colComercial ? 'co.Nombre as ComercialNombre' : 'NULL as ComercialNombre';
        const where = [];
        const params = [];
        if (metaVisitas.colComercial && Number.isFinite(userId) && userId > 0) {
          where.push(`v.\`${metaVisitas.colComercial}\` = ?`);
          params.push(userId);
        }
        if (selectedYear !== 'all' && metaVisitas.colFecha) {
          where.push(`DATE(v.\`${metaVisitas.colFecha}\`) BETWEEN ? AND ?`);
          params.push(yearFrom, yearTo);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        latest.visitas = await db.query(
          `
          SELECT
            v.\`${metaVisitas.pk}\` as Id,
            ${metaVisitas.colFecha ? `v.\`${metaVisitas.colFecha}\` as Fecha,` : 'NULL as Fecha,'}
            ${metaVisitas.colTipo ? `v.\`${metaVisitas.colTipo}\` as TipoVisita,` : "'' as TipoVisita,"}
            ${metaVisitas.colEstado ? `v.\`${metaVisitas.colEstado}\` as Estado,` : "'' as Estado,"}
            ${metaVisitas.colCliente ? `v.\`${metaVisitas.colCliente}\` as ClienteId,` : 'NULL as ClienteId,'}
            ${metaVisitas.colComercial ? `v.\`${metaVisitas.colComercial}\` as ComercialId,` : 'NULL as ComercialId,'}
            ${selectClienteNombre},
            ${selectComercialNombre}
          FROM \`${metaVisitas.table}\` v
          ${joinCliente}
          ${joinComercial}
          ${whereSql}
          ORDER BY v.\`${metaVisitas.pk}\` DESC
          LIMIT 10
        `,
          params
        );
      } catch (_) {
        latest.visitas = [];
      }
    }
    if (admin) {
      try {
        if (!metaVisitas?.table) throw new Error('Sin meta visitas');

        const clientesMeta = await db._ensureClientesMeta().catch(() => null);
        const comercialesMeta = await db._ensureComercialesMeta().catch(() => null);
        const tClientes = clientesMeta?.tClientes ? `\`${clientesMeta.tClientes}\`` : '`clientes`';
        const pkClientes = clientesMeta?.pk || 'Id';
        const tComerciales = comercialesMeta?.table ? `\`${comercialesMeta.table}\`` : '`comerciales`';
        const pkComerciales = comercialesMeta?.pk || 'id';

        const joinCliente = metaVisitas.colCliente ? `LEFT JOIN ${tClientes} c ON v.\`${metaVisitas.colCliente}\` = c.\`${pkClientes}\`` : '';
        const joinComercial = metaVisitas.colComercial ? `LEFT JOIN ${tComerciales} co ON v.\`${metaVisitas.colComercial}\` = co.\`${pkComerciales}\`` : '';
        const selectClienteNombre = metaVisitas.colCliente ? 'c.Nombre_Razon_Social as ClienteNombre' : 'NULL as ClienteNombre';
        const selectComercialNombre = metaVisitas.colComercial ? 'co.Nombre as ComercialNombre' : 'NULL as ComercialNombre';

        const where = [];
        const params = [];
        if (selectedYear !== 'all' && metaVisitas.colFecha) {
          where.push(`DATE(v.\`${metaVisitas.colFecha}\`) BETWEEN ? AND ?`);
          params.push(yearFrom, yearTo);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        latest.visitas = await db.query(
          `
          SELECT
            v.\`${metaVisitas.pk}\` as Id,
            ${metaVisitas.colFecha ? `v.\`${metaVisitas.colFecha}\` as Fecha,` : 'NULL as Fecha,'}
            ${metaVisitas.colTipo ? `v.\`${metaVisitas.colTipo}\` as TipoVisita,` : "'' as TipoVisita,"}
            ${metaVisitas.colEstado ? `v.\`${metaVisitas.colEstado}\` as Estado,` : "'' as Estado,"}
            ${metaVisitas.colCliente ? `v.\`${metaVisitas.colCliente}\` as ClienteId,` : 'NULL as ClienteId,'}
            ${metaVisitas.colComercial ? `v.\`${metaVisitas.colComercial}\` as ComercialId,` : 'NULL as ComercialId,'}
            ${selectClienteNombre},
            ${selectComercialNombre}
          FROM \`${metaVisitas.table}\` v
          ${joinCliente}
          ${joinComercial}
          ${whereSql}
          ORDER BY v.\`${metaVisitas.pk}\` DESC
          LIMIT 10
        `,
          params
        );
      } catch (_) {
        latest.visitas = [];
      }
    }

    res.render('dashboard', { stats, latest, dashboardErrors: dashboardErrors || {}, years, selectedYear });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /health:
 *   get:
 *     tags:
 *       - Health
 *     summary: Healthcheck básico del servicio
 *     responses:
 *       200:
 *         description: OK
 */
app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'crm_gemavip',
    timestamp: new Date().toISOString()
  });
});

// Comprueba conectividad con la BD configurada en variables de entorno.
// No devuelve credenciales; solo un diagnóstico básico.
/**
 * @openapi
 * /health/db:
 *   get:
 *     tags:
 *       - Health
 *     summary: Healthcheck de base de datos (requiere API key si está configurada)
 *     description: Diagnóstico de conectividad a MySQL. No expone credenciales.
 *     responses:
 *       200:
 *         description: OK
 *       500:
 *         description: Error
 */
app.get('/health/db', requireApiKeyIfConfigured, async (_req, res) => {
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306;
  const user = process.env.DB_USER;
  const database = process.env.DB_NAME || 'crm_gemavip';

  if (!host || !user || !process.env.DB_PASSWORD) {
    return res.status(500).json({
      ok: false,
      service: 'crm_gemavip',
      db: { host: Boolean(host), user: Boolean(user), password: Boolean(process.env.DB_PASSWORD), database },
      error: 'Faltan variables de entorno DB_HOST/DB_USER/DB_PASSWORD'
    });
  }

  try {
    const connection = await mysql.createConnection({
      host,
      port,
      user,
      password: process.env.DB_PASSWORD,
      database,
      connectTimeout: 8000,
      // Si tu MySQL requiere SSL, configura DB_SSL=true en Vercel
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    });

    const [rows] = await connection.query('SELECT 1 AS ok');
    await connection.end();

    return res.status(200).json({
      ok: true,
      service: 'crm_gemavip',
      db: { host, port, user, database },
      ping: Array.isArray(rows) ? rows[0] : rows,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      service: 'crm_gemavip',
      db: { host, port, user, database },
      error: err?.message || String(err),
      code: err?.code,
      errno: err?.errno,
      timestamp: new Date().toISOString()
    });
  }
});

// OpenAPI JSON + Swagger UI (público)
// Importante: deben ir ANTES de app.use('/api', ...) para no quedar detrás de requireApiKeyIfConfigured.
app.get('/api/openapi.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(swaggerSpec);
});

// Swagger UI (público)
// Nota: en Vercel, servir assets con swaggerUi.serve dentro del mismo app.use(...)
// puede acabar devolviendo el HTML para las rutas de assets. Separamos HTML y assets.
const swaggerUiOpts = {
  customSiteTitle: 'CRM Gemavip · API Docs',
  swaggerOptions: {
    persistAuthorization: true
  }
};
const swaggerUiHtml = swaggerUi.setup(swaggerSpec, swaggerUiOpts);

app.get('/api/docs', (_req, res) => res.redirect(301, '/api/docs/'));
app.get('/api/docs/', swaggerUiHtml);
app.use('/api/docs', swaggerUi.serve);

// API REST (protegida con API_KEY si está configurada)
app.use('/api', requireApiKeyIfConfigured, apiRouter);

// 404 estándar (HTML bonito + JSON consistente)
app.use((req, res) => {
  if (wantsHtml(req)) {
    return renderErrorPage(req, res, {
      status: 404,
      title: 'No encontrado',
      heading: 'No encontramos esa página',
      summary: 'Puede que el enlace esté desactualizado o que no tengas acceso.',
      statusLabel: 'Not Found',
      whatToDo: [
        'Comprueba la URL y vuelve a intentarlo.',
        'Vuelve al Dashboard y navega desde el menú.',
        'Si llegaste aquí desde un enlace interno, envía el ID a soporte.'
      ]
    });
  }
  return res.status(404).json({ ok: false, error: 'Not Found', requestId: req.requestId });
});

// Error handler (HTML bonito + JSON estándar)
app.use((err, req, res, _next) => {
  const status = Number(err?.status || err?.statusCode || res.statusCode || 500) || 500;
  const code = err?.code;
  const message = err?.message || String(err);

  if (wantsHtml(req)) {
    const publicMessage = status >= 500 ? 'Se produjo un error interno al procesar la solicitud.' : message;
    return renderErrorPage(req, res, {
      status,
      title: `Error ${status}`,
      heading: status >= 500 ? 'Error interno' : 'No se ha podido completar la acción',
      summary: publicMessage,
      statusLabel: status >= 500 ? 'Server Error' : 'Error',
      publicMessage,
      code
    });
  }

  return res.status(status).json({ ok: false, error: message, code, requestId: req.requestId });
});

// En Vercel (runtime @vercel/node) se exporta la app como handler.
module.exports = app;

// Si se ejecuta en local con `node api/index.js`, levantamos servidor HTTP.
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`CRM Gemavip escuchando en http://localhost:${port}`);
  });
}

