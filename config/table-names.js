/**
 * Mapeo estático de nombres de tabla (auditoría punto 14).
 * Evita 20-60 queries en cada cold start de serverless.
 * Basado en scripts/crm_gemavip-schema-drawdb.sql
 *
 * Para sobrescribir en un entorno con nombres distintos:
 * TABLE_NAMES_OVERRIDE='{"clientes":"Clientes","pedidos":"Pedidos"}' (JSON)
 */
'use strict';

const DEFAULT_TABLE_NAMES = {
  agenda: 'agenda',
  agenda_especialidades: 'agenda_especialidades',
  agenda_roles: 'agenda_roles',
  api_keys: 'api_keys',
  articulos: 'articulos',
  bancos: 'bancos',
  clientes: 'clientes',
  clientes_contactos: 'clientes_contactos',
  clientes_cooperativas: 'clientes_cooperativas',
  clientes_gruposCompras: 'clientes_gruposCompras',
  clientes_relacionados: 'clientes_relacionados',
  codigos_postales: 'codigos_postales',
  comerciales: 'comerciales',
  comerciales_codigos_postales_marcas: 'comerciales_codigos_postales_marcas',
  comisiones: 'comisiones',
  comisiones_detalle: 'comisiones_detalle',
  cooperativas: 'cooperativas',
  descuentos_pedido: 'descuentos_pedido',
  direccionesEnvio: 'direccionesEnvio',
  especialidades: 'especialidades',
  estadoComisiones: 'estadoComisiones',
  estados_pedido: 'estados_pedido',
  estdoClientes: 'estdoClientes',
  formas_pago: 'formas_pago',
  gruposCompras: 'gruposCompras',
  marcas: 'marcas',
  paises: 'paises',
  pedidos: 'pedidos',
  pedidos_articulos: 'pedidos_articulos',
  provincias: 'provincias',
  tarifas: 'tarifas',
  tarifasClientes: 'tarifasClientes',
  tarifasClientes_precios: 'tarifasClientes_precios',
  tipos_clientes: 'tipos_clientes',
  tipos_pedido: 'tipos_pedidos',
  tipos_pedidos: 'tipos_pedidos',
  variables_sistema: 'variables_sistema',
  visitas: 'visitas',
  idiomas: 'idiomas',
  monedas: 'monedas',
  notificaciones: 'notificaciones',
  ventas_hefame: 'ventas_hefame',
  regimenes_fiscales: 'regimenes_fiscales',
  tipos_impuesto: 'tipos_impuesto',
  equivalencias_impuesto: 'equivalencias_impuesto',
  estados_visita: 'estados_visita',
  centros_prescriptores: 'centros_prescriptores',
  tiposcargorol: 'tiposcargorol',
  push_subscriptions: 'push_subscriptions'
};

function getTableNames() {
  const override = process.env.TABLE_NAMES_OVERRIDE;
  if (override && typeof override === 'string') {
    try {
      const parsed = JSON.parse(override);
      return { ...DEFAULT_TABLE_NAMES, ...parsed };
    } catch (_) {
      // JSON inválido, usar defaults
    }
  }
  return DEFAULT_TABLE_NAMES;
}

let _tableNames = null;
function getTableName(logicalName) {
  if (!_tableNames) _tableNames = getTableNames();
  const key = String(logicalName || '').trim();
  return _tableNames[key] || null;
}

module.exports = { getTableName, DEFAULT_TABLE_NAMES };
