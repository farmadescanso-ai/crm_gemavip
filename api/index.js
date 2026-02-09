const express = require('express');
const mysql = require('mysql2/promise');
const swaggerUi = require('swagger-ui-express');
const crypto = require('crypto');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const MySQLStoreFactory = require('express-mysql-session');

const swaggerSpec = require('../config/swagger');
const apiRouter = require('../routes/api');
const publicRouter = require('../routes/public');
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

  const links = [];
  if (isAdmin || isComercial) {
    links.push({ href: '/clientes', label: 'Clientes' });
    links.push({ href: '/pedidos', label: 'Pedidos' });
    links.push({ href: '/visitas', label: 'Visitas' });
    links.push({ href: '/articulos', label: 'Artículos' });
  }
  // Orden alfabético por etiqueta (español), para que nuevos enlaces caigan en su sitio.
  return links.sort((a, b) =>
    String(a?.label || '').localeCompare(String(b?.label || ''), 'es', { sensitivity: 'base' })
  );
}

function getRoleNavLinksForRoles(roles) {
  const has = (name) => (roles || []).some((r) => String(r).toLowerCase().includes(String(name).toLowerCase()));
  const isAdmin = has('admin');

  const links = [];
  // Solo enlaces específicos del rol (no repetir los del menú principal)
  if (isAdmin) links.push({ href: '/comerciales', label: 'Comerciales' });
  if (isAdmin) links.push({ href: '/api/docs', label: 'API Docs' });
  return links.sort((a, b) =>
    String(a?.label || '').localeCompare(String(b?.label || ''), 'es', { sensitivity: 'base' })
  );
}

function requireLogin(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/login');
}

function isAdminUser(user) {
  const roles = user?.roles || [];
  return (roles || []).some((r) => String(r).toLowerCase().includes('admin'));
}

function requireAdmin(req, res, next) {
  // API Docs debe ser visible solo para administradores (por sesión)
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
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  const roles = res.locals.user?.roles || [];
  res.locals.navLinks = res.locals.user ? getCommonNavLinksForRoles(roles) : [];
  res.locals.roleNavLinks = res.locals.user ? getRoleNavLinksForRoles(roles) : [];

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

  next();
});

// Evita 404 en navegadores por el icono
app.get('/favicon.ico', (_req, res) => {
  res.status(204).end();
});

// Vistas y endpoints públicos (no requieren login)
app.use('/', publicRouter);

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

app.get('/clientes', requireLogin, async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * limit;
    const q = typeof (req.query.q ?? req.query.search) === 'string' ? String(req.query.q ?? req.query.search).trim() : '';
    const admin = isAdminUser(res.locals.user);
    const baseFilters = admin ? {} : { comercial: res.locals.user?.id };
    const filters = q ? { ...baseFilters, q } : baseFilters;
    const [items, total] = await Promise.all([
      db.getClientesOptimizadoPaged(filters, { limit, offset }),
      db.countClientesOptimizado(filters)
    ]);
    res.render('clientes', { items: items || [], q, admin, paging: { page, limit, total: total || 0 } });
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
    const payload = {
      Id_Cial: body.Id_Cial ? Number(body.Id_Cial) || null : null,
      Nombre_Razon_Social: String(body.Nombre_Razon_Social || '').trim(),
      Nombre_Cial: String(body.Nombre_Cial || '').trim() || null,
      DNI_CIF: String(body.DNI_CIF || '').trim() || null,
      Direccion: String(body.Direccion || '').trim() || null,
      Poblacion: String(body.Poblacion || '').trim() || null,
      CodigoPostal: String(body.CodigoPostal || '').trim() || null,
      Telefono: String(body.Telefono || '').trim() || null,
      Movil: String(body.Movil || '').trim() || null,
      Email: String(body.Email || '').trim() || null,
      Tarifa: body.Tarifa !== undefined ? (Number(body.Tarifa) || 0) : 0,
      Dto: body.Dto !== undefined ? (Number(String(body.Dto).replace(',', '.')) || 0) : undefined,
      OK_KO: String(body.OK_KO || '1') === '1' ? 1 : 0,
      Observaciones: String(body.Observaciones || '').trim() || null
    };

    if (!payload.Nombre_Razon_Social) {
      return res.status(400).render('cliente-form', { mode: 'create', comerciales, tarifas, item: payload, error: 'Nombre/Razón Social es obligatorio' });
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
    res.render('cliente', { item, admin });
  } catch (e) {
    next(e);
  }
});

app.get('/clientes/:id/edit', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const [item, comerciales, tarifas] = await Promise.all([
      db.getClienteById(id),
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => [])
    ]);
    if (!item) return res.status(404).send('No encontrado');
    res.render('cliente-form', { mode: 'edit', item, comerciales, tarifas, error: null });
  } catch (e) {
    next(e);
  }
});

app.post('/clientes/:id/edit', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const item = await db.getClienteById(id);
    if (!item) return res.status(404).send('No encontrado');
    const comerciales = await db.getComerciales().catch(() => []);
    const tarifas = await db.getTarifas().catch(() => []);
    const body = req.body || {};

    const payload = {
      Id_Cial: body.Id_Cial ? Number(body.Id_Cial) || null : null,
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
      OK_KO: body.OK_KO !== undefined ? (String(body.OK_KO || '1') === '1' ? 1 : 0) : undefined,
      Observaciones: body.Observaciones !== undefined ? (String(body.Observaciones || '').trim() || null) : undefined
    };

    if (payload.Nombre_Razon_Social !== undefined && !String(payload.Nombre_Razon_Social || '').trim()) {
      return res.status(400).render('cliente-form', { mode: 'edit', item: { ...item, ...payload }, comerciales, tarifas, error: 'Nombre/Razón Social es obligatorio' });
    }

    await db.updateCliente(id, payload);
    return res.redirect(`/clientes/${id}`);
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
          SELECT DISTINCT p.*
          FROM pedidos p
          INNER JOIN pedidos_articulos pa ON pa.Id_NumPedido = p.id
          INNER JOIN articulos a ON a.id = pa.Id_Articulo
          WHERE YEAR(p.FechaPedido) = ? AND a.Id_Marca = ?
          ORDER BY p.id DESC
          LIMIT 200
        `,
        [selectedYear, selectedMarcaId]
      );
    } else {
      items = await db.query('SELECT * FROM pedidos WHERE YEAR(FechaPedido) = ? ORDER BY id DESC LIMIT 200', [
        selectedYear
      ]);
    }

    res.render('pedidos', {
      items: items || [],
      years,
      selectedYear,
      marcas: Array.isArray(marcas) ? marcas : [],
      selectedMarcaId,
      admin: isAdminUser(res.locals.user)
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
    const dto = item.Dto !== undefined ? (Number(String(item.Dto).replace(',', '.')) || 0) : undefined;
    if (!idArt || cantidad <= 0) continue;
    const clean = { Id_Articulo: idArt, Cantidad: cantidad };
    if (dto !== undefined) clean.Dto = dto;
    lineas.push(clean);
  }
  return lineas;
}

app.get('/pedidos/new', requireAdmin, async (_req, res, next) => {
  try {
    const [comerciales, tarifas, formasPago] = await Promise.all([
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => [])
    ]);
    // Nota: artículos puede ser grande; lo usamos para selector simple (mejorable con búsqueda más adelante).
    const articulos = await db.getArticulos({}).catch(() => []);
    const clientesRecent = await db
      .getClientesOptimizadoPaged({ comercial: res.locals.user?.id }, { limit: 10, offset: 0, compact: true, order: 'desc' })
      .catch(() => []);
    res.render('pedido-form', {
      mode: 'create',
      comerciales: Array.isArray(comerciales) ? comerciales : [],
      tarifas: Array.isArray(tarifas) ? tarifas : [],
      formasPago: Array.isArray(formasPago) ? formasPago : [],
      articulos: Array.isArray(articulos) ? articulos : [],
      item: {
        Id_Cial: res.locals.user?.id ?? null,
        Id_Tarifa: 0,
        Serie: 'P',
        EstadoPedido: 'Pendiente',
        Id_FormaPago: null,
        Id_TipoPedido: null,
        Observaciones: ''
      },
      lineas: [{ Id_Articulo: '', Cantidad: 1, Dto: '' }],
      clientes: Array.isArray(clientesRecent) ? clientesRecent : [],
      error: null
    });
  } catch (e) {
    next(e);
  }
});

app.post('/pedidos/new', requireAdmin, async (req, res, next) => {
  try {
    const [comerciales, tarifas, formasPago] = await Promise.all([
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => [])
    ]);
    const articulos = await db.getArticulos({}).catch(() => []);
    const body = req.body || {};
    const pedidoPayload = {
      Id_Cial: Number(body.Id_Cial) || 0,
      Id_Cliente: Number(body.Id_Cliente) || 0,
      Id_DireccionEnvio: body.Id_DireccionEnvio ? (Number(body.Id_DireccionEnvio) || null) : null,
      Id_FormaPago: body.Id_FormaPago ? (Number(body.Id_FormaPago) || 0) : 0,
      Id_TipoPedido: body.Id_TipoPedido ? (Number(body.Id_TipoPedido) || 0) : 0,
      Id_Tarifa: body.Id_Tarifa ? (Number(body.Id_Tarifa) || 0) : 0,
      // Serie fija para pedidos en este CRM
      Serie: 'P',
      FechaPedido: body.FechaPedido ? String(body.FechaPedido).slice(0, 10) : undefined,
      FechaEntrega: body.FechaEntrega ? String(body.FechaEntrega).slice(0, 10) : null,
      EstadoPedido: String(body.EstadoPedido || 'Pendiente').trim(),
      Observaciones: String(body.Observaciones || '').trim() || null
    };
    const lineas = parseLineasFromBody(body);

    if (!pedidoPayload.Id_Cial || !pedidoPayload.Id_Cliente) {
      return res.status(400).render('pedido-form', {
        mode: 'create',
        comerciales,
        tarifas,
        formasPago,
        articulos,
        item: pedidoPayload,
        lineas: (body.lineas || body.Lineas) ? (Array.isArray(body.lineas || body.Lineas) ? (body.lineas || body.Lineas) : Object.values(body.lineas || body.Lineas)) : [{ Id_Articulo: '', Cantidad: 1, Dto: '' }],
        error: 'Id_Cial e Id_Cliente son obligatorios'
      });
    }
    if (!pedidoPayload.EstadoPedido) {
      return res.status(400).render('pedido-form', { mode: 'create', comerciales, tarifas, formasPago, articulos, item: pedidoPayload, lineas, error: 'EstadoPedido es obligatorio' });
    }

    const created = await db.createPedido(pedidoPayload);
    const pedidoId = created?.insertId ?? created?.Id ?? created?.id;
    const result = await db.updatePedidoWithLineas(pedidoId, {}, lineas);
    return res.redirect(`/pedidos/${pedidoId}`);
  } catch (e) {
    next(e);
  }
});

app.get('/pedidos/:id', requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const item = await db.getPedidoById(id);
    if (!item) return res.status(404).send('No encontrado');
    const lineas = await db.getArticulosByPedido(id);
    const cliente = item?.Id_Cliente ? await db.getClienteById(Number(item.Id_Cliente)).catch(() => null) : null;
    const admin = isAdminUser(res.locals.user);
    res.render('pedido', { item, lineas: lineas || [], cliente, admin });
  } catch (e) {
    next(e);
  }
});

app.get('/pedidos/:id/edit', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const [item, tarifas, formasPago, comerciales] = await Promise.all([
      db.getPedidoById(id),
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => []),
      db.getComerciales().catch(() => [])
    ]);
    if (!item) return res.status(404).send('No encontrado');
    const articulos = await db.getArticulos({}).catch(() => []);
    const clientesRecent = await db
      .getClientesOptimizadoPaged({ comercial: item?.Id_Cial ?? res.locals.user?.id }, { limit: 10, offset: 0, compact: true, order: 'desc' })
      .catch(() => []);
    const lineasRaw = await db.getArticulosByPedido(id);
    const lineas = Array.isArray(lineasRaw) && lineasRaw.length
      ? lineasRaw.map((l) => ({ Id_Articulo: l.Id_Articulo ?? l.id_articulo ?? l.ArticuloId ?? '', Cantidad: l.Cantidad ?? l.Unidades ?? 1, Dto: l.Dto ?? '' }))
      : [{ Id_Articulo: '', Cantidad: 1, Dto: '' }];
    res.render('pedido-form', { mode: 'edit', item, lineas, tarifas, formasPago, comerciales, articulos, clientes: Array.isArray(clientesRecent) ? clientesRecent : [], error: null });
  } catch (e) {
    next(e);
  }
});

app.post('/pedidos/:id/edit', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
    const existing = await db.getPedidoById(id);
    if (!existing) return res.status(404).send('No encontrado');

    const [tarifas, formasPago, comerciales] = await Promise.all([
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => []),
      db.getComerciales().catch(() => [])
    ]);
    const articulos = await db.getArticulos({}).catch(() => []);

    const body = req.body || {};
    const pedidoPayload = {
      Id_Cial: Number(body.Id_Cial) || 0,
      Id_Cliente: Number(body.Id_Cliente) || 0,
      Id_DireccionEnvio: body.Id_DireccionEnvio ? (Number(body.Id_DireccionEnvio) || null) : null,
      Id_FormaPago: body.Id_FormaPago ? (Number(body.Id_FormaPago) || 0) : 0,
      Id_TipoPedido: body.Id_TipoPedido ? (Number(body.Id_TipoPedido) || 0) : 0,
      Id_Tarifa: body.Id_Tarifa ? (Number(body.Id_Tarifa) || 0) : 0,
      Serie: 'P',
      FechaPedido: body.FechaPedido ? String(body.FechaPedido).slice(0, 10) : undefined,
      FechaEntrega: body.FechaEntrega ? String(body.FechaEntrega).slice(0, 10) : null,
      EstadoPedido: String(body.EstadoPedido || '').trim(),
      Observaciones: String(body.Observaciones || '').trim() || null
    };
    const lineas = parseLineasFromBody(body);

    if (!pedidoPayload.Id_Cial || !pedidoPayload.Id_Cliente) {
      return res.status(400).render('pedido-form', {
        mode: 'edit',
        item: { ...existing, ...pedidoPayload },
        lineas: (body.lineas || body.Lineas) ? (Array.isArray(body.lineas || body.Lineas) ? (body.lineas || body.Lineas) : Object.values(body.lineas || body.Lineas)) : [{ Id_Articulo: '', Cantidad: 1, Dto: '' }],
        tarifas,
        formasPago,
        comerciales,
        articulos,
        error: 'Id_Cial e Id_Cliente son obligatorios'
      });
    }

    await db.updatePedidoWithLineas(id, pedidoPayload, lineas);
    return res.redirect(`/pedidos/${id}`);
  } catch (e) {
    next(e);
  }
});

app.post('/pedidos/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
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

    const admin = isAdminUser(res.locals.user);
    const metaVisitas = await db._ensureVisitasMeta().catch(() => null);
    const visitasTable = metaVisitas?.table ? metaVisitas.table : 'visitas';

    const userId = Number(res.locals.user?.id);
    const hasUserId = Number.isFinite(userId) && userId > 0;

    const [clientes, pedidos, visitasTotal, comerciales] = await Promise.all([
      admin
        ? safeCount('clientes')
        : (hasUserId ? db.countClientesOptimizado({ comercial: userId }) : 0),
      admin
        ? safeCount('pedidos')
        : (hasUserId ? db.countPedidos({ comercialId: userId }) : 0),
      safeCount(visitasTable),
      admin ? safeCount('comerciales') : null
    ]);

    let visitas = visitasTotal;
    if (!admin) {
      try {
        const meta = await db._ensureVisitasMeta();
        const owner = db._buildVisitasOwnerWhere(meta, res.locals.user, 'v');
        if (owner.clause) {
          const rows = await db.query(`SELECT COUNT(*) AS n FROM \`${meta.table}\` v WHERE ${owner.clause}`, owner.params);
          visitas = Number(rows?.[0]?.n ?? 0);
        } else {
          visitas = 0;
        }
      } catch (_) {
        visitas = 0;
      }
    }

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
      if (!admin) {
        const uIdNum = Number(res.locals.user?.id);
        if (metaVisitas.colComercial && Number.isFinite(uIdNum) && uIdNum > 0) {
          where.push(`v.\`${metaVisitas.colComercial}\` = ?`);
          params.push(uIdNum);
        }
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

// Swagger UI (solo admins)
app.use('/api/docs', requireAdmin, swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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

