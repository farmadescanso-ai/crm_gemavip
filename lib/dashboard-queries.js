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

/** KPI: suma ventas y recuento pedidos (con filtro CCAA opcional). */
async function queryKpiVentasYPedidos(db, {
  tPedidos, tClientes, pkClientes, colPedCliente, colPedTotal,
  pedWhereClause, pedWhereParams, pedidosWithZone, ccaaJoin, zoneCondition, zoneParams
}) {
  let ventasSql = `SELECT COALESCE(SUM(COALESCE(p.\`${colPedTotal}\`, 0)), 0) AS total, COUNT(*) AS n FROM \`${tPedidos}\` p`;
  let ventasParams = [];
  if (pedidosWithZone) {
    ventasSql += ` INNER JOIN \`${tClientes}\` c ON c.\`${pkClientes}\` = p.\`${colPedCliente}\` ${ccaaJoin} ${pedWhereClause} ${zoneCondition}`;
    ventasParams = [...pedWhereParams, ...zoneParams];
  } else {
    ventasSql += ` ${pedWhereClause}`;
    ventasParams = pedWhereParams;
  }
  const [ventasRow] = await db.query(ventasSql, ventasParams);
  return { total: Number(ventasRow?.total ?? 0), n: Number(ventasRow?.n ?? 0) };
}

/** KPI: número de visitas en rango / comercial. */
async function queryKpiNumVisitas(db, metaVisitas, {
  admin, filters, hasUserId, userId, hasDateFilter, dateFrom, dateTo
}) {
  if (!metaVisitas?.table) return 0;
  const visWhere = [];
  const visParams = [];
  if (admin && filters.comercial) {
    visWhere.push(`\`${metaVisitas.colComercial}\` = ?`);
    visParams.push(filters.comercial);
  } else if (!admin && hasUserId) {
    visWhere.push(`\`${metaVisitas.colComercial}\` = ?`);
    visParams.push(userId);
  }
  if (hasDateFilter && metaVisitas.colFecha) {
    visWhere.push(`\`${metaVisitas.colFecha}\` >= ? AND \`${metaVisitas.colFecha}\` < ? + INTERVAL 1 DAY`);
    visParams.push(dateFrom, dateTo);
  }
  const visWhereSql = visWhere.length ? `WHERE ${visWhere.join(' AND ')}` : '';
  const [visRow] = await db.query(`SELECT COUNT(*) AS n FROM \`${metaVisitas.table}\` ${visWhereSql}`, visParams);
  return Number(visRow?.n ?? 0);
}

/** KPI: clientes nuevos creados en Holded (columna cli_creado_holded) en rango. */
async function queryKpiContactosNuevosHolded(db, {
  tClientes, clientesMeta, ccaaJoin, admin, filters, hasUserId, userId,
  hasDateFilter, dateFrom, dateTo
}) {
  const cliWhere = [];
  const cliParams = [];
  if (admin && filters.comercial) {
    cliWhere.push(`c.\`${clientesMeta?.colComercial || 'cli_com_id'}\` = ?`);
    cliParams.push(filters.comercial);
  } else if (!admin && hasUserId) {
    cliWhere.push(`c.\`${clientesMeta?.colComercial || 'cli_com_id'}\` = ?`);
    cliParams.push(userId);
  }
  cliWhere.push('c.cli_creado_holded >= ? AND c.cli_creado_holded < ? + INTERVAL 1 DAY');
  cliParams.push(dateFrom, dateTo);
  if (filters.zone) {
    cliWhere.push('cp.codpos_ComunidadAutonoma = ?');
    cliParams.push(filters.zone);
  }
  const joinPart = filters.zone ? ccaaJoin : '';
  const [cnRow] = await db.query(
    `SELECT COUNT(*) AS n FROM \`${tClientes}\` c ${joinPart} WHERE ${cliWhere.join(' AND ')}`,
    cliParams
  );
  return Number(cnRow?.n ?? 0);
}

/** KPI admin: farmacias (clientes distintos) con pedido en rango. */
async function queryKpiFarmaciasActivas(db, {
  tPedidos, tClientes, pkClientes, colPedCliente, colPedComercial, colPedFecha,
  ccaaJoin, zoneCondition, zoneParams, filters, hasDateFilter, dateFrom, dateTo
}) {
  const faWhere = [];
  const faParams = [];
  if (filters.comercial) {
    faWhere.push(`p.\`${colPedComercial}\` = ?`);
    faParams.push(filters.comercial);
  }
  faWhere.push(`p.\`${colPedFecha}\` >= ? AND p.\`${colPedFecha}\` < ? + INTERVAL 1 DAY`);
  faParams.push(dateFrom, dateTo);
  const faJoin = filters.zone ? `INNER JOIN \`${tClientes}\` c ON c.\`${pkClientes}\` = p.\`${colPedCliente}\` ${ccaaJoin} ${zoneCondition}` : '';
  const [faRow] = await db.query(
    `SELECT COUNT(DISTINCT p.\`${colPedCliente}\`) AS n FROM \`${tPedidos}\` p ${faJoin} WHERE ${faWhere.join(' AND ')}`,
    filters.zone ? [...faParams, ...zoneParams] : faParams
  );
  return Number(faRow?.n ?? 0);
}

/** KPI admin: CCAA distintas con actividad en rango. */
async function queryKpiCoberturaCCAA(db, {
  tPedidos, tClientes, pkClientes, colPedCliente, colPedComercial, colPedFecha,
  ccaaJoin, filters, hasDateFilter, dateFrom, dateTo
}) {
  const ccWhere = [];
  const ccParams = [];
  if (filters.comercial) {
    ccWhere.push(`p.\`${colPedComercial}\` = ?`);
    ccParams.push(filters.comercial);
  }
  ccWhere.push(`p.\`${colPedFecha}\` >= ? AND p.\`${colPedFecha}\` < ? + INTERVAL 1 DAY`);
  ccParams.push(dateFrom, dateTo);
  const [ccRow] = await db.query(
    `SELECT COUNT(DISTINCT COALESCE(cp.codpos_ComunidadAutonoma, 'Sin CCAA')) AS n
     FROM \`${tPedidos}\` p INNER JOIN \`${tClientes}\` c ON c.\`${pkClientes}\` = p.\`${colPedCliente}\`
     ${ccaaJoin} WHERE ${ccWhere.join(' AND ')}`,
    ccParams
  );
  return Number(ccRow?.n ?? 0);
}

/** KPI comercial: clientes distintos con pedido (y rango opcional). */
async function queryKpiClientesActivosComercial(db, {
  tPedidos, colPedCliente, colPedComercial, colPedFecha, userId, hasDateFilter, dateFrom, dateTo
}) {
  const caWhere = [];
  const caParams = [userId];
  if (hasDateFilter) {
    caWhere.push(`p.\`${colPedFecha}\` >= ? AND p.\`${colPedFecha}\` < ? + INTERVAL 1 DAY`);
    caParams.push(dateFrom, dateTo);
  }
  const caWhereSql = caWhere.length ? `AND ${caWhere.join(' AND ')}` : '';
  const [caRow] = await db.query(
    `SELECT COUNT(DISTINCT p.\`${colPedCliente}\`) AS n FROM \`${tPedidos}\` p
     WHERE p.\`${colPedComercial}\` = ? ${caWhereSql}`,
    caParams
  );
  return Number(caRow?.n ?? 0);
}

/** KPI admin: total clientes con filtros comercial / zona. */
async function queryKpiNumClientesAdmin(db, {
  tClientes, clientesMeta, filters
}) {
  const cliWhere = [];
  const cliParams = [];
  if (filters.comercial) {
    cliWhere.push(`\`${clientesMeta?.colComercial || 'cli_com_id'}\` = ?`);
    cliParams.push(filters.comercial);
  }
  if (filters.zone) {
    cliWhere.push(`EXISTS (SELECT 1 FROM codigos_postales cp WHERE (cp.codpos_id = \`${tClientes}\`.cli_codp_id OR cp.codpos_CodigoPostal = \`${tClientes}\`.cli_codigo_postal) AND cp.codpos_ComunidadAutonoma = ?)`);
    cliParams.push(filters.zone);
  }
  const cliWhereSql = cliWhere.length ? `WHERE ${cliWhere.join(' AND ')}` : '';
  const [cliRow] = await db.query(`SELECT COUNT(*) AS n FROM \`${tClientes}\` ${cliWhereSql}`, cliParams);
  return Number(cliRow?.n ?? 0);
}

async function queryKpiNumComerciales(db) {
  const [comRow] = await db.query('SELECT COUNT(*) AS n FROM comerciales');
  return Number(comRow?.n ?? 0);
}

/** Desglose de pedidos por estado (JOIN estados_pedido). */
async function queryDesgloseEstadoPedidos(db, pedidosCols, {
  tPedidos, tClientes, pkClientes, colPedCliente, colPedTotal,
  pedWhere, pedidosWithZone, ccaaJoin, zoneParams
}) {
  const colEstadoId = db._pickCIFromColumns(pedidosCols, ['Id_EstadoPedido', 'id_estado_pedido', 'ped_estped_id']);
  if (!colEstadoId) return [];
  const deWhere = [...pedWhere.where];
  const deParams = [...pedWhere.params];
  if (pedidosWithZone) {
    deWhere.push(...(zoneParams.length ? ['cp.codpos_ComunidadAutonoma = ?'] : []));
    deParams.push(...zoneParams);
  }
  const deWhereClause = deWhere.length ? `WHERE ${deWhere.join(' AND ')}` : '';
  const deSql = `
    SELECT ep.estped_nombre AS estado, ep.estped_color AS color, ep.estped_orden AS orden,
      COUNT(*) AS pedidos, COALESCE(SUM(COALESCE(p.\`${colPedTotal}\`, 0)), 0) AS ventas
    FROM \`${tPedidos}\` p
    LEFT JOIN estados_pedido ep ON ep.estped_id = p.\`${colEstadoId}\`
    ${pedidosWithZone ? `INNER JOIN \`${tClientes}\` c ON c.\`${pkClientes}\` = p.\`${colPedCliente}\` ${ccaaJoin}` : ''}
    ${deWhereClause}
    GROUP BY ep.estped_nombre, ep.estped_color, ep.estped_orden
    ORDER BY ep.estped_orden ASC`;
  return db.query(deSql, deParams);
}

async function queryRankingZonaPedidos(db, {
  tPedidos, tClientes, pkClientes, colPedCliente, colPedTotal, colPedFecha, colPedComercial,
  ccaaJoin, filters, hasDateFilter, dateFrom, dateTo
}) {
  const rzWhere = ['cp.codpos_ComunidadAutonoma = ?'];
  const rzParams = [filters.zone];
  if (hasDateFilter) {
    rzWhere.push(`p.\`${colPedFecha}\` >= ? AND p.\`${colPedFecha}\` < ? + INTERVAL 1 DAY`);
    rzParams.push(dateFrom, dateTo);
  }
  if (filters.comercial) {
    rzWhere.push(`p.\`${colPedComercial}\` = ?`);
    rzParams.push(filters.comercial);
  }
  return db.query(
    `SELECT cp.codpos_ComunidadAutonoma AS Zona,
      COALESCE(SUM(COALESCE(p.\`${colPedTotal}\`, 0)), 0) AS Ventas,
      COUNT(*) AS Pedidos,
      COALESCE(SUM(COALESCE(p.\`${colPedTotal}\`, 0)), 0) / NULLIF(COUNT(*), 0) AS TicketMedio
     FROM \`${tPedidos}\` p INNER JOIN \`${tClientes}\` c ON c.\`${pkClientes}\` = p.\`${colPedCliente}\`
     ${ccaaJoin} WHERE ${rzWhere.join(' AND ')}
     GROUP BY cp.codpos_ComunidadAutonoma ORDER BY Ventas DESC LIMIT 10`,
    rzParams
  );
}

async function queryRankingComercialesPedidos(db, comercialesMeta, {
  tPedidos, colPedFecha, colPedComercial, colPedTotal, filters, hasDateFilter, dateFrom, dateTo
}) {
  const rcWhere = [];
  const rcParams = [];
  if (hasDateFilter) {
    rcWhere.push(`p.\`${colPedFecha}\` >= ? AND p.\`${colPedFecha}\` < ? + INTERVAL 1 DAY`);
    rcParams.push(dateFrom, dateTo);
  } else {
    rcWhere.push('1=1');
  }
  if (filters.comercial) {
    rcWhere.push(`p.\`${colPedComercial}\` = ?`);
    rcParams.push(filters.comercial);
  }
  const provJoin = comercialesMeta?.table ? 'LEFT JOIN provincias prov ON prov.prov_id = co.com_prov_id' : '';
  const tCom = comercialesMeta?.table || 'comerciales';
  const pkCom = comercialesMeta?.pk || 'com_id';
  const colNom = comercialesMeta?.colNombre || 'com_nombre';
  return db.query(
    `SELECT co.\`${pkCom}\` AS ComercialId, co.\`${colNom}\` AS Comercial,
      prov.prov_nombre AS Zona,
      COALESCE(SUM(COALESCE(p.\`${colPedTotal}\`, 0)), 0) AS Ventas,
      COUNT(*) AS Pedidos,
      COALESCE(SUM(COALESCE(p.\`${colPedTotal}\`, 0)), 0) / NULLIF(COUNT(*), 0) AS TicketMedio
     FROM \`${tPedidos}\` p
     INNER JOIN \`${tCom}\` co ON co.\`${pkCom}\` = p.\`${colPedComercial}\`
     ${provJoin}
     WHERE ${rcWhere.join(' AND ')}
     GROUP BY co.\`${pkCom}\`, co.\`${colNom}\`, prov.prov_nombre
     ORDER BY Ventas DESC LIMIT 10`,
    rcParams
  );
}

async function queryLatestClientesAdminDashboard(db, {
  tClientes, tPedidos, pkClientes, colNombreRazon, colPoblacion, colCodigoPostal, colOK_KO,
  colPedTotal, colPedFecha, colPedComercial, colClientePedido,
  filters, hasDateFilter, dateFrom, dateTo, limitAdmin
}) {
  const adminCliWhere = [];
  const adminCliParams = [];
  if (filters.zone) adminCliParams.push(filters.zone);
  if (hasDateFilter && colPedFecha) {
    adminCliWhere.push(`p.\`${colPedFecha}\` >= ? AND p.\`${colPedFecha}\` < ? + INTERVAL 1 DAY`);
    adminCliParams.push(dateFrom, dateTo);
  }
  if (filters.comercial) {
    adminCliWhere.push(`p.\`${colPedComercial}\` = ?`);
    adminCliParams.push(filters.comercial);
  }
  const adminCliWhereSql = adminCliWhere.length ? `WHERE ${adminCliWhere.join(' AND ')}` : '';
  return db.query(
    `SELECT c.\`${pkClientes}\` AS Id, c.\`${colNombreRazon}\` AS Nombre_Razon_Social, c.\`${colPoblacion}\` AS Poblacion, c.\`${colCodigoPostal}\` AS CodigoPostal, c.\`${colOK_KO}\` AS OK_KO,
      COALESCE(SUM(COALESCE(p.\`${colPedTotal}\`, 0)), 0) AS TotalFacturado
     FROM \`${tClientes}\` c
     INNER JOIN \`${tPedidos}\` p ON p.\`${colClientePedido}\` = c.\`${pkClientes}\`
     ${filters.zone ? 'INNER JOIN codigos_postales cp ON (cp.codpos_id = c.cli_codp_id OR (c.cli_codp_id IS NULL AND cp.codpos_CodigoPostal = c.cli_codigo_postal)) AND cp.codpos_ComunidadAutonoma = ?' : ''}
     ${adminCliWhereSql}
     GROUP BY c.\`${pkClientes}\`, c.\`${colNombreRazon}\`, c.\`${colPoblacion}\`, c.\`${colCodigoPostal}\`, c.\`${colOK_KO}\`
     ORDER BY TotalFacturado DESC LIMIT ${limitAdmin}`,
    adminCliParams
  );
}

async function queryLatestPedidosAdminDashboard(db, {
  tPedidos, colPedNum, colPedFecha, colPedTotal, colPedEstado, pedWhereClause, pedWhereParams, limitAdmin
}) {
  return db.query(
    `SELECT p.ped_id AS Id, p.\`${colPedNum}\` AS NumPedido, p.\`${colPedFecha}\` AS FechaPedido, p.\`${colPedTotal}\` AS TotalPedido, p.\`${colPedEstado}\` AS EstadoPedido
     FROM \`${tPedidos}\` p ${pedWhereClause} ORDER BY p.ped_id DESC LIMIT ${limitAdmin}`,
    pedWhereParams
  );
}

async function queryLatestVisitasAdminDashboard(db, metaVisitas, clientesMeta, comercialesMeta, {
  colNombreRazon, pkClientes, hasDateFilter, dateFrom, dateTo, filters
}) {
  const visWhere = [];
  const visParams = [];
  if (hasDateFilter && metaVisitas.colFecha) {
    visWhere.push(`v.\`${metaVisitas.colFecha}\` >= ? AND v.\`${metaVisitas.colFecha}\` < ? + INTERVAL 1 DAY`);
    visParams.push(dateFrom, dateTo);
  }
  if (filters.comercial) {
    visWhere.push(`v.\`${metaVisitas.colComercial}\` = ?`);
    visParams.push(filters.comercial);
  }
  const visWhereSql = visWhere.length ? `WHERE ${visWhere.join(' AND ')}` : '';
  const tClientesQ = clientesMeta?.tClientes ? `\`${clientesMeta.tClientes}\`` : '`clientes`';
  const tComercialesQ = comercialesMeta?.table ? `\`${comercialesMeta.table}\`` : '`comerciales`';
  return db.query(
    `SELECT v.\`${metaVisitas.pk}\` AS Id, v.\`${metaVisitas.colFecha}\` AS Fecha, v.\`${metaVisitas.colTipo}\` AS TipoVisita, v.\`${metaVisitas.colEstado}\` AS Estado,
      c.\`${colNombreRazon}\` AS ClienteNombre, co.\`${comercialesMeta?.colNombre || 'com_nombre'}\` AS ComercialNombre
     FROM \`${metaVisitas.table}\` v
     LEFT JOIN ${tClientesQ} c ON c.\`${pkClientes}\` = v.\`${metaVisitas.colCliente}\`
     LEFT JOIN ${tComercialesQ} co ON co.\`${comercialesMeta?.pk || 'com_id'}\` = v.\`${metaVisitas.colComercial}\`
     ${visWhereSql} ORDER BY v.\`${metaVisitas.pk}\` DESC LIMIT 10`,
    visParams
  );
}

async function queryMisClientesComercialDashboard(db, metaVisitas, clientesMeta, {
  tClientes, tPedidos, pkClientes, colNombreRazon, colPedTotal, colPedFecha, colPedCliente, colPedComercial,
  userId, hasDateFilter, dateFrom, dateTo, limitComercial
}) {
  return db.query(
    `SELECT c.\`${pkClientes}\` AS Id, c.\`${colNombreRazon}\` AS Nombre_Razon_Social,
      COALESCE(SUM(p.\`${colPedTotal}\`), 0) AS TotalFacturado,
      COUNT(p.ped_id) AS NumPedidos,
      (SELECT MAX(v.\`${metaVisitas?.colFecha}\`) FROM \`${metaVisitas?.table}\` v WHERE v.\`${metaVisitas?.colCliente}\` = c.\`${pkClientes}\` AND v.\`${metaVisitas?.colComercial}\` = ?) AS UltimaVisita,
      MAX(p.\`${colPedFecha}\`) AS UltimoPedido
     FROM \`${tClientes}\` c
     LEFT JOIN \`${tPedidos}\` p ON p.\`${colPedCliente}\` = c.\`${pkClientes}\` AND p.\`${colPedComercial}\` = ? ${hasDateFilter ? `AND p.\`${colPedFecha}\` >= ? AND p.\`${colPedFecha}\` < ? + INTERVAL 1 DAY` : ''}
     WHERE c.\`${clientesMeta?.colComercial || 'cli_com_id'}\` = ?
     GROUP BY c.\`${pkClientes}\`, c.\`${colNombreRazon}\`
     ORDER BY TotalFacturado DESC LIMIT ${limitComercial}`,
    hasDateFilter ? [userId, userId, dateFrom, dateTo, userId] : [userId, userId, userId]
  );
}

async function queryLatestPedidosComercialDashboard(db, {
  tPedidos, tClientes, pkClientes, colPedCliente, colNombreRazon,
  colPedNum, colPedFecha, colPedTotal, colPedEstado, colPedComercial,
  userId, hasDateFilter, dateFrom, dateTo, pedEstadoFilter, pedEstadoParam, limitComercial
}) {
  return db.query(
    `SELECT p.ped_id AS Id, p.\`${colPedNum}\` AS NumPedido, p.\`${colPedFecha}\` AS FechaPedido, p.\`${colPedTotal}\` AS TotalPedido, p.\`${colPedEstado}\` AS EstadoPedido,
      c.\`${colNombreRazon}\` AS ClienteNombre
     FROM \`${tPedidos}\` p LEFT JOIN \`${tClientes}\` c ON c.\`${pkClientes}\` = p.\`${colPedCliente}\`
     WHERE p.\`${colPedComercial}\` = ? ${hasDateFilter ? `AND p.\`${colPedFecha}\` >= ? AND p.\`${colPedFecha}\` < ? + INTERVAL 1 DAY` : ''} ${pedEstadoFilter}
     ORDER BY p.ped_id DESC LIMIT ${limitComercial}`,
    [userId, ...(hasDateFilter ? [dateFrom, dateTo] : []), ...pedEstadoParam]
  );
}

async function queryProximasVisitasComercialDashboard(db, metaVisitas, {
  colNombreRazon, pkClientes, tClientes, userId, hoy
}) {
  return db.query(
    `SELECT v.\`${metaVisitas.pk}\` AS Id, v.\`${metaVisitas.colFecha}\` AS Fecha, v.\`${metaVisitas.colTipo}\` AS TipoVisita, v.\`${metaVisitas.colEstado}\` AS Estado,
      c.\`${colNombreRazon}\` AS ClienteNombre
     FROM \`${metaVisitas.table}\` v
     LEFT JOIN \`${tClientes}\` c ON c.\`${pkClientes}\` = v.\`${metaVisitas.colCliente}\`
     WHERE v.\`${metaVisitas.colComercial}\` = ? AND v.\`${metaVisitas.colFecha}\` >= ?
     ORDER BY v.\`${metaVisitas.colFecha}\` ASC LIMIT 10`,
    [userId, hoy]
  );
}

/** Catálogos marcas + comerciales para vista comercial (filtros). */
async function loadMarcasComercialesParaComercial(db, comercialesMeta) {
  const [marcasList, comercialesList] = await Promise.all([
    db.query('SELECT mar_id AS id, mar_nombre AS nombre FROM marcas ORDER BY mar_nombre').catch((e) => { warn('[dashboard]', e?.message); return []; }),
    db.query(`SELECT \`${comercialesMeta?.pk || 'com_id'}\` AS id, \`${comercialesMeta?.colNombre || 'com_nombre'}\` AS nombre FROM \`${comercialesMeta?.table || 'comerciales'}\` ORDER BY \`${comercialesMeta?.colNombre || 'com_nombre'}\``).catch((e) => { warn('[dashboard]', e?.message); return []; })
  ]);
  return { marcasList: marcasList || [], comercialesList: comercialesList || [] };
}

module.exports = {
  resolveDashboardMeta,
  CCAA_JOIN,
  queryRankingProductos,
  loadDashboardFilterCatalogs,
  queryKpiVentasYPedidos,
  queryKpiNumVisitas,
  queryKpiContactosNuevosHolded,
  queryKpiFarmaciasActivas,
  queryKpiCoberturaCCAA,
  queryKpiClientesActivosComercial,
  queryKpiNumClientesAdmin,
  queryKpiNumComerciales,
  queryDesgloseEstadoPedidos,
  queryRankingZonaPedidos,
  queryRankingComercialesPedidos,
  queryLatestClientesAdminDashboard,
  queryLatestPedidosAdminDashboard,
  queryLatestVisitasAdminDashboard,
  queryMisClientesComercialDashboard,
  queryLatestPedidosComercialDashboard,
  queryProximasVisitasComercialDashboard,
  loadMarcasComercialesParaComercial
};
