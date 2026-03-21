'use strict';

/**
 * Consultas SQL del listado de visitas (rutas HTML).
 * La lógica de filtros (where/params) sigue en la ruta; aquí solo el armado y ejecución.
 */

/**
 * JOINs y columnas del SELECT para listado con cliente/comercial.
 */
function buildVisitasJoinsAndSelects(meta, clientesMeta, comercialesMeta) {
  const tClientes = clientesMeta?.tClientes ? `\`${clientesMeta.tClientes}\`` : '`clientes`';
  const pkClientes = clientesMeta?.pk || 'Id';
  const tComerciales = comercialesMeta?.table ? `\`${comercialesMeta.table}\`` : '`comerciales`';
  const pkComerciales = comercialesMeta?.pk || 'id';

  const colNombreRazon = clientesMeta?.colNombreRazonSocial || 'cli_nombre_razon_social';
  const colComercialNombre = comercialesMeta?.colNombre || 'com_nombre';
  const joinCliente = meta.colCliente ? `LEFT JOIN ${tClientes} c ON v.\`${meta.colCliente}\` = c.\`${pkClientes}\`` : '';
  const joinComercial = meta.colComercial ? `LEFT JOIN ${tComerciales} co ON v.\`${meta.colComercial}\` = co.\`${pkComerciales}\`` : '';
  const selectClienteNombre = meta.colCliente ? `c.\`${colNombreRazon}\` as ClienteNombre` : 'NULL as ClienteNombre';
  const selectClienteRazon = meta.colCliente ? `c.\`${colNombreRazon}\` as ClienteRazonSocial` : 'NULL as ClienteRazonSocial';
  const selectComercialNombre = meta.colComercial ? `co.\`${colComercialNombre}\` as ComercialNombre` : 'NULL as ComercialNombre';

  return {
    joinCliente,
    joinComercial,
    selectClienteNombre,
    selectClienteRazon,
    selectComercialNombre
  };
}

/**
 * SELECT paginado + COUNT para la vista lista de visitas.
 * @param {string[]} whereClauses - fragmentos AND con alias `v.`
 * @returns {{ items: any[], total: number }}
 */
async function queryVisitasListPage(db, meta, clientesMeta, comercialesMeta, whereClauses, params, idFilter, limit, offset) {
  const whereList = [...whereClauses];
  const paramsList = [...params];
  if (idFilter && meta.pk) {
    whereList.push(`v.\`${meta.pk}\` = ?`);
    paramsList.push(idFilter);
  }
  const whereListSql = whereList.length ? `WHERE ${whereList.join(' AND ')}` : '';

  const {
    joinCliente,
    joinComercial,
    selectClienteNombre,
    selectClienteRazon,
    selectComercialNombre
  } = buildVisitasJoinsAndSelects(meta, clientesMeta, comercialesMeta);

  const lim = Math.max(0, Math.min(200, Number(limit) || 10));
  const off = Math.max(0, Number(offset) || 0);

  const sql = `
      SELECT
        v.\`${meta.pk}\` as Id,
        ${meta.colFecha ? `v.\`${meta.colFecha}\` as Fecha,` : 'NULL as Fecha,'}
        ${meta.colHora ? `v.\`${meta.colHora}\` as Hora,` : "'' as Hora,"}
        ${meta.colHoraFinal ? `v.\`${meta.colHoraFinal}\` as HoraFinal,` : "'' as HoraFinal,"}
        ${meta.colTipo ? `v.\`${meta.colTipo}\` as TipoVisita,` : "'' as TipoVisita,"}
        ${meta.colEstado ? `v.\`${meta.colEstado}\` as Estado,` : "'' as Estado,"}
        ${meta.colCliente ? `v.\`${meta.colCliente}\` as ClienteId,` : 'NULL as ClienteId,'}
        ${meta.colComercial ? `v.\`${meta.colComercial}\` as ComercialId,` : 'NULL as ComercialId,'}
        ${selectClienteNombre},
        ${selectClienteRazon},
        ${selectComercialNombre}
      FROM \`${meta.table}\` v
      ${joinCliente}
      ${joinComercial}
      ${whereListSql}
      ORDER BY ${
        meta.colFecha
          ? `v.\`${meta.colFecha}\` DESC, v.\`${meta.pk}\` DESC`
          : 'v.`' + meta.pk + '` DESC'
      }
      LIMIT ${lim} OFFSET ${off}
    `;

  const countSql = `SELECT COUNT(*) as total FROM \`${meta.table}\` v ${whereListSql}`;

  const [items, countRows] = await Promise.all([db.query(sql, paramsList), db.query(countSql, paramsList)]);
  const total = Number(countRows?.[0]?.total ?? 0);
  return { items: items || [], total };
}

/**
 * Total de visitas en el rango [start, end) para la vista calendario (mes).
 */
async function queryVisitasCalendarMonthCount(db, meta, { admin, userId, start, end }) {
  if (!meta?.table || !meta?.colFecha) return 0;
  const whereCal = [];
  const paramsCal = [];
  if (!admin) {
    const uIdNum = Number(userId);
    if (meta.colComercial && Number.isFinite(uIdNum) && uIdNum > 0) {
      whereCal.push(`v.\`${meta.colComercial}\` = ?`);
      paramsCal.push(uIdNum);
    }
  }
  whereCal.push(`v.\`${meta.colFecha}\` >= ? AND v.\`${meta.colFecha}\` < ?`);
  paramsCal.push(start, end);
  const whereCalSql = whereCal.length ? `WHERE ${whereCal.join(' AND ')}` : '';
  const rows = await db.query(`SELECT COUNT(*) as total FROM \`${meta.table}\` v ${whereCalSql}`, paramsCal);
  return Number(rows?.[0]?.total ?? 0);
}

module.exports = {
  buildVisitasJoinsAndSelects,
  queryVisitasListPage,
  queryVisitasCalendarMonthCount
};
