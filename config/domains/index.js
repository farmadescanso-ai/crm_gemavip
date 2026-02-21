/**
 * Dominios del CRM - módulos por vista/entidad
 * Cada dominio exporta métodos que se invocan con db como contexto (this).
 * Uso en mysql-crm.js: visitasDomain.getVisitas.apply(this, arguments)
 */
'use strict';

module.exports = {
  visitas: require('./visitas'),
  articulos: require('./articulos'),
  pedidos: require('./pedidos'),
  comerciales: require('./comerciales'),
  agenda: require('./agenda'),
  clientes: require('./clientes'),
  clientesCrud: require('./clientes-crud')
  // pedidos: require('./pedidos'),
  // articulos: require('./articulos'),
  // agenda: require('./agenda'),
  // comerciales: require('./comerciales'),
  // ...
};
