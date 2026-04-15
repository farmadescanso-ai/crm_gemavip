/**
 * Rutas HTML de clientes (CRUD). Orden de registro relevante para /:id vs rutas más específicas.
 */
const express = require('express');
const db = require('../../config/mysql-crm');
const { requireAdmin } = require('../../lib/app-helpers');
const { requireLogin, isAdminUser } = require('../../lib/auth');
const { registerDuplicadosRoutes } = require('./duplicados');
const { registerListRoutes } = require('./list');
const { registerNewClienteRoutes } = require('./new');
const { registerDireccionesRoutes } = require('./direcciones');
const { registerEditClienteRoutes } = require('./edit');
const { registerViewClienteRoutes } = require('./view');
const { registerClienteActionRoutes } = require('./actions');

const router = express.Router();

const ctx = {
  db,
  requireLogin,
  requireAdmin,
  isAdminUser
};

registerDuplicadosRoutes(router, ctx);
registerListRoutes(router, ctx);
registerNewClienteRoutes(router, ctx);
registerDireccionesRoutes(router, ctx);
registerEditClienteRoutes(router, ctx);
registerViewClienteRoutes(router, ctx);
registerClienteActionRoutes(router, ctx);

module.exports = router;
