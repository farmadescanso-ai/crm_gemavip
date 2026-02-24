#!/usr/bin/env node
/**
 * Extrae las rutas de pedidos de api/index.js a routes/pedidos.js
 */
const fs = require('fs');
const path = require('path');

const apiPath = path.join(__dirname, '..', 'api', 'index.js');
const routesPath = path.join(__dirname, '..', 'routes', 'pedidos.js');

const content = fs.readFileSync(apiPath, 'utf8');
const lines = content.split('\n');

// Encontrar inicio: app.get('/pedidos',
let startIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim().startsWith("app.get('/pedidos', requireLogin")) {
    startIdx = i;
    break;
  }
}

// Encontrar fin: después de app.post('/pedidos/:id(\\d+)/delete', ... });
let endIdx = -1;
let deleteRouteIdx = -1;
for (let i = startIdx; i < lines.length; i++) {
  if (lines[i].includes("/pedidos/:id") && lines[i].includes("delete")) {
    deleteRouteIdx = i;
  }
  if (deleteRouteIdx >= 0 && i > deleteRouteIdx && lines[i].trim() === '});') {
    endIdx = i;
    break;
  }
}

if (startIdx < 0 || endIdx < 0) {
  console.error('No se encontró el bloque de pedidos');
  process.exit(1);
}

const block = lines.slice(startIdx, endIdx + 1).join('\n');

// Transformar app.X('/pedidos/...' -> router.X('/...'
// y app.get('/pedidos', -> router.get('/',
// y app.get('/pedidos/new' -> router.get('/new',
// etc.
let transformed = block
  .replace(/app\.get\('\/pedidos', /g, "router.get('/', ")
  .replace(/app\.post\('\/pedidos\/:id\(\\\\d\+\)\/estado', /g, "router.post('/:id(\\\\d+)/estado', ")
  .replace(/app\.get\('\/pedidos\/new', /g, "router.get('/new', ")
  .replace(/app\.post\('\/pedidos\/new', /g, "router.post('/new', ")
  .replace(/app\.get\('\/pedidos\/:id\(\\\\d\+\)\/duplicate', /g, "router.get('/:id(\\\\d+)/duplicate', ")
  .replace(/app\.get\('\/pedidos\/:id\(\\\\d\+\)', /g, "router.get('/:id(\\\\d+)', ")
  .replace(/app\.get\('\/pedidos\/:id\(\\\\d\+\)\.xlsx', /g, "router.get('/:id(\\\\d+).xlsx', ")
  .replace(/app\.get\('\/pedidos\/:id\(\\\\d\+\)\/hefame-send-email', /g, "router.get('/:id(\\\\d+)/hefame-send-email', ")
  .replace(/app\.get\('\/pedidos\/:id\(\\\\d\+\)\/hefame\.xlsx', /g, "router.get('/:id(\\\\d+)/hefame.xlsx', ")
  .replace(/app\.post\('\/pedidos\/:id\(\\\\d\+\)\/enviar-n8n', /g, "router.post('/:id(\\\\d+)/enviar-n8n', ")
  .replace(/app\.get\('\/pedidos\/:id\(\\\\d\+\)\/edit', /g, "router.get('/:id(\\\\d+)/edit', ")
  .replace(/app\.post\('\/pedidos\/:id\(\\\\d\+\)\/edit', /g, "router.post('/:id(\\\\d+)/edit', ")
  .replace(/app\.post\('\/pedidos\/:id\(\\\\d\+\)\/delete', /g, "router.post('/:id(\\\\d+)/delete', ");

// Eliminar función tokenizeSmartQuery local (ya importada del helper)
const tokenizeRegex = /function tokenizeSmartQuery\(input\) \{\s*\n\s*const q = String\(input \|\| ''\)\.trim\(\);[\s\S]*?return \{ tokens, terms \};\s*\n\s*\}(\s*\n)/;
transformed = transformed.replace(tokenizeRegex, '$1');

// Helpers que necesitan db como primer argumento
transformed = transformed
  .replace(/await canShowHefameForPedido\(item\)/g, 'await canShowHefameForPedido(db, item)')
  .replace(/await isTransferPedido\(item\)/g, 'await isTransferPedido(db, item)')
  .replace(/canShowHefameForPedido\(item\)/g, 'canShowHefameForPedido(db, item)')
  .replace(/isTransferPedido\(item\)/g, 'isTransferPedido(db, item)');

const header = `/**
 * Rutas HTML de pedidos (CRUD, Excel, Hefame, N8N).
 */

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const db = require('../config/mysql-crm');
const ExcelJS = require('exceljs');
const {
  _n,
  renderErrorPage
} = require('../lib/app-helpers');
const {
  isAdminUser,
  requireLogin,
  requireAdmin,
  createLoadPedidoAndCheckOwner
} = require('../lib/auth');
const { parsePagination } = require('../lib/pagination');
const { sendPedidoEmail, APP_BASE_URL } = require('../lib/mailer');
const { escapeHtml: escapeHtmlUtil } = require('../lib/utils');
const { loadMarcasForSelect } = require('../lib/articulo-helpers');
const { SYSVAR_PEDIDOS_MAIL_TO } = require('../lib/admin-helpers');
const {
  tokenizeSmartQuery,
  parseLineasFromBody,
  canShowHefameForPedido,
  isTransferPedido,
  renderHefameInfoPage,
  buildStandardPedidoXlsxBuffer,
  buildHefameXlsxBuffer
} = require('../lib/pedido-helpers');

const router = express.Router();
const loadPedidoAndCheckOwner = createLoadPedidoAndCheckOwner('id');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

`;

const footer = `
module.exports = router;
`;

const output = header + transformed + footer;
fs.writeFileSync(routesPath, output, 'utf8');
console.log('routes/pedidos.js creado');
