const express = require('express');
const mysql = require('mysql2/promise');
const swaggerUi = require('swagger-ui-express');
const path = require('path');

const swaggerSpec = require('../config/swagger');
const apiRouter = require('../routes/api');
const db = require('../config/mysql-crm');

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use('/assets', express.static(path.join(__dirname, '..', 'public')));

function requireApiKeyIfConfigured(req, res, next) {
  const configured = process.env.API_KEY;
  if (!configured) return next();
  const provided = req.header('x-api-key') || req.header('X-API-Key');
  if (provided && provided === configured) return next();
  return res.status(401).json({ ok: false, error: 'API key requerida (X-API-Key)' });
}

// Evita 404 en navegadores por el icono
app.get('/favicon.ico', (_req, res) => {
  res.status(204).end();
});

app.get(
  '/',
  async (_req, res) => {
    // No bloquear la home si falla la BD: solo indicamos si hay conexión.
    let dbOk = false;
    try {
      await db.query('SELECT 1 AS ok');
      dbOk = true;
    } catch (_) {
      dbOk = false;
    }
    res.status(200).render('home', { dbOk });
  }
);

app.get('/comerciales', async (req, res, next) => {
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

app.get('/clientes', async (req, res, next) => {
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

app.get('/pedidos', async (_req, res, next) => {
  try {
    const items = await db.query('SELECT * FROM pedidos ORDER BY Id DESC LIMIT 50');
    res.render('pedidos', { items: items || [] });
  } catch (e) {
    next(e);
  }
});

app.get('/visitas', async (_req, res, next) => {
  try {
    const items = await db.query('SELECT * FROM visitas ORDER BY Id DESC LIMIT 50');
    res.render('visitas', { items: items || [] });
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

