const express = require('express');
const helmet = require('helmet');
const fs = require('fs').promises;
const mysql = require('mysql2/promise');
const swaggerUi = require('swagger-ui-express');
const crypto = require('crypto');
const path = require('path');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const ExcelJS = require('exceljs');
const axios = require('axios');
const swaggerSpec = require('../config/swagger');
const apiRouter = require('../routes/api');
const publicRouter = require('../routes/public');
const authRouter = require('../routes/auth');
const comercialesRouter = require('../routes/comerciales');
const adminRouter = require('../routes/admin');
const notificacionesRouter = require('../routes/notificaciones');
const manualRouter = require('../routes/manual');
const visitasRouter = require('../routes/visitas');
const articulosRouter = require('../routes/articulos');
const clientesRouter = require('../routes/clientes');
const pedidosRouter = require('../routes/pedidos');
const dashboardRouter = require('../routes/dashboard');
const db = require('../config/mysql-crm');
const {
  _n,
  getStoredPasswordFromRow,
  makeRequestId,
  wantsHtml,
  buildSupportDetails,
  renderErrorPage,
  requireApiKeyIfConfigured,
  requireAdmin
} = require('../lib/app-helpers');
const {
  isAdminUser,
  normalizeRoles,
  getCommonNavLinksForRoles,
  getRoleNavLinksForRoles,
  requireLogin
} = require('../lib/auth');
const { toNum: toNumUtil, escapeHtml: escapeHtmlUtil } = require('../lib/utils');
const { parsePagination } = require('../lib/pagination');
const { sendPedidoEmail, APP_BASE_URL } = require('../lib/mailer');
let sendPushToAdmins = () => Promise.resolve();
try {
  const wp = require('../lib/web-push');
  if (wp && typeof wp.sendPushToAdmins === 'function') sendPushToAdmins = wp.sendPushToAdmins;
} catch (_) {
  // web-push opcional: si no existe el módulo, no enviar push
}

// Emails de notificaciones: desactivado por defecto (hasta configurar SMTP correctamente).
const NOTIF_EMAILS_ENABLED =
  process.env.NOTIF_EMAILS_ENABLED === '1' ||
  String(process.env.NOTIF_EMAILS_ENABLED || '').toLowerCase() === 'true';

const app = express();
// trust proxy: 1 = confiar en el primer proxy (Vercel). Necesario para req.ip correcto en rate limiting.
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      fontSrc: ["'self'", "fonts.gstatic.com", "fonts.googleapis.com"],
      connectSrc: ["'self'"],
      frameSrc: ["'self'"]
    }
  }
}));

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

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

// Diagnóstico de IP para verificar trust proxy (rate limiting en Vercel)
app.get('/health/ip', requireApiKeyIfConfigured, (req, res) => {
  res.json({
    ip: req.ip,
    ips: req.ips,
    xForwardedFor: req.headers['x-forwarded-for'],
    remoteAddress: req.socket?.remoteAddress
  });
});

// Diagnóstico de login: solo en desarrollo y con DEBUG_LOGIN_SECRET. Nunca en producción.
// GET /api/debug-login?secret=TU_SECRETO&email=tu@email.com
app.get('/api/debug-login', async (req, res) => {
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL;
  const secret = process.env.DEBUG_LOGIN_SECRET;
  const providedSecret = String(req.query?.secret || '').trim();
  const hasAccess = !isProd && secret && secret.length >= 16 && secret === providedSecret;
  if (!hasAccess) {
    return res.status(404).json({ error: 'No disponible' });
  }
  const email = String(req.query?.email || '').trim();
  try {
    const dbNameEnv = process.env.DB_NAME || 'crm_gemavip';
    const actualDb = await db.query('SELECT DATABASE() AS db').then((r) => r?.[0]?.db ?? null).catch(() => null);
    const countAll = await db.query('SELECT COUNT(*) AS n FROM `comerciales`').then((r) => r?.[0]?.n ?? null).catch(() => null);
    const t = await db._resolveTableNameCaseInsensitive('comerciales');
    const cols = await db._getColumns(t);
    const colEmail = db._pickCIFromColumns(cols, ['com_email', 'Email', 'email']) || 'com_email';
    const colList = cols.length ? cols.map((c) => `\`${c}\``).join(', ') : '*';
    const rawRows = email
      ? await db.query(
          `SELECT ${colList} FROM \`${t}\` WHERE LOWER(TRIM(\`${colEmail}\`)) = LOWER(TRIM(?)) LIMIT 1`,
          [email]
        )
      : [];
    const comercial = Array.isArray(rawRows) && rawRows.length > 0 ? rawRows[0] : null;
    const stored = comercial ? getStoredPasswordFromRow(comercial) : '';
    const pwdCols = cols.filter((c) => /password|contraseña|pass|clave/i.test(String(c)));
    return res.json({
      ok: true,
      dbNameEnv,
      actualDb,
      countComerciales: countAll,
      tableName: t,
      columns: cols,
      colEmail,
      pwdColumns: pwdCols,
      testEmail: email || '(no proporcionado)',
      userFound: !!comercial,
      hasStoredPassword: stored.length > 0,
      storedPrefix: stored ? stored.substring(0, 10) + '...' : null,
      rowKeys: comercial ? Object.keys(comercial) : null
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message,
      stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined
    });
  }
});

// Provincia por código postal (para auto-rellenar en formulario de clientes/comerciales)
app.get('/api/provincia-by-cp', requireLogin, async (req, res) => {
  try {
    const cp = String(req.query?.cp ?? '').trim().replace(/\s+/g, '');
    if (!cp || cp.length < 2) return res.json({ ok: true, provinciaId: null, provinciaNombre: null });
    let provinciaId = null;
    let provinciaNombre = null;
    const codigosTable = await db._getCodigosPostalesTableName?.().catch(() => null);
    const provTable = await db._resolveTableNameCaseInsensitive?.('provincias').catch(() => 'provincias');
    const provCols = await db._getColumns?.(provTable).catch(() => []);
    const provPk = db._pickCIFromColumns?.(provCols, ['prov_id', 'id', 'Id']) || 'prov_id';
    const provNombre = db._pickCIFromColumns?.(provCols, ['prov_nombre', 'Nombre', 'nombre']) || 'prov_nombre';
    if (codigosTable && provPk) {
      const cpCols = await db._getColumns?.(codigosTable).catch(() => []);
      const cpIdProv = db._pickCIFromColumns?.(cpCols, ['codpos_Id_Provincia', 'Id_Provincia', 'id_Provincia']) || 'codpos_Id_Provincia';
      const cpCodigo = db._pickCIFromColumns?.(cpCols, ['codpos_CodigoPostal', 'CodigoPostal', 'codigo_postal']) || 'codpos_CodigoPostal';
      const joinCond = `cp.\`${cpIdProv}\` = p.\`${provPk}\``;
      const rows = await db.query(
        `SELECT cp.\`${cpIdProv}\` AS Id_Provincia, p.\`${provPk}\` AS prov_pk, p.\`${provNombre}\` AS NombreProvincia
         FROM \`${codigosTable}\` cp
         LEFT JOIN \`${provTable}\` p ON ${joinCond}
         WHERE TRIM(cp.\`${cpCodigo}\`) = ? LIMIT 1`,
        [cp]
      ).catch(() => []);
      const r = rows?.[0];
      if (r) {
        provinciaId = r.Id_Provincia ?? r.prov_pk ?? null;
        provinciaNombre = r.NombreProvincia ?? null;
      }
    }
    if (!provinciaId && cp.length >= 2) {
      const prefix = cp.substring(0, 2);
      const provincias = await db.getProvincias?.().catch(() => []);
      const prov = (provincias || []).find((p) => {
        const cod = String(p?.Codigo ?? p?.codigo ?? p?.prov_codigo ?? '').trim();
        return cod === prefix;
      });
      if (prov) {
        provinciaId = prov.id ?? prov.Id ?? prov.prov_id ?? null;
        provinciaNombre = prov.Nombre ?? prov.nombre ?? null;
      }
    }
    return res.json({ ok: true, provinciaId, provinciaNombre });
  } catch (e) {
    return res.json({ ok: true, provinciaId: null, provinciaNombre: null });
  }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view cache', process.env.NODE_ENV === 'production');
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

// Pool compartido: sesión y db usan el mismo pool para evitar duplicar conexiones (auditoría paso 11).
const sharedPoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'crm_gemavip',
  charset: 'utf8mb4',
  timezone: 'Europe/Madrid',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || (process.env.VERCEL ? 3 : 10),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 10000
};
const sharedPool = mysql.createPool(sharedPoolConfig);
db.setSharedPool(sharedPool);

const comisionesCrm = require('../config/mysql-crm-comisiones');
comisionesCrm.setSharedPool(sharedPool);

// Auditoría punto 21: limpieza automática de sesiones expiradas (evita crecimiento ilimitado de tabla sessions)
const sessionCheckExpirationMs = Number(process.env.SESSION_CHECK_EXPIRATION_MS) || 900000; // 15 min por defecto
const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore(
  {
    createDatabaseTable: true,
    expiration: sessionMaxAgeMs,
    clearExpired: true,
    checkExpirationInterval: sessionCheckExpirationMs
  },
  sharedPool
);

const sessionSecret = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' || process.env.VERCEL ? null : 'dev-secret-change-me');
if (!sessionSecret && (process.env.NODE_ENV === 'production' || process.env.VERCEL)) {
  console.error('❌ SESSION_SECRET debe estar definido en producción. Configúralo en las variables de entorno.');
  process.exit(1);
}

app.use(
  session({
    name: 'crm_session',
    secret: sessionSecret || 'dev-secret-change-me',
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

// Request ID estándar (útil para soporte)
app.use((req, res, next) => {
  req.requestId = makeRequestId();
  res.locals.requestId = req.requestId;
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

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

  // Teléfonos: formato vista "+34 630 87 47 81" y normalización para BD
  const { formatTelefonoForDisplay, normalizeTelefonoForDB, getTelefonoForHref } = require('../lib/telefono-utils');
  res.locals.fmtTelefono = formatTelefonoForDisplay;
  res.locals.normalizeTelefono = normalizeTelefonoForDB;
  res.locals.getTelefonoForHref = getTelefonoForHref;

  next();
});

// Favicon: redirigir al logo de Gemavip
app.get('/favicon.ico', (req, res) => {
  res.redirect(302, '/assets/images/gemavip-logo.svg');
});

// Diagnóstico de email (solo admin): comprobar si SMTP/Graph están configurados para recuperación de contraseña
app.get('/api/email-status', requireAdmin, async (req, res) => {
  try {
    const { getSmtpStatus, getGraphStatus } = require('../lib/mailer');
    const [smtp, graph] = await Promise.all([getSmtpStatus(), getGraphStatus()]);
    return res.json({
      smtpConfigured: smtp.configured,
      graphConfigured: graph.configured,
      emailReady: smtp.configured || graph.configured,
      smtp: { hasHost: smtp.hasHost, hasUser: smtp.hasUser, hasPass: smtp.hasPass, port: smtp.port },
      graph: { hasTenant: graph.hasTenant, hasClientId: graph.hasClientId, hasSecret: graph.hasSecret, hasSender: graph.hasSender }
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message });
  }
});

// Prueba de envío de email (solo admin): envía un email de prueba y devuelve el error exacto si falla
// GET /api/email-test?to=tu@email.com
app.get('/api/email-test', requireAdmin, async (req, res) => {
  try {
    const to = String(req.query?.to || req.session?.user?.email || '').trim();
    if (!to) {
      return res.status(400).json({ error: 'Indica ?to=tu@email.com o inicia sesión con un email' });
    }
    const { sendTestEmail } = require('../lib/mailer');
    const result = await sendTestEmail(to);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e?.message });
  }
});

// Service Worker (Web Push): debe estar en raíz para scope /
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});

// Vistas y endpoints públicos (no requieren login)
app.use('/', publicRouter);
app.use('/', authRouter);
app.use('/', dashboardRouter);
app.use('/', manualRouter);
app.use('/comerciales', comercialesRouter);
app.use('/admin', adminRouter);
app.use('/visitas', visitasRouter);
app.use('/articulos', articulosRouter);
app.use('/clientes', clientesRouter);
app.use('/pedidos', pedidosRouter);
app.use('/', notificacionesRouter);

app.get(
  '/',
  async (_req, res) => {
    // En producción no exponemos la home/entrada: vamos a login o dashboard
    if (res.locals.user) return res.redirect('/dashboard');
    return res.redirect('/login');
  }
);



// ===========================


// ===========================
// ARTÍCULOS (HTML)
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

