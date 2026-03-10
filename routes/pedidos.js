/**
 * Rutas HTML de pedidos (CRUD, Excel, Hefame, N8N).
 */

const express = require('express');
const db = require('../config/mysql-crm');
const {
  _n,
  renderErrorPage,
  requireAdmin
} = require('../lib/app-helpers');
const {
  isAdminUser,
  requireLogin,
  createLoadPedidoAndCheckOwner
} = require('../lib/auth');
const { parsePagination } = require('../lib/pagination');
const { sendPedidoEmail, sendTransferExcelEmail, getSmtpStatus, getGraphStatus, APP_BASE_URL } = require('../lib/mailer');
const { escapeHtml: escapeHtmlUtil } = require('../lib/utils');
const { loadMarcasForSelect } = require('../lib/articulo-helpers');
const { SYSVAR_PEDIDOS_MAIL_TO } = require('../lib/admin-helpers');
const {
  tokenizeSmartQuery,
  parseLineasFromBody,
  canShowHefameForPedido,
  isTransferPedido,
  resolveMayoristaInfo,
  renderHefameInfoPage,
  buildStandardPedidoXlsxBuffer,
  buildHefameXlsxBuffer,
  buildPedidosTokenClauses,
  buildPedidosTermClauses
} = require('../lib/pedido-helpers');

const router = express.Router();
const loadPedidoAndCheckOwner = createLoadPedidoAndCheckOwner('id');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function ensureTransferTarifaYFormaPago(payload, body, tarifas, formasPago, tiposPedido) {
  const idTipo = Number(body.Id_TipoPedido) || 0;
  if (!idTipo) return payload;
  const tipo = (tiposPedido || []).find((t) => Number(_n(t.tipp_id, _n(t.id, t.Id))) === idTipo);
  const tipoNombre = String(_n(tipo && (tipo.tipp_tipo || tipo.Nombre || tipo.Tipo || tipo.nombre), '')).trim();
  if (!/transfer/i.test(tipoNombre)) return payload;
  const getTarifaNombre = (t) => String(_n(t.tarcli_nombre, _n(t.NombreTarifa, _n(t.Nombre, t.nombre))));
  const getFormaPagoNombre = (fp) => String(_n(fp.formp_nombre, _n(fp.Nombre, _n(fp.FormaPago, fp.nombre))));
  const tarTransfer = (tarifas || []).find((t) => /transfer/i.test(getTarifaNombre(t)));
  const fpTransfer = (formasPago || []).find((fp) => /transfer/i.test(getFormaPagoNombre(fp)));
  const out = { ...payload };
  if (tarTransfer) out.Id_Tarifa = Number(_n(tarTransfer.tarcli_id, _n(tarTransfer.Id, tarTransfer.id))) || 0;
  if (fpTransfer) out.Id_FormaPago = Number(_n(fpTransfer.formp_id, _n(fpTransfer.id, fpTransfer.Id))) || 0;
  return out;
}

router.get('/', requireLogin, async (req, res, next) => {
  try {
    

    const admin = isAdminUser(res.locals.user);
    const userId = Number(res.locals.user?.id);
    const scopeUserId = !admin && Number.isFinite(userId) && userId > 0 ? userId : null;

    // Resolver columnas reales de pedidos (evita errores tipo "Unknown column p.ComercialId")
    const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
    const tPedidos = pedidosMeta?.tPedidos || 'pedidos';
    const colFecha = pedidosMeta?.colFecha || 'FechaPedido';
    const colComercial = pedidosMeta?.colComercial || 'Id_Cial';
    const colEstadoTxt = pedidosMeta?.colEstado || 'EstadoPedido';
    const colEstadoId = pedidosMeta?.colEstadoId || 'Id_EstadoPedido';
    const colNumPedido = pedidosMeta?.colNumPedido || 'NumPedido';

    // Best-effort: columnas extra en pedidos para buscar/filtrar
    const pedidosCols = await db._getColumns(tPedidos).catch(() => []);
    const pedidosColsLower = new Map((pedidosCols || []).map((c) => [String(c).toLowerCase(), c]));
    const pickPedidoCol = (cands) => {
      for (const c of (cands || [])) {
        const real = pedidosColsLower.get(String(c).toLowerCase());
        if (real) return real;
      }
      return null;
    };
    const colNumPedidoCliente = pickPedidoCol(['NumPedidoCliente', 'Num_Pedido_Cliente', 'num_pedido_cliente']);
    const colNumAsociadoHefame = pickPedidoCol(['NumAsociadoHefame', 'num_asociado_hefame']);
    const colTotal = pickPedidoCol(['ped_total', 'TotalPedido', 'Total', 'ImporteTotal', 'total_pedido', 'importe_total']);
    const colEspecial = pickPedidoCol(['EsEspecial', 'es_especial', 'especial']);
    const colEspecialEstado = pickPedidoCol(['EspecialEstado', 'especial_estado']);

    // Meta clientes para joins/filtros (provincia/tipo cliente)
    const clientesMeta = await db._ensureClientesMeta().catch(() => null);
    const tClientes = clientesMeta?.tClientes || 'clientes';
    const clientesCols = Array.isArray(clientesMeta?.cols) ? clientesMeta.cols : (await db._getColumns(tClientes).catch(() => []));
    const clientesColsLower = new Map((clientesCols || []).map((c) => [String(c).toLowerCase(), c]));
    const pickClienteCol = (cands) => {
      for (const c of (cands || [])) {
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

    // Estado catálogo (best-effort)
    let hasEstadoIdCol = false;
    try {
      const cols = await db._getColumns(pedidosMeta?.tPedidos || 'pedidos').catch(() => []);
      hasEstadoIdCol = (cols || []).some((c) => String(c).toLowerCase() === String(colEstadoId).toLowerCase());
    } catch (_) {}

    const startYear = 2025;
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = currentYear; y >= startYear; y--) years.push(y);

    const rawYear = String(req.query.year || '').trim();
    const parsedYear = rawYear && /^\d{4}$/.test(rawYear) ? Number(rawYear) : NaN;
    const selectedYear =
      Number.isFinite(parsedYear) && parsedYear >= startYear && parsedYear <= currentYear ? parsedYear : currentYear;

    const rawMarca = String(req.query.marca || req.query.brand || '').trim();
    const parsedMarca = rawMarca && /^\d+$/.test(rawMarca) ? Number(rawMarca) : NaN;
    const selectedMarcaId = Number.isFinite(parsedMarca) && parsedMarca > 0 ? parsedMarca : null;

    const marcas = await loadMarcasForSelect(db);

    const rawQ = String(req.query.q || req.query.search || '').trim();
    const smartQ = tokenizeSmartQuery(rawQ);

    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 200 });

    // Joins opcionales para filtros "inteligentes"
    const tProvincias = cColProvinciaId ? await db._resolveTableNameCaseInsensitive('provincias').catch(() => null) : null;
    const joinProvincia = Boolean(tProvincias && cColProvinciaId);
    const tTiposClientes = cColTipoClienteId ? await db._resolveTableNameCaseInsensitive('tipos_clientes').catch(() => null) : null;
    const joinTipoCliente = Boolean(tTiposClientes && cColTipoClienteId);
    const tComerciales = await db._resolveTableNameCaseInsensitive('comerciales').catch(() => null);
    const joinComerciales = Boolean(tComerciales && colComercial);

    // Filtrar por año (y opcionalmente marca) usando FechaPedido (datetime)
    let items = [];
    let totalPedidos = 0;
    let colPaPedidoId = null;
    let colPaArticulo = null;
    let colArtPk = null;
    let colArtMarca = null;
    if (selectedMarcaId) {
      const paMeta = await db._ensurePedidosArticulosMeta().catch(() => null);
      const tArt = await db._resolveTableNameCaseInsensitive('articulos').catch(() => null);
      const paCols = paMeta ? (await db._getColumns(paMeta.table).catch(() => [])) : [];
      const artCols = tArt ? (await db._getColumns(tArt).catch(() => [])) : [];
      const paColsLower = new Map((paCols || []).map((c) => [String(c).toLowerCase(), c]));
      const artColsLower = new Map((artCols || []).map((c) => [String(c).toLowerCase(), c]));
      const pickPa = (cands) => { for (const c of (cands || [])) { const r = paColsLower.get(String(c).toLowerCase()); if (r) return r; } return null; };
      const pickArt = (cands) => { for (const c of (cands || [])) { const r = artColsLower.get(String(c).toLowerCase()); if (r) return r; } return null; };
      colPaPedidoId = paMeta?.colPedidoId || pickPa(['pedart_ped_id', 'Id_NumPedido', 'id_numpedido']) || 'pedart_ped_id';
      colPaArticulo = paMeta?.colArticulo || pickPa(['pedart_art_id', 'Id_Articulo', 'id_articulo']) || 'pedart_art_id';
      colArtPk = pickArt(['art_id', 'id', 'Id']) || 'art_id';
      colArtMarca = pickArt(['art_mar_id', 'Id_Marca', 'id_marca']) || 'art_mar_id';

      const where = [];
      const params = [];
      where.push(`YEAR(p.\`${colFecha}\`) = ?`);
      params.push(selectedYear);
      where.push(`a.\`${colArtMarca}\` = ?`);
      params.push(selectedMarcaId);
      if (scopeUserId) {
        where.push(`p.\`${colComercial}\` = ?`);
        params.push(scopeUserId);
      }

      const tokenClauses = buildPedidosTokenClauses(smartQ, {
        colFecha,
        colComercial,
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
        pedidosPk: pedidosMeta?.pk || 'ped_id',
        params
      });

      // Texto libre: FULLTEXT (MATCH...AGAINST) cuando hay índices, si no LIKE
      const termClauses = await buildPedidosTermClauses(db, {
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
        tClientes,
        tPedidos,
        params
      });

      if (tokenClauses.length) where.push(tokenClauses.join(' AND '));
      if (termClauses.length) where.push(termClauses.join(' AND '));

      const sql = `
        SELECT DISTINCT p.*,
          p.\`${colFecha}\` AS FechaPedido,
          p.\`${colNumPedido}\` AS NumPedido,
          ${hasEstadoIdCol ? 'ep.estped_nombre AS EstadoPedidoNombre, ep.estped_color AS EstadoColor,' : 'NULL AS EstadoPedidoNombre, NULL AS EstadoColor,'}
          ${cColNombre ? `c.\`${cColNombre}\` AS ClienteNombre,` : 'NULL AS ClienteNombre,'}
          ${cColNombreCial ? `c.\`${cColNombreCial}\` AS ClienteNombreCial,` : 'NULL AS ClienteNombreCial,'}
          ${joinProvincia ? 'pr.prov_nombre AS ProvinciaNombre,' : 'NULL AS ProvinciaNombre,'}
          ${joinTipoCliente ? 'tc.tipc_tipo AS TipoClienteNombre,' : 'NULL AS TipoClienteNombre,'}
          ${joinComerciales ? 'co.com_nombre AS ComercialNombre,' : 'NULL AS ComercialNombre,'}
          ${joinComerciales ? 'co.com_email AS ComercialEmail' : 'NULL AS ComercialEmail'}
        FROM \`${tPedidos}\` p
        LEFT JOIN \`${tClientes}\` c ON (c.\`${clientesMeta?.pk || 'cli_id'}\` = p.\`${pedidosMeta?.colCliente || 'ped_cli_id'}\`)
        ${joinProvincia ? `LEFT JOIN \`${tProvincias}\` pr ON c.\`${cColProvinciaId}\` = pr.prov_id` : ''}
        ${joinTipoCliente ? `LEFT JOIN \`${tTiposClientes}\` tc ON c.\`${cColTipoClienteId}\` = tc.tipc_id` : ''}
        ${joinComerciales ? `LEFT JOIN \`${tComerciales}\` co ON p.\`${colComercial}\` = co.com_id` : ''}
        ${hasEstadoIdCol ? `LEFT JOIN estados_pedido ep ON ep.estped_id = p.\`${colEstadoId}\`` : ''}
        INNER JOIN pedidos_articulos pa ON pa.\`${colPaPedidoId || 'pedart_ped_id'}\` = p.\`${pedidosMeta?.pk || 'ped_id'}\`
        INNER JOIN articulos a ON a.\`${colArtPk || 'art_id'}\` = pa.\`${colPaArticulo || 'pedart_art_id'}\`
        WHERE ${where.join('\n          AND ')}
        ORDER BY p.\`${pedidosMeta?.pk || 'ped_id'}\` DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const countSql = `
        SELECT COUNT(DISTINCT p.\`${pedidosMeta?.pk || 'ped_id'}\`) as total
        FROM \`${tPedidos}\` p
        LEFT JOIN \`${tClientes}\` c ON (c.\`${clientesMeta?.pk || 'cli_id'}\` = p.\`${pedidosMeta?.colCliente || 'ped_cli_id'}\`)
        ${joinProvincia ? `LEFT JOIN \`${tProvincias}\` pr ON c.\`${cColProvinciaId}\` = pr.prov_id` : ''}
        ${joinTipoCliente ? `LEFT JOIN \`${tTiposClientes}\` tc ON c.\`${cColTipoClienteId}\` = tc.tipc_id` : ''}
        ${joinComerciales ? `LEFT JOIN \`${tComerciales}\` co ON p.\`${colComercial}\` = co.com_id` : ''}
        ${hasEstadoIdCol ? `LEFT JOIN estados_pedido ep ON ep.estped_id = p.\`${colEstadoId}\`` : ''}
        INNER JOIN pedidos_articulos pa ON pa.\`${colPaPedidoId || 'pedart_ped_id'}\` = p.\`${pedidosMeta?.pk || 'ped_id'}\`
        INNER JOIN articulos a ON a.\`${colArtPk || 'art_id'}\` = pa.\`${colPaArticulo || 'pedart_art_id'}\`
        WHERE ${where.join('\n          AND ')}
      `;
      const [itemsRaw, countRows] = await Promise.all([db.query(sql, params), db.query(countSql, params)]);
      items = itemsRaw;
      totalPedidos = Number(_n(countRows && countRows[0] && countRows[0].total, 0));
    } else {
      const where = [];
      const params = [];
      where.push(`YEAR(p.\`${colFecha}\`) = ?`);
      params.push(selectedYear);
      if (scopeUserId) {
        where.push(`p.\`${colComercial}\` = ?`);
        params.push(scopeUserId);
      }

      const tokenClauses = buildPedidosTokenClauses(smartQ, {
        colFecha,
        colComercial,
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
        pedidosPk: pedidosMeta?.pk || 'ped_id',
        params
      });

      const termClauses = await buildPedidosTermClauses(db, {
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
        tClientes,
        tPedidos,
        params
      });

      if (tokenClauses.length) where.push(tokenClauses.join(' AND '));
      if (termClauses.length) where.push(termClauses.join(' AND '));

      const sql = `
        SELECT p.*,
          p.\`${colFecha}\` AS FechaPedido,
          p.\`${colNumPedido}\` AS NumPedido,
          ${hasEstadoIdCol ? 'ep.estped_nombre AS EstadoPedidoNombre, ep.estped_color AS EstadoColor,' : 'NULL AS EstadoPedidoNombre, NULL AS EstadoColor,'}
          ${cColNombre ? `c.\`${cColNombre}\` AS ClienteNombre,` : 'NULL AS ClienteNombre,'}
          ${cColNombreCial ? `c.\`${cColNombreCial}\` AS ClienteNombreCial,` : 'NULL AS ClienteNombreCial,'}
          ${joinProvincia ? 'pr.prov_nombre AS ProvinciaNombre,' : 'NULL AS ProvinciaNombre,'}
          ${joinTipoCliente ? 'tc.tipc_tipo AS TipoClienteNombre,' : 'NULL AS TipoClienteNombre,'}
          ${joinComerciales ? 'co.com_nombre AS ComercialNombre,' : 'NULL AS ComercialNombre,'}
          ${joinComerciales ? 'co.com_email AS ComercialEmail' : 'NULL AS ComercialEmail'}
        FROM \`${tPedidos}\` p
        LEFT JOIN \`${tClientes}\` c ON (c.\`${clientesMeta?.pk || 'cli_id'}\` = p.\`${pedidosMeta?.colCliente || 'ped_cli_id'}\`)
        ${joinProvincia ? `LEFT JOIN \`${tProvincias}\` pr ON c.\`${cColProvinciaId}\` = pr.prov_id` : ''}
        ${joinTipoCliente ? `LEFT JOIN \`${tTiposClientes}\` tc ON c.\`${cColTipoClienteId}\` = tc.tipc_id` : ''}
        ${joinComerciales ? `LEFT JOIN \`${tComerciales}\` co ON p.\`${colComercial}\` = co.com_id` : ''}
        ${hasEstadoIdCol ? `LEFT JOIN estados_pedido ep ON ep.estped_id = p.\`${colEstadoId}\`` : ''}
        WHERE ${where.join('\n          AND ')}
        ORDER BY p.\`${pedidosMeta?.pk || 'ped_id'}\` DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const countSql = `
        SELECT COUNT(*) as total
        FROM \`${tPedidos}\` p
        LEFT JOIN \`${tClientes}\` c ON (c.\`${clientesMeta?.pk || 'cli_id'}\` = p.\`${pedidosMeta?.colCliente || 'ped_cli_id'}\`)
        ${joinProvincia ? `LEFT JOIN \`${tProvincias}\` pr ON c.\`${cColProvinciaId}\` = pr.prov_id` : ''}
        ${joinTipoCliente ? `LEFT JOIN \`${tTiposClientes}\` tc ON c.\`${cColTipoClienteId}\` = tc.tipc_id` : ''}
        ${joinComerciales ? `LEFT JOIN \`${tComerciales}\` co ON p.\`${colComercial}\` = co.com_id` : ''}
        ${hasEstadoIdCol ? `LEFT JOIN estados_pedido ep ON ep.estped_id = p.\`${colEstadoId}\`` : ''}
        WHERE ${where.join('\n          AND ')}
      `;
      const [itemsRaw, countRows] = await Promise.all([db.query(sql, params), db.query(countSql, params)]);
      items = itemsRaw;
      totalPedidos = Number(_n(countRows && countRows[0] && countRows[0].total, 0));
    }

    const n8nFlag = String(req.query.n8n || '').trim().toLowerCase();
    const n8nPid = String(req.query.pid || '').trim();
    const n8nFile = String(req.query.file || '').trim();
    const n8nMsg = String(req.query.msg || '').trim();
    const n8nNotice =
      n8nFlag === 'ok'
        ? {
            ok: true,
            pid: n8nPid || null,
            file: n8nFile || null,
            message: `Pedido${n8nPid ? ` ${n8nPid}` : ''} enviado correctamente${n8nFile ? `.\nExcel: ${n8nFile}` : '.'}${n8nMsg ? `\n${n8nMsg}` : ''}`
          }
        : n8nFlag === 'err'
          ? {
              ok: false,
              pid: n8nPid || null,
              message: `No se pudo enviar el pedido${n8nPid ? ` ${n8nPid}` : ''} a N8N.${n8nMsg ? `\n${n8nMsg}` : ''}`
            }
          : null;

    // Estados de pedido (solo admin) para UI de cambio de estado en listado
    let estadosPedido = [];
    if (admin) {
      await db.ensureEstadosPedidoTable().catch(() => null);
      estadosPedido = await db.getEstadosPedidoActivos().catch(() => []);
    }

    const sessionUser = res.locals.user;
    const sessionUserId = sessionUser?.id != null ? Number(sessionUser.id) : null;
    res.render('pedidos', {
      items: items || [],
      years,
      selectedYear,
      marcas: Array.isArray(marcas) ? marcas : [],
      selectedMarcaId,
      q: rawQ,
      admin,
      userId: sessionUserId,
      user: sessionUser,
      n8nNotice,
      estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
      paging: { page, limit, total: totalPedidos }
    });
  } catch (e) {
    next(e);
  }
});

// Admin: cambiar estado del pedido desde el listado (/pedidos)
router.post('/:id(\\d+)/estado', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'ID no válido' });

    const estadoIdRaw = _n(_n(_n(_n(req.body && req.body.estadoId, req.body && req.body.estado_id), req.body && req.body.Id_EstadoPedido), req.body && req.body.id_estado_pedido), null);
    const estadoId = Number(estadoIdRaw);
    if (!Number.isFinite(estadoId) || estadoId <= 0) {
      return res.status(400).json({ ok: false, error: 'Estado no válido' });
    }

    await db.ensureEstadosPedidoTable().catch(() => null);
    const estado = await db.getEstadoPedidoById(estadoId).catch(() => null);
    if (!estado) return res.status(404).json({ ok: false, error: 'Estado no encontrado' });

    const nombre = String(_n(_n(estado && estado.nombre, estado && estado.Nombre), '')).trim();
    const color = String(_n(_n(estado && estado.color, estado && estado.Color), 'info')).trim().toLowerCase() || 'info';

    // Best-effort: actualizar Id_EstadoPedido si existe y mantener texto legacy si existe.
    await db.updatePedido(id, { Id_EstadoPedido: estadoId, EstadoPedido: nombre || undefined }).catch((e) => {
      throw e;
    });

    return res.json({ ok: true, id, estado: { id: estadoId, nombre: nombre || '—', color } });
  } catch (e) {
    next(e);
  }
});

router.get('/new', requireLogin, async (_req, res, next) => {
  try {
    const [comerciales, tarifas, formasPago, tiposPedido, descuentosPedido, estadosPedido, estadoPendienteId] = await Promise.all([
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => []),
      db.getTiposPedido().catch(() => []),
      db.getDescuentosPedidoActivos().catch(() => []),
      db.getEstadosPedidoActivos().catch(() => []),
      db.getEstadoPedidoIdByCodigo('pendiente').catch(() => null)
    ]);
    const tarifaTransfer = await db.ensureTarifaTransfer().catch(() => null);
    if (tarifaTransfer && _n(tarifaTransfer.tarcli_id, tarifaTransfer.Id, tarifaTransfer.id) != null && !(tarifas || []).some((t) => Number(_n(t.tarcli_id, t.Id, t.id)) === Number(_n(tarifaTransfer.tarcli_id, tarifaTransfer.Id, tarifaTransfer.id)))) tarifas.push(tarifaTransfer);
    const formaPagoTransfer = await db.ensureFormaPagoTransfer().catch(() => null);
    if (formaPagoTransfer && _n(formaPagoTransfer.id, formaPagoTransfer.Id) != null && !(formasPago || []).some((f) => Number(_n(f.id, f.Id)) === Number(_n(formaPagoTransfer.id, formaPagoTransfer.Id)))) formasPago.push(formaPagoTransfer);
    // Nota: artículos puede ser grande; lo usamos para selector simple (mejorable con búsqueda más adelante).
    const articulos = await db.getArticulos({}).catch(() => []);
    const admin = isAdminUser(res.locals.user);
    // Lista reciente: solo asignados (pool solo al buscar en Contactos)
    const clientesFilters = { comercial: res.locals.user?.id };
    const clientesRecent = await db
      .getClientesOptimizadoPaged(clientesFilters, { limit: 10, offset: 0, compact: true, order: 'desc' })
      .catch(() => []);
    res.render('pedido-form', {
      mode: 'create',
      admin,
      comerciales: Array.isArray(comerciales) ? comerciales : [],
      tarifas: Array.isArray(tarifas) ? tarifas : [],
      formasPago: Array.isArray(formasPago) ? formasPago : [],
      tiposPedido: Array.isArray(tiposPedido) ? tiposPedido : [],
      descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
      estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
      articulos: Array.isArray(articulos) ? articulos : [],
      item: {
        Id_Cial: _n(res.locals.user && res.locals.user.id, null),
        Id_Tarifa: 0,
        Serie: 'P',
        EstadoPedido: 'Pendiente',
        Id_EstadoPedido: _n(estadoPendienteId, null),
        Id_FormaPago: null,
        Id_TipoPedido: null,
        Observaciones: ''
      },
      lineas: [{ Id_Articulo: '', Cantidad: 1, Dto: '' }],
      clientes: Array.isArray(clientesRecent) ? clientesRecent : [],
      // En creación siempre editable; permite cargar defaults (tarifa/direcciones) al seleccionar cliente.
      canEdit: true,
      error: null
    });
  } catch (e) {
    next(e);
  }
});

router.post('/new', requireLogin, async (req, res, next) => {
  try {
    const [comerciales, tarifas, formasPago, tiposPedido, descuentosPedido, estadosPedido] = await Promise.all([
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => []),
      db.getTiposPedido().catch(() => []),
      db.getDescuentosPedidoActivos().catch(() => []),
      db.getEstadosPedidoActivos().catch(() => [])
    ]);
    const articulos = await db.getArticulos({}).catch(() => []);
    const body = req.body || {};
    const admin = isAdminUser(res.locals.user);
    const clientesFilters = { comercial: res.locals.user?.id };
    const esEspecial = body.EsEspecial === '1' || body.EsEspecial === 1 || body.EsEspecial === true || String(body.EsEspecial || '').toLowerCase() === 'on';
    const tarifaIn = Number(body.Id_Tarifa);
    const tarifaId = Number.isFinite(tarifaIn) ? tarifaIn : NaN;
    const pedidoPayload = {
      Id_Cial: admin ? (Number(body.Id_Cial) || 0) : (Number(res.locals.user?.id) || 0),
      Id_Cliente: Number(body.Id_Cliente) || 0,
      Id_DireccionEnvio: body.Id_DireccionEnvio ? (Number(body.Id_DireccionEnvio) || null) : null,
      Id_FormaPago: body.Id_FormaPago ? (Number(body.Id_FormaPago) || 0) : 0,
      Id_TipoPedido: body.Id_TipoPedido ? (Number(body.Id_TipoPedido) || 0) : 0,
      Id_EstadoPedido: body.Id_EstadoPedido ? (Number(body.Id_EstadoPedido) || null) : null,
      // Importante: si viene 0 (default de UI), omitimos para que DB aplique tarifa del cliente.
      ...(Number.isFinite(tarifaId) && tarifaId > 0 ? { Id_Tarifa: tarifaId } : {}),
      // Serie fija para pedidos en este CRM
      Serie: 'P',
      // Pedido especial: descuentos manuales (no aplicar tabla descuentos_pedido)
      ...(esEspecial ? { EsEspecial: 1, EspecialEstado: 'pendiente', EspecialFechaSolicitud: new Date() } : { EsEspecial: 0 }),
      ...(esEspecial ? { Dto: Number(String(body.Dto || '').replace(',', '.')) || 0 } : {}),
      NumPedidoCliente: String(body.NumPedidoCliente || '').trim() || null,
      NumAsociadoHefame: body.NumAsociadoHefame != null ? String(body.NumAsociadoHefame).trim() || null : undefined,
      FechaPedido: body.FechaPedido ? String(body.FechaPedido).slice(0, 10) : undefined,
      FechaEntrega: body.FechaEntrega ? String(body.FechaEntrega).slice(0, 10) : null,
      // Legacy: mantener también el texto para instalaciones sin FK/columna
      EstadoPedido: String(body.EstadoPedido || 'Pendiente').trim(),
      Observaciones: String(body.Observaciones || '').trim() || null
    };
    const lineas = parseLineasFromBody(body);

    if (!pedidoPayload.Id_Cial || !pedidoPayload.Id_Cliente) {
      return res.status(400).render('pedido-form', {
        mode: 'create',
        admin,
        comerciales,
        tarifas,
        formasPago,
        tiposPedido: tiposPedido || [],
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        articulos,
        item: pedidoPayload,
        lineas: (body.lineas || body.Lineas) ? (Array.isArray(body.lineas || body.Lineas) ? (body.lineas || body.Lineas) : Object.values(body.lineas || body.Lineas)) : [{ Id_Articulo: '', Cantidad: 1, Dto: '' }],
        clientes: [],
        canEdit: true,
        error: 'Id_Cial e Id_Cliente son obligatorios'
      });
    }
    const clientePedido = await db.getClienteById(pedidoPayload.Id_Cliente);
    const dniCliente = clientePedido ? String(_n(_n(clientePedido.cli_dni_cif, clientePedido.DNI_CIF), clientePedido.DniCif) || '').trim() : '';
    const activo = Number(_n(_n(_n(clientePedido && clientePedido.cli_ok_ko, clientePedido && clientePedido.OK_KO), clientePedido && clientePedido.ok_ko), 0)) === 1;
    if (!clientePedido) {
      return res.status(400).render('pedido-form', {
        mode: 'create',
        admin,
        comerciales,
        tarifas,
        formasPago,
        tiposPedido: tiposPedido || [],
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        articulos,
        item: pedidoPayload,
        lineas,
        clientes: [],
        canEdit: true,
        error: 'Cliente no encontrado.'
      });
    }
    if (!dniCliente || dniCliente.toLowerCase() === 'pendiente') {
      return res.status(400).render('pedido-form', {
        mode: 'create',
        admin,
        comerciales,
        tarifas,
        formasPago,
        tiposPedido: tiposPedido || [],
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        articulos,
        item: pedidoPayload,
        lineas,
        clientes: await db.getClientesOptimizadoPaged(clientesFilters, { limit: 10, offset: 0, compact: true, order: 'desc' }).catch(() => []),
        canEdit: true,
        error: 'No se pueden crear pedidos para un cliente sin DNI/CIF. Indica el DNI/CIF del cliente y asígnalo como activo.'
      });
    }
    if (!activo) {
      return res.status(400).render('pedido-form', {
        mode: 'create',
        admin,
        comerciales,
        tarifas,
        formasPago,
        tiposPedido: tiposPedido || [],
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        articulos,
        item: pedidoPayload,
        lineas,
        clientes: await db.getClientesOptimizadoPaged(clientesFilters, { limit: 10, offset: 0, compact: true, order: 'desc' }).catch(() => []),
        canEdit: true,
        error: 'No se pueden crear pedidos para un cliente inactivo. Activa el cliente en Contactos.'
      });
    }
    if (!pedidoPayload.EstadoPedido) {
      return res.status(400).render('pedido-form', {
        mode: 'create',
        admin,
        comerciales,
        tarifas,
        formasPago,
        tiposPedido: tiposPedido || [],
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        articulos,
        item: pedidoPayload,
        lineas,
        clientes: [],
        canEdit: true,
        error: 'EstadoPedido es obligatorio'
      });
    }

    const finalPayload = ensureTransferTarifaYFormaPago(pedidoPayload, body, tarifas, formasPago, tiposPedido);
    if (await isTransferPedido(db, finalPayload).catch(() => false)) {
      const mayoristaInfo = await resolveMayoristaInfo(db, finalPayload);
      if (mayoristaInfo && (mayoristaInfo.nombre || mayoristaInfo.codigoAsociado)) {
        const cod = mayoristaInfo.codigoAsociado || String(body.NumAsociadoHefame || '').trim() || null;
        if (mayoristaInfo.nombre) finalPayload.cooperativa_nombre = mayoristaInfo.nombre;
        if (cod) {
          finalPayload.NumAsociadoHefame = cod;
          finalPayload.numero_cooperativa = cod;
        }
      }
    }
    const created = await db.createPedido(finalPayload);
    const pedidoId = _n(_n(created && created.insertId, created && created.Id), created && created.id);
    const result = await db.updatePedidoWithLineas(pedidoId, {}, lineas);
    if (esEspecial && !admin) {
      await db.ensureNotificacionPedidoEspecial(pedidoId, finalPayload.Id_Cliente, finalPayload.Id_Cial).catch(() => null);
    }
    return res.redirect(`/pedidos/${pedidoId}`);
  } catch (e) {
    next(e);
  }
});

router.get('/:id(\\d+)/duplicate', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    const id = Number(req.params.id);
    const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
    const pk = pedidosMeta?.pk || 'id';
    const colNum = pedidosMeta?.colNumPedido || 'NumPedido';
    const cabecera = { ...item };
    delete cabecera[pk];
    delete cabecera.Id;
    delete cabecera.id;
    if (colNum) cabecera[colNum] = '';
    const lineasRaw = await db.getArticulosByPedido(id).catch(() => []);
    const pickRowCI = (row, cands) => {
      const obj = row && typeof row === 'object' ? row : {};
      const map = new Map(Object.keys(obj).map((k) => [String(k).toLowerCase(), k]));
      for (const cand of cands || []) {
        const real = map.get(String(cand).toLowerCase());
        if (real && obj[real] !== undefined) return obj[real];
      }
      return undefined;
    };
    const lineas = Array.isArray(lineasRaw) && lineasRaw.length
      ? lineasRaw.map((l) => ({
          Id_Articulo: _n(pickRowCI(l, ['Id_Articulo', 'id_articulo', 'ArticuloId', 'Articulo_Id']), ''),
          Cantidad: _n(pickRowCI(l, ['Cantidad', 'cantidad', 'Unidades', 'Uds']), 1),
          Dto: _n(pickRowCI(l, ['Linea_Dto', 'DtoLinea', 'Dto', 'dto', 'Descuento']), ''),
          PrecioUnitario: _n(pickRowCI(l, ['Linea_PVP', 'PVP', 'PrecioUnitario', 'Precio', 'PVL']), '')
        }))
      : [];
    const created = await db.createPedido(cabecera);
    const newId = _n(_n(created && created.insertId, created && created.Id), created && created.id);
    if (lineas.length) await db.updatePedidoWithLineas(newId, {}, lineas);
    return res.redirect(`/pedidos/${newId}/edit`);
  } catch (e) {
    next(e);
  }
});

router.get('/:id(\\d+)', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    const admin = res.locals.pedidoAdmin;
    const id = Number(req.params.id);
    const idFormaPago = Number(_n(_n(_n(item && item.Id_FormaPago, item && item.id_forma_pago), item && item.ped_formp_id), 0)) || 0;
    const idTipoPedido = Number(_n(_n(_n(item && item.Id_TipoPedido, item && item.id_tipo_pedido), item && item.ped_tipp_id), 0)) || 0;
    const idTarifa = Number(_n(_n(_n(item && item.Id_Tarifa, item && item.id_tarifa), item && item.ped_tarcli_id), 0)) || 0;
    const idEstadoPedido = Number(_n(_n(_n(item && item.Id_EstadoPedido, item && item.id_estado_pedido), item && item.ped_estped_id), 0)) || 0;
    const idComercial = Number(_n(_n(_n(_n(_n(item && item.Id_Cial, item && item.id_cial), item && item.ped_com_id), item && item.ComercialId), item && item.comercialId), 0)) || 0;

    const needTiposPedido = idTipoPedido > 0;
    const needTarifas = idTarifa > 0;

    const idCliente = Number(item?.Id_Cliente ?? item?.ped_cli_id ?? 0) || 0;
    const [
      lineas,
      cliente,
      canShowHefame,
      formaPago,
      estadoPedido,
      comercial,
      tiposPedido,
      tarifas
    ] = await Promise.all([
      db.getArticulosByPedido(id).catch(() => []),
      idCliente ? db.getClienteById(idCliente).catch(() => null) : null,
      canShowHefameForPedido(db, item),
      idFormaPago ? db.getFormaPagoById(idFormaPago).catch(() => null) : null,
      idEstadoPedido ? db.getEstadoPedidoById(idEstadoPedido).catch(() => null) : null,
      idComercial ? db.getComercialById(idComercial).catch(() => null) : null,
      needTiposPedido ? db.getTiposPedido().catch(() => []) : [],
      needTarifas ? db.getTarifas().catch(() => []) : []
    ]);

    const tipoPedido = needTiposPedido
      ? (tiposPedido || []).find((t) => Number(_n(_n(_n(t && t.id, t && t.Id), t && t.tipp_id), 0)) === idTipoPedido) || null
      : null;
    const tarifa = needTarifas
      ? (tarifas || []).find((t) => Number(_n(_n(_n(t && t.Id, t && t.id), t && t.tarcli_id), 0)) === idTarifa) || null
      : null;

    const isTransfer = await isTransferPedido(db, item).catch(() => false);
    const mayoristaInfo = (canShowHefame || isTransfer) ? await resolveMayoristaInfo(db, item) : null;

    const idDirEnvio = Number(item?.Id_DireccionEnvio ?? item?.ped_direnv_id ?? 0) || 0;
    let direccionEnvio = idDirEnvio
      ? await db.getDireccionEnvioById(idDirEnvio).catch(() => null)
      : null;
    const clientePk = Number(cliente?.Id ?? cliente?.cli_id ?? cliente?.id ?? 0) || 0;
    if (!direccionEnvio && clientePk) {
      const dirs = await db.getDireccionesEnvioByCliente(clientePk).catch(() => []);
      if (Array.isArray(dirs) && dirs.length === 1) direccionEnvio = dirs[0];
    }

    const estadoNorm = String(_n(_n(_n(item.EstadoPedido, item.Estado), item.ped_estado_txt), '')).trim().toLowerCase() || 'pendiente';
    const userId = Number(res.locals.user?.id);
    const owner = Number(item.ped_com_id ?? item.Id_Cial ?? item.id_cial ?? item.ComercialId ?? item.comercialId ?? 0) || 0;
    const canEdit =
      admin ? !estadoNorm.includes('pagad') : (Number.isFinite(userId) && userId === owner && estadoNorm.includes('pend'));

    // Labels para mostrar nombres en vez de IDs (compatibles con columnas legacy y migradas)
    const pick = (obj, keys) => {
      if (!obj || typeof obj !== 'object') return '';
      for (const k of keys) {
        const v = obj[k];
        if (v != null && String(v).trim() !== '') return String(v).trim();
      }
      return '';
    };
    const clienteLabel = pick(cliente, ['Nombre_Razon_Social', 'cli_nombre_razon_social', 'Nombre', 'nombre']);
    const comercialLabel = pick(comercial, ['Nombre', 'com_nombre', 'nombre']);
    const formaPagoLabel = pick(formaPago, ['FormaPago', 'formp_nombre', 'Nombre', 'nombre', 'forma_pago']);
    const tarifaLabel = pick(tarifa, ['NombreTarifa', 'Nombre', 'nombre', 'tarcli_nombre']);
    const tipoPedidoLabel = pick(tipoPedido, ['Nombre', 'Tipo', 'tipp_tipo', 'nombre', 'tipo']);
    const estadoLabel = pick(estadoPedido, ['nombre', 'Nombre', 'estped_nombre']) || pick(item, ['EstadoPedido', 'Estado', 'ped_estado_txt']) || '';

    // Enriquecer líneas con PVL cuando está en 0: buscar precios por tarifa
    let lineasToRender = lineas || [];
    const artIdsNeedingPvl = (lineasToRender || [])
      .map((l) => Number(l.pedart_art_id ?? l.Id_Articulo ?? l.id_articulo ?? l.art_id ?? 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    const needsEnrichment = (lineasToRender || []).some((l) => {
      const pvl = Number(l.Linea_PVP ?? l.pedart_pvp ?? l.PVP ?? l.pvp ?? l.art_pvl ?? 0);
      return !Number.isFinite(pvl) || pvl <= 0;
    });
    if (needsEnrichment && artIdsNeedingPvl.length > 0) {
      const precios = await db.getPreciosArticulosParaTarifa(idTarifa ?? 0, artIdsNeedingPvl).catch(() => ({}));
      lineasToRender = (lineasToRender || []).map((l) => {
        const artId = Number(l.pedart_art_id ?? l.Id_Articulo ?? l.id_articulo ?? l.art_id ?? 0);
        const pvlStored = Number(l.Linea_PVP ?? l.pedart_pvp ?? l.PVP ?? l.pvp ?? 0);
        if ((!Number.isFinite(pvlStored) || pvlStored <= 0) && artId > 0 && precios[artId] != null) {
          return { ...l, Linea_PVP: precios[artId], pedart_pvp: precios[artId] };
        }
        return l;
      });
    }

    res.render('pedido', {
      item,
      lineas: lineasToRender,
      cliente,
      direccionEnvio,
      admin,
      canEdit,
      canShowHefame,
      isTransfer,
      mayoristaInfo,
      formaPago,
      tipoPedido,
      tarifa,
      estadoPedido,
      comercial,
      clienteLabel,
      comercialLabel,
      formaPagoLabel,
      tarifaLabel,
      tipoPedidoLabel,
      estadoLabel
    });
  } catch (e) {
    next(e);
  }
});

router.get('/:id(\\d+).xlsx', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    const id = Number(req.params.id);
    let lineas = await db.getArticulosByPedido(id).catch(() => []);
    const cliente = item?.Id_Cliente ? await db.getClienteById(Number(item.Id_Cliente)).catch(() => null) : null;

    const canShowHefame = await canShowHefameForPedido(db, item);
    const mayoristaInfo = canShowHefame ? await resolveMayoristaInfo(db, item) : null;

    const idTarifa = _n(item?.Id_Tarifa, item?.id_tarifa);
    const artIdsNeedingPvl = (lineas || [])
      .map((l) => Number(l.pedart_art_id ?? l.Id_Articulo ?? l.id_articulo ?? l.art_id ?? 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    const needsEnrichment = (lineas || []).some((l) => {
      const pvl = Number(l.Linea_PVP ?? l.pedart_pvp ?? l.PVP ?? l.pvp ?? l.art_pvl ?? 0);
      return !Number.isFinite(pvl) || pvl <= 0;
    });
    if (needsEnrichment && artIdsNeedingPvl.length > 0) {
      const precios = await db.getPreciosArticulosParaTarifa(idTarifa ?? 0, artIdsNeedingPvl).catch(() => ({}));
      lineas = (lineas || []).map((l) => {
        const artId = Number(l.pedart_art_id ?? l.Id_Articulo ?? l.id_articulo ?? l.art_id ?? 0);
        const pvlStored = Number(l.Linea_PVP ?? l.pedart_pvp ?? l.PVP ?? l.pvp ?? l.art_pvl ?? 0);
        if ((!Number.isFinite(pvlStored) || pvlStored <= 0) && artId > 0 && precios[artId] != null) {
          return { ...l, Linea_PVP: precios[artId], pedart_pvp: precios[artId] };
        }
        return l;
      });
    }

    let buf; let filename;
    if (canShowHefame) {
      const built = await buildHefameXlsxBuffer({ item, id, lineas, cliente, mayoristaInfo });
      if (!built.ok) {
        let direccionEnvio = item?.Id_DireccionEnvio
          ? await db.getDireccionEnvioById(Number(item.Id_DireccionEnvio)).catch(() => null)
          : null;
        if (!direccionEnvio && cliente?.Id) {
          const dirs = await db.getDireccionesEnvioByCliente(Number(cliente.Id), { compact: false }).catch(() => []);
          if (Array.isArray(dirs) && dirs.length === 1) direccionEnvio = dirs[0];
        }
        const std = await buildStandardPedidoXlsxBuffer({
          item,
          id,
          lineas,
          cliente,
          direccionEnvio,
          fmtDateES: res.locals.fmtDateES,
          mayoristaInfo
        });
        buf = std.buf;
        filename = std.filename;
      } else {
        buf = built.buf;
        filename = built.filename;
      }
    } else {
      let direccionEnvio = item?.Id_DireccionEnvio
        ? await db.getDireccionEnvioById(Number(item.Id_DireccionEnvio)).catch(() => null)
        : null;
      if (!direccionEnvio && cliente?.Id) {
        const dirs = await db.getDireccionesEnvioByCliente(Number(cliente.Id), { compact: false }).catch(() => []);
        if (Array.isArray(dirs) && dirs.length === 1) direccionEnvio = dirs[0];
      }
      const built = await buildStandardPedidoXlsxBuffer({
        item,
        id,
        lineas,
        cliente,
        direccionEnvio,
        fmtDateES: res.locals.fmtDateES,
        mayoristaInfo
      });
      buf = built.buf;
      filename = built.filename;
    }

    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.end(buf);
  } catch (e) {
    next(e);
  }
});

// Página Hefame: envío por email deshabilitado; enlace a descargar Excel (se intentará en otro momento)
router.get('/:id(\\d+)/hefame-send-email', requireLogin, loadPedidoAndCheckOwner, async (req, res) => {
  const item = res.locals.pedido;
  if (!(await canShowHefameForPedido(db, item))) {
    res.status(403).send('HEFAME solo disponible para pedidos con forma de pago Transfer y tipo HEFAME.');
    return;
  }
  const id = Number(req.params.id);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderHefameInfoPage(true, 'El envío por email está temporalmente deshabilitado.\n\nPuede descargar la plantilla Excel con los datos del pedido para Hefame usando el enlace siguiente.', id));
});

router.get('/:id(\\d+)/transfer-imprimir', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    if (!(await isTransferPedido(db, item))) {
      res.status(403).send('Imprimir Transfer solo disponible para pedidos con forma de pago Transfer.');
      return;
    }
    const id = Number(req.params.id);
    const lineas = await db.getArticulosByPedido(id).catch(() => []);
    const cliente = item?.Id_Cliente ? await db.getClienteById(Number(item.Id_Cliente)).catch(() => null) : null;
    const mayoristaInfo = await resolveMayoristaInfo(db, item);

    const pick = (obj, keys) => {
      if (!obj || typeof obj !== 'object') return '';
      for (const k of keys) {
        const v = obj[k];
        if (v != null && String(v).trim() !== '') return String(v).trim();
      }
      return '';
    };
    const numPedido = item?.NumPedido ?? item?.ped_numero ?? item?.Numero_Pedido ?? '';
    const clienteNombre = pick(cliente, ['Nombre_Razon_Social', 'cli_nombre_razon_social', 'Nombre', 'nombre']) || item?.Id_Cliente || '';
    const codigoAsociado = mayoristaInfo?.codigoAsociado || String(item?.NumAsociadoHefame ?? item?.num_asociado_hefame ?? '').trim() || '';
    const telefono = pick(cliente, ['cli_telefono', 'cli_movil', 'Telefono', 'Movil', 'Teléfono']) || '';
    const cp = String(pick(cliente, ['cli_codigo_postal', 'CodigoPostal', 'codigo_postal']) || '').trim();
    const poblacion = String(pick(cliente, ['cli_poblacion', 'Poblacion', 'poblacion']) || '').trim();
    const poblacionConCP = [cp, poblacion].filter(Boolean).join(' ');

    res.render('pedido-transfer-print', {
      pedidoId: id,
      numPedido,
      clienteNombre,
      codigoAsociado,
      telefono,
      poblacionConCP,
      mayoristaInfo,
      lineas
    });
  } catch (e) {
    next(e);
  }
});

router.get('/:id(\\d+)/transfer.xlsx', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    if (!(await isTransferPedido(db, item))) {
      res.status(403).send('Transfer solo disponible para pedidos con forma de pago Transfer.');
      return;
    }
    const id = Number(req.params.id);
    const lineas = await db.getArticulosByPedido(id).catch(() => []);
    const cliente = item?.Id_Cliente ? await db.getClienteById(Number(item.Id_Cliente)).catch(() => null) : null;
    const mayoristaInfo = await resolveMayoristaInfo(db, item);

    const built = await buildHefameXlsxBuffer({ item, id, lineas, cliente, mayoristaInfo });
    if (!built.ok) {
      return res.redirect(`/pedidos/${id}.xlsx`);
    }

    const [smtpStatus, graphStatus] = await Promise.all([getSmtpStatus(), getGraphStatus()]);
    if (smtpStatus?.configured || graphStatus?.configured) {
      sendTransferExcelEmail({
        item,
        cliente,
        mayoristaInfo,
        excelBuf: built.buf,
        excelFilename: built.filename
      }).catch((err) => console.error('[PEDIDOS] Error enviando email Transfer:', err?.message));
    }

    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${built.filename}"`);
    return res.end(built.buf);
  } catch (e) {
    next(e);
  }
});

router.get('/:id(\\d+)/hefame.xlsx', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    if (!(await canShowHefameForPedido(db, item))) {
      res.status(403).send('HEFAME solo disponible para pedidos con forma de pago Transfer y tipo HEFAME.');
      return;
    }
    const id = Number(req.params.id);
    const lineas = await db.getArticulosByPedido(id).catch(() => []);
    const cliente = item?.Id_Cliente ? await db.getClienteById(Number(item.Id_Cliente)).catch(() => null) : null;
    const mayoristaInfo = await resolveMayoristaInfo(db, item);

    const built = await buildHefameXlsxBuffer({ item, id, lineas, cliente, mayoristaInfo });
    if (!built.ok) {
      return res.redirect(`/pedidos/${id}.xlsx`);
    }

    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${built.filename}"`);
    return res.end(built.buf);
  } catch (e) {
    next(e);
  }
});

router.post('/:id(\\d+)/enviar-n8n', requireLogin, requireAdmin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    const id = Number(req.params.id);

    let lineas = await db.getArticulosByPedido(id).catch(() => []);
    const cliente = item?.Id_Cliente ? await db.getClienteById(Number(item.Id_Cliente)).catch(() => null) : null;

    const idTarifa = _n(item?.Id_Tarifa, item?.id_tarifa);
    const artIdsNeedingPvl = (lineas || [])
      .map((l) => Number(l.pedart_art_id ?? l.Id_Articulo ?? l.id_articulo ?? l.art_id ?? 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    const needsEnrichment = (lineas || []).some((l) => {
      const pvl = Number(l.Linea_PVP ?? l.pedart_pvp ?? l.PVP ?? l.pvp ?? l.art_pvl ?? 0);
      return !Number.isFinite(pvl) || pvl <= 0;
    });
    if (needsEnrichment && artIdsNeedingPvl.length > 0) {
      const precios = await db.getPreciosArticulosParaTarifa(idTarifa ?? 0, artIdsNeedingPvl).catch(() => ({}));
      lineas = (lineas || []).map((l) => {
        const artId = Number(l.pedart_art_id ?? l.Id_Articulo ?? l.id_articulo ?? l.art_id ?? 0);
        const pvlStored = Number(l.Linea_PVP ?? l.pedart_pvp ?? l.PVP ?? l.pvp ?? l.art_pvl ?? 0);
        if ((!Number.isFinite(pvlStored) || pvlStored <= 0) && artId > 0 && precios[artId] != null) {
          return { ...l, Linea_PVP: precios[artId], pedart_pvp: precios[artId] };
        }
        return l;
      });
    }

    let direccionEnvio = null;
    try {
      direccionEnvio = item?.Id_DireccionEnvio
        ? await db.getDireccionEnvioById(Number(item.Id_DireccionEnvio)).catch(() => null)
        : null;
      if (!direccionEnvio && cliente?.Id) {
        const dirs = await db.getDireccionesEnvioByCliente(Number(cliente.Id), { compact: false }).catch(() => []);
        if (Array.isArray(dirs) && dirs.length === 1) direccionEnvio = dirs[0];
      }
    } catch (_) {
      direccionEnvio = null;
    }

    const isTransfer = await isTransferPedido(db, item).catch(() => false);
    const canShowHefame = await canShowHefameForPedido(db, item);
    const mayoristaInfo = canShowHefame ? await resolveMayoristaInfo(db, item) : null;

    let excel;
    let excelTipo = 'estandar';
    if (isTransfer) {
      const built = await buildHefameXlsxBuffer({ item, id, lineas, cliente, mayoristaInfo });
      if (!built.ok) {
        return res.redirect(
          `/pedidos?n8n=err&pid=${encodeURIComponent(String(id))}&msg=${encodeURIComponent(built.error || 'No se pudo generar el Excel (Transfer).')}`
        );
      }
      excel = { buf: built.buf, filename: built.filename };
      excelTipo = 'transfer';
    } else {
      const built = await buildStandardPedidoXlsxBuffer({
        item,
        id,
        lineas,
        cliente,
        direccionEnvio,
        fmtDateES: res.locals.fmtDateES,
        mayoristaInfo
      });
      excel = { buf: built.buf, filename: built.filename };
      excelTipo = 'directo';
    }

    const payload = {
      requestId: req.requestId,
      sentAt: new Date().toISOString(),
      excelTipo,
      pedido: (() => {
        const pedidoId = Number(_n(_n(item && item.Id, item && item.id), id)) || id;
        const numPedido = String(_n(_n(_n(item && item.NumPedido, item && item.Num_Pedido), item && item.Numero_Pedido), '')).trim();
        const numPedidoCliente = String(_n(_n(item && item.NumPedidoCliente, item && item.Num_Pedido_Cliente), '')).trim();
        const idCliente = Number(_n(_n(_n(_n(item && item.Id_Cliente, item && item.id_cliente), cliente && cliente.Id), cliente && cliente.id), 0)) || null;
        const idComercial = Number(_n(_n(_n(_n(item && item.Id_Cial, item && item.id_cial), item && item.ComercialId), item && item.comercialId), 0)) || null;
        const idFormaPago = Number(_n(_n(item && item.Id_FormaPago, item && item.id_forma_pago), 0)) || null;
        const idTipoPedido = Number(_n(_n(item && item.Id_TipoPedido, item && item.id_tipo_pedido), 0)) || null;
        const idTarifa = _n(item && item.Id_Tarifa, item && item.id_tarifa);
        const tarifaIdNum = idTarifa === null || idTarifa === undefined || String(idTarifa).trim() === '' ? null : (Number(idTarifa) || null);
        const idEstado = Number(_n(_n(item && item.Id_EstadoPedido, item && item.id_estado_pedido), 0)) || null;

        const clienteNombre =
          cliente?.Nombre_Razon_Social || cliente?.Nombre || cliente?.nombre || item?.ClienteNombre || item?.ClienteNombreCial || '';
        const comercialNombre = item?.ComercialNombre || item?.NombreComercial || '';

        // Best-effort: resolver nombres de catálogos (no romper si falla)
        const formaPagoNombre = (item?.FormaPagoNombre || '').toString().trim();
        const tipoPedidoNombre = (item?.TipoPedidoNombre || '').toString().trim();
        const tarifaNombre = (item?.TarifaNombre || '').toString().trim();
        const estadoNombre = (item?.EstadoPedidoNombre || item?.EstadoPedido || item?.Estado || '').toString().trim();

        return {
          id: pedidoId,
          numero: numPedido || String(pedidoId),
          fecha: _n(_n(item && item.FechaPedido, item && item.Fecha), null),
          entrega: _n(item && item.FechaEntrega, null),
          total: _n(_n(item && item.TotalPedido, item && item.Total), null),
          subtotal: _n(_n(item && item.SubtotalPedido, item && item.Subtotal), null),
          descuentoPct: _n(_n(item && item.Dto, item && item.Descuento), null),
          observaciones: _n(item && item.Observaciones, null),
          numPedidoCliente: numPedidoCliente || null,
          numAsociadoHefame: _n(_n(item && item.NumAsociadoHefame, item && item.num_asociado_hefame), null),
          cliente: {
            id: idCliente,
            nombre: clienteNombre || (idCliente ? String(idCliente) : null),
            cif: _n(cliente && cliente.DNI_CIF, cliente && cliente.DniCif),
            poblacion: _n(cliente && cliente.Poblacion, null),
            cp: _n(cliente && cliente.CodigoPostal, null),
            telefono: _n(cliente && cliente.Telefono, cliente && cliente.Movil),
            email: _n(cliente && cliente.Email, null)
          },
          comercial: {
            id: idComercial,
            nombre: comercialNombre || (idComercial ? String(idComercial) : null)
          },
          formaPago: { id: idFormaPago, nombre: formaPagoNombre || null },
          tipoPedido: { id: idTipoPedido, nombre: tipoPedidoNombre || null },
          tarifa: { id: tarifaIdNum, nombre: tarifaNombre || null },
          estado: { id: idEstado, nombre: estadoNombre || null }
        };
      })(),
      lineas: (Array.isArray(lineas) ? lineas : []).map((l) => ({
        articuloId: Number(_n(_n(_n(l.Id_Articulo, l.id_articulo), l.ArticuloId), 0)) || null,
        codigo: String(_n(_n(_n(_n(l.SKU, l.Codigo), l.Id_Articulo), l.id_articulo), '')).trim() || null,
        nombre: String(_n(_n(_n(_n(l.Nombre, l.Descripcion), l.Articulo), l.nombre), '')).trim() || null,
        cantidad: Number(_n(_n(l.Cantidad, l.Unidades), 0)) || 0,
        precioUnitario: Number(_n(_n(_n(_n(_n(l.Linea_PVP, l.PVP), l.PrecioUnitario), l.PVL), l.Precio), 0)) || 0,
        descuentoPct: Number(_n(_n(_n(_n(_n(l.Linea_Dto, l.DtoLinea), l.Dto), l.dto), l.Descuento), 0)) || 0,
        ivaPct: Number(_n(_n(_n(_n(l.Linea_IVA, l.IVA), l.PorcIVA), l.PorcentajeIVA), 0)) || 0
      })),
      cliente: cliente
        ? {
            id: _n(_n(cliente && cliente.Id, cliente && cliente.id), null),
            nombre: _n(_n(_n(cliente && cliente.Nombre_Razon_Social, cliente && cliente.Nombre), cliente && cliente.nombre), null),
            cif: _n(cliente && cliente.DNI_CIF, cliente && cliente.DniCif),
            direccion: _n(cliente && cliente.Direccion, null),
            poblacion: _n(cliente && cliente.Poblacion, null),
            cp: _n(cliente && cliente.CodigoPostal, null),
            telefono: _n(cliente && cliente.Telefono, cliente && cliente.Movil),
            email: _n(cliente && cliente.Email, null)
          }
        : null,
      direccionEnvio,
      excel: {
        filename: excel.filename,
        mime: XLSX_MIME,
        base64: excel.buf.toString('base64')
      }
    };

    // === ENVÍO POR EMAIL (modo actual) ===
    // Nota: mantenemos el código de N8N más abajo, pero no se ejecuta por defecto.
    const mailToFromDb = await db.getVariableSistema?.(SYSVAR_PEDIDOS_MAIL_TO).catch(() => null);
    const mailTo = String(mailToFromDb || process.env.PEDIDOS_MAIL_TO || 'p.lara@gemavip.com').trim() || 'p.lara@gemavip.com';
    const pedidoNum = String(_n(_n(_n(item && item.NumPedido, item && item.Num_Pedido), item && item.Numero_Pedido), id)).trim();
    const clienteNombre =
      (payload?.pedido?.cliente?.nombre ? String(payload.pedido.cliente.nombre) : '') ||
      String(_n(_n(item && item.ClienteNombre, item && item.ClienteNombreCial), '')).trim() ||
      '';
    const totalLabel = _n(_n(item && item.TotalPedido, item && item.Total), null);
    const pedidoUrl = `${APP_BASE_URL}/pedidos/${id}`;
    const subject = `Pedido ${pedidoNum}${clienteNombre ? ` · ${clienteNombre}` : ''} · CRM Gemavip`;

    const signatureText = [
      '--',
      'GEMAVIP',
      'Paco Lara',
      'Key Account Manager',
      'GEMAVIP',
      'Email: p.lara@gemavip.com',
      'Tel: +34 610 72 13 69',
      'Web: gemavip.com/es/ | farmadescanso.com',
      'LinkedIn',
      'Valoraciones Trustpilot',
      '',
      'Aviso de confidencialidad: La información contenida en esta comunicación electrónica y en sus archivos adjuntos es confidencial, privilegiada y está dirigida exclusivamente a la persona o entidad a la que va destinada. Si usted no es el destinatario previsto, se le notifica que cualquier lectura, uso, copia, distribución, divulgación o reproducción de este mensaje y sus anexos está estrictamente prohibida y puede constituir un delito. Si ha recibido este correo por error, le rogamos que lo notifique inmediatamente al remitente respondiendo a este mensaje y proceda a su eliminación de su sistema.',
      '',
      'Protección de datos: De conformidad con el Reglamento (UE) 2016/679 del Parlamento Europeo y del Consejo (RGPD) y la Ley Orgánica 3/2018, de 5 de diciembre, de Protección de Datos Personales y garantía de los derechos digitales (LOPDGDD), garantizo la adopción de todas las medidas técnicas y organizativas necesarias para el tratamiento seguro y confidencial de sus datos personales. Puede ejercer sus derechos de acceso, rectificación, supresión, limitación, portabilidad y oposición escribiendo a p.lara@gemavip.com.',
      '',
      'Exención de responsabilidad: No me hago responsable de la transmisión íntegra y puntual de este mensaje, ni de posibles retrasos, errores, alteraciones o pérdidas que pudieran producirse en su recepción. Este mensaje no constituye ningún compromiso, salvo que exista un acuerdo expreso y por escrito entre las partes.'
    ].join('\n');

    const linesText = (payload.lineas || [])
      .slice(0, 60)
      .map((l) => `- ${l.codigo || l.articuloId || '—'} · ${l.nombre || ''} · uds: ${_n(l.cantidad, 0)}`)
      .join('\n');

    const text = [
      'Pedido enviado desde CRM Gemavip.',
      '',
      `Pedido: ${pedidoNum}`,
      clienteNombre ? `Cliente: ${clienteNombre}` : null,
      totalLabel != null ? `Total: ${String(totalLabel)}` : null,
      `Enlace: ${pedidoUrl}`,
      '',
      (linesText ? `Líneas (resumen):\n${linesText}\n` : ''),
      signatureText
    ]
      .filter(Boolean)
      .join('\n');

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:1.45;color:#111827;">
        <h2 style="margin:0 0 10px 0;font-size:16px;">Pedido enviado desde CRM Gemavip</h2>
        <div style="margin:0 0 12px 0;">
          <div><strong>Pedido:</strong> ${escapeHtmlUtil(pedidoNum)}</div>
          ${clienteNombre ? `<div><strong>Cliente:</strong> ${escapeHtmlUtil(clienteNombre)}</div>` : ''}
          ${totalLabel != null ? `<div><strong>Total:</strong> ${escapeHtmlUtil(String(totalLabel))}</div>` : ''}
          <div><strong>Enlace:</strong> <a href="${escapeHtmlUtil(pedidoUrl)}">${escapeHtmlUtil(pedidoUrl)}</a></div>
        </div>
        ${
          linesText
            ? `<div style="margin: 0 0 12px 0;"><strong>Líneas (resumen)</strong><div style="white-space:pre-wrap;margin-top:6px;">${escapeHtmlUtil(linesText)}</div></div>`
            : ''
        }
        <hr style="border:0;border-top:1px solid #e5e7eb;margin:16px 0;" />
        <div style="white-space:pre-wrap;color:#111827;">${escapeHtmlUtil(signatureText)}</div>
      </div>
    `.trim();

    const mailRes = await sendPedidoEmail(mailTo, {
      subject,
      text,
      html,
      attachments: [
        {
          filename: excel.filename,
          content: excel.buf,
          contentType: XLSX_MIME
        }
      ]
    });

    if (!mailRes?.sent) {
      return res.redirect(
        `/pedidos?n8n=err&pid=${encodeURIComponent(String(id))}&msg=${encodeURIComponent(`No se pudo enviar el email: ${mailRes?.error || 'error desconocido'}`)}`
      );
    }

    // Resultado OK por email
    // (Reutilizamos el aviso existente en /pedidos, aunque internamente no hayamos llamado a N8N)
    /*
    // === CÓDIGO N8N (PRESERVADO, NO EJECUTAR) ===
    // Si se quisiera reactivar en el futuro:
    // 1) resolver webhookUrl (BD o .env)
    // 2) enviar axios.post(webhookUrl, payload, { headers: { 'Content-Type': 'application/json' }, ... })
    */

    return res.redirect(
      `/pedidos?n8n=ok&pid=${encodeURIComponent(String(id))}&file=${encodeURIComponent(excel.filename)}&msg=${encodeURIComponent(`Email enviado a ${mailTo}`)}`
    );
  } catch (e) {
    console.error('Enviar pedido a N8N: error', e?.message);
    return res.redirect(
      `/pedidos?n8n=err&pid=${encodeURIComponent(String(req.params.id || ''))}&msg=${encodeURIComponent('Error enviando a N8N. Revisa logs/soporte.')}`
    );
  }
});

router.get('/:id(\\d+)/edit', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    const admin = res.locals.pedidoAdmin;
    const id = Number(req.params.id);
    const [tarifas, formasPago, comerciales, tiposPedido, descuentosPedido, estadosPedido] = await Promise.all([
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => []),
      db.getComerciales().catch(() => []),
      db.getTiposPedido().catch(() => []),
      db.getDescuentosPedidoActivos().catch(() => []),
      db.getEstadosPedidoActivos().catch(() => [])
    ]);
    const tarifaTransfer = await db.ensureTarifaTransfer().catch(() => null);
    if (tarifaTransfer && _n(tarifaTransfer.tarcli_id, tarifaTransfer.Id, tarifaTransfer.id) != null && !(tarifas || []).some((t) => Number(_n(t.tarcli_id, t.Id, t.id)) === Number(_n(tarifaTransfer.tarcli_id, tarifaTransfer.Id, tarifaTransfer.id)))) tarifas.push(tarifaTransfer);
    const formaPagoTransfer = await db.ensureFormaPagoTransfer().catch(() => null);
    if (formaPagoTransfer && _n(formaPagoTransfer.id, formaPagoTransfer.Id) != null && !(formasPago || []).some((f) => Number(_n(f.id, f.Id)) === Number(_n(formaPagoTransfer.id, formaPagoTransfer.Id)))) formasPago.push(formaPagoTransfer);

    const estadoNorm = String(_n(_n(_n(item.EstadoPedido, item.Estado), item.ped_estado_txt), 'Pendiente')).trim().toLowerCase() || 'pendiente';
    const canEdit = admin ? !estadoNorm.includes('pagad') : estadoNorm.includes('pend');
    if (!canEdit) {
      return renderErrorPage(req, res, {
        status: 403,
        heading: 'No permitido',
        summary: admin
          ? 'Un pedido en estado "Pagado" no se puede modificar.'
          : 'Solo puedes modificar pedidos en estado "Pendiente".',
        publicMessage: `Estado actual: ${String(_n(_n(item.EstadoPedido, item.Estado), item.ped_estado_txt ?? '—'))}`
      });
    }

    const idClienteEdit = Number(item?.Id_Cliente ?? item?.ped_cli_id ?? 0) || 0;
    const cliente = idClienteEdit ? await db.getClienteById(idClienteEdit).catch(() => null) : null;
    const clienteLabel = cliente
      ? (() => {
          const idc = _n(_n(_n(_n(cliente.cli_id, cliente.Id), cliente.id), item.Id_Cliente), '');
          const rs = _n(_n(cliente.cli_nombre_razon_social, cliente.Nombre_Razon_Social), cliente.Nombre || '');
          const nc = _n(_n(cliente.cli_nombre_cial, cliente.Nombre_Cial), '');
          const cif = _n(_n(cliente.cli_dni_cif, cliente.DNI_CIF), '');
          const pob = _n(_n(cliente.cli_poblacion, cliente.Poblacion), '');
          const cp = _n(_n(cliente.cli_codigo_postal, cliente.CodigoPostal), '');
          const parts = [rs, nc].filter(Boolean).join(' / ');
          const extra = [cif, [cp, pob].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
          return `${idc} · ${parts || 'Sin nombre'}${extra ? ` · ${extra}` : ''}`.trim();
        })()
      : '';
    const articulos = await db.getArticulos({}).catch(() => []);
    const comercialEdit = _n(item && (item.Id_Cial ?? item.ped_com_id), res.locals.user && res.locals.user.id);
    const clientesFiltersEdit = { comercial: comercialEdit };
    const clientesRecent = await db
      .getClientesOptimizadoPaged(clientesFiltersEdit, { limit: 10, offset: 0, compact: true, order: 'desc' })
      .catch(() => []);
    const lineasRaw = await db.getArticulosByPedido(id).catch(() => []);

    // Helper: leer valores de columnas con nombres variables (case-insensitive)
    const pickRowCI = (row, cands) => {
      const obj = row && typeof row === 'object' ? row : {};
      const map = new Map(Object.keys(obj).map((k) => [String(k).toLowerCase(), k]));
      for (const cand of (cands || [])) {
        const real = map.get(String(cand).toLowerCase());
        if (real && obj[real] !== undefined) return obj[real];
      }
      return undefined;
    };

    const lineas = Array.isArray(lineasRaw) && lineasRaw.length
      ? lineasRaw.map((l) => ({
          Id_Articulo:
            _n(pickRowCI(l, [
              'pedart_art_id',
              'Id_Articulo',
              'id_articulo',
              'ArticuloId',
              'articuloid',
              'Articulo_Id',
              'articulo_id',
              'IdArticulo',
              'idArticulo'
            ]), ''),
          Cantidad:
            _n(pickRowCI(l, ['pedart_cantidad', 'Cantidad', 'cantidad', 'Unidades', 'unidades', 'Uds', 'uds', 'Cant', 'cant']), 1),
          Dto:
            _n(pickRowCI(l, ['pedart_dto', 'Linea_Dto', 'DtoLinea', 'dto_linea', 'Dto', 'dto', 'DTO', 'Descuento', 'descuento', 'PorcentajeDescuento', 'porcentaje_descuento']), ''),
          PrecioUnitario:
            _n(pickRowCI(l, ['pedart_pvp', 'Linea_PVP', 'PVP', 'pvp', 'PrecioUnitario', 'precio_unitario', 'Precio', 'precio', 'PVL', 'pvl']), '')
        }))
      : [{ Id_Articulo: '', Cantidad: 1, Dto: '' }];
    res.render('pedido-form', {
      mode: 'edit',
      admin,
      item,
      lineas,
      tarifas,
      formasPago,
      tiposPedido: Array.isArray(tiposPedido) ? tiposPedido : [],
      descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
      estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
      comerciales,
      articulos,
      clientes: Array.isArray(clientesRecent) ? clientesRecent : [],
      cliente,
      clienteLabel,
      canEdit,
      error: null
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:id(\\d+)/edit', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const existing = res.locals.pedido;
    const admin = res.locals.pedidoAdmin;
    const id = Number(req.params.id);

    const estadoNorm = String(_n(_n(_n(existing.EstadoPedido, existing.Estado), existing.ped_estado_txt), 'Pendiente')).trim().toLowerCase() || 'pendiente';
    const canEdit = admin ? !estadoNorm.includes('pagad') : estadoNorm.includes('pend');
    if (!canEdit) {
      return renderErrorPage(req, res, {
        status: 403,
        heading: 'No permitido',
        summary: admin
          ? 'Un pedido en estado "Pagado" no se puede modificar.'
          : 'Solo puedes modificar pedidos en estado "Pendiente".',
        publicMessage: `Estado actual: ${String(_n(_n(existing.EstadoPedido, existing.Estado), existing.ped_estado_txt ?? '—'))}`
      });
    }

    const [tarifas, formasPago, comerciales, tiposPedido, descuentosPedido, estadosPedido] = await Promise.all([
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => []),
      db.getComerciales().catch(() => []),
      db.getTiposPedido().catch(() => []),
      db.getDescuentosPedidoActivos().catch(() => []),
      db.getEstadosPedidoActivos().catch(() => [])
    ]);
    const articulos = await db.getArticulos({}).catch(() => []);

    const body = req.body || {};
    const esEspecial = body.EsEspecial === '1' || body.EsEspecial === 1 || body.EsEspecial === true || String(body.EsEspecial || '').toLowerCase() === 'on';
    const existingEspecial = Number(_n(_n(existing.EsEspecial, existing.es_especial), 0)) === 1;
    const pedidoPayload = {
      Id_Cial: admin ? (Number(body.Id_Cial) || 0) : (Number(res.locals.user?.id) || 0),
      Id_Cliente: Number(body.Id_Cliente) || 0,
      Id_DireccionEnvio: body.Id_DireccionEnvio ? (Number(body.Id_DireccionEnvio) || null) : null,
      Id_FormaPago: body.Id_FormaPago ? (Number(body.Id_FormaPago) || 0) : 0,
      Id_TipoPedido: body.Id_TipoPedido ? (Number(body.Id_TipoPedido) || 0) : 0,
      Id_Tarifa: body.Id_Tarifa ? (Number(body.Id_Tarifa) || 0) : 0,
      Id_EstadoPedido: body.Id_EstadoPedido ? (Number(body.Id_EstadoPedido) || null) : null,
      Serie: 'P',
      ...(esEspecial ? { EsEspecial: 1, EspecialEstado: 'pendiente' } : { EsEspecial: 0 }),
      ...(esEspecial && !existingEspecial ? { EspecialFechaSolicitud: new Date() } : {}),
      ...(esEspecial ? { Dto: Number(String(body.Dto || '').replace(',', '.')) || 0 } : {}),
      NumPedidoCliente: String(body.NumPedidoCliente || '').trim() || null,
      NumAsociadoHefame: body.NumAsociadoHefame != null ? String(body.NumAsociadoHefame).trim() || null : undefined,
      FechaPedido: body.FechaPedido ? String(body.FechaPedido).slice(0, 10) : undefined,
      FechaEntrega: body.FechaEntrega ? String(body.FechaEntrega).slice(0, 10) : null,
      EstadoPedido: String(body.EstadoPedido || '').trim(),
      Observaciones: String(body.Observaciones || '').trim() || null
    };
    const lineas = parseLineasFromBody(body);

    if (!pedidoPayload.Id_Cial || !pedidoPayload.Id_Cliente) {
      return res.status(400).render('pedido-form', {
        mode: 'edit',
        admin,
        item: { ...existing, ...pedidoPayload },
        lineas: (body.lineas || body.Lineas) ? (Array.isArray(body.lineas || body.Lineas) ? (body.lineas || body.Lineas) : Object.values(body.lineas || body.Lineas)) : [{ Id_Articulo: '', Cantidad: 1, Dto: '' }],
        tarifas,
        formasPago,
        tiposPedido: tiposPedido || [],
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        comerciales,
        articulos,
        error: 'Id_Cial e Id_Cliente son obligatorios'
      });
    }

    const finalPayload = ensureTransferTarifaYFormaPago(pedidoPayload, body, tarifas, formasPago, tiposPedido);
    if (await isTransferPedido(db, { ...existing, ...finalPayload }).catch(() => false)) {
      const mayoristaInfo = await resolveMayoristaInfo(db, { ...existing, ...finalPayload });
      if (mayoristaInfo && (mayoristaInfo.nombre || mayoristaInfo.codigoAsociado)) {
        const cod = mayoristaInfo.codigoAsociado || String(body.NumAsociadoHefame || '').trim() || null;
        if (mayoristaInfo.nombre) finalPayload.cooperativa_nombre = mayoristaInfo.nombre;
        if (cod) {
          finalPayload.NumAsociadoHefame = cod;
          finalPayload.numero_cooperativa = cod;
        }
      }
    }
    await db.updatePedidoWithLineas(id, finalPayload, lineas);
    if (esEspecial && !admin) {
      await db.ensureNotificacionPedidoEspecial(id, pedidoPayload.Id_Cliente, pedidoPayload.Id_Cial).catch(() => null);
    }
    return res.redirect(`/pedidos/${id}`);
  } catch (e) {
    next(e);
  }
});

router.post('/:id(\\d+)/delete', requireLogin, requireAdmin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.deletePedido(id);
    return res.redirect('/pedidos');
  } catch (e) {
    next(e);
  }
});
module.exports = router;
