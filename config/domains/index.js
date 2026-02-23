/**
 * Dominios del CRM - lazy loading (Fase 3)
 * Cada dominio se carga solo cuando se accede por primera vez.
 * ensureModule(name) aplica el mysql-crm-* correspondiente al prototipo.
 * @param {function(name: string)} ensureModule - Callback para aplicar módulo mysql-crm-* antes de cargar dominio
 */
'use strict';

const domainCache = {};
const MODULE_DEPS = {
  visitas: 'visitas',
  articulos: 'articulos',
  pedidos: 'pedidos',
  comerciales: 'comerciales',
  agenda: 'agenda',
  clientes: 'clientes',
  clientesCrud: 'clientes', // clientesCrud depende de clientesModule
  catalogos: 'catalogos',
  notificaciones: ['clientes', 'comerciales', 'pedidos', 'notificaciones'] // múltiples deps
};

function createDomains(ensureModule) {
  return new Proxy({}, {
    get(target, prop) {
      const dep = MODULE_DEPS[prop];
      if (!dep) return undefined;
      const deps = Array.isArray(dep) ? dep : [dep];
      deps.forEach((d) => ensureModule(d));
      if (!domainCache[prop]) {
        const loaders = {
          visitas: () => require('./visitas'),
          articulos: () => require('./articulos'),
          pedidos: () => require('./pedidos'),
          comerciales: () => require('./comerciales'),
          agenda: () => require('./agenda'),
          clientes: () => require('./clientes'),
          clientesCrud: () => require('./clientes-crud'),
          catalogos: () => require('./catalogos'),
          notificaciones: () => require('./notificaciones')
        };
        domainCache[prop] = loaders[prop]();
      }
      return domainCache[prop];
    },
    has(target, prop) {
      return prop in MODULE_DEPS;
    }
  });
}

module.exports = createDomains;
