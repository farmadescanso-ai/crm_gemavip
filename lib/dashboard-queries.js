'use strict';

const { warn } = require('./logger');

/**
 * Resuelve los metadatos de tablas/columnas necesarios para el dashboard.
 * Evita repetir ~20 líneas de _ensureMeta + _getColumns + _pickCIFromColumns.
 */
async function resolveDashboardMeta(db) {
  const [metaVisitas, pedidosMeta, clientesMeta, comercialesMeta] = await Promise.all([
    db._ensureVisitasMeta().catch(() => null),
    db._ensurePedidosMeta().catch(() => null),
    db._ensureClientesMeta().catch(() => null),
    db._ensureComercialesMeta().catch(() => null)
  ]);

  const tPedidos = pedidosMeta?.tPedidos || 'pedidos';
  const tClientes = clientesMeta?.tClientes || 'clientes';
  const pkClientes = clientesMeta?.pk || 'cli_id';
  const colPedComercial = pedidosMeta?.colComercial || 'ped_com_id';
  const colPedCliente = pedidosMeta?.colCliente || 'ped_cli_id';
  const colPedFecha = pedidosMeta?.colFecha || 'ped_fecha';
  const colPedNum = pedidosMeta?.colNumPedido || 'ped_numero';
  const colNombreRazon = clientesMeta?.colNombreRazonSocial || 'cli_nombre_razon_social';

  const pedidosCols = await db._getColumns(tPedidos).catch(() => []);
  const colPedTotal = db._pickCIFromColumns(pedidosCols, ['ped_total', 'TotalPedido', 'Total', 'ImporteTotal']) || 'ped_total';
  const colPedEstado = db._pickCIFromColumns(pedidosCols, ['ped_estado_txt', 'EstadoPedido', 'Estado', 'estado']) || 'ped_estado_txt';
  const colEstadoId = db._pickCIFromColumns(pedidosCols, ['Id_EstadoPedido', 'id_estado_pedido', 'ped_estped_id']);

  const clientesCols = await db._getColumns(tClientes).catch(() => []);
  const colPoblacion = db._pickCIFromColumns(clientesCols, ['cli_poblacion', 'Poblacion']) || 'cli_poblacion';
  const colCodigoPostal = db._pickCIFromColumns(clientesCols, ['cli_codigo_postal', 'CodigoPostal']) || 'cli_codigo_postal';
  const colOK_KO = db._pickCIFromColumns(clientesCols, ['cli_ok_ko', 'OK_KO']) || 'cli_ok_ko';

  return {
    metaVisitas, pedidosMeta, clientesMeta, comercialesMeta,
    tPedidos, tClientes, pkClientes,
    colPedComercial, colPedCliente, colPedFecha, colPedNum,
    colPedTotal, colPedEstado, colEstadoId,
    colNombreRazon, colPoblacion, colCodigoPostal, colOK_KO,
    pedidosCols, clientesCols
  };
}

const CCAA_JOIN = 'LEFT JOIN codigos_postales cp ON (cp.codpos_id = c.cli_codp_id OR (c.cli_codp_id IS NULL AND cp.codpos_CodigoPostal = c.cli_codigo_postal))';

/**
 * Ranking de productos vendidos. Usado tanto en dashboard admin como comercial.
 * @param {object} db
 * @param {object} opts - { tPedidos, colPedFecha, colPedComercial, dateFrom, dateTo, comercialId, marcaId, limit }
 */
async function queryRankingProductos(db, opts) {
  const { tPedidos, colPedFecha, colPedComercial } = opts;
  const paMeta = await db._ensurePedidosArticulosMeta().catch(() => null);
  const tPA = paMeta?.table || 'pedidos_articulos';
  const colPaPedId = paMeta?.colPedidoId || 'pedart_ped_id';
  const colPaArtId = paMeta?.colArticulo || 'pedart_art_id';
  const paCols = await db._getColumns(tPA).catch(() => []);
  const colPaCantidad = db._pickCIFromColumns(paCols, ['pedart_cantidad', 'Cantidad']) || 'pedart_cantidad';
  const colPaPvp = db._pickCIFromColumns(paCols, ['pedart_pvp', 'PVP', 'pvp']) || 'pedart_pvp';

  const where = [];
  const params = [];
  if (opts.comercialId) {
    where.push(`p.\`${colPedComercial}\` = ?`);
    params.push(opts.comercialId);
  }
  if (opts.dateFrom && opts.dateTo) {
    where.push(`p.\`${colPedFecha}\` >= ? AND p.\`${colPedFecha}\` < ? + INTERVAL 1 DAY`);
    params.push(opts.dateFrom, opts.dateTo);
  }
  if (opts.marcaId) {
    where.push('a.art_mar_id = ?');
    params.push(opts.marcaId);
  }
  where.push('(COALESCE(a.art_activo, 1) = 1)');
  if (where.length === 1) where.unshift('1=1');

  const limit = opts.limit || 15;
  const rows = await db.query(
    `SELECT a.art_id AS ArtId, a.art_nombre AS Producto,
       COALESCE(SUM(COALESCE(pa.\`${colPaCantidad}\`, 0) * COALESCE(pa.\`${colPaPvp}\`, 0)), 0) AS Ventas,
       COALESCE(SUM(COALESCE(pa.\`${colPaCantidad}\`, 0)), 0) AS Unidades
     FROM \`${tPedidos}\` p
     INNER JOIN \`${tPA}\` pa ON pa.\`${colPaPedId}\` = p.ped_id
     INNER JOIN articulos a ON a.art_id = pa.\`${colPaArtId}\`
     WHERE ${where.join(' AND ')}
     GROUP BY a.art_id, a.art_nombre ORDER BY Ventas DESC LIMIT ${limit}`,
    params
  );

  const total = rows.reduce((s, r) => s + Number(r.Ventas || 0), 0);
  return rows.map((r) => ({
    ...r,
    PctTotal: total > 0 ? Math.round((Number(r.Ventas || 0) / total) * 100) : 0
  }));
}

/**
 * Carga los catálogos de filtros del dashboard (zonas, comerciales, marcas).
 */
async function loadDashboardFilterCatalogs(db, comercialesMeta) {
  const [zonas, comercialesList, marcasList] = await Promise.all([
    db.query('SELECT DISTINCT codpos_ComunidadAutonoma AS value FROM codigos_postales WHERE codpos_ComunidadAutonoma IS NOT NULL AND codpos_ComunidadAutonoma != "" ORDER BY codpos_ComunidadAutonoma').catch((e) => { warn('[dashboard] zonas', e?.message); return []; }),
    db.query(`SELECT \`${comercialesMeta?.pk || 'com_id'}\` AS id, \`${comercialesMeta?.colNombre || 'com_nombre'}\` AS nombre FROM \`${comercialesMeta?.table || 'comerciales'}\` ORDER BY \`${comercialesMeta?.colNombre || 'com_nombre'}\``).catch((e) => { warn('[dashboard] comerciales', e?.message); return []; }),
    db.query('SELECT mar_id AS id, mar_nombre AS nombre FROM marcas ORDER BY mar_nombre').catch((e) => { warn('[dashboard] marcas', e?.message); return []; })
  ]);
  return { zonas: zonas || [], comercialesList: comercialesList || [], marcasList: marcasList || [] };
}

module.exports = { resolveDashboardMeta, CCAA_JOIN, queryRankingProductos, loadDashboardFilterCatalogs };
