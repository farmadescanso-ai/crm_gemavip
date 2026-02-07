const express = require('express');
const mysql = require('mysql2/promise');
const swaggerUi = require('swagger-ui-express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const MySQLStoreFactory = require('express-mysql-session');

const swaggerSpec = require('../config/swagger');
const apiRouter = require('../routes/api');
const db = require('../config/mysql-crm');

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

function requireApiKeyIfConfigured(req, res, next) {
  const configured = process.env.API_KEY;
  if (!configured) return next();
  const provided = req.header('x-api-key') || req.header('X-API-Key');
  if (provided && provided === configured) return next();
  return res.status(401).json({ ok: false, error: 'API key requerida (X-API-Key)' });
}

function normalizeRoles(roll) {
  if (!roll) return [];
  if (Array.isArray(roll)) return roll.map(String);
  if (typeof roll === 'string') {
    const s = roll.trim();
    // JSON array en string
    if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch (_) {
        // ignore
      }
    }
    // CSV fallback
    return s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [String(roll)];
}

function getCommonNavLinksForRoles(roles) {
  const has = (name) => (roles || []).some((r) => String(r).toLowerCase().includes(String(name).toLowerCase()));
  const isAdmin = has('admin');
  const isComercial = has('comercial') || !roles || roles.length === 0;

  const links = [{ href: '/dashboard', label: 'Dashboard' }];
  if (isAdmin || isComercial) {
    links.push({ href: '/clientes', label: 'Clientes' });
    links.push({ href: '/pedidos', label: 'Pedidos' });
    links.push({ href: '/visitas', label: 'Visitas' });
  }
  return links;
}

function getRoleNavLinksForRoles(roles) {
  const has = (name) => (roles || []).some((r) => String(r).toLowerCase().includes(String(name).toLowerCase()));
  const isAdmin = has('admin');

  const links = [];
  // Solo enlaces específicos del rol (no repetir los del menú principal)
  if (isAdmin) links.push({ href: '/comerciales', label: 'Comerciales' });
  if (isAdmin) links.push({ href: '/api/docs', label: 'API Docs' });
  return links;
}

function requireLogin(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/login');
}

// Locals para todas las vistas
app.use((req, _res, next) => {
  const user = req.session?.user || null;
  req.user = user;
  next();
});
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  const roles = res.locals.user?.roles || [];
  res.locals.navLinks = res.locals.user ? getCommonNavLinksForRoles(roles) : [];
  res.locals.roleNavLinks = res.locals.user ? getRoleNavLinksForRoles(roles) : [];
  next();
});

// Evita 404 en navegadores por el icono
app.get('/favicon.ico', (_req, res) => {
  res.status(204).end();
});

app.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Login', error: null });
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

app.get(
  '/',
  async (_req, res) => {
    // En producción no exponemos la home/entrada: vamos a login o dashboard
    if (res.locals.user) return res.redirect('/dashboard');
    return res.redirect('/login');
  }
);

app.get('/comerciales', requireLogin, async (req, res, next) => {
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

app.get('/clientes', requireLogin, async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * limit;
    const filters = {};
    const [items, total] = await Promise.all([
      db.getClientesOptimizadoPaged(filters, { limit, offset }),
      db.countClientesOptimizado(filters)
    ]);
    res.render('clientes', { items: items || [], paging: { page, limit, total: total || 0 } });
  } catch (e) {
    next(e);
  }
});

app.get('/pedidos', requireLogin, async (_req, res, next) => {
  try {
    const items = await db.query('SELECT * FROM pedidos ORDER BY Id DESC LIMIT 50');
    res.render('pedidos', { items: items || [] });
  } catch (e) {
    next(e);
  }
});

app.get('/visitas', requireLogin, async (_req, res, next) => {
  try {
    const items = await db.query('SELECT * FROM visitas ORDER BY Id DESC LIMIT 50');
    res.render('visitas', { items: items || [] });
  } catch (e) {
    next(e);
  }
});

app.get('/dashboard', requireLogin, async (_req, res, next) => {
  try {
    const safeCount = async (table) => {
      try {
        const rows = await db.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
        return Number(rows?.[0]?.n ?? 0);
      } catch (_) {
        return null;
      }
    };

    const [clientes, pedidos, visitas, comerciales] = await Promise.all([
      safeCount('clientes'),
      safeCount('pedidos'),
      safeCount('visitas'),
      safeCount('comerciales')
    ]);

    const stats = { clientes, pedidos, visitas, comerciales };

    const latest = { clientes: [], pedidos: [], visitas: [] };

    try {
      latest.clientes = await db.query(
        'SELECT Id, Nombre_Razon_Social, Poblacion, CodigoPostal, OK_KO FROM clientes ORDER BY Id DESC LIMIT 8'
      );
    } catch (_) {
      latest.clientes = [];
    }
    try {
      latest.pedidos = await db.query(
        'SELECT Id, NumPedido, FechaPedido, TotalPedido, EstadoPedido FROM pedidos ORDER BY Id DESC LIMIT 8'
      );
    } catch (_) {
      latest.pedidos = [];
    }
    try {
      latest.visitas = await db.query(
        'SELECT Id, Fecha, TipoVisita, ClienteId, Id_Cial, Estado FROM visitas ORDER BY Id DESC LIMIT 10'
      );
    } catch (_) {
      latest.visitas = [];
    }

    res.render('dashboard', { stats, latest });
  } catch (e) {
    next(e);
  }
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'crm_gemavip',
    timestamp: new Date().toISOString()
  });
});

// Comprueba conectividad con la BD configurada en variables de entorno.
// No devuelve credenciales; solo un diagnóstico básico.
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

// API REST (protegida con API_KEY si está configurada)
app.use('/api', requireApiKeyIfConfigured, apiRouter);

// Swagger UI (protegido con API_KEY si está configurada)
app.use('/api/docs', requireApiKeyIfConfigured, swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Error handler (si el cliente pide HTML, devolvemos página simple)
app.use((err, _req, res, _next) => {
  // Evitar filtrar stack en producción
  const message = err?.message || String(err);
  const code = err?.code;
  const accept = String(_req.headers?.accept || '');
  if (accept.includes('text/html')) {
    return res
      .status(500)
      .type('text/html; charset=utf-8')
      .send(
        `<html><body style="font-family:system-ui;padding:24px"><h1>Error</h1><pre>${String(message)}</pre><pre>${String(code || '')}</pre></body></html>`
      );
  }
  res.status(500).json({ ok: false, error: message, code });
});

// En Vercel (runtime @vercel/node) se exporta la app como handler.
module.exports = app;

