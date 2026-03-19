/**
 * Dominios del CRM - carga eager al inicio.
 * ensureModule(name) aplica el mysql-crm-* correspondiente al prototipo.
 * @param {function(name: string)} ensureModule - Callback para aplicar módulo mysql-crm-*
 */
'use strict';

const MODULE_DEPS = {
  visitas: 'visitas',
  articulos: 'articulos',
  pedidos: 'pedidos',
  comerciales: 'comerciales',
  clientes: 'clientes',
  clientesCrud: ['clientes', 'codigos-postales'],
  clientesRelacionados: 'clientes',
  catalogos: 'catalogos',
  notificaciones: ['clientes', 'comerciales', 'pedidos', 'notificaciones']
};

const LOADERS = {
  visitas: () => require('./visitas'),
  articulos: () => require('./articulos'),
  pedidos: () => require('./pedidos'),
  comerciales: () => require('./comerciales'),
  clientes: () => require('./clientes'),
  clientesCrud: () => require('./clientes-crud'),
  clientesRelacionados: () => require('./clientes-relacionados'),
  catalogos: () => require('./catalogos'),
  notificaciones: () => require('./notificaciones')
};

function createDomains(ensureModule) {
  const cache = {};
  for (const prop of Object.keys(MODULE_DEPS)) {
    const dep = MODULE_DEPS[prop];
    const deps = Array.isArray(dep) ? dep : [dep];
    deps.forEach((d) => ensureModule(d));
    cache[prop] = LOADERS[prop]();
  }
  return cache;
}

module.exports = createDomains;
