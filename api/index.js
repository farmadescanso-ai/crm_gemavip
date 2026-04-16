const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
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
const ventasGemavipRouter = require('../routes/ventas-gemavip');
const cpanelRouter = require('../routes/cpanel');
const db = require('../config/mysql-crm');
const {
  makeRequestId,
  wantsHtml,
  getQueryParam,
  renderErrorPage,
  requireApiKeyIfConfigured,
  requireAdmin,
  getStoredPasswordFromRow
} = require('../lib/app-helpers');
const {
  getCommonNavLinksForRoles,
  getRoleNavLinksForRoles,
  requireLoginJson,
  requireSessionComercialActive,
  isAdminUser
} = require('../lib/auth');
const { corsMiddleware } = require('../lib/cors-middleware');
const { vercelPathRewrite, apiHtmlUiPathRewrite } = require('./middleware/vercel-path');
const { setupSharedPoolAndSession } = require('./setup-session-pool');
const { createEjsLocalsMiddleware } = require('./middleware/ejs-res-locals');
const { registerEarlyDiagnostics } = require('./routes/early-diagnostics');
const { registerJsonHelperRoutes } = require('./routes/json-helpers');
const { registerOpenApiAndHealthDb } = require('./routes/openapi-and-health-db');
const { registerHttpErrorHandlers } = require('./middleware/http-error-handlers');

const comisionesCrm = require('../config/mysql-crm-comisiones');

const app = express();
app.set('trust proxy', 1);

app.use(compression());

app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64url');
  next();
});

const cspAppMiddleware = helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      (req, res) => `'nonce-${res.locals.cspNonce}'`,
      'https://cdn.jsdelivr.net',
      'https://vercel.live'
    ],
    scriptSrcAttr: ["'unsafe-inline'"],
    styleSrc: [
      "'self'",
      (req, res) => `'nonce-${res.locals.cspNonce}'`,
      'https://fonts.googleapis.com',
      'https://cdn.jsdelivr.net'
    ],
    styleSrcAttr: ["'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://fonts.googleapis.com'],
    connectSrc: ["'self'", 'https://cdn.jsdelivr.net'],
    frameSrc: ["'self'", 'https://vercel.live'],
    frameAncestors: ["'none'"],
    workerSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"]
  }
});

/** Swagger UI inyecta scripts/estilos inline sin nonce; CSP más permisiva solo en /api/docs. */
const cspSwaggerDocsMiddleware = helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://fonts.googleapis.com'],
    connectSrc: ["'self'"],
    frameAncestors: ["'none'"],
    workerSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"]
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/docs')) {
    return cspSwaggerDocsMiddleware(req, res, next);
  }
  return cspAppMiddleware(req, res, next);
});

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

app.use(vercelPathRewrite);
app.use(apiHtmlUiPathRewrite);
app.use(corsMiddleware);

registerEarlyDiagnostics(app, { db, getStoredPasswordFromRow, requireApiKeyIfConfigured });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view cache', process.env.NODE_ENV === 'production');
app.use('/assets', express.static(path.join(__dirname, '..', 'public')));

setupSharedPoolAndSession(app, { db, comisionesCrm });

const { csrfProtection } = require('../lib/csrf');
app.use(
  csrfProtection({
    skipPaths: ['/api/', '/webhook/', '/health', '/sw.js'],
    deferValidationPaths: ['/ventas-gemavip/upload']
  })
);

app.use((req, res, next) => {
  req.requestId = makeRequestId();
  res.locals.requestId = req.requestId;
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

app.use((req, _res, next) => {
  const user = req.session?.user || null;
  req.user = user;
  next();
});

app.use(
  createEjsLocalsMiddleware({
    db,
    getCommonNavLinksForRoles,
    getRoleNavLinksForRoles,
    isAdminUser
  })
);

app.use(requireSessionComercialActive);

registerJsonHelperRoutes(app, { db, getQueryParam, requireLoginJson, requireAdmin });

app.use('/webhook', require('../routes/webhook-aprobacion'));

app.use('/', publicRouter);
app.use('/', ventasGemavipRouter);
app.use('/', authRouter);
app.use('/', dashboardRouter);
app.use('/', manualRouter);
app.use('/', cpanelRouter);
app.use('/comerciales', comercialesRouter);
app.use('/admin', adminRouter);
app.use('/visitas', visitasRouter);
app.use('/articulos', articulosRouter);
app.use('/clientes', clientesRouter);
app.use('/pedidos', pedidosRouter);
app.use('/', notificacionesRouter);

app.get('/', async (_req, res) => {
  if (res.locals.user) return res.redirect('/dashboard');
  return res.redirect('/login');
});

registerOpenApiAndHealthDb(app, { requireApiKeyIfConfigured, swaggerSpec, swaggerUi });

const { apiLimiter } = require('../lib/rate-limit');
app.use('/api', apiLimiter, requireApiKeyIfConfigured, apiRouter);

registerHttpErrorHandlers(app, { wantsHtml, renderErrorPage });

module.exports = app;

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`CRM Gemavip escuchando en http://localhost:${port}`);
  });
}
