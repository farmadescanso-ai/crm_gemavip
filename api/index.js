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
const { parsePagination } = require('../lib/pagination');
const { sendPasswordResetEmail, sendPedidoEspecialDecisionEmail, sendPedidoEmail, APP_BASE_URL } = require('../lib/mailer');

// Helper para Node <14: a ?? b
function _n(a, b) { return a != null ? a : b; }

// Extrae contraseña de fila comercial (com_password, Password, etc.)
function getStoredPasswordFromRow(row) {
  if (!row || typeof row !== 'object') return '';
  const cands = ['com_password', 'Password', 'password', 'contraseña', 'Pass', 'Clave'];
  for (const c of cands) {
    const val = row[c];
    if (val != null && val !== '') return String(val);
  }
  const keys = Object.keys(row);
  const pwdKey = keys.find((k) => /password|contraseña|pass|clave/i.test(String(k)));
  return pwdKey ? String(row[pwdKey] || '') : '';
}

// Emails de notificaciones: desactivado por defecto (hasta configurar SMTP correctamente).
const NOTIF_EMAILS_ENABLED =
  process.env.NOTIF_EMAILS_ENABLED === '1' ||
  String(process.env.NOTIF_EMAILS_ENABLED || '').toLowerCase() === 'true';

const app = express();
app.set('trust proxy', 1);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Vercel rewrites: /login -> /api/index?__path=/login; usar __path para routing
app.use((req, _res, next) => {
  const pathParam = req.query && req.query.__path;
  if (typeof pathParam === 'string' && pathParam.startsWith('/')) {
    req.url = pathParam;
  } else if (typeof req.url === 'string' && req.url.startsWith('/api/index')) {
    req.url = req.url.replace(/^\/api\/index/, '') || '/';
  }
  next();
});

// Health check (sin sesión/DB) para diagnosticar crashes en Vercel
app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'crm_gemavip', timestamp: new Date().toISOString() });
});

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
    `Usuario: ${user ? `${user.email || '—'} (id: ${_n(user.id, '—')})` : 'No logueado'}`,
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
  // Sesión: acceso desde la app web (autocomplete, listados, etc.)
  if (req.session?.user) return next();
  const configured = process.env.API_KEY;
  // Si API_KEY no está configurada: exigir sesión (evitar API abierta a cualquiera)
  if (!configured) {
    return res.status(401).json({ ok: false, error: 'Login requerido (inicia sesión en la web o configura API_KEY para acceso externo)' });
  }
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
    const colId = pick(['mar_id', 'id', 'Id']) || 'mar_id';
    const colNombre =
      pick(['mar_nombre', 'Nombre', 'nombre', 'Marca', 'marca', 'Descripcion', 'descripcion', 'NombreMarca', 'nombre_marca']) || null;
    const colActivo = pick(['mar_activo', 'Activo', 'activo']);

    const selectNombre = colNombre ? `\`${colNombre}\` AS nombre` : `CAST(\`${colId}\` AS CHAR) AS nombre`;
    const whereActivo = colActivo ? `WHERE \`${colActivo}\` = 1` : '';
    const rows = await db.query(`SELECT \`${colId}\` AS id, ${selectNombre} FROM \`${tMarcas}\` ${whereActivo} ORDER BY nombre ASC`);
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

async function loadSimpleCatalogForSelect(db, tableKey, { labelCandidates } = {}) {
  // Best-effort: si no existe la tabla o faltan permisos, devolver [].
  try {
    const t = await db._resolveTableNameCaseInsensitive(tableKey);
    const cols = await db._getColumns(t);
    const colsLower = new Set((cols || []).map((c) => String(c).toLowerCase()));
    const pick = (cands) => (cands || []).find((c) => colsLower.has(String(c).toLowerCase())) || null;
    const colId = pick(['id', 'Id', 'ID']) || 'id';
    const colLabel = pick(labelCandidates || ['Nombre', 'nombre', 'Descripcion', 'descripcion', 'Tipo', 'tipo', 'FormaPago', 'formaPago']);
    const selectLabel = colLabel ? `\`${colLabel}\` AS nombre` : `CAST(\`${colId}\` AS CHAR) AS nombre`;
    const rows = await db.query(`SELECT * , \`${colId}\` AS id, ${selectLabel} FROM \`${t}\` ORDER BY nombre ASC`);
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

async function loadEstadosClienteForSelect(db) {
  // Tabla: estdoClientes (id, Nombre)
  try {
    const t = await db._resolveTableNameCaseInsensitive('estdoClientes');
    const rows = await db.query(`SELECT id, Nombre FROM \`${t}\` ORDER BY id ASC`);
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

function findRowByCode(rows, codeCandidates) {
  const codes = (codeCandidates || []).map((c) => String(c).toUpperCase());
  for (const r of (rows || [])) {
    for (const v of Object.values(r || {})) {
      const sv = String(_n(v, '')).trim().toUpperCase();
      if (sv && codes.includes(sv)) return r;
    }
  }
  return null;
}

function findRowByNameContains(rows, substrCandidates) {
  const subs = (substrCandidates || []).map((s) => String(s).toLowerCase());
  for (const r of (rows || [])) {
    for (const v of Object.values(r || {})) {
      const sv = String(_n(v, '')).toLowerCase();
      if (!sv) continue;
      if (subs.some((sub) => sv.includes(sub))) return r;
    }
  }
  return null;
}

function applySpainDefaultsIfEmpty(item, { meta, paises, idiomas, monedas } = {}) {
  if (!item || typeof item !== 'object') return item;
  const cols = Array.isArray(meta?.cols) ? meta.cols : [];
  const colsLower = new Set(cols.map((c) => String(c).toLowerCase()));

  const hasCol = (name) => colsLower.has(String(name).toLowerCase());
  const isEmpty = (val) => val === undefined || val === null || String(val).trim() === '';

  // País: España (ISO ES)
  if (hasCol('Id_Pais') && isEmpty(item.Id_Pais)) {
    const esp = (paises || []).find((p) => String(_n(_n(p && p.Id_pais, p && p.id_pais), '')).toUpperCase() === 'ES')
      || findRowByNameContains(paises, ['españa', 'espana']);
    const espId = Number(_n(_n(_n(esp && esp.id, esp && esp.Id), esp && esp.ID), 0)) || 0;
    if (espId) item.Id_Pais = espId;
  }

  // Idioma: Español (ES)
  if (hasCol('Id_Idioma') && isEmpty(item.Id_Idioma)) {
    const direct =
      (idiomas || []).find((r) => String(_n(_n(r && r.Codigo, r && r.codigo), '')).trim().toLowerCase() === 'es')
      || null;
    const es =
      direct
      || findRowByCode(idiomas, ['ES'])
      || findRowByNameContains(idiomas, ['español', 'espanol', 'castellano', 'spanish']);
    const esId = Number(_n(_n(_n(es && es.id, es && es.Id), es && es.ID), 0)) || 0;
    if (esId) item.Id_Idioma = esId;
  }

  // Moneda: Euro (EUR)
  if (hasCol('Id_Moneda') && isEmpty(item.Id_Moneda)) {
    const direct =
      (monedas || []).find((r) => String(_n(_n(r && r.Codigo, r && r.codigo), '')).trim().toUpperCase() === 'EUR')
      || null;
    const eur =
      direct
      || findRowByCode(monedas, ['EUR'])
      || findRowByNameContains(monedas, ['euro', '€']);
    const eurId = Number(_n(_n(_n(eur && eur.id, eur && eur.Id), eur && eur.ID), 0)) || 0;
    if (eurId) item.Id_Moneda = eurId;
  }

  return item;
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
    const password = String(req.body?.password || '').trim();
    if (!email || !password) {
      return res.status(400).render('login', { title: 'Login', error: 'Email y contraseña son obligatorios' });
    }

    const comercial = await db.getComercialByEmail(email);
    if (!comercial) {
      return res.status(401).render('login', { title: 'Login', error: 'Credenciales incorrectas' });
    }

    const stored = getStoredPasswordFromRow(comercial);
    let ok = false;
    if (stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$')) {
      ok = await bcrypt.compare(password, stored);
    } else {
      // Legacy: comparación directa (texto plano)
      ok = password === String(stored).trim();
    }

    if (!ok) {
      // Diagnóstico: si DEBUG_LOGIN=1, loguear info (sin contraseña) para depurar admin vs comercial
      if (process.env.DEBUG_LOGIN === '1') {
        console.warn('[DEBUG_LOGIN] Usuario encontrado pero contraseña no coincide.', {
          email,
          roll: _n(comercial.com_roll, comercial.Roll || comercial.roll),
          columnas: Object.keys(comercial).filter((k) => /pass|password|clave/i.test(k)),
          storedLen: stored.length,
          storedPrefix: stored ? stored.substring(0, 7) : '(vacío)'
        });
      }
      return res.status(401).render('login', { title: 'Login', error: 'Credenciales incorrectas' });
    }

    req.session.user = {
      id: _n(_n(comercial.com_id, comercial.id), comercial.Id),
      nombre: _n(comercial.com_nombre, comercial.Nombre || null),
      email: _n(_n(comercial.com_email, comercial.Email), comercial.email || email),
      roles: normalizeRoles(_n(comercial.com_roll, comercial.Roll || comercial.roll || comercial.Rol))
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
      const comercialId = _n(_n(comercial.com_id, comercial.id), comercial.Id);
      await db.createPasswordResetToken(comercialId, email, token, 1);
      recordPasswordResetIp(ip);
      const resetLink = `${APP_BASE_URL.replace(/\/$/, '')}/login/restablecer-contrasena?token=${encodeURIComponent(token)}`;
      await sendPasswordResetEmail(email, resetLink, _n(comercial.com_nombre, comercial.Nombre || ''));
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
    const stored = getStoredPasswordFromRow(comercial);
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
    const q = typeof req.query.q === 'string' ? String(req.query.q) : '';
    const created = String(req.query.created || '') === '1';
    const updated = String(req.query.updated || '') === '1';
    const deleted = String(req.query.deleted || '') === '1';
    const error = typeof req.query.error === 'string' ? String(req.query.error) : '';

    const items = await db.getComerciales();
    // Redactar password por seguridad
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

async function loadComercialesTableMeta() {
  try {
    const t = await db._resolveTableNameCaseInsensitive('comerciales');
    const cols = await db._getColumns(t);
    const set = new Set((cols || []).map((c) => String(c).toLowerCase()));
    const has = (name) => set.has(String(name).toLowerCase());
    return {
      hasMeetEmail: has('meet_email'),
      hasTeamsEmail: has('teams_email'),
      hasPlataforma: has('plataforma_reunion_preferida'),
      hasFijoMensual: has('fijo_mensual')
    };
  } catch (_) {
    return { hasMeetEmail: false, hasTeamsEmail: false, hasPlataforma: true, hasFijoMensual: true };
  }
}

function sanitizeComercialForView(row) {
  if (!row || typeof row !== 'object') return row;
  // eslint-disable-next-line no-unused-vars
  const { Password, password, ...rest } = row;
  return rest;
}

function parseMoneyLike(v, fallback = null) {
  const s = String(_n(v, '')).trim();
  if (!s) return fallback;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function parseIntLike(v, fallback = null) {
  const s = String(_n(v, '')).trim();
  if (!s) return fallback;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCp(cpRaw) {
  const s = String(_n(cpRaw, '')).trim();
  if (!s) return '';
  return s.replace(/[^0-9]/g, '').slice(0, 5);
}

function rolesFromBody(body) {
  const raw = body?.Roll;
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const roles = arr.map((x) => String(x || '').trim()).filter(Boolean);
  const unique = Array.from(new Set(roles));
  // Default: si no seleccionan nada, considerarlo comercial.
  return unique.length > 0 ? unique : ['Comercial'];
}

app.get('/comerciales/new', requireAdmin, async (_req, res, next) => {
  try {
    const [provincias, meta] = await Promise.all([db.getProvincias().catch(() => []), loadComercialesTableMeta()]);
    return res.render('comercial-form', {
      mode: 'create',
      item: { Nombre: '', Email: '', DNI: '', Movil: '', Direccion: '', CodigoPostal: '', Poblacion: '', Id_Provincia: '', Roll: ['Comercial'] },
      provincias: provincias || [],
      meta,
      error: null
    });
  } catch (e) {
    next(e);
  }
});

app.post('/comerciales/new', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const [provincias, meta] = await Promise.all([db.getProvincias().catch(() => []), loadComercialesTableMeta()]);

    const Nombre = String(_n(body.Nombre, '')).trim();
    const Email = String(_n(body.Email, '')).trim();
    const Password = String(_n(body.Password, '')).trim();
    const DNI = String(_n(body.DNI, '')).trim() || null;
    const Movil = String(_n(body.Movil, '')).trim() || null;
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
    // Mensaje más amigable en formulario
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

app.get('/comerciales/:id(\\d+)', requireAdmin, async (req, res, next) => {
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

app.get('/comerciales/:id(\\d+)/edit', requireAdmin, async (req, res, next) => {
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

app.post('/comerciales/:id(\\d+)/edit', requireAdmin, async (req, res, next) => {
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
    const Movil = String(_n(body.Movil, '')).trim() || null;
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

    // Campos opcionales solo si existen en tabla
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

app.post('/comerciales/:id(\\d+)/delete', requireAdmin, async (req, res, next) => {
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

// ===========================
// DESCUENTOS PEDIDO (HTML) - Admin CRUD
// ===========================
app.get('/admin/descuentos-pedido', requireAdmin, async (_req, res, next) => {
  try {
    // Diagnóstico (solo admin) para detectar DB incorrecta o tabla vacía en producción
    let diag = { database: null, count: null };
    try {
      const r = await db.query('SELECT DATABASE() AS db').catch(() => []);
      diag.database = r && r[0] ? _n(_n(_n(r[0].db, r[0].DB), r[0].database), null) : null;
    } catch (_) {}
    try {
      const c = await db.query('SELECT COUNT(*) AS n FROM `descuentos_pedido`').catch(() => []);
      diag.count = c && c[0] ? Number(_n(_n(c[0].n, c[0].N), 0)) : null;
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
      const s = String(_n(v, '')).trim();
      if (!s) return null;
      const x = Number(String(s).replace(',', '.'));
      return Number.isFinite(x) ? x : null;
    };
    const i = (v) => {
      const s = String(_n(v, '')).trim();
      if (!s) return 0;
      const x = parseInt(s, 10);
      return Number.isFinite(x) ? x : 0;
    };

    const payload = {
      importe_desde: n(body.importe_desde),
      importe_hasta: n(body.importe_hasta),
      dto_pct: n(body.dto_pct),
      orden: i(body.orden),
      activo: String(_n(body.activo, '1')) === '1' ? 1 : 0
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
      const s = String(_n(v, '')).trim();
      if (!s) return null;
      const x = Number(String(s).replace(',', '.'));
      return Number.isFinite(x) ? x : null;
    };
    const i = (v) => {
      const s = String(_n(v, '')).trim();
      if (!s) return 0;
      const x = parseInt(s, 10);
      return Number.isFinite(x) ? x : 0;
    };

    const payload = {
      importe_desde: n(body.importe_desde),
      importe_hasta: n(body.importe_hasta),
      dto_pct: n(body.dto_pct),
      orden: i(body.orden),
      activo: String(_n(body.activo, '1')) === '1' ? 1 : 0
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
const SYSVAR_SMTP_HOST = 'SMTP_HOST';
const SYSVAR_SMTP_PORT = 'SMTP_PORT';
const SYSVAR_SMTP_SECURE = 'SMTP_SECURE';
const SYSVAR_SMTP_USER = 'SMTP_USER';
const SYSVAR_SMTP_PASS = 'SMTP_PASS';
const SYSVAR_MAIL_FROM = 'MAIL_FROM';

function buildSysVarMergedList(itemsRaw, knownKeys) {
  const byKey = new Map((itemsRaw || []).map((r) => [String(r?.clave || '').trim(), r]));
  return (knownKeys || []).map((k) => {
    const row = byKey.get(k.clave) || {};
    const dbVal = row.valor === null || row.valor === undefined ? '' : String(row.valor);
    const envVal = String(process.env[k.clave] || '').trim();
    const effectiveValue = (dbVal || '').trim() || envVal || '';
    return {
      id: _n(row.id, null),
      clave: k.clave,
      descripcion: row.descripcion || k.descripcion || '',
      valor: dbVal,
      effectiveValue,
      updated_at: _n(row.updated_at, null),
      updated_by: _n(row.updated_by, null)
      ,
      secret: Boolean(k.secret),
      inputType: k.inputType || null,
      multiline: Boolean(k.multiline),
      placeholder: k.placeholder || null
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
    const known = [
      { clave: SYSVAR_PEDIDOS_MAIL_TO, descripcion: 'Destinatario del email al pulsar ENVIAR en /pedidos.' },
      { clave: SYSVAR_SMTP_HOST, descripcion: 'Servidor SMTP (host). Ej: smtp.office365.com' },
      { clave: SYSVAR_SMTP_PORT, descripcion: 'Puerto SMTP. Ej: 587' },
      { clave: SYSVAR_SMTP_SECURE, descripcion: 'SMTP seguro (true/false). Normalmente false para 587 (STARTTLS).' },
      { clave: SYSVAR_SMTP_USER, descripcion: 'Usuario SMTP (email del remitente).' },
      { clave: SYSVAR_SMTP_PASS, descripcion: 'Contraseña SMTP / contraseña de aplicación.', secret: true, inputType: 'password' },
      { clave: SYSVAR_MAIL_FROM, descripcion: 'From visible. Si vacío, usa SMTP_USER.' }
    ];
    const flag = String(req.query.saved || '').trim().toLowerCase();
    return res.render('variables-sistema', {
      title: 'Configuración Email',
      subtitle: 'Destinatarios y ajustes funcionales (no incluye credenciales SMTP).',
      sections: [
        { title: 'Envío de pedidos', description: 'Destino por defecto del botón ENVIAR.', items: buildSysVarMergedList(itemsRaw, known.slice(0, 1)) },
        { title: 'SMTP', description: 'Credenciales del servidor de correo (se leen desde BD o .env).', items: buildSysVarMergedList(itemsRaw, known.slice(1)) }
      ],
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

    const keepIfEmpty = String(req.body?.keepIfEmpty || '').trim() === '1';
    const clearSecret = String(req.body?.clear || '').trim() === '1';

    // Guardamos vacío como NULL para que el fallback a .env funcione.
    if (keepIfEmpty && !trimmed && !clearSecret) return res.redirect(`${returnTo}?saved=1`);
    const storeVal = trimmed ? trimmed : null;

    const descripcion =
      clave === SYSVAR_N8N_PEDIDOS_WEBHOOK_URL
        ? 'Webhook de N8N para envío de pedidos + Excel (multipart/form-data).'
        : clave === SYSVAR_PEDIDOS_MAIL_TO
          ? 'Destinatario del email al pulsar ENVIAR en /pedidos.'
          : clave === SYSVAR_SMTP_HOST
            ? 'Servidor SMTP (host).'
            : clave === SYSVAR_SMTP_PORT
              ? 'Puerto SMTP.'
              : clave === SYSVAR_SMTP_SECURE
                ? 'SMTP seguro (true/false).'
                : clave === SYSVAR_SMTP_USER
                  ? 'Usuario SMTP.'
                  : clave === SYSVAR_SMTP_PASS
                    ? 'Contraseña SMTP / app password.'
                    : clave === SYSVAR_MAIL_FROM
                      ? 'From visible.'
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
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 200 });
    const q = typeof _n(req.query.q, req.query.search) === 'string' ? String(_n(req.query.q, req.query.search)).trim() : '';
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
// AGENDA (HTML) - Comercial + Admin
// ===========================
app.get('/agenda', requireLogin, async (req, res, next) => {
  try {
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 200 });
    const q = typeof req.query.q === 'string' ? String(req.query.q).trim() : '';

    // Nota: db.getContactos soporta FULLTEXT/LIKE y paginación saneada.
    const items = await db.getContactos({ search: q, limit, offset, includeInactivos: false }).catch(() => []);
    // No tenemos COUNT barato aquí; aproximamos total por "hay siguiente" (si llegan limit, asumir hay más).
    const totalGuess = (Array.isArray(items) && items.length === limit) ? (page * limit + 1) : (offset + (items?.length || 0));

    res.render('agenda', {
      items: items || [],
      q,
      paging: { page, limit, total: totalGuess }
    });
  } catch (e) {
    next(e);
  }
});

app.get('/agenda/new', requireLogin, async (_req, res, next) => {
  try {
    const [roles, especialidades] = await Promise.all([
      db.getAgendaRoles().catch(() => []),
      db.getAgendaEspecialidades().catch(() => [])
    ]);
    res.render('agenda-form', { mode: 'create', item: {}, error: null, roles: roles || [], especialidades: especialidades || [] });
  } catch (e) {
    next(e);
  }
});

app.post('/agenda/new', requireLogin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const cargoFromSelect = String(body.Cargo || '').trim();
    const cargoNew = String(body.CargoNew || '').trim();
    const especFromSelect = String(body.Especialidad || '').trim();
    const especNew = String(body.EspecialidadNew || '').trim();

    const legacyPrefix = '__legacy_text__:';
    const cargoIsLegacy = cargoFromSelect.startsWith(legacyPrefix);
    const especIsLegacy = especFromSelect.startsWith(legacyPrefix);

    const cargoFinalText =
      cargoFromSelect === '__add__' ? cargoNew
        : cargoIsLegacy ? cargoFromSelect.slice(legacyPrefix.length)
          : '';
    const especFinalText =
      especFromSelect === '__add__' ? especNew
        : especIsLegacy ? especFromSelect.slice(legacyPrefix.length)
          : '';

    const cargoId = (!cargoIsLegacy && cargoFromSelect && cargoFromSelect !== '__add__' && /^[0-9]+$/.test(cargoFromSelect)) ? Number(cargoFromSelect) : null;
    const especId = (!especIsLegacy && especFromSelect && especFromSelect !== '__add__' && /^[0-9]+$/.test(especFromSelect)) ? Number(especFromSelect) : null;

    const [rolesArr, especArr] = await Promise.all([
      db.getAgendaRoles().catch(() => []),
      db.getAgendaEspecialidades().catch(() => [])
    ]);

    const payload = {
      Nombre: String(body.Nombre || '').trim().slice(0, 120),
      Apellidos: String(body.Apellidos || '').trim().slice(0, 180) || null,
      Cargo: null,
      Especialidad: null,
      Id_TipoCargoRol: cargoId || null,
      Id_Especialidad: especId || null,
      Empresa: String(body.Empresa || '').trim().slice(0, 180) || null,
      Email: String(body.Email || '').trim().slice(0, 255) || null,
      Movil: String(body.Movil || '').trim().slice(0, 20) || null,
      Telefono: String(body.Telefono || '').trim().slice(0, 20) || null,
      Extension: String(body.Extension || '').trim().slice(0, 10) || null,
      Notas: String(body.Notas || '').trim().slice(0, 2000) || null,
      Activo: (String(body.Activo || '1').trim() === '0') ? 0 : 1
    };
    if (!payload.Nombre) {
      return res.render('agenda-form', { mode: 'create', item: payload, error: 'El campo Nombre es obligatorio', roles: rolesArr || [], especialidades: especArr || [] });
    }

    // Cargo/tipo/rol
    if (cargoFinalText && String(cargoFinalText).trim()) {
      const r = await db.createAgendaRol(String(cargoFinalText).trim()).catch(() => null);
      if (r?.insertId) payload.Id_TipoCargoRol = r.insertId;
      if (r?.nombre) payload.Cargo = r.nombre;
    } else if (payload.Id_TipoCargoRol) {
      const found = (rolesArr || []).find((x) => Number(x?.id) === Number(payload.Id_TipoCargoRol));
      if (found?.Nombre) payload.Cargo = String(found.Nombre);
    }

    // Especialidad
    if (especFinalText && String(especFinalText).trim()) {
      const r = await db.createAgendaEspecialidad(String(especFinalText).trim()).catch(() => null);
      if (r?.insertId) payload.Id_Especialidad = r.insertId;
      if (r?.nombre) payload.Especialidad = r.nombre;
    } else if (payload.Id_Especialidad) {
      const found = (especArr || []).find((x) => Number(x?.id) === Number(payload.Id_Especialidad));
      if (found?.Nombre) payload.Especialidad = String(found.Nombre);
    }

    const result = await db.createContacto(payload);
    const id = result?.insertId;
    return res.redirect(id ? `/agenda/${id}?created=1` : '/agenda');
  } catch (e) {
    next(e);
  }
});

app.get('/agenda/:id(\\d+)', requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const item = await db.getContactoById(id);
    if (!item) return res.status(404).send('No encontrado');
    const [clientes, roles] = await Promise.all([
      db.getClientesByContacto(id, { includeHistorico: true }).catch(() => []),
      db.getAgendaRoles().catch(() => [])
    ]);
    const created = String(req.query.created || '') === '1';
    res.render('agenda-view', {
      item,
      clientes: clientes || [],
      roles: roles || [],
      success: created ? 'Contacto creado.' : null,
      error: null
    });
  } catch (e) {
    next(e);
  }
});

app.get('/agenda/:id(\\d+)/edit', requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const item = await db.getContactoById(id);
    if (!item) return res.status(404).send('No encontrado');
    const [roles, especialidades] = await Promise.all([
      db.getAgendaRoles().catch(() => []),
      db.getAgendaEspecialidades().catch(() => [])
    ]);
    res.render('agenda-form', { mode: 'edit', item, error: null, roles: roles || [], especialidades: especialidades || [] });
  } catch (e) {
    next(e);
  }
});

app.post('/agenda/:id(\\d+)/edit', requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const current = await db.getContactoById(id);
    if (!current) return res.status(404).send('No encontrado');
    const body = req.body || {};
    const cargoFromSelect = String(body.Cargo || '').trim();
    const cargoNew = String(body.CargoNew || '').trim();
    const especFromSelect = String(body.Especialidad || '').trim();
    const especNew = String(body.EspecialidadNew || '').trim();

    const legacyPrefix = '__legacy_text__:';
    const cargoIsLegacy = cargoFromSelect.startsWith(legacyPrefix);
    const especIsLegacy = especFromSelect.startsWith(legacyPrefix);

    const cargoFinalText =
      cargoFromSelect === '__add__' ? cargoNew
        : cargoIsLegacy ? cargoFromSelect.slice(legacyPrefix.length)
          : '';
    const especFinalText =
      especFromSelect === '__add__' ? especNew
        : especIsLegacy ? especFromSelect.slice(legacyPrefix.length)
          : '';

    const cargoId = (!cargoIsLegacy && cargoFromSelect && cargoFromSelect !== '__add__' && /^[0-9]+$/.test(cargoFromSelect)) ? Number(cargoFromSelect) : null;
    const especId = (!especIsLegacy && especFromSelect && especFromSelect !== '__add__' && /^[0-9]+$/.test(especFromSelect)) ? Number(especFromSelect) : null;

    const [rolesArr, especArr] = await Promise.all([
      db.getAgendaRoles().catch(() => []),
      db.getAgendaEspecialidades().catch(() => [])
    ]);

    const payload = {
      Nombre: String(body.Nombre || '').trim().slice(0, 120),
      Apellidos: String(body.Apellidos || '').trim().slice(0, 180) || null,
      Cargo: null,
      Especialidad: null,
      Id_TipoCargoRol: cargoId || null,
      Id_Especialidad: especId || null,
      Empresa: String(body.Empresa || '').trim().slice(0, 180) || null,
      Email: String(body.Email || '').trim().slice(0, 255) || null,
      Movil: String(body.Movil || '').trim().slice(0, 20) || null,
      Telefono: String(body.Telefono || '').trim().slice(0, 20) || null,
      Extension: String(body.Extension || '').trim().slice(0, 10) || null,
      Notas: String(body.Notas || '').trim().slice(0, 2000) || null,
      Activo: (String(body.Activo || '1').trim() === '0') ? 0 : 1
    };
    if (!payload.Nombre) {
      return res.render('agenda-form', { mode: 'edit', item: { ...current, ...payload }, error: 'El campo Nombre es obligatorio', roles: rolesArr || [], especialidades: especArr || [] });
    }

    if (cargoFinalText && String(cargoFinalText).trim()) {
      const r = await db.createAgendaRol(String(cargoFinalText).trim()).catch(() => null);
      if (r?.insertId) payload.Id_TipoCargoRol = r.insertId;
      if (r?.nombre) payload.Cargo = r.nombre;
    } else if (payload.Id_TipoCargoRol) {
      const found = (rolesArr || []).find((x) => Number(x?.id) === Number(payload.Id_TipoCargoRol));
      if (found?.Nombre) payload.Cargo = String(found.Nombre);
    }

    if (especFinalText && String(especFinalText).trim()) {
      const r = await db.createAgendaEspecialidad(String(especFinalText).trim()).catch(() => null);
      if (r?.insertId) payload.Id_Especialidad = r.insertId;
      if (r?.nombre) payload.Especialidad = r.nombre;
    } else if (payload.Id_Especialidad) {
      const found = (especArr || []).find((x) => Number(x?.id) === Number(payload.Id_Especialidad));
      if (found?.Nombre) payload.Especialidad = String(found.Nombre);
    }

    await db.updateContacto(id, payload);
    return res.redirect(`/agenda/${id}`);
  } catch (e) {
    next(e);
  }
});

app.post('/agenda/:id(\\d+)/clientes/link', requireLogin, async (req, res, next) => {
  try {
    const contactoId = Number(req.params.id);
    if (!Number.isFinite(contactoId) || contactoId <= 0) return res.status(400).send('ID no válido');
    const clienteId = Number(req.body?.clienteId || 0);
    if (!Number.isFinite(clienteId) || clienteId <= 0) {
      return res.redirect(`/agenda/${contactoId}?error=${encodeURIComponent('Selecciona un cliente válido')}`);
    }
    const admin = isAdminUser(res.locals.user);
    if (!admin) {
      const can = await db.canComercialEditCliente(clienteId, res.locals.user?.id).catch(() => false);
      if (!can) return res.status(404).send('No encontrado');
    }
    const esPrincipal = String(req.body?.Es_Principal || '').trim() === '1' || String(req.body?.Es_Principal || '').toLowerCase() === 'on';
    // Si no se indica rol en el vínculo (UI de Agenda), usar Cargo del contacto como valor por defecto.
    // Mantiene integridad: el rol "oficial" sigue estando en clientes_contactos.Rol.
    const contacto = await db.getContactoById(contactoId).catch(() => null);
    const rolDefault = contacto?.Cargo ? String(contacto.Cargo).trim().slice(0, 120) : null;
    await db.vincularContactoACliente(clienteId, contactoId, { Rol: rolDefault, Es_Principal: esPrincipal });
    return res.redirect(`/agenda/${contactoId}`);
  } catch (e) {
    next(e);
  }
});

app.post('/agenda/:id(\\d+)/clientes/:clienteId(\\d+)/unlink', requireLogin, async (req, res, next) => {
  try {
    const contactoId = Number(req.params.id);
    const clienteId = Number(req.params.clienteId);
    if (!Number.isFinite(contactoId) || contactoId <= 0) return res.status(400).send('ID no válido');
    if (!Number.isFinite(clienteId) || clienteId <= 0) return res.status(400).send('ID no válido');
    const admin = isAdminUser(res.locals.user);
    if (!admin) {
      const can = await db.canComercialEditCliente(clienteId, res.locals.user?.id).catch(() => false);
      if (!can) return res.status(404).send('No encontrado');
    }
    await db.cerrarVinculoContactoCliente(clienteId, contactoId, { MotivoBaja: 'Desasociado desde Agenda' });
    return res.redirect(`/agenda/${contactoId}`);
  } catch (e) {
    next(e);
  }
});

// ===========================
// CLIENTES (HTML) - Admin CRUD
// ===========================
function buildClienteFormModel({ mode, meta, item, comerciales, tarifas, provincias, paises, formasPago, tiposClientes, idiomas, monedas, estadosCliente, cooperativas, gruposCompras, canChangeComercial, missingFields }) {
  const cols = Array.isArray(meta?.cols) ? meta.cols : [];
  const pk = meta?.pk || 'Id';
  const hasEstadoCliente = !!meta?.colEstadoCliente;
  const colsLower = new Set((cols || []).map((c) => String(c || '').toLowerCase()));
  const hasIdTipoCliente =
    colsLower.has('id_tipocliente')
    || colsLower.has('id_tipo_cliente')
    || colsLower.has('id_tipocliente_id')
    || colsLower.has('id_tipo_cliente_id');
  const ignore = new Set(
    [pk, 'created_at', 'updated_at', 'CreatedAt', 'UpdatedAt', 'FechaAlta', 'Fecha_Alta', 'FechaBaja', 'Fecha_Baja']
      .map(String)
  );
  // Si existe estdoClientes, OK_KO queda derivado del estado (evita solape en UI)
  if (hasEstadoCliente) ignore.add('OK_KO');
  // Id_CodigoPostal es un FK/lookup técnico a Codigos_Postales y suele duplicar "CodigoPostal" (texto).
  // Evitar mostrarlo en el formulario para no confundir.
  try {
    if (colsLower.has('id_codigopostal') && colsLower.has('codigopostal')) ignore.add('Id_CodigoPostal');
  } catch (_) {}
  // Si existe Id_TipoCliente (FK), ocultar el texto legacy TipoCliente para no duplicar.
  if (hasIdTipoCliente && colsLower.has('tipocliente')) ignore.add('TipoCliente');

  const titleCaseEs = (s) => {
    const parts = String(s || '')
      .trim()
      .split(/\s+/g)
      .filter(Boolean);
    const lowerWords = new Set(['de', 'del', 'la', 'el', 'y', 'o', 'a', 'en', 'por', 'para', 'con']);
    return parts
      .map((w, idx) => {
        const lw = w.toLowerCase();
        if (idx > 0 && lowerWords.has(lw)) return lw;
        return lw.length ? (lw.charAt(0).toUpperCase() + lw.slice(1)) : lw;
      })
      .join(' ');
  };

  const labelize = (name) => {
    const raw = String(name || '');
    const lower = raw.toLowerCase();
    const overrides = {
      id_estdocliente: 'Estado Cliente',
      id_estadocliente: 'Estado Cliente',
      ok_ko: 'Estado',
      id_cial: 'Delegado',
      comercialid: 'Delegado',
      tipocontacto: 'Tipo Contacto',
      tipo_contacto: 'Tipo Contacto',
      nombre_razon_social: 'Nombre / Razón social',
      nombre_cial: 'Nombre comercial',
      dni_cif: 'DNI/CIF',
      codigopostal: 'Código postal',
      id_provincia: 'Provincia',
      id_pais: 'País',
      id_idioma: 'Idioma',
      id_moneda: 'Moneda',
      id_formapago: 'Forma de pago',
      id_forma_pago: 'Forma de pago',
      id_tipocliente: 'Tipo cliente',
      id_tipo_cliente: 'Tipo cliente',
      numcontacto: 'Nombre contacto',
      numeroFarmacia: 'Nº farmacia'
    };
    if (overrides[lower]) return overrides[lower];

    // Humanizar: snake_case + camelCase
    let cleaned = raw
      .replace(/_/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .trim();

    // Quitar "ID"/"Id" de etiquetas (p.ej. "ID País" -> "País")
    cleaned = cleaned.replace(/\bID\b/gi, '').replace(/\s+/g, ' ').trim();
    cleaned = cleaned.replace(/^\b(id)\b\s+/i, '').trim();

    // Abreviaturas
    cleaned = cleaned
      .replace(/\bDni\b/g, 'DNI')
      .replace(/\bCif\b/g, 'CIF')
      .replace(/\bCp\b/g, 'CP')
      .replace(/\bIva\b/g, 'IVA')
      .replace(/\bIban\b/g, 'IBAN')
      .replace(/\bRe\b/g, 'RE');

    return titleCaseEs(cleaned) || raw;
  };

  const toTab = (name) => {
    const n = String(name || '').toLowerCase();
    if (['nombre_razon_social', 'nombre_cial', 'dni_cif', 'tipocontacto', 'ok_ko', 'id_estdocliente', 'id_estadocliente'].includes(n)) return 'ident';
    if (n.includes('direccion') || n.includes('poblacion') || n.includes('codigopostal') || n.includes('provincia') || n.includes('pais')) return 'direccion';
    if (n.includes('email') || n.includes('telefono') || n.includes('movil') || n.includes('web') || n.includes('fax')) return 'contacto';
    if (n.includes('tarifa') || n === 'dto' || n.includes('descuento') || n.includes('comercial') || n.includes('id_cial')) return 'condiciones';
    if (n.includes('observ') || n.includes('notas') || n.includes('coment')) return 'notas';
    return 'avanzado';
  };

  const fieldKind = (name) => {
    const n = String(name || '').toLowerCase();
    if (n === 'ok_ko') return { kind: 'select', options: 'ok_ko' };
    if (n === 'tipocontacto' || n === 'tipo_contacto') return { kind: 'select', options: 'tipo_contacto' };
    if (n === 'id_estdocliente' || n === 'id_estadocliente') return { kind: 'select', options: 'estados_cliente' };
    if (n === String(meta?.colComercial || '').toLowerCase() || n === 'id_cial' || n === 'comercialid') return { kind: 'select', options: 'comerciales' };
    if (n === 'tarifa' || n === 'id_tarifa') return { kind: 'select', options: 'tarifas' };
    if (n === 'id_pais') return { kind: 'select', options: 'paises' };
    if (n === 'id_provincia') return { kind: 'select', options: 'provincias' };
    if (n === 'id_formapago' || n === 'id_forma_pago') return { kind: 'select', options: 'formas_pago' };
    if (n === 'id_tipocliente' || n === 'id_tipo_cliente') return { kind: 'select', options: 'tipos_clientes' };
    // Legacy: si solo existe TipoCliente (texto) y no existe Id_TipoCliente, renderizar select por nombre.
    if ((n === 'tipocliente' || n === 'tipo_cliente') && !hasIdTipoCliente) return { kind: 'select', options: 'tipos_clientes_nombre' };
    if (n === 'id_idioma') return { kind: 'select', options: 'idiomas' };
    if (n === 'id_moneda') return { kind: 'select', options: 'monedas' };
    if (n === 'id_cooperativa') return { kind: 'select', options: 'cooperativas' };
    if (n === 'id_grupocompras' || n === 'id_grupo_compras') return { kind: 'select', options: 'grupos_compras' };
    if (n.includes('email')) return { kind: 'input', type: 'email' };
    if (n.includes('telefono') || n.includes('movil') || n.includes('fax')) return { kind: 'input', type: 'tel' };
    if (n.includes('web') || n.includes('url')) return { kind: 'input', type: 'url' };
    if (n.includes('fecha')) return { kind: 'input', type: 'date' };
    if (n === 'dto' || n.includes('descuento') || n.includes('importe') || n.includes('factur') || n.includes('saldo')) return { kind: 'input', type: 'number' };
    if (n === 'observaciones' || n === 'notas' || n.includes('coment')) return { kind: 'textarea' };
    if (n.startsWith('es_') || n.startsWith('es') || n.includes('activo') || n.includes('activa')) return { kind: 'checkbox' };
    return { kind: 'input', type: 'text' };
  };

  const tabs = [
    { id: 'ident', label: 'Identificación', fields: [] },
    { id: 'contacto', label: 'Comunicación', fields: [] },
    { id: 'direccion', label: 'Dirección', fields: [] },
    { id: 'condiciones', label: 'Condiciones', fields: [] },
    { id: 'notas', label: 'Notas', fields: [] },
    { id: 'avanzado', label: 'Avanzado', fields: [] }
  ];
  {
    const m = String(mode || '').toLowerCase();
    if (m === 'view' || m === 'edit') tabs.push({ id: 'agenda', label: 'Agenda', fields: [] });
  }
  const byId = new Map(tabs.map((t) => [t.id, t]));

  for (const col of cols) {
    if (!col) continue;
    if (ignore.has(String(col))) continue;
    const tabId = toTab(col);
    const spec = fieldKind(col);
    const required = String(col) === 'Nombre_Razon_Social';
    const field = {
      name: col,
      label: labelize(col),
      required,
      spec
    };
    byId.get(tabId)?.fields.push(field);
  }

  // Campos técnicos (solo lectura)
  const readonlyFields = [];
  for (const col of cols) {
    const lc = String(col).toLowerCase();
    if (lc === String(pk).toLowerCase() || lc === 'created_at' || lc === 'updated_at') {
      readonlyFields.push({ name: col, label: labelize(col) });
    }
  }
  if (readonlyFields.length) byId.get('avanzado')?.fields.unshift(...readonlyFields.map((f) => ({ ...f, spec: { kind: 'readonly' } })));

  // Orden preferido dentro de pestañas (promover algunos campos arriba)
  const promote = (arr, names) => {
    const set = new Set(names);
    const top = arr.filter((f) => set.has(f.name));
    const rest = arr.filter((f) => !set.has(f.name));
    return [...top, ...rest];
  };
  byId.get('ident').fields = promote(byId.get('ident').fields, ['Nombre_Razon_Social', 'Nombre_Cial', 'TipoContacto', 'DNI_CIF', 'OK_KO']);
  byId.get('contacto').fields = promote(byId.get('contacto').fields, ['Email', 'Telefono', 'Movil', 'Web']);
  byId.get('direccion').fields = promote(byId.get('direccion').fields, ['Direccion', 'Direccion2', 'CodigoPostal', 'Poblacion', 'Id_Provincia', 'Id_Pais']);
  byId.get('condiciones').fields = promote(byId.get('condiciones').fields, [meta?.colComercial || 'Id_Cial', 'Tarifa', 'Dto', 'Id_TipoCliente', 'Id_FormaPago', 'Id_Idioma', 'Id_Moneda']);

  // Eliminar pestañas sin campos salvo Avanzado/Agenda
  const tabsFiltered = tabs.filter((t) => t.id === 'avanzado' || t.id === 'agenda' || (t.fields && t.fields.length));

  return {
    mode,
    item,
    tabs: tabsFiltered,
    comerciales,
    tarifas,
    provincias,
    paises,
    formasPago,
    tiposClientes,
    idiomas,
    monedas,
    estadosCliente,
    cooperativas,
    gruposCompras,
    canChangeComercial: !!canChangeComercial,
    missingFields: Array.isArray(missingFields) ? missingFields : []
  };
}

function coerceClienteValue(fieldName, raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  // Cuando el formulario envía múltiples valores con el mismo nombre
  // (típico patrón hidden(0)+checkbox(1)), body-parser puede devolver un array.
  // Nos quedamos con el último valor.
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    raw = raw[raw.length - 1];
  }
  const name = String(fieldName || '');
  const n = name.toLowerCase();
  const s = String(raw);
  const trimmed = s.trim();
  if (trimmed === '') return null;

  // ids / ints
  if (n === 'ok_ko' || n.endsWith('_id') || n.startsWith('id_') || n.endsWith('id')) {
    const x = parseInt(trimmed, 10);
    return Number.isFinite(x) ? x : null;
  }
  // numbers
  if (n === 'dto' || n.includes('descuento') || n.includes('importe') || n.includes('factur') || n.includes('saldo')) {
    const x = Number(String(trimmed).replace(',', '.'));
    return Number.isFinite(x) ? x : null;
  }
  // booleans stored as 0/1 in some cols
  if (n.startsWith('es_') || n.includes('activo')) {
    if (trimmed === '1' || trimmed.toLowerCase() === 'true' || trimmed.toLowerCase() === 'si') return 1;
    if (trimmed === '0' || trimmed.toLowerCase() === 'false' || trimmed.toLowerCase() === 'no') return 0;
  }
  return trimmed;
}
app.get('/clientes/new', requireLogin, async (_req, res, next) => {
  try {
    const [comerciales, tarifas, provincias, paises, formasPago, tiposClientes, idiomas, monedas, estadosCliente, cooperativas, gruposCompras, meta] = await Promise.all([
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      _n(db.getProvincias && db.getProvincias().catch(() => []), []),
      _n(db.getPaises && db.getPaises().catch(() => []), []),
      _n(db.getFormasPago && db.getFormasPago().catch(() => []), []),
      loadSimpleCatalogForSelect(db, 'tipos_clientes', { labelCandidates: ['Tipo', 'Nombre', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'idiomas', { labelCandidates: ['Nombre', 'Idioma', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'monedas', { labelCandidates: ['Nombre', 'Moneda', 'Descripcion', 'descripcion', 'Codigo', 'codigo', 'ISO', 'Iso'] }),
      loadEstadosClienteForSelect(db),
      _n(db.getCooperativas && db.getCooperativas().catch(() => []), []),
      _n(db.getGruposCompras && db.getGruposCompras().catch(() => []), []),
      db._ensureClientesMeta().catch(() => null)
    ]);
    const isAdmin = isAdminUser(res.locals.user);
    const baseItem = applySpainDefaultsIfEmpty(
      { OK_KO: 1, Tarifa: 0, Dto: 0 },
      { meta, paises, idiomas, monedas }
    );
    const model = buildClienteFormModel({
      mode: 'create',
      meta,
      item: baseItem,
      comerciales: Array.isArray(comerciales) ? comerciales : [],
      tarifas: Array.isArray(tarifas) ? tarifas : [],
      provincias: Array.isArray(provincias) ? provincias : [],
      paises: Array.isArray(paises) ? paises : [],
      formasPago: Array.isArray(formasPago) ? formasPago : [],
      tiposClientes: Array.isArray(tiposClientes) ? tiposClientes : [],
      idiomas: Array.isArray(idiomas) ? idiomas : [],
      monedas: Array.isArray(monedas) ? monedas : [],
      estadosCliente: Array.isArray(estadosCliente) ? estadosCliente : [],
      cooperativas: Array.isArray(cooperativas) ? cooperativas : [],
      gruposCompras: Array.isArray(gruposCompras) ? gruposCompras : [],
      canChangeComercial: !!isAdmin
    });
    res.render('cliente-form', { ...model, error: null });
  } catch (e) {
    next(e);
  }
});

app.post('/clientes/new', requireLogin, async (req, res, next) => {
  try {
    const [comerciales, tarifas, provincias, paises, formasPago, tiposClientes, idiomas, monedas, estadosCliente, cooperativas, gruposCompras, meta] = await Promise.all([
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      _n(db.getProvincias && db.getProvincias().catch(() => []), []),
      _n(db.getPaises && db.getPaises().catch(() => []), []),
      _n(db.getFormasPago && db.getFormasPago().catch(() => []), []),
      loadSimpleCatalogForSelect(db, 'tipos_clientes', { labelCandidates: ['Tipo', 'Nombre', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'idiomas', { labelCandidates: ['Nombre', 'Idioma', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'monedas', { labelCandidates: ['Nombre', 'Moneda', 'Descripcion', 'descripcion', 'Codigo', 'codigo', 'ISO', 'Iso'] }),
      loadEstadosClienteForSelect(db),
      _n(db.getCooperativas && db.getCooperativas().catch(() => []), []),
      _n(db.getGruposCompras && db.getGruposCompras().catch(() => []), []),
      db._ensureClientesMeta().catch(() => null)
    ]);
    const isAdmin = isAdminUser(res.locals.user);
    const body = req.body || {};
    const dupConfirmed = String(body.dup_confirmed || '').trim() === '1';
    const cols = Array.isArray(meta?.cols) ? meta.cols : [];
    const pk = meta?.pk || 'Id';
    const colsLower = new Map(cols.map((c) => [String(c).toLowerCase(), c]));
    const payload = {};
    for (const [k, v] of Object.entries(body)) {
      const real = colsLower.get(String(k).toLowerCase());
      if (!real) continue;
      if (String(real).toLowerCase() === String(pk).toLowerCase()) continue;
      // No admin: no permitir cambiar delegado/comercial
      if (!isAdmin && meta?.colComercial && String(real).toLowerCase() === String(meta.colComercial).toLowerCase()) continue;
      payload[real] = coerceClienteValue(real, v);
    }

    // No admin: auto-asignar delegado/comercial al usuario actual
    if (!isAdmin && meta?.colComercial && res.locals.user?.id) {
      payload[meta.colComercial] = Number(res.locals.user.id);
    }

    // Defaults mínimos
    if (payload.OK_KO === null || payload.OK_KO === undefined) payload.OK_KO = 1;
    if (payload.Tarifa === null || payload.Tarifa === undefined) payload.Tarifa = 0;
    applySpainDefaultsIfEmpty(payload, { meta, paises, idiomas, monedas });

    // Bloqueo/aviso de duplicados (servidor): no permitir guardar sin mostrar aviso.
    const dup = await db.findPosiblesDuplicadosClientes(
      {
        dniCif: payload.DNI_CIF,
        nombre: payload.Nombre_Razon_Social,
        nombreCial: payload.Nombre_Cial
      },
      { limit: 6, userId: _n(res.locals.user && res.locals.user.id, null), isAdmin }
    );
    const hasDup = (dup && Array.isArray(dup.matches) && dup.matches.length > 0) || (dup && Number(dup.otherCount || 0) > 0);
    if (hasDup && !dupConfirmed) {
      const model = buildClienteFormModel({
        mode: 'create',
        meta,
        item: payload,
        comerciales,
        tarifas,
        provincias,
        paises,
        formasPago,
        tiposClientes,
        idiomas,
        monedas,
        estadosCliente,
        cooperativas,
        gruposCompras,
        canChangeComercial: !!isAdmin,
        missingFields: []
      });
      return res.status(409).render('cliente-form', {
        ...model,
        error: 'Este contacto puede estar ya dado de alta. Revisa coincidencias y confirma si quieres continuar.',
        dupMatches: dup.matches || [],
        dupOtherCount: Number(dup.otherCount || 0) || 0
      });
    }

    const missingFieldsNew = [];
    if (!payload.Nombre_Razon_Social) missingFieldsNew.push('Nombre_Razon_Social');
    if (missingFieldsNew.length > 0) {
      const model = buildClienteFormModel({
        mode: 'create',
        meta,
        item: payload,
        comerciales,
        tarifas,
        provincias,
        paises,
        formasPago,
        tiposClientes,
        idiomas,
        monedas,
        estadosCliente,
        cooperativas,
        gruposCompras,
        canChangeComercial: !!isAdmin,
        missingFields: missingFieldsNew
      });
      return res.status(400).render('cliente-form', { ...model, error: 'Completa los campos obligatorios marcados.' });
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
    const admin = isAdminUser(res.locals.user);
    const canEdit = admin || (await db.canComercialEditCliente(id, res.locals.user?.id));
    if (!admin && !canEdit) return res.status(403).send('No tiene permiso para ver este contacto.');
    const includeAgendaHistorico = String(req.query.agendaHistorico || '').trim() === '1';
    const [item, comerciales, tarifas, provincias, paises, formasPago, tiposClientes, idiomas, monedas, estadosCliente, cooperativas, gruposCompras, meta, agendaContactos, agendaRoles] = await Promise.all([
      db.getClienteById(id),
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      _n(db.getProvincias && db.getProvincias().catch(() => []), []),
      _n(db.getPaises && db.getPaises().catch(() => []), []),
      _n(db.getFormasPago && db.getFormasPago().catch(() => []), []),
      loadSimpleCatalogForSelect(db, 'tipos_clientes', { labelCandidates: ['Tipo', 'Nombre', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'idiomas', { labelCandidates: ['Nombre', 'Idioma', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'monedas', { labelCandidates: ['Nombre', 'Moneda', 'Descripcion', 'descripcion', 'Codigo', 'codigo', 'ISO', 'Iso'] }),
      loadEstadosClienteForSelect(db),
      _n(db.getCooperativas && db.getCooperativas().catch(() => []), []),
      _n(db.getGruposCompras && db.getGruposCompras().catch(() => []), []),
      db._ensureClientesMeta().catch(() => null),
      db.getContactosByCliente(id, { includeHistorico: includeAgendaHistorico }).catch(() => []),
      db.getAgendaRoles().catch(() => [])
    ]);
    if (!item) return res.status(404).send('No encontrado');
    const puedeSolicitarAsignacion = !admin && res.locals.user?.id && (await db.isContactoAsignadoAPoolOSinAsignar(id));
    const poolId = await db.getComercialIdPool();
    const solicitud = req.query.solicitud === 'ok' ? 'ok' : undefined;
    const model = buildClienteFormModel({
      mode: 'view',
      meta,
      item,
      comerciales,
      tarifas,
      provincias,
      paises,
      formasPago,
      tiposClientes,
      idiomas,
      monedas,
      estadosCliente,
      cooperativas,
      gruposCompras,
      canChangeComercial: false
    });
    const agendaOk = String(req.query.agendaOk || '') === '1';
    const agendaError = String(req.query.agendaError || '') === '1';
    res.render('cliente-view', {
      ...model,
      admin,
      canEdit,
      puedeSolicitarAsignacion,
      poolId,
      solicitud,
      contactoId: id,
      agendaContactos: Array.isArray(agendaContactos) ? agendaContactos : [],
      agendaRoles: Array.isArray(agendaRoles) ? agendaRoles : [],
      agendaIncludeHistorico: includeAgendaHistorico,
      agendaOk,
      agendaError
    });
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
    const includeAgendaHistorico = String(req.query.agendaHistorico || '').trim() === '1';
    const [item, comerciales, tarifas, provincias, paises, formasPago, tiposClientes, idiomas, monedas, estadosCliente, cooperativas, gruposCompras, meta, agendaContactos] = await Promise.all([
      db.getClienteById(id),
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      _n(db.getProvincias && db.getProvincias().catch(() => []), []),
      _n(db.getPaises && db.getPaises().catch(() => []), []),
      _n(db.getFormasPago && db.getFormasPago().catch(() => []), []),
      loadSimpleCatalogForSelect(db, 'tipos_clientes', { labelCandidates: ['Tipo', 'Nombre', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'idiomas', { labelCandidates: ['Nombre', 'Idioma', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'monedas', { labelCandidates: ['Nombre', 'Moneda', 'Descripcion', 'descripcion', 'Codigo', 'codigo', 'ISO', 'Iso'] }),
      loadEstadosClienteForSelect(db),
      _n(db.getCooperativas && db.getCooperativas().catch(() => []), []),
      _n(db.getGruposCompras && db.getGruposCompras().catch(() => []), []),
      db._ensureClientesMeta().catch(() => null),
      db.getContactosByCliente(id, { includeHistorico: includeAgendaHistorico }).catch(() => [])
    ]);
    if (!item) return res.status(404).send('No encontrado');
    const puedeSolicitarAsignacion = !admin && res.locals.user?.id && (await db.isContactoAsignadoAPoolOSinAsignar(id));
    const model = buildClienteFormModel({
      mode: 'edit',
      meta,
      item,
      comerciales,
      tarifas,
      provincias,
      paises,
      formasPago,
      tiposClientes,
      idiomas,
      monedas,
      estadosCliente,
      cooperativas,
      gruposCompras,
      canChangeComercial: admin
    });
    res.render('cliente-form', {
      ...model,
      error: null,
      admin,
      puedeSolicitarAsignacion,
      contactoId: id,
      agendaContactos: Array.isArray(agendaContactos) ? agendaContactos : [],
      agendaIncludeHistorico: includeAgendaHistorico
    });
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
    const [item, meta, provincias, paises, formasPago, tiposClientes, idiomas, monedas, estadosCliente, cooperativas, gruposCompras] = await Promise.all([
      db.getClienteById(id),
      db._ensureClientesMeta().catch(() => null),
      _n(db.getProvincias && db.getProvincias().catch(() => []), []),
      _n(db.getPaises && db.getPaises().catch(() => []), []),
      _n(db.getFormasPago && db.getFormasPago().catch(() => []), []),
      loadSimpleCatalogForSelect(db, 'tipos_clientes', { labelCandidates: ['Tipo', 'Nombre', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'idiomas', { labelCandidates: ['Nombre', 'Idioma', 'Descripcion', 'descripcion'] }),
      loadSimpleCatalogForSelect(db, 'monedas', { labelCandidates: ['Nombre', 'Moneda', 'Descripcion', 'descripcion', 'Codigo', 'codigo', 'ISO', 'Iso'] }),
      loadEstadosClienteForSelect(db),
      _n(db.getCooperativas && db.getCooperativas().catch(() => []), []),
      _n(db.getGruposCompras && db.getGruposCompras().catch(() => []), [])
    ]);
    if (!item) return res.status(404).send('No encontrado');
    const comerciales = await db.getComerciales().catch(() => []);
    const tarifas = await db.getTarifas().catch(() => []);
    const body = req.body || {};
    const canChangeComercial = admin;

    const cols = Array.isArray(meta?.cols) ? meta.cols : [];
    const pk = meta?.pk || 'Id';
    const colsLower = new Map(cols.map((c) => [String(c).toLowerCase(), c]));
    const payload = {};
    for (const [k, v] of Object.entries(body)) {
      const real = colsLower.get(String(k).toLowerCase());
      if (!real) continue;
      if (String(real).toLowerCase() === String(pk).toLowerCase()) continue;
      // No admin: no permitir cambiar comercial asignado (colComercial)
      if (!canChangeComercial && meta?.colComercial && String(real).toLowerCase() === String(meta.colComercial).toLowerCase()) continue;
      payload[real] = coerceClienteValue(real, v);
    }

    const missingFields = [];
    if (payload.Nombre_Razon_Social !== undefined && !String(payload.Nombre_Razon_Social || '').trim()) missingFields.push('Nombre_Razon_Social');
    if (missingFields.length > 0) {
      const puedeSolicitar = !admin && res.locals.user?.id && (await db.isContactoAsignadoAPoolOSinAsignar(id));
      const model = buildClienteFormModel({
        mode: 'edit',
        meta,
        item: { ...item, ...payload },
        comerciales,
        tarifas,
        provincias,
        paises,
        formasPago,
        tiposClientes,
        idiomas,
        monedas,
        estadosCliente,
        cooperativas,
        gruposCompras,
        canChangeComercial: !!admin,
        missingFields
      });
      return res.status(400).render('cliente-form', { ...model, error: 'Completa los campos obligatorios marcados.', admin, puedeSolicitarAsignacion: puedeSolicitar, contactoId: id });
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

// ===========================
// CLIENTES <-> AGENDA (HTML)
// ===========================
app.post('/clientes/:id/agenda/link', requireLogin, async (req, res, next) => {
  try {
    const clienteId = Number(req.params.id);
    if (!Number.isFinite(clienteId) || clienteId <= 0) return res.status(400).send('ID no válido');
    const contactoId = Number(req.body?.agendaContactoId || req.body?.contactoId || 0);
    if (!Number.isFinite(contactoId) || contactoId <= 0) return res.redirect(`/clientes/${clienteId}?agendaError=1`);

    const admin = isAdminUser(res.locals.user);
    if (!admin) {
      const can = await db.canComercialEditCliente(clienteId, res.locals.user?.id).catch(() => false);
      if (!can) return res.status(404).send('No encontrado');
    }

    let rol = String(req.body?.Rol || '').trim().slice(0, 120) || null;
    const esPrincipal = String(req.body?.Es_Principal || '').trim() === '1' || String(req.body?.Es_Principal || '').toLowerCase() === 'on';
    const notas = String(req.body?.Notas || '').trim().slice(0, 500) || null;
    if (rol) {
      const r = await db.createAgendaRol(rol).catch(() => null);
      if (r?.nombre) rol = r.nombre;
    }

    await db.vincularContactoACliente(clienteId, contactoId, { Rol: rol, Es_Principal: esPrincipal, Notas: notas });
    return res.redirect(`/clientes/${clienteId}?agendaOk=1`);
  } catch (e) {
    next(e);
  }
});

app.post('/clientes/:id/agenda/:contactoId(\\d+)/principal', requireLogin, async (req, res, next) => {
  try {
    const clienteId = Number(req.params.id);
    const contactoId = Number(req.params.contactoId);
    if (!Number.isFinite(clienteId) || clienteId <= 0) return res.status(400).send('ID no válido');
    if (!Number.isFinite(contactoId) || contactoId <= 0) return res.status(400).send('ID no válido');

    const admin = isAdminUser(res.locals.user);
    if (!admin) {
      const can = await db.canComercialEditCliente(clienteId, res.locals.user?.id).catch(() => false);
      if (!can) return res.status(404).send('No encontrado');
    }

    await db.setContactoPrincipalForCliente(clienteId, contactoId);
    return res.redirect(`/clientes/${clienteId}?agendaOk=1`);
  } catch (e) {
    next(e);
  }
});

app.post('/clientes/:id/agenda/:contactoId(\\d+)/unlink', requireLogin, async (req, res, next) => {
  try {
    const clienteId = Number(req.params.id);
    const contactoId = Number(req.params.contactoId);
    if (!Number.isFinite(clienteId) || clienteId <= 0) return res.status(400).send('ID no válido');
    if (!Number.isFinite(contactoId) || contactoId <= 0) return res.status(400).send('ID no válido');

    const admin = isAdminUser(res.locals.user);
    if (!admin) {
      const can = await db.canComercialEditCliente(clienteId, res.locals.user?.id).catch(() => false);
      if (!can) return res.status(404).send('No encontrado');
    }

    await db.cerrarVinculoContactoCliente(clienteId, contactoId, { MotivoBaja: 'Desasociado desde ficha de cliente' });
    return res.redirect(`/clientes/${clienteId}?agendaOk=1`);
  } catch (e) {
    next(e);
  }
});

app.get('/notificaciones', requireAdmin, async (req, res, next) => {
  try {
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
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
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
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
    function tokenizeSmartQuery(input) {
      const q = String(input || '').trim();
      if (!q) return { tokens: [], terms: [] };

      const tokens = [];
      // field:value, soporta comillas dobles/simples y negación con "-"
      const re = /(^|\s)(-?)([a-zA-Z_ñÑáéíóúüÁÉÍÓÚÜ]+)\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;
      let rest = q;
      let m;
      while ((m = re.exec(q)) !== null) {
        const neg = m[2] === '-';
        const fieldRaw = String(m[3] || '').trim();
        const field = fieldRaw.toLowerCase();
        const value = String(_n(_n(_n(m[4], m[5]), m[6]), '')).trim();
        if (field && value) tokens.push({ field, value, neg });
        // eliminar del texto libre para no duplicar
        rest = rest.replace(m[0], ' ');
      }

      const terms = [];
      const s = rest.trim();
      if (s) {
        // separar por espacios pero respetar comillas
        const tRe = /"([^"]+)"|'([^']+)'|([^\s]+)/g;
        let tm;
        while ((tm = tRe.exec(s)) !== null) {
          const v = String(_n(_n(_n(tm[1], tm[2]), tm[3]), '')).trim();
          if (v) terms.push(v);
        }
      }

      return { tokens, terms };
    }

    const admin = isAdminUser(res.locals.user);
    const userId = Number(res.locals.user?.id);
    const scopeUserId = !admin && Number.isFinite(userId) && userId > 0 ? userId : null;

    // Resolver columnas reales de pedidos (evita errores tipo "Unknown column p.ComercialId")
    const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
    const tPedidos = pedidosMeta?.tPedidos || 'pedidos';
    const colFecha = pedidosMeta?.colFecha || 'FechaPedido';
    const colComercial = pedidosMeta?.colComercial || 'Id_Cial';
    const colEstadoTxt = pedidosMeta?.colEstado || 'EstadoPedido';
    const colEstadoId = pedidosMeta?.colEstadoId || 'Id_EstadoPedido';
    const colNumPedido = pedidosMeta?.colNumPedido || 'NumPedido';

    // Best-effort: columnas extra en pedidos para buscar/filtrar
    const pedidosCols = await db._getColumns(tPedidos).catch(() => []);
    const pedidosColsLower = new Map((pedidosCols || []).map((c) => [String(c).toLowerCase(), c]));
    const pickPedidoCol = (cands) => {
      for (const c of (cands || [])) {
        const real = pedidosColsLower.get(String(c).toLowerCase());
        if (real) return real;
      }
      return null;
    };
    const colNumPedidoCliente = pickPedidoCol(['NumPedidoCliente', 'Num_Pedido_Cliente', 'num_pedido_cliente']);
    const colNumAsociadoHefame = pickPedidoCol(['NumAsociadoHefame', 'num_asociado_hefame']);
    const colTotal = pickPedidoCol(['ped_total', 'TotalPedido', 'Total', 'ImporteTotal', 'total_pedido', 'importe_total']);
    const colEspecial = pickPedidoCol(['EsEspecial', 'es_especial', 'especial']);
    const colEspecialEstado = pickPedidoCol(['EspecialEstado', 'especial_estado']);

    // Meta clientes para joins/filtros (provincia/tipo cliente)
    const clientesMeta = await db._ensureClientesMeta().catch(() => null);
    const tClientes = clientesMeta?.tClientes || 'clientes';
    const clientesCols = Array.isArray(clientesMeta?.cols) ? clientesMeta.cols : (await db._getColumns(tClientes).catch(() => []));
    const clientesColsLower = new Map((clientesCols || []).map((c) => [String(c).toLowerCase(), c]));
    const pickClienteCol = (cands) => {
      for (const c of (cands || [])) {
        const real = clientesColsLower.get(String(c).toLowerCase());
        if (real) return real;
      }
      return null;
    };
    const cColNombre = pickClienteCol(['cli_nombre_razon_social', 'Nombre_Razon_Social', 'Nombre', 'nombre']);
    const cColNombreCial = pickClienteCol(['cli_nombre_cial', 'Nombre_Cial', 'nombre_cial']);
    const cColDniCif = pickClienteCol(['cli_dni_cif', 'DNI_CIF', 'DniCif', 'dni_cif', 'CIF', 'cif']);
    const cColEmail = pickClienteCol(['cli_email', 'Email', 'email']);
    const cColTelefono = pickClienteCol(['cli_telefono', 'Telefono', 'telefono', 'Movil', 'movil']);
    const cColPoblacion = pickClienteCol(['cli_poblacion', 'Poblacion', 'poblacion', 'Localidad', 'localidad']);
    const cColProvinciaId = pickClienteCol(['cli_prov_id', 'Id_Provincia', 'id_provincia', 'ProvinciaId', 'provincia_id']);
    const cColTipoClienteId = pickClienteCol(['cli_tipc_id', 'Id_TipoCliente', 'id_tipocliente', 'TipoClienteId', 'tipo_cliente_id']);

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

    const rawQ = String(req.query.q || req.query.search || '').trim();
    const smartQ = tokenizeSmartQuery(rawQ);

    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });

    // Joins opcionales para filtros "inteligentes"
    const tProvincias = cColProvinciaId ? await db._resolveTableNameCaseInsensitive('provincias').catch(() => null) : null;
    const joinProvincia = Boolean(tProvincias && cColProvinciaId);
    const tTiposClientes = cColTipoClienteId ? await db._resolveTableNameCaseInsensitive('tipos_clientes').catch(() => null) : null;
    const joinTipoCliente = Boolean(tTiposClientes && cColTipoClienteId);
    const tComerciales = await db._resolveTableNameCaseInsensitive('comerciales').catch(() => null);
    const joinComerciales = Boolean(tComerciales && colComercial);

    // Filtrar por año (y opcionalmente marca) usando FechaPedido (datetime)
    let items = [];
    let totalPedidos = 0;
    let colPaPedidoId = null;
    let colPaArticulo = null;
    let colArtPk = null;
    let colArtMarca = null;
    if (selectedMarcaId) {
      const paMeta = await db._ensurePedidosArticulosMeta().catch(() => null);
      const tArt = await db._resolveTableNameCaseInsensitive('articulos').catch(() => null);
      const paCols = paMeta ? (await db._getColumns(paMeta.table).catch(() => [])) : [];
      const artCols = tArt ? (await db._getColumns(tArt).catch(() => [])) : [];
      const paColsLower = new Map((paCols || []).map((c) => [String(c).toLowerCase(), c]));
      const artColsLower = new Map((artCols || []).map((c) => [String(c).toLowerCase(), c]));
      const pickPa = (cands) => { for (const c of (cands || [])) { const r = paColsLower.get(String(c).toLowerCase()); if (r) return r; } return null; };
      const pickArt = (cands) => { for (const c of (cands || [])) { const r = artColsLower.get(String(c).toLowerCase()); if (r) return r; } return null; };
      colPaPedidoId = paMeta?.colPedidoId || pickPa(['pedart_ped_id', 'Id_NumPedido', 'id_numpedido']) || 'pedart_ped_id';
      colPaArticulo = paMeta?.colArticulo || pickPa(['pedart_art_id', 'Id_Articulo', 'id_articulo']) || 'pedart_art_id';
      colArtPk = pickArt(['art_id', 'id', 'Id']) || 'art_id';
      colArtMarca = pickArt(['art_mar_id', 'Id_Marca', 'id_marca']) || 'art_mar_id';

      const where = [];
      const params = [];
      where.push(`YEAR(p.\`${colFecha}\`) = ?`);
      params.push(selectedYear);
      where.push(`a.\`${colArtMarca}\` = ?`);
      params.push(selectedMarcaId);
      if (scopeUserId) {
        where.push(`p.\`${colComercial}\` = ?`);
        params.push(scopeUserId);
      }

      // Tokens campo:valor
      const tokenClauses = [];
      for (const t of (smartQ.tokens || [])) {
        const f = t.field;
        const v = t.value;
        const neg = !!t.neg;
        const per = [];
        const perParamsStart = params.length;

        const addPerLike = (expr) => {
          per.push(`${expr} LIKE ?`);
          params.push(`%${v}%`);
        };
        const addPerEqNum = (expr) => {
          const n = Number(String(v).trim());
          if (Number.isFinite(n) && n > 0) {
            per.push(`${expr} = ?`);
            params.push(n);
            return true;
          }
          return false;
        };

        if (['cliente', 'c'].includes(f)) {
          if (cColNombre) addPerLike(`c.\`${cColNombre}\``);
          if (cColNombreCial) addPerLike(`c.\`${cColNombreCial}\``);
          if (cColDniCif) addPerLike(`c.\`${cColDniCif}\``);
        } else if (['provincia', 'prov', 'p'].includes(f)) {
          if (!(cColProvinciaId && addPerEqNum(`c.\`${cColProvinciaId}\``))) {
            if (joinProvincia) addPerLike(`COALESCE(pr.prov_nombre,'')`);
          }
        } else if (['poblacion', 'pob'].includes(f)) {
          if (cColPoblacion) addPerLike(`c.\`${cColPoblacion}\``);
        } else if (['comercial', 'com'].includes(f)) {
          if (!addPerEqNum(`p.\`${colComercial}\``)) {
            if (joinComerciales) {
              addPerLike(`COALESCE(co.com_nombre,'')`);
              addPerLike(`COALESCE(co.Email,'')`);
            }
          }
        } else if (['tipo', 'tipocliente', 'tc'].includes(f)) {
          if (!(cColTipoClienteId && addPerEqNum(`c.\`${cColTipoClienteId}\``))) {
            if (joinTipoCliente) addPerLike(`COALESCE(tc.tipc_tipo,'')`);
          }
        } else if (['estado', 'st'].includes(f)) {
          if (hasEstadoIdCol && addPerEqNum(`p.\`${colEstadoId}\``)) {
            // ok
          } else {
            if (hasEstadoIdCol) addPerLike(`COALESCE(ep.estped_nombre,'')`);
            addPerLike(`COALESCE(CONCAT(p.\`${colEstadoTxt}\`,''),'')`);
          }
        } else if (['pedido', 'num'].includes(f)) {
          if (!addPerEqNum(`p.\`${pedidosMeta?.pk || 'Id'}\``)) addPerLike(`COALESCE(CONCAT(p.\`${colNumPedido}\`,''),'')`);
        } else if (['ref', 'pedidocliente', 'pedidoCliente'].includes(f)) {
          if (colNumPedidoCliente) addPerLike(`COALESCE(CONCAT(p.\`${colNumPedidoCliente}\`,''),'')`);
        } else if (['hefame'].includes(f)) {
          if (colNumAsociadoHefame) addPerLike(`COALESCE(CONCAT(p.\`${colNumAsociadoHefame}\`,''),'')`);
        } else if (['especial'].includes(f)) {
          if (colEspecial) {
            const vv = String(v).trim().toLowerCase();
            if (['1', 'si', 'sí', 'true', 'yes'].includes(vv)) {
              per.push(`COALESCE(p.\`${colEspecial}\`,0) = 1`);
            } else if (['0', 'no', 'false'].includes(vv)) {
              per.push(`COALESCE(p.\`${colEspecial}\`,0) = 0`);
            }
          }
        } else if (['especialestado', 'espestado'].includes(f)) {
          if (colEspecialEstado) addPerLike(`COALESCE(CONCAT(p.\`${colEspecialEstado}\`,''),'')`);
        } else if (['total', 'importe'].includes(f)) {
          if (colTotal) {
            const m = String(v).trim().match(/^([<>]=?|=)?\s*([0-9]+(?:[.,][0-9]+)?)$/);
            if (m) {
              const op = m[1] || '=';
              const num = Number(String(m[2]).replace(',', '.'));
              if (Number.isFinite(num)) {
                per.push(`COALESCE(p.\`${colTotal}\`,0) ${op} ?`);
                params.push(num);
              }
            } else if (String(v).includes('..')) {
              const parts = String(v).split('..').map(s => s.trim());
              const a = Number(String(parts[0] || '').replace(',', '.'));
              const b = Number(String(parts[1] || '').replace(',', '.'));
              if (Number.isFinite(a) && Number.isFinite(b)) {
                per.push(`COALESCE(p.\`${colTotal}\`,0) BETWEEN ? AND ?`);
                params.push(Math.min(a, b), Math.max(a, b));
              }
            }
          }
        } else if (['fecha', 'desde', 'hasta'].includes(f)) {
          // Formato ISO YYYY-MM-DD o rango YYYY-MM-DD..YYYY-MM-DD
          const vv = String(v).trim();
          if (vv.includes('..')) {
            const [aRaw, bRaw] = vv.split('..');
            const a = String(aRaw || '').trim();
            const b = String(bRaw || '').trim();
            if (a && b) {
              per.push(`DATE(p.\`${colFecha}\`) BETWEEN ? AND ?`);
              params.push(a, b);
            }
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(vv)) {
            if (f === 'desde') {
              per.push(`DATE(p.\`${colFecha}\`) >= ?`);
              params.push(vv);
            } else if (f === 'hasta') {
              per.push(`DATE(p.\`${colFecha}\`) <= ?`);
              params.push(vv);
            } else {
              per.push(`DATE(p.\`${colFecha}\`) = ?`);
              params.push(vv);
            }
          }
        }

        if (per.length) {
          const clause = `(${per.join(' OR ')})`;
          tokenClauses.push(neg ? `NOT ${clause}` : clause);
        } else {
          // si no se pudo construir nada, revertir params añadidos por error
          params.splice(perParamsStart);
        }
      }

      // Texto libre: AND por término, OR por campo
      const termClauses = [];
      for (const term of (smartQ.terms || [])) {
        const ors = [];
        const likeVal = `%${term}%`;
        const addOr = (expr) => {
          ors.push(`${expr} LIKE ?`);
          params.push(likeVal);
        };
        addOr(`COALESCE(CONCAT(p.\`${colNumPedido}\`,''),'')`);
        if (colNumPedidoCliente) addOr(`COALESCE(CONCAT(p.\`${colNumPedidoCliente}\`,''),'')`);
        if (colNumAsociadoHefame) addOr(`COALESCE(CONCAT(p.\`${colNumAsociadoHefame}\`,''),'')`);
        if (cColNombre) addOr(`COALESCE(CONCAT(c.\`${cColNombre}\`,''),'')`);
        if (cColNombreCial) addOr(`COALESCE(CONCAT(c.\`${cColNombreCial}\`,''),'')`);
        if (cColDniCif) addOr(`COALESCE(CONCAT(c.\`${cColDniCif}\`,''),'')`);
        if (cColEmail) addOr(`COALESCE(CONCAT(c.\`${cColEmail}\`,''),'')`);
        if (cColTelefono) addOr(`COALESCE(CONCAT(c.\`${cColTelefono}\`,''),'')`);
        if (cColPoblacion) addOr(`COALESCE(CONCAT(c.\`${cColPoblacion}\`,''),'')`);
        if (joinProvincia) addOr(`COALESCE(pr.prov_nombre,'')`);
        if (joinComerciales) addOr(`COALESCE(co.com_nombre,'')`);
        if (joinTipoCliente) addOr(`COALESCE(tc.tipc_tipo,'')`);
        if (hasEstadoIdCol) addOr(`COALESCE(ep.estped_nombre,'')`);
        addOr(`COALESCE(CONCAT(p.\`${colEstadoTxt}\`,''),'')`);
        if (ors.length) termClauses.push(`(${ors.join(' OR ')})`);
      }

      if (tokenClauses.length) where.push(tokenClauses.join(' AND '));
      if (termClauses.length) where.push(termClauses.join(' AND '));

      const sql = `
        SELECT DISTINCT p.*,
          p.\`${colFecha}\` AS FechaPedido,
          p.\`${colNumPedido}\` AS NumPedido,
          ${hasEstadoIdCol ? 'ep.estped_nombre AS EstadoPedidoNombre, ep.estped_color AS EstadoColor,' : 'NULL AS EstadoPedidoNombre, NULL AS EstadoColor,'}
          ${cColNombre ? `c.\`${cColNombre}\` AS ClienteNombre,` : 'NULL AS ClienteNombre,'}
          ${cColNombreCial ? `c.\`${cColNombreCial}\` AS ClienteNombreCial,` : 'NULL AS ClienteNombreCial,'}
          ${joinProvincia ? 'pr.prov_nombre AS ProvinciaNombre,' : 'NULL AS ProvinciaNombre,'}
          ${joinTipoCliente ? 'tc.tipc_tipo AS TipoClienteNombre,' : 'NULL AS TipoClienteNombre,'}
          ${joinComerciales ? 'co.com_nombre AS ComercialNombre,' : 'NULL AS ComercialNombre,'}
          ${joinComerciales ? 'co.com_email AS ComercialEmail' : 'NULL AS ComercialEmail'}
        FROM \`${tPedidos}\` p
        LEFT JOIN \`${tClientes}\` c ON (c.\`${clientesMeta?.pk || 'cli_id'}\` = p.\`${pedidosMeta?.colCliente || 'ped_cli_id'}\`)
        ${joinProvincia ? `LEFT JOIN \`${tProvincias}\` pr ON c.\`${cColProvinciaId}\` = pr.prov_id` : ''}
        ${joinTipoCliente ? `LEFT JOIN \`${tTiposClientes}\` tc ON c.\`${cColTipoClienteId}\` = tc.tipc_id` : ''}
        ${joinComerciales ? `LEFT JOIN \`${tComerciales}\` co ON p.\`${colComercial}\` = co.com_id` : ''}
        ${hasEstadoIdCol ? `LEFT JOIN estados_pedido ep ON ep.estped_id = p.\`${colEstadoId}\`` : ''}
        INNER JOIN pedidos_articulos pa ON pa.\`${colPaPedidoId || 'pedart_ped_id'}\` = p.\`${pedidosMeta?.pk || 'ped_id'}\`
        INNER JOIN articulos a ON a.\`${colArtPk || 'art_id'}\` = pa.\`${colPaArticulo || 'pedart_art_id'}\`
        WHERE ${where.join('\n          AND ')}
        ORDER BY p.\`${pedidosMeta?.pk || 'ped_id'}\` DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const countSql = `
        SELECT COUNT(DISTINCT p.\`${pedidosMeta?.pk || 'ped_id'}\`) as total
        FROM \`${tPedidos}\` p
        LEFT JOIN \`${tClientes}\` c ON (c.\`${clientesMeta?.pk || 'cli_id'}\` = p.\`${pedidosMeta?.colCliente || 'ped_cli_id'}\`)
        ${joinProvincia ? `LEFT JOIN \`${tProvincias}\` pr ON c.\`${cColProvinciaId}\` = pr.prov_id` : ''}
        ${joinTipoCliente ? `LEFT JOIN \`${tTiposClientes}\` tc ON c.\`${cColTipoClienteId}\` = tc.tipc_id` : ''}
        ${joinComerciales ? `LEFT JOIN \`${tComerciales}\` co ON p.\`${colComercial}\` = co.com_id` : ''}
        ${hasEstadoIdCol ? `LEFT JOIN estados_pedido ep ON ep.estped_id = p.\`${colEstadoId}\`` : ''}
        INNER JOIN pedidos_articulos pa ON pa.\`${colPaPedidoId || 'pedart_ped_id'}\` = p.\`${pedidosMeta?.pk || 'ped_id'}\`
        INNER JOIN articulos a ON a.\`${colArtPk || 'art_id'}\` = pa.\`${colPaArticulo || 'pedart_art_id'}\`
        WHERE ${where.join('\n          AND ')}
      `;
      const [itemsRaw, countRows] = await Promise.all([db.query(sql, params), db.query(countSql, params)]);
      items = itemsRaw;
      totalPedidos = Number(_n(countRows && countRows[0] && countRows[0].total, 0));
    } else {
      const where = [];
      const params = [];
      where.push(`YEAR(p.\`${colFecha}\`) = ?`);
      params.push(selectedYear);
      if (scopeUserId) {
        where.push(`p.\`${colComercial}\` = ?`);
        params.push(scopeUserId);
      }

      const tokenClauses = [];
      const addEqNum = (expr, value) => {
        const n = Number(String(value).trim());
        if (Number.isFinite(n) && n > 0) {
          tokenClauses.push(`${expr} = ?`);
          params.push(n);
          return true;
        }
        return false;
      };
      for (const t of (smartQ.tokens || [])) {
        const f = t.field;
        const v = t.value;
        const neg = !!t.neg;
        const per = [];
        const perParamsStart = params.length;
        const addPerLike = (expr) => {
          per.push(`${expr} LIKE ?`);
          params.push(`%${v}%`);
        };
        const addPerEqNum = (expr) => {
          const n = Number(String(v).trim());
          if (Number.isFinite(n) && n > 0) {
            per.push(`${expr} = ?`);
            params.push(n);
            return true;
          }
          return false;
        };

        if (['cliente', 'c'].includes(f)) {
          if (cColNombre) addPerLike(`c.\`${cColNombre}\``);
          if (cColNombreCial) addPerLike(`c.\`${cColNombreCial}\``);
          if (cColDniCif) addPerLike(`c.\`${cColDniCif}\``);
        } else if (['provincia', 'prov', 'p'].includes(f)) {
          if (!(cColProvinciaId && addPerEqNum(`c.\`${cColProvinciaId}\``))) {
            if (joinProvincia) addPerLike(`COALESCE(pr.prov_nombre,'')`);
          }
        } else if (['poblacion', 'pob'].includes(f)) {
          if (cColPoblacion) addPerLike(`c.\`${cColPoblacion}\``);
        } else if (['comercial', 'com'].includes(f)) {
          if (!addPerEqNum(`p.\`${colComercial}\``)) {
            if (joinComerciales) {
              addPerLike(`COALESCE(co.com_nombre,'')`);
              addPerLike(`COALESCE(co.Email,'')`);
            }
          }
        } else if (['tipo', 'tipocliente', 'tc'].includes(f)) {
          if (!(cColTipoClienteId && addPerEqNum(`c.\`${cColTipoClienteId}\``))) {
            if (joinTipoCliente) addPerLike(`COALESCE(tc.tipc_tipo,'')`);
          }
        } else if (['estado', 'st'].includes(f)) {
          if (hasEstadoIdCol && addPerEqNum(`p.\`${colEstadoId}\``)) {
            // ok
          } else {
            if (hasEstadoIdCol) addPerLike(`COALESCE(ep.estped_nombre,'')`);
            addPerLike(`COALESCE(CONCAT(p.\`${colEstadoTxt}\`,''),'')`);
          }
        } else if (['pedido', 'num'].includes(f)) {
          if (!addPerEqNum(`p.\`${pedidosMeta?.pk || 'Id'}\``)) addPerLike(`COALESCE(CONCAT(p.\`${colNumPedido}\`,''),'')`);
        } else if (['ref', 'pedidocliente', 'pedidoCliente'].includes(f)) {
          if (colNumPedidoCliente) addPerLike(`COALESCE(CONCAT(p.\`${colNumPedidoCliente}\`,''),'')`);
        } else if (['hefame'].includes(f)) {
          if (colNumAsociadoHefame) addPerLike(`COALESCE(CONCAT(p.\`${colNumAsociadoHefame}\`,''),'')`);
        } else if (['especial'].includes(f)) {
          if (colEspecial) {
            const vv = String(v).trim().toLowerCase();
            if (['1', 'si', 'sí', 'true', 'yes'].includes(vv)) per.push(`COALESCE(p.\`${colEspecial}\`,0) = 1`);
            else if (['0', 'no', 'false'].includes(vv)) per.push(`COALESCE(p.\`${colEspecial}\`,0) = 0`);
          }
        } else if (['especialestado', 'espestado'].includes(f)) {
          if (colEspecialEstado) addPerLike(`COALESCE(CONCAT(p.\`${colEspecialEstado}\`,''),'')`);
        } else if (['total', 'importe'].includes(f)) {
          if (colTotal) {
            const m = String(v).trim().match(/^([<>]=?|=)?\s*([0-9]+(?:[.,][0-9]+)?)$/);
            if (m) {
              const op = m[1] || '=';
              const num = Number(String(m[2]).replace(',', '.'));
              if (Number.isFinite(num)) {
                per.push(`COALESCE(p.\`${colTotal}\`,0) ${op} ?`);
                params.push(num);
              }
            } else if (String(v).includes('..')) {
              const parts = String(v).split('..').map(s => s.trim());
              const a = Number(String(parts[0] || '').replace(',', '.'));
              const b = Number(String(parts[1] || '').replace(',', '.'));
              if (Number.isFinite(a) && Number.isFinite(b)) {
                per.push(`COALESCE(p.\`${colTotal}\`,0) BETWEEN ? AND ?`);
                params.push(Math.min(a, b), Math.max(a, b));
              }
            }
          }
        } else if (['fecha', 'desde', 'hasta'].includes(f)) {
          const vv = String(v).trim();
          if (vv.includes('..')) {
            const [aRaw, bRaw] = vv.split('..');
            const a = String(aRaw || '').trim();
            const b = String(bRaw || '').trim();
            if (a && b) {
              per.push(`DATE(p.\`${colFecha}\`) BETWEEN ? AND ?`);
              params.push(a, b);
            }
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(vv)) {
            if (f === 'desde') {
              per.push(`DATE(p.\`${colFecha}\`) >= ?`);
              params.push(vv);
            } else if (f === 'hasta') {
              per.push(`DATE(p.\`${colFecha}\`) <= ?`);
              params.push(vv);
            } else {
              per.push(`DATE(p.\`${colFecha}\`) = ?`);
              params.push(vv);
            }
          }
        }

        if (per.length) {
          const clause = `(${per.join(' OR ')})`;
          tokenClauses.push(neg ? `NOT ${clause}` : clause);
        } else {
          params.splice(perParamsStart);
        }
      }

      const termClauses = [];
      for (const term of (smartQ.terms || [])) {
        const ors = [];
        const likeVal = `%${term}%`;
        const addOr = (expr) => {
          ors.push(`${expr} LIKE ?`);
          params.push(likeVal);
        };
        addOr(`COALESCE(CONCAT(p.\`${colNumPedido}\`,''),'')`);
        if (colNumPedidoCliente) addOr(`COALESCE(CONCAT(p.\`${colNumPedidoCliente}\`,''),'')`);
        if (colNumAsociadoHefame) addOr(`COALESCE(CONCAT(p.\`${colNumAsociadoHefame}\`,''),'')`);
        if (cColNombre) addOr(`COALESCE(CONCAT(c.\`${cColNombre}\`,''),'')`);
        if (cColNombreCial) addOr(`COALESCE(CONCAT(c.\`${cColNombreCial}\`,''),'')`);
        if (cColDniCif) addOr(`COALESCE(CONCAT(c.\`${cColDniCif}\`,''),'')`);
        if (cColEmail) addOr(`COALESCE(CONCAT(c.\`${cColEmail}\`,''),'')`);
        if (cColTelefono) addOr(`COALESCE(CONCAT(c.\`${cColTelefono}\`,''),'')`);
        if (cColPoblacion) addOr(`COALESCE(CONCAT(c.\`${cColPoblacion}\`,''),'')`);
        if (joinProvincia) addOr(`COALESCE(pr.prov_nombre,'')`);
        if (joinComerciales) addOr(`COALESCE(co.com_nombre,'')`);
        if (joinTipoCliente) addOr(`COALESCE(tc.tipc_tipo,'')`);
        if (hasEstadoIdCol) addOr(`COALESCE(ep.estped_nombre,'')`);
        addOr(`COALESCE(CONCAT(p.\`${colEstadoTxt}\`,''),'')`);
        if (ors.length) termClauses.push(`(${ors.join(' OR ')})`);
      }

      if (tokenClauses.length) where.push(tokenClauses.join(' AND '));
      if (termClauses.length) where.push(termClauses.join(' AND '));

      const sql = `
        SELECT p.*,
          p.\`${colFecha}\` AS FechaPedido,
          p.\`${colNumPedido}\` AS NumPedido,
          ${hasEstadoIdCol ? 'ep.estped_nombre AS EstadoPedidoNombre, ep.estped_color AS EstadoColor,' : 'NULL AS EstadoPedidoNombre, NULL AS EstadoColor,'}
          ${cColNombre ? `c.\`${cColNombre}\` AS ClienteNombre,` : 'NULL AS ClienteNombre,'}
          ${cColNombreCial ? `c.\`${cColNombreCial}\` AS ClienteNombreCial,` : 'NULL AS ClienteNombreCial,'}
          ${joinProvincia ? 'pr.prov_nombre AS ProvinciaNombre,' : 'NULL AS ProvinciaNombre,'}
          ${joinTipoCliente ? 'tc.tipc_tipo AS TipoClienteNombre,' : 'NULL AS TipoClienteNombre,'}
          ${joinComerciales ? 'co.com_nombre AS ComercialNombre,' : 'NULL AS ComercialNombre,'}
          ${joinComerciales ? 'co.com_email AS ComercialEmail' : 'NULL AS ComercialEmail'}
        FROM \`${tPedidos}\` p
        LEFT JOIN \`${tClientes}\` c ON (c.\`${clientesMeta?.pk || 'cli_id'}\` = p.\`${pedidosMeta?.colCliente || 'ped_cli_id'}\`)
        ${joinProvincia ? `LEFT JOIN \`${tProvincias}\` pr ON c.\`${cColProvinciaId}\` = pr.prov_id` : ''}
        ${joinTipoCliente ? `LEFT JOIN \`${tTiposClientes}\` tc ON c.\`${cColTipoClienteId}\` = tc.tipc_id` : ''}
        ${joinComerciales ? `LEFT JOIN \`${tComerciales}\` co ON p.\`${colComercial}\` = co.com_id` : ''}
        ${hasEstadoIdCol ? `LEFT JOIN estados_pedido ep ON ep.estped_id = p.\`${colEstadoId}\`` : ''}
        WHERE ${where.join('\n          AND ')}
        ORDER BY p.\`${pedidosMeta?.pk || 'ped_id'}\` DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const countSql = `
        SELECT COUNT(*) as total
        FROM \`${tPedidos}\` p
        LEFT JOIN \`${tClientes}\` c ON (c.\`${clientesMeta?.pk || 'cli_id'}\` = p.\`${pedidosMeta?.colCliente || 'ped_cli_id'}\`)
        ${joinProvincia ? `LEFT JOIN \`${tProvincias}\` pr ON c.\`${cColProvinciaId}\` = pr.prov_id` : ''}
        ${joinTipoCliente ? `LEFT JOIN \`${tTiposClientes}\` tc ON c.\`${cColTipoClienteId}\` = tc.tipc_id` : ''}
        ${joinComerciales ? `LEFT JOIN \`${tComerciales}\` co ON p.\`${colComercial}\` = co.com_id` : ''}
        ${hasEstadoIdCol ? `LEFT JOIN estados_pedido ep ON ep.estped_id = p.\`${colEstadoId}\`` : ''}
        WHERE ${where.join('\n          AND ')}
      `;
      const [itemsRaw, countRows] = await Promise.all([db.query(sql, params), db.query(countSql, params)]);
      items = itemsRaw;
      totalPedidos = Number(_n(countRows && countRows[0] && countRows[0].total, 0));
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

    // Estados de pedido (solo admin) para UI de cambio de estado en listado
    let estadosPedido = [];
    if (admin) {
      await db.ensureEstadosPedidoTable().catch(() => null);
      estadosPedido = await db.getEstadosPedidoActivos().catch(() => []);
    }

    const sessionUser = res.locals.user;
    const sessionUserId = sessionUser?.id != null ? Number(sessionUser.id) : null;
    res.render('pedidos', {
      items: items || [],
      years,
      selectedYear,
      marcas: Array.isArray(marcas) ? marcas : [],
      selectedMarcaId,
      q: rawQ,
      admin,
      userId: sessionUserId,
      user: sessionUser,
      n8nNotice,
      estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
      paging: { page, limit, total: totalPedidos }
    });
  } catch (e) {
    next(e);
  }
});

// Admin: cambiar estado del pedido desde el listado (/pedidos)
app.post('/pedidos/:id(\\d+)/estado', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'ID no válido' });

    const estadoIdRaw = _n(_n(_n(_n(req.body && req.body.estadoId, req.body && req.body.estado_id), req.body && req.body.Id_EstadoPedido), req.body && req.body.id_estado_pedido), null);
    const estadoId = Number(estadoIdRaw);
    if (!Number.isFinite(estadoId) || estadoId <= 0) {
      return res.status(400).json({ ok: false, error: 'Estado no válido' });
    }

    await db.ensureEstadosPedidoTable().catch(() => null);
    const estado = await db.getEstadoPedidoById(estadoId).catch(() => null);
    if (!estado) return res.status(404).json({ ok: false, error: 'Estado no encontrado' });

    const nombre = String(_n(_n(estado && estado.nombre, estado && estado.Nombre), '')).trim();
    const color = String(_n(_n(estado && estado.color, estado && estado.Color), 'info')).trim().toLowerCase() || 'info';

    // Best-effort: actualizar Id_EstadoPedido si existe y mantener texto legacy si existe.
    await db.updatePedido(id, { Id_EstadoPedido: estadoId, EstadoPedido: nombre || undefined }).catch((e) => {
      throw e;
    });

    return res.json({ ok: true, id, estado: { id: estadoId, nombre: nombre || '—', color } });
  } catch (e) {
    next(e);
  }
});

// ===========================
// PEDIDOS (HTML) - Admin CRUD
// ===========================
function parseLineasFromBody(body) {
  const raw = _n(_n(body && body.lineas, body && body.Lineas), []);
  const arr = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
  const lineas = [];
  for (const l of (arr || [])) {
    const item = l && typeof l === 'object' ? l : {};
    const idArt = Number(_n(_n(_n(item.Id_Articulo, item.id_articulo), item.ArticuloId), 0)) || 0;
    const cantidad = Number(String(_n(_n(item.Cantidad, item.Unidades), 0)).replace(',', '.')) || 0;
    let dto = undefined;
    if (item.Dto !== undefined) {
      const s = String(_n(item.Dto, '')).trim();
      if (s !== '') {
        const n = Number(String(s).replace(',', '.'));
        if (Number.isFinite(n)) dto = n;
      }
    }
    let precioUnit = undefined;
    if (item.PrecioUnitario !== undefined || item.Precio !== undefined) {
      const s = String(_n(_n(item.PrecioUnitario, item.Precio), '')).trim();
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
    if (tarifaTransfer && _n(tarifaTransfer.tarcli_id, tarifaTransfer.Id, tarifaTransfer.id) != null && !(tarifas || []).some((t) => Number(_n(t.tarcli_id, t.Id, t.id)) === Number(_n(tarifaTransfer.tarcli_id, tarifaTransfer.Id, tarifaTransfer.id)))) tarifas.push(tarifaTransfer);
    const formaPagoTransfer = await db.ensureFormaPagoTransfer().catch(() => null);
    if (formaPagoTransfer && _n(formaPagoTransfer.id, formaPagoTransfer.Id) != null && !(formasPago || []).some((f) => Number(_n(f.id, f.Id)) === Number(_n(formaPagoTransfer.id, formaPagoTransfer.Id)))) formasPago.push(formaPagoTransfer);
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
        Id_Cial: _n(res.locals.user && res.locals.user.id, null),
        Id_Tarifa: 0,
        Serie: 'P',
        EstadoPedido: 'Pendiente',
        Id_EstadoPedido: _n(estadoPendienteId, null),
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
    const activo = Number(_n(_n(clientePedido && clientePedido.OK_KO, clientePedido && clientePedido.ok_ko), 0)) === 1;
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
    const pedidoId = _n(_n(created && created.insertId, created && created.Id), created && created.id);
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
          Id_Articulo: _n(pickRowCI(l, ['Id_Articulo', 'id_articulo', 'ArticuloId', 'Articulo_Id']), ''),
          Cantidad: _n(pickRowCI(l, ['Cantidad', 'cantidad', 'Unidades', 'Uds']), 1),
          Dto: _n(pickRowCI(l, ['Linea_Dto', 'DtoLinea', 'Dto', 'dto', 'Descuento']), ''),
          PrecioUnitario: _n(pickRowCI(l, ['Linea_PVP', 'PVP', 'PrecioUnitario', 'Precio', 'PVL']), '')
        }))
      : [];
    const created = await db.createPedido(cabecera);
    const newId = _n(_n(created && created.insertId, created && created.Id), created && created.id);
    if (lineas.length) await db.updatePedidoWithLineas(newId, {}, lineas);
    return res.redirect(`/pedidos/${newId}/edit`);
  } catch (e) {
    next(e);
  }
});

// HEFAME solo disponible si forma de pago = Transfer y tipo de pedido incluye "HEFAME" (admin y comercial)
async function canShowHefameForPedido(item) {
  const idFormaPago = Number(_n(_n(item && item.Id_FormaPago, item && item.id_forma_pago), 0));
  const idTipoPedido = Number(_n(_n(item && item.Id_TipoPedido, item && item.id_tipo_pedido), 0));
  const [formaPago, tipos] = await Promise.all([
    idFormaPago ? db.getFormaPagoById(idFormaPago).catch(() => null) : null,
    db.getTiposPedido().catch(() => [])
  ]);
  const tipo = _n((tipos || []).find((t) => Number(_n(t.id, t.Id)) === idTipoPedido), null);
  const formaPagoNombre = String(_n(_n(_n(formaPago && formaPago.FormaPago, formaPago && formaPago.Nombre), formaPago && formaPago.nombre), '')).trim();
  const tipoNombre = String(_n(_n(_n(tipo && tipo.Tipo, tipo && tipo.Nombre), tipo && tipo.nombre), '')).trim();
  return /transfer/i.test(formaPagoNombre) && /hefame/i.test(tipoNombre);
}

// Para envíos (N8N): usar plantilla "Transfer" en cuanto la forma de pago sea Transfer,
// aunque el tipo no sea HEFAME (si falta, quedará el campo vacío en la plantilla).
async function isTransferPedido(item) {
  const idFormaPago = Number(_n(_n(item && item.Id_FormaPago, item && item.id_forma_pago), 0));
  if (!idFormaPago) return false;
  const formaPago = await db.getFormaPagoById(idFormaPago).catch(() => null);
  const formaPagoNombre = String(_n(_n(_n(formaPago && formaPago.FormaPago, formaPago && formaPago.Nombre), formaPago && formaPago.nombre), '')).trim();
  return /transfer/i.test(formaPagoNombre);
}

app.get('/pedidos/:id(\\d+)', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    const admin = res.locals.pedidoAdmin;
    const id = Number(req.params.id);
    const idFormaPago = Number(_n(_n(_n(item && item.Id_FormaPago, item && item.id_forma_pago), item && item.ped_formp_id), 0)) || 0;
    const idTipoPedido = Number(_n(_n(_n(item && item.Id_TipoPedido, item && item.id_tipo_pedido), item && item.ped_tipp_id), 0)) || 0;
    const idTarifa = Number(_n(_n(_n(item && item.Id_Tarifa, item && item.id_tarifa), item && item.ped_tarcli_id), 0)) || 0;
    const idEstadoPedido = Number(_n(_n(_n(item && item.Id_EstadoPedido, item && item.id_estado_pedido), item && item.ped_estped_id), 0)) || 0;
    const idComercial = Number(_n(_n(_n(_n(_n(item && item.Id_Cial, item && item.id_cial), item && item.ped_com_id), item && item.ComercialId), item && item.comercialId), 0)) || 0;

    const needTiposPedido = idTipoPedido > 0;
    const needTarifas = idTarifa > 0;

    const idCliente = Number(item?.Id_Cliente ?? item?.ped_cli_id ?? 0) || 0;
    const [
      lineas,
      cliente,
      canShowHefame,
      formaPago,
      estadoPedido,
      comercial,
      tiposPedido,
      tarifas
    ] = await Promise.all([
      db.getArticulosByPedido(id).catch(() => []),
      idCliente ? db.getClienteById(idCliente).catch(() => null) : null,
      canShowHefameForPedido(item),
      idFormaPago ? db.getFormaPagoById(idFormaPago).catch(() => null) : null,
      idEstadoPedido ? db.getEstadoPedidoById(idEstadoPedido).catch(() => null) : null,
      idComercial ? db.getComercialById(idComercial).catch(() => null) : null,
      needTiposPedido ? db.getTiposPedido().catch(() => []) : [],
      needTarifas ? db.getTarifas().catch(() => []) : []
    ]);

    const tipoPedido = needTiposPedido
      ? (tiposPedido || []).find((t) => Number(_n(_n(_n(t && t.id, t && t.Id), t && t.tipp_id), 0)) === idTipoPedido) || null
      : null;
    const tarifa = needTarifas
      ? (tarifas || []).find((t) => Number(_n(_n(_n(t && t.Id, t && t.id), t && t.tarcli_id), 0)) === idTarifa) || null
      : null;

    const idDirEnvio = Number(item?.Id_DireccionEnvio ?? item?.ped_direnv_id ?? 0) || 0;
    let direccionEnvio = idDirEnvio
      ? await db.getDireccionEnvioById(idDirEnvio).catch(() => null)
      : null;
    const clientePk = Number(cliente?.Id ?? cliente?.cli_id ?? cliente?.id ?? 0) || 0;
    if (!direccionEnvio && clientePk) {
      const dirs = await db.getDireccionesEnvioByCliente(clientePk).catch(() => []);
      if (Array.isArray(dirs) && dirs.length === 1) direccionEnvio = dirs[0];
    }

    const estadoNorm = String(_n(_n(_n(item.EstadoPedido, item.Estado), item.ped_estado_txt), '')).trim().toLowerCase() || 'pendiente';
    const userId = Number(res.locals.user?.id);
    const owner = Number(item.ped_com_id ?? item.Id_Cial ?? item.id_cial ?? item.ComercialId ?? item.comercialId ?? 0) || 0;
    const canEdit =
      admin ? !estadoNorm.includes('pagad') : (Number.isFinite(userId) && userId === owner && estadoNorm.includes('pend'));

    // Labels para mostrar nombres en vez de IDs (compatibles con columnas legacy y migradas)
    const pick = (obj, keys) => {
      if (!obj || typeof obj !== 'object') return '';
      for (const k of keys) {
        const v = obj[k];
        if (v != null && String(v).trim() !== '') return String(v).trim();
      }
      return '';
    };
    const clienteLabel = pick(cliente, ['Nombre_Razon_Social', 'cli_nombre_razon_social', 'Nombre', 'nombre']);
    const comercialLabel = pick(comercial, ['Nombre', 'com_nombre', 'nombre']);
    const formaPagoLabel = pick(formaPago, ['FormaPago', 'formp_nombre', 'Nombre', 'nombre', 'forma_pago']);
    const tarifaLabel = pick(tarifa, ['NombreTarifa', 'Nombre', 'nombre', 'tarcli_nombre']);
    const tipoPedidoLabel = pick(tipoPedido, ['Nombre', 'Tipo', 'tipp_tipo', 'nombre', 'tipo']);
    const estadoLabel = pick(estadoPedido, ['nombre', 'Nombre', 'estped_nombre']) || pick(item, ['EstadoPedido', 'Estado', 'ped_estado_txt']) || '';

    // Enriquecer líneas con PVL cuando está en 0: buscar precios por tarifa
    let lineasToRender = lineas || [];
    const artIdsNeedingPvl = (lineasToRender || [])
      .map((l) => Number(l.pedart_art_id ?? l.Id_Articulo ?? l.id_articulo ?? l.art_id ?? 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    const needsEnrichment = (lineasToRender || []).some((l) => {
      const pvl = Number(l.Linea_PVP ?? l.pedart_pvp ?? l.PVP ?? l.pvp ?? l.art_pvl ?? 0);
      return !Number.isFinite(pvl) || pvl <= 0;
    });
    if (needsEnrichment && artIdsNeedingPvl.length > 0) {
      const precios = await db.getPreciosArticulosParaTarifa(idTarifa ?? 0, artIdsNeedingPvl).catch(() => ({}));
      lineasToRender = (lineasToRender || []).map((l) => {
        const artId = Number(l.pedart_art_id ?? l.Id_Articulo ?? l.id_articulo ?? l.art_id ?? 0);
        const pvlStored = Number(l.Linea_PVP ?? l.pedart_pvp ?? l.PVP ?? l.pvp ?? 0);
        if ((!Number.isFinite(pvlStored) || pvlStored <= 0) && artId > 0 && precios[artId] != null) {
          return { ...l, Linea_PVP: precios[artId], pedart_pvp: precios[artId] };
        }
        return l;
      });
    }

    res.render('pedido', {
      item,
      lineas: lineasToRender,
      cliente,
      direccionEnvio,
      admin,
      canEdit,
      canShowHefame,
      formaPago,
      tipoPedido,
      tarifa,
      estadoPedido,
      comercial,
      clienteLabel,
      comercialLabel,
      formaPagoLabel,
      tarifaLabel,
      tipoPedidoLabel,
      estadoLabel
    });
  } catch (e) {
    next(e);
  }
});

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function buildStandardPedidoXlsxBuffer({ item, id, lineas, cliente, direccionEnvio, fmtDateES }) {
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const dtoPedidoPct = Math.max(0, Math.min(100, toNumUtil(_n(_n(item.Dto, item.Descuento), 0), 0)));

  const numPedido = String(_n(_n(_n(item && item.NumPedido, item && item.Num_Pedido), item && item.Numero_Pedido), '')).trim();
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
  const fecha = fmtDateES ? fmtDateES(_n(_n(item.FechaPedido, item.Fecha), '')) : '';
  const entrega = item?.FechaEntrega && fmtDateES ? fmtDateES(item.FechaEntrega) : '';
  const numPedidoCliente = String(_n(_n(item && item.NumPedidoCliente, item && item.Num_Pedido_Cliente), '')).trim();
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
    const codigo = String(_n(_n(_n(_n(l.SKU, l.Codigo), l.Id_Articulo), l.id_articulo), '')).trim();
    const concepto = String(_n(_n(_n(_n(l.Nombre, l.Descripcion), l.Articulo), l.nombre), '')).trim();
    const qty = Math.max(0, toNumUtil(_n(_n(l.Cantidad, l.Unidades), 0), 0));
    const pvl = Math.max(0, toNumUtil(_n(_n(_n(_n(_n(_n(_n(l.Linea_PVP, l.PVP), l.pvp), l.PrecioUnitario), l.PVL), l.Precio), l.pvl), 0), 0));
    const dto = Math.max(0, Math.min(100, toNumUtil(_n(_n(_n(_n(_n(_n(l.Linea_Dto, l.DtoLinea), l.dto_linea), l.Dto), l.dto), l.Descuento), 0), 0)));
    let ivaPct = toNumUtil(_n(_n(_n(_n(_n(l.Linea_IVA, l.IVA), l.PorcIVA), l.PorcentajeIVA), l.TipoIVA), 0), 0);
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
  const numPedido = String(_n(_n(_n(item && item.NumPedido, item && item.Num_Pedido), item && item.Numero_Pedido), '')).trim();

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
  const codigoHefame = String(_n(_n(item && item.NumAsociadoHefame, item && item.num_asociado_hefame), '')).trim();
  const telefono = cliente?.Telefono || cliente?.Movil || cliente?.Teléfono || '';
  const cp = String(_n(cliente && cliente.CodigoPostal, '')).trim();
  const poblacion = String(_n(cliente && cliente.Poblacion, '')).trim();
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
    const cantidad = Math.max(0, toNumUtil(_n(_n(l.Cantidad, l.Unidades), 0), 0));
    const cn = String(_n(_n(_n(_n(l.SKU, l.Codigo), l.Id_Articulo), l.id_articulo), '')).trim();
    const descripcion = String(_n(_n(_n(_n(l.Nombre, l.Descripcion), l.Articulo), l.nombre), '')).trim();
    const descuentoPct = Math.max(0, Math.min(100, toNumUtil(_n(_n(_n(_n(_n(l.Linea_Dto, l.DtoLinea), l.Dto), l.dto), l.Descuento), 0), 0)));
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

app.post('/pedidos/:id(\\d+)/enviar-n8n', requireLogin, requireAdmin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
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
        const pedidoId = Number(_n(_n(item && item.Id, item && item.id), id)) || id;
        const numPedido = String(_n(_n(_n(item && item.NumPedido, item && item.Num_Pedido), item && item.Numero_Pedido), '')).trim();
        const numPedidoCliente = String(_n(_n(item && item.NumPedidoCliente, item && item.Num_Pedido_Cliente), '')).trim();
        const idCliente = Number(_n(_n(_n(_n(item && item.Id_Cliente, item && item.id_cliente), cliente && cliente.Id), cliente && cliente.id), 0)) || null;
        const idComercial = Number(_n(_n(_n(_n(item && item.Id_Cial, item && item.id_cial), item && item.ComercialId), item && item.comercialId), 0)) || null;
        const idFormaPago = Number(_n(_n(item && item.Id_FormaPago, item && item.id_forma_pago), 0)) || null;
        const idTipoPedido = Number(_n(_n(item && item.Id_TipoPedido, item && item.id_tipo_pedido), 0)) || null;
        const idTarifa = _n(item && item.Id_Tarifa, item && item.id_tarifa);
        const tarifaIdNum = idTarifa === null || idTarifa === undefined || String(idTarifa).trim() === '' ? null : (Number(idTarifa) || null);
        const idEstado = Number(_n(_n(item && item.Id_EstadoPedido, item && item.id_estado_pedido), 0)) || null;

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
          fecha: _n(_n(item && item.FechaPedido, item && item.Fecha), null),
          entrega: _n(item && item.FechaEntrega, null),
          total: _n(_n(item && item.TotalPedido, item && item.Total), null),
          subtotal: _n(_n(item && item.SubtotalPedido, item && item.Subtotal), null),
          descuentoPct: _n(_n(item && item.Dto, item && item.Descuento), null),
          observaciones: _n(item && item.Observaciones, null),
          numPedidoCliente: numPedidoCliente || null,
          numAsociadoHefame: _n(_n(item && item.NumAsociadoHefame, item && item.num_asociado_hefame), null),
          cliente: {
            id: idCliente,
            nombre: clienteNombre || (idCliente ? String(idCliente) : null),
            cif: _n(cliente && cliente.DNI_CIF, cliente && cliente.DniCif),
            poblacion: _n(cliente && cliente.Poblacion, null),
            cp: _n(cliente && cliente.CodigoPostal, null),
            telefono: _n(cliente && cliente.Telefono, cliente && cliente.Movil),
            email: _n(cliente && cliente.Email, null)
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
        articuloId: Number(_n(_n(_n(l.Id_Articulo, l.id_articulo), l.ArticuloId), 0)) || null,
        codigo: String(_n(_n(_n(_n(l.SKU, l.Codigo), l.Id_Articulo), l.id_articulo), '')).trim() || null,
        nombre: String(_n(_n(_n(_n(l.Nombre, l.Descripcion), l.Articulo), l.nombre), '')).trim() || null,
        cantidad: Number(_n(_n(l.Cantidad, l.Unidades), 0)) || 0,
        precioUnitario: Number(_n(_n(_n(_n(_n(l.Linea_PVP, l.PVP), l.PrecioUnitario), l.PVL), l.Precio), 0)) || 0,
        descuentoPct: Number(_n(_n(_n(_n(_n(l.Linea_Dto, l.DtoLinea), l.Dto), l.dto), l.Descuento), 0)) || 0,
        ivaPct: Number(_n(_n(_n(_n(l.Linea_IVA, l.IVA), l.PorcIVA), l.PorcentajeIVA), 0)) || 0
      })),
      cliente: cliente
        ? {
            id: _n(_n(cliente && cliente.Id, cliente && cliente.id), null),
            nombre: _n(_n(_n(cliente && cliente.Nombre_Razon_Social, cliente && cliente.Nombre), cliente && cliente.nombre), null),
            cif: _n(cliente && cliente.DNI_CIF, cliente && cliente.DniCif),
            direccion: _n(cliente && cliente.Direccion, null),
            poblacion: _n(cliente && cliente.Poblacion, null),
            cp: _n(cliente && cliente.CodigoPostal, null),
            telefono: _n(cliente && cliente.Telefono, cliente && cliente.Movil),
            email: _n(cliente && cliente.Email, null)
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
    const pedidoNum = String(_n(_n(_n(item && item.NumPedido, item && item.Num_Pedido), item && item.Numero_Pedido), id)).trim();
    const clienteNombre =
      (payload?.pedido?.cliente?.nombre ? String(payload.pedido.cliente.nombre) : '') ||
      String(_n(_n(item && item.ClienteNombre, item && item.ClienteNombreCial), '')).trim() ||
      '';
    const totalLabel = _n(_n(item && item.TotalPedido, item && item.Total), null);
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
      .map((l) => `- ${l.codigo || l.articuloId || '—'} · ${l.nombre || ''} · uds: ${_n(l.cantidad, 0)}`)
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
    if (tarifaTransfer && _n(tarifaTransfer.tarcli_id, tarifaTransfer.Id, tarifaTransfer.id) != null && !(tarifas || []).some((t) => Number(_n(t.tarcli_id, t.Id, t.id)) === Number(_n(tarifaTransfer.tarcli_id, tarifaTransfer.Id, tarifaTransfer.id)))) tarifas.push(tarifaTransfer);
    const formaPagoTransfer = await db.ensureFormaPagoTransfer().catch(() => null);
    if (formaPagoTransfer && _n(formaPagoTransfer.id, formaPagoTransfer.Id) != null && !(formasPago || []).some((f) => Number(_n(f.id, f.Id)) === Number(_n(formaPagoTransfer.id, formaPagoTransfer.Id)))) formasPago.push(formaPagoTransfer);

    const estadoNorm = String(_n(_n(_n(item.EstadoPedido, item.Estado), item.ped_estado_txt), 'Pendiente')).trim().toLowerCase() || 'pendiente';
    const canEdit = admin ? !estadoNorm.includes('pagad') : estadoNorm.includes('pend');
    if (!canEdit) {
      return renderErrorPage(req, res, {
        status: 403,
        heading: 'No permitido',
        summary: admin
          ? 'Un pedido en estado "Pagado" no se puede modificar.'
          : 'Solo puedes modificar pedidos en estado "Pendiente".',
        publicMessage: `Estado actual: ${String(_n(_n(item.EstadoPedido, item.Estado), item.ped_estado_txt ?? '—'))}`
      });
    }

    const idClienteEdit = Number(item?.Id_Cliente ?? item?.ped_cli_id ?? 0) || 0;
    const cliente = idClienteEdit ? await db.getClienteById(idClienteEdit).catch(() => null) : null;
    const clienteLabel = cliente
      ? (() => {
          const idc = _n(_n(_n(_n(cliente.cli_id, cliente.Id), cliente.id), item.Id_Cliente), '');
          const rs = _n(_n(cliente.cli_nombre_razon_social, cliente.Nombre_Razon_Social), cliente.Nombre || '');
          const nc = _n(_n(cliente.cli_nombre_cial, cliente.Nombre_Cial), '');
          const cif = _n(_n(cliente.cli_dni_cif, cliente.DNI_CIF), '');
          const pob = _n(_n(cliente.cli_poblacion, cliente.Poblacion), '');
          const cp = _n(_n(cliente.cli_codigo_postal, cliente.CodigoPostal), '');
          const parts = [rs, nc].filter(Boolean).join(' / ');
          const extra = [cif, [cp, pob].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
          return `${idc} · ${parts || 'Sin nombre'}${extra ? ` · ${extra}` : ''}`.trim();
        })()
      : '';
    const articulos = await db.getArticulos({}).catch(() => []);
    const clientesRecent = await db
      .getClientesOptimizadoPaged({ comercial: _n(item && (item.Id_Cial ?? item.ped_com_id), res.locals.user && res.locals.user.id) }, { limit: 10, offset: 0, compact: true, order: 'desc' })
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
            _n(pickRowCI(l, [
              'pedart_art_id',
              'Id_Articulo',
              'id_articulo',
              'ArticuloId',
              'articuloid',
              'Articulo_Id',
              'articulo_id',
              'IdArticulo',
              'idArticulo'
            ]), ''),
          Cantidad:
            _n(pickRowCI(l, ['pedart_cantidad', 'Cantidad', 'cantidad', 'Unidades', 'unidades', 'Uds', 'uds', 'Cant', 'cant']), 1),
          Dto:
            _n(pickRowCI(l, ['pedart_dto', 'Linea_Dto', 'DtoLinea', 'dto_linea', 'Dto', 'dto', 'DTO', 'Descuento', 'descuento', 'PorcentajeDescuento', 'porcentaje_descuento']), ''),
          PrecioUnitario:
            _n(pickRowCI(l, ['pedart_pvp', 'Linea_PVP', 'PVP', 'pvp', 'PrecioUnitario', 'precio_unitario', 'Precio', 'precio', 'PVL', 'pvl']), '')
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

    const estadoNorm = String(_n(_n(_n(existing.EstadoPedido, existing.Estado), existing.ped_estado_txt), 'Pendiente')).trim().toLowerCase() || 'pendiente';
    const canEdit = admin ? !estadoNorm.includes('pagad') : estadoNorm.includes('pend');
    if (!canEdit) {
      return renderErrorPage(req, res, {
        status: 403,
        heading: 'No permitido',
        summary: admin
          ? 'Un pedido en estado "Pagado" no se puede modificar.'
          : 'Solo puedes modificar pedidos en estado "Pendiente".',
        publicMessage: `Estado actual: ${String(_n(_n(existing.EstadoPedido, existing.Estado), existing.ped_estado_txt ?? '—'))}`
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

app.post('/pedidos/:id(\\d+)/delete', requireLogin, requireAdmin, loadPedidoAndCheckOwner, async (req, res, next) => {
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
    let items = [];
    let loadError = null;
    try {
      items = await db.getArticulos({ marcaId: selectedMarcaId });
    } catch (e) {
      console.error('❌ [articulos] Error cargando artículos:', e?.message || e);
      loadError = e?.message || String(e);
    }

    res.render('articulos', {
      items: items || [],
      loadError,
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
    const value = String(_n(_n(req.body && req.body.Activo, req.body && req.body.activo), '')).toLowerCase();
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

    const colNombreRazon = clientesMeta?.colNombreRazonSocial || 'cli_nombre_razon_social';
    const colComercialNombre = comercialesMeta?.colNombre || 'com_nombre';
    const joinCliente = meta.colCliente ? `LEFT JOIN ${tClientes} c ON v.\`${meta.colCliente}\` = c.\`${pkClientes}\`` : '';
    const joinComercial = meta.colComercial ? `LEFT JOIN ${tComerciales} co ON v.\`${meta.colComercial}\` = co.\`${pkComerciales}\`` : '';
    const selectClienteNombre = meta.colCliente ? `c.\`${colNombreRazon}\` as ClienteNombre` : 'NULL as ClienteNombre';
    const selectClienteRazon = meta.colCliente ? `c.\`${colNombreRazon}\` as ClienteRazonSocial` : 'NULL as ClienteRazonSocial';
    const selectComercialNombre = meta.colComercial ? `co.\`${colComercialNombre}\` as ComercialNombre` : 'NULL as ComercialNombre';

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
          totalMes = Number(_n(rows && rows[0] && rows[0].total, 0));
        }
      } catch (_) {
        totalMes = 0;
      }

      return res.render('visitas-calendar', { month, initialDate, meta, admin, totalMes });
    }

    // LISTA
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 200 });
    const idFilter = Number(req.query.id || 0) || null;
    const whereList = [...where];
    const paramsList = [...params];
    if (idFilter && meta.pk) {
      whereList.push(`v.\`${meta.pk}\` = ?`);
      paramsList.push(idFilter);
    }

    // Sin filtro explícito: mostrar todas las visitas (antes solo futuras; ahora todas para que se vean los datos)
    const hasExplicitFilter = Boolean(qDate || idFilter);
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
        meta.colFecha
          ? `v.\`${meta.colFecha}\` DESC, v.\`${meta.pk}\` DESC`
          : 'v.`' + meta.pk + '` DESC'
      }
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countSql = `SELECT COUNT(*) as total FROM \`${meta.table}\` v ${whereListSql}`;
    const [items, countRows] = await Promise.all([db.query(sql, paramsList), db.query(countSql, paramsList)]);
    const total = Number(_n(countRows && countRows[0] && countRows[0].total, 0));
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
    const clientesMeta = await db._ensureClientesMeta().catch(() => null);
    const tClientes = clientesMeta?.tClientes || 'clientes';
    const pkClientes = clientesMeta?.pk || 'Id';
    const colNombreRazon = clientesMeta?.colNombreRazonSocial || 'cli_nombre_razon_social';
    const clientes = await db.query(`SELECT \`${pkClientes}\` AS Id, \`${colNombreRazon}\` AS Nombre_Razon_Social FROM \`${tClientes}\` ORDER BY \`${pkClientes}\` DESC LIMIT 200`).catch(() => []);

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
    const clientesMeta = await db._ensureClientesMeta().catch(() => null);
    const tClientes = clientesMeta?.tClientes || 'clientes';
    const pkClientes = clientesMeta?.pk || 'Id';
    const colNombreRazon = clientesMeta?.colNombreRazonSocial || 'cli_nombre_razon_social';
    const clientes = await db.query(`SELECT \`${pkClientes}\` AS Id, \`${colNombreRazon}\` AS Nombre_Razon_Social FROM \`${tClientes}\` ORDER BY \`${pkClientes}\` DESC LIMIT 200`).catch(() => []);

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
    const clientesMeta = await db._ensureClientesMeta().catch(() => null);
    const tClientes = clientesMeta?.tClientes || 'clientes';
    const pkClientes = clientesMeta?.pk || 'Id';
    const colNombreRazon = clientesMeta?.colNombreRazonSocial || 'cli_nombre_razon_social';
    const clientes = await db.query(`SELECT \`${pkClientes}\` AS Id, \`${colNombreRazon}\` AS Nombre_Razon_Social FROM \`${tClientes}\` ORDER BY \`${pkClientes}\` DESC LIMIT 200`).catch(() => []);
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

// Manual operativo (landing) - requiere sesión
app.get('/manual', requireLogin, async (_req, res) => {
  return res.render('manual', { title: 'Manual operativo' });
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
        return Number(_n(rows && rows[0] && rows[0].n, 0));
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
        return Number(_n(rows && rows[0] && rows[0].n, 0));
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
        return Number(_n(rows && rows[0] && rows[0].n, 0));
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
          visitas = Number(_n(rows && rows[0] && rows[0].n, 0));
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
        db._pickCIFromColumns(pedidosCols, ['ped_total', 'TotalPedido', 'Total', 'ImporteTotal', 'total_pedido', 'total']) || null;

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
          ventas = Number(_n(rows && rows[0] && rows[0].total, 0)) || 0;
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
            ventas = Number(_n(rows && rows[0] && rows[0].total, 0)) || 0;
          } else {
            // Fallback legacy: usar el método existente (puede ser más costoso, pero evita "Unknown column")
            const rows = await db.getPedidosByComercial(userId).catch(() => []);
            ventas = (Array.isArray(rows) ? rows : []).reduce((acc, r) => {
              const v = Number(_n(_n(_n(_n(_n(r && r[colTotal], r && r.ped_total), r && r.TotalPedido), r && r.Total), r && r.ImporteTotal), 0));
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
        const colTotal = db._pickCIFromColumns(pedidosCols, ['ped_total', 'TotalPedido', 'Total', 'ImporteTotal', 'total_pedido', 'total']) || 'ped_total';
        const clientesCols = await db._getColumns(tClientes).catch(() => []);
        const colNombreRazon = db._pickCIFromColumns(clientesCols, ['cli_nombre_razon_social', 'Nombre_Razon_Social', 'nombre_razon_social']) || 'cli_nombre_razon_social';
        const colPoblacion = db._pickCIFromColumns(clientesCols, ['cli_poblacion', 'Poblacion', 'poblacion']) || 'cli_poblacion';
        const colCodigoPostal = db._pickCIFromColumns(clientesCols, ['cli_codigo_postal', 'CodigoPostal', 'codigo_postal']) || 'cli_codigo_postal';
        const colOK_KO = db._pickCIFromColumns(clientesCols, ['cli_ok_ko', 'OK_KO', 'ok_ko']) || 'cli_ok_ko';
        const yearWhere = (selectedYear !== 'all' && colFecha) ? `WHERE DATE(p.\`${colFecha}\`) BETWEEN ? AND ?` : '';
        const yearParams = (selectedYear !== 'all' && colFecha) ? [yearFrom, yearTo] : [];
        latest.clientes = await db.query(
          `SELECT c.\`${pkClientes}\` AS Id, c.\`${colNombreRazon}\` AS Nombre_Razon_Social, c.\`${colPoblacion}\` AS Poblacion, c.\`${colCodigoPostal}\` AS CodigoPostal, c.\`${colOK_KO}\` AS OK_KO,
            COALESCE(SUM(COALESCE(p.\`${colTotal}\`, 0)), 0) AS TotalFacturado
           FROM \`${tClientes}\` c
           INNER JOIN \`${tPedidos}\` p ON p.\`${colClientePedido}\` = c.\`${pkClientes}\`
           ${yearWhere}
           GROUP BY c.\`${pkClientes}\`, c.\`${colNombreRazon}\`, c.\`${colPoblacion}\`, c.\`${colCodigoPostal}\`, c.\`${colOK_KO}\`
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
        const colTotal = db._pickCIFromColumns(pedidosCols, ['ped_total', 'TotalPedido', 'Total', 'ImporteTotal', 'total_pedido', 'total']) || 'ped_total';
        const colEstado = db._pickCIFromColumns(pedidosCols, ['ped_estado_txt', 'EstadoPedido', 'estado_pedido', 'Estado', 'estado']) || 'ped_estado_txt';
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
              const fv = _n(_n(r && r.FechaPedido, r && r.Fecha), null);
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
        const colNombreRazon = clientesMeta?.colNombreRazonSocial || 'cli_nombre_razon_social';
        const colComercialNombre = comercialesMeta?.colNombre || 'com_nombre';
        const joinCliente = metaVisitas.colCliente ? `LEFT JOIN ${tClientes} c ON v.\`${metaVisitas.colCliente}\` = c.\`${pkClientes}\`` : '';
        const joinComercial = metaVisitas.colComercial ? `LEFT JOIN ${tComerciales} co ON v.\`${metaVisitas.colComercial}\` = co.\`${pkComerciales}\`` : '';
        const selectClienteNombre = metaVisitas.colCliente ? `c.\`${colNombreRazon}\` as ClienteNombre` : 'NULL as ClienteNombre';
        const selectComercialNombre = metaVisitas.colComercial ? `co.\`${colComercialNombre}\` as ComercialNombre` : 'NULL as ComercialNombre';
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

        const colNombreRazon = clientesMeta?.colNombreRazonSocial || 'cli_nombre_razon_social';
        const colComercialNombre = comercialesMeta?.colNombre || 'com_nombre';
        const joinCliente = metaVisitas.colCliente ? `LEFT JOIN ${tClientes} c ON v.\`${metaVisitas.colCliente}\` = c.\`${pkClientes}\`` : '';
        const joinComercial = metaVisitas.colComercial ? `LEFT JOIN ${tComerciales} co ON v.\`${metaVisitas.colComercial}\` = co.\`${pkComerciales}\`` : '';
        const selectClienteNombre = metaVisitas.colCliente ? `c.\`${colNombreRazon}\` as ClienteNombre` : 'NULL as ClienteNombre';
        const selectComercialNombre = metaVisitas.colComercial ? `co.\`${colComercialNombre}\` as ComercialNombre` : 'NULL as ComercialNombre';

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

