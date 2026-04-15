/**
 * Healthcheck BD, OpenAPI JSON y Swagger UI. Debe registrarse antes de app.use('/api', apiLimiter, ...).
 */
const mysql = require('mysql2/promise');

function registerOpenApiAndHealthDb(app, deps) {
  const { requireApiKeyIfConfigured, swaggerSpec, swaggerUi } = deps;

  app.get('/health/db', requireApiKeyIfConfigured, async (_req, res) => {
    const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL;
    const host = process.env.DB_HOST;
    const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306;
    const user = process.env.DB_USER;
    const database = process.env.DB_NAME || 'crm_gemavip';

    if (!host || !user || !process.env.DB_PASSWORD) {
      if (isProduction) {
        return res.status(500).json({
          ok: false,
          service: 'crm_gemavip',
          error: 'db_configuration_incomplete',
          timestamp: new Date().toISOString()
        });
      }
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
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
      });

      const [rows] = await connection.query('SELECT 1 AS ok');
      await connection.end();

      if (isProduction) {
        return res.status(200).json({
          ok: true,
          service: 'crm_gemavip',
          timestamp: new Date().toISOString()
        });
      }
      return res.status(200).json({
        ok: true,
        service: 'crm_gemavip',
        db: { host, port, user, database },
        ping: Array.isArray(rows) ? rows[0] : rows,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      if (isProduction) {
        return res.status(500).json({
          ok: false,
          service: 'crm_gemavip',
          error: 'database_unreachable',
          timestamp: new Date().toISOString()
        });
      }
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

  app.get('/api/openapi.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(swaggerSpec);
  });

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
}

module.exports = { registerOpenApiAndHealthDb };
