/**
 * Filtros de pedidos alineados con la lista de pedidos (tokens + texto libre + marca)
 * para el dashboard. Construye WHERE + JOINs opcionales.
 */

const { warn } = require('./logger');
const {
  tokenizeSmartQuery,
  buildPedidosTokenClauses,
  buildPedidosTermClauses
} = require('./pedido-helpers');

/**
 * @param {import('../config/mysql-crm')} db
 * @param {object} opt
 * @returns {Promise<{ where: string[], params: any[], joinsNoZone: string, joinsWithZone: string }>}
 */
async function buildDashboardPedidoSmartWhere(db, opt) {
  const {
    admin,
    filters,
    userId,
    hasUserId,
    hasDateFilter,
    dateFrom,
    dateTo,
    colPedFecha,
    colPedComercial,
    colPedCliente,
    colEstadoId,
    selectedEstadoId,
    pedidosMeta,
    clientesMeta,
    tPedidos,
    tClientes,
    pkClientes,
    pedidosCols,
    comercialesMeta,
    rawQ,
    filtersMarca
  } = opt;

  const where = [];
  const params = [];

  if (admin && filters.comercial) {
    where.push(`p.\`${colPedComercial}\` = ?`);
    params.push(filters.comercial);
  } else if (!admin && hasUserId) {
    where.push(`p.\`${colPedComercial}\` = ?`);
    params.push(userId);
  }
  if (hasDateFilter && colPedFecha) {
    where.push(`p.\`${colPedFecha}\` >= ? AND p.\`${colPedFecha}\` < ? + INTERVAL 1 DAY`);
    params.push(dateFrom, dateTo);
  }
  if (selectedEstadoId && colEstadoId) {
    where.push(`p.\`${colEstadoId}\` = ?`);
    params.push(selectedEstadoId);
  }

  const pedidosPk = pedidosMeta?.pk || 'ped_id';
  const paMeta = await db._ensurePedidosArticulosMeta().catch(() => null);
  const tPA = paMeta?.table || 'pedidos_articulos';
  const colPaPedId = paMeta?.colPedidoId || 'pedart_ped_id';
  const colPaArtId = paMeta?.colArticulo || 'pedart_art_id';

  if (filtersMarca) {
    where.push(
      `EXISTS (SELECT 1 FROM \`${tPA}\` pa_m INNER JOIN articulos a_m ON a_m.art_id = pa_m.\`${colPaArtId}\` WHERE pa_m.\`${colPaPedId}\` = p.\`${pedidosPk}\` AND a_m.art_mar_id = ?)`
    );
    params.push(Number(filtersMarca));
  }

  const qStr = String(rawQ || '').trim();
  if (!qStr) {
    return { where, params, joinsNoZone: '', joinsWithZone: '' };
  }

  const pedidosColsLower = new Map((pedidosCols || []).map((c) => [String(c).toLowerCase(), c]));
  const pickPedidoCol = (cands) => {
    for (const c of cands || []) {
      const real = pedidosColsLower.get(String(c).toLowerCase());
      if (real) return real;
    }
    return null;
  };

  const colNumPedido = pedidosMeta?.colNumPedido || pickPedidoCol(['NumPedido', 'ped_numero', 'Numero_Pedido']) || 'ped_numero';
  const colNumPedidoCliente = pickPedidoCol(['NumPedidoCliente', 'Num_Pedido_Cliente', 'ped_num_pedido_cliente']);
  const colNumAsociadoHefame = pickPedidoCol(['NumAsociadoHefame', 'num_asociado_hefame']);
  const colEstadoTxt = pedidosMeta?.colEstado || pickPedidoCol(['ped_estado_txt', 'EstadoPedido', 'Estado']) || 'ped_estado_txt';
  const colTotal = pickPedidoCol(['ped_total', 'TotalPedido', 'Total', 'ImporteTotal']);
  const colEspecial = pickPedidoCol(['EsEspecial', 'es_especial', 'especial']);
  const colEspecialEstado = pickPedidoCol(['EspecialEstado', 'especial_estado']);

  const tClientesName = tClientes || 'clientes';
  const clientesCols = await db._getColumns(tClientesName).catch(() => []);
  const clientesColsLower = new Map((clientesCols || []).map((c) => [String(c).toLowerCase(), c]));
  const pickClienteCol = (cands) => {
    for (const c of cands || []) {
      const real = clientesColsLower.get(String(c).toLowerCase());
      if (real) return real;
    }
    return null;
  };

  const cColNombre = pickClienteCol(['cli_nombre_razon_social', 'Nombre_Razon_Social', 'Nombre', 'nombre']);
  const cColNombreCial = pickClienteCol(['cli_nombre_cial', 'Nombre_Cial', 'nombre_cial']);
  const cColDniCif = pickClienteCol(['cli_dni_cif', 'DNI_CIF', 'DniCif', 'dni_cif', 'CIF', 'cif']);
  const cColEmail = pickClienteCol(['cli_email', 'Email', 'email']);
  const cColTelefono = pickClienteCol(['cli_telefono', 'Telefono', 'telefono', 'Movil', 'movil']);
  const cColPoblacion = pickClienteCol(['cli_poblacion', 'Poblacion', 'poblacion', 'Localidad', 'localidad']);
  const cColProvinciaId = pickClienteCol(['cli_prov_id', 'Id_Provincia', 'id_provincia', 'ProvinciaId', 'provincia_id']);
  const cColTipoClienteId = pickClienteCol(['cli_tipc_id', 'Id_TipoCliente', 'id_tipocliente', 'TipoClienteId', 'tipo_cliente_id']);

  let hasEstadoIdCol = false;
  try {
    const cols = await db._getColumns(pedidosMeta?.tPedidos || 'pedidos').catch(() => []);
    hasEstadoIdCol = (cols || []).some((c) => String(c).toLowerCase() === String(colEstadoId).toLowerCase());
  } catch (_) {
    hasEstadoIdCol = false;
  }

  const tProvincias = cColProvinciaId ? await db._resolveTableNameCaseInsensitive('provincias').catch(() => null) : null;
  const joinProvincia = Boolean(tProvincias && cColProvinciaId);
  const tTiposClientes = cColTipoClienteId ? await db._resolveTableNameCaseInsensitive('tipos_clientes').catch(() => null) : null;
  const joinTipoCliente = Boolean(tTiposClientes && cColTipoClienteId);
  const tComerciales = await db._resolveTableNameCaseInsensitive('comerciales').catch(() => null);
  const joinComerciales = Boolean(tComerciales && colPedComercial);
  const comPk = comercialesMeta?.pk || 'com_id';

  const smartQ = tokenizeSmartQuery(qStr);

  const tokenClauses = buildPedidosTokenClauses(smartQ, {
    colFecha: colPedFecha,
    colComercial: colPedComercial,
    colNumPedido,
    colNumPedidoCliente,
    colNumAsociadoHefame,
    colEstadoTxt,
    colEstadoId,
    colEspecial,
    colEspecialEstado,
    colTotal,
    cColNombre,
    cColNombreCial,
    cColDniCif,
    cColPoblacion,
    cColProvinciaId,
    cColTipoClienteId,
    joinProvincia,
    joinComerciales,
    joinTipoCliente,
    hasEstadoIdCol,
    pedidosPk,
    params
  });

  let termClauses = [];
  try {
    termClauses = await buildPedidosTermClauses(db, {
      smartQ,
      colNumPedido,
      colNumPedidoCliente,
      colNumAsociadoHefame,
      colEstadoTxt,
      cColNombre,
      cColNombreCial,
      cColDniCif,
      cColEmail,
      cColTelefono,
      cColPoblacion,
      joinProvincia,
      joinComerciales,
      joinTipoCliente,
      hasEstadoIdCol,
      tClientes: tClientesName,
      tPedidos,
      params
    });
  } catch (e) {
    warn('[dashboard-pedido-filters] termClauses', e?.message);
    termClauses = [];
  }

  for (const tc of tokenClauses) where.push(tc);
  for (const tc of termClauses) where.push(tc);

  const joinPartsNoZone = [];
  joinPartsNoZone.push(
    `LEFT JOIN \`${tClientesName}\` c ON c.\`${pkClientes}\` = p.\`${colPedCliente}\``
  );
  if (joinProvincia && tProvincias && cColProvinciaId) {
    joinPartsNoZone.push(`LEFT JOIN \`${tProvincias}\` pr ON c.\`${cColProvinciaId}\` = pr.prov_id`);
  }
  if (joinTipoCliente && tTiposClientes && cColTipoClienteId) {
    joinPartsNoZone.push(`LEFT JOIN \`${tTiposClientes}\` tc ON c.\`${cColTipoClienteId}\` = tc.tipc_id`);
  }
  if (joinComerciales && tComerciales) {
    joinPartsNoZone.push(`LEFT JOIN \`${tComerciales}\` co ON p.\`${colPedComercial}\` = co.\`${comPk}\``);
  }
  if (hasEstadoIdCol && colEstadoId) {
    joinPartsNoZone.push(`LEFT JOIN estados_pedido ep ON ep.estped_id = p.\`${colEstadoId}\``);
  }

  const joinsNoZone = joinPartsNoZone.length ? `\n${joinPartsNoZone.join('\n')}` : '';

  const joinPartsWithZone = [];
  if (joinProvincia && tProvincias && cColProvinciaId) {
    joinPartsWithZone.push(`LEFT JOIN \`${tProvincias}\` pr ON c.\`${cColProvinciaId}\` = pr.prov_id`);
  }
  if (joinTipoCliente && tTiposClientes && cColTipoClienteId) {
    joinPartsWithZone.push(`LEFT JOIN \`${tTiposClientes}\` tc ON c.\`${cColTipoClienteId}\` = tc.tipc_id`);
  }
  if (joinComerciales && tComerciales) {
    joinPartsWithZone.push(`LEFT JOIN \`${tComerciales}\` co ON p.\`${colPedComercial}\` = co.\`${comPk}\``);
  }
  if (hasEstadoIdCol && colEstadoId) {
    joinPartsWithZone.push(`LEFT JOIN estados_pedido ep ON ep.estped_id = p.\`${colEstadoId}\``);
  }
  const joinsWithZone = joinPartsWithZone.length ? `\n${joinPartsWithZone.join('\n')}` : '';

  return { where, params, joinsNoZone, joinsWithZone };
}

module.exports = { buildDashboardPedidoSmartWhere };
