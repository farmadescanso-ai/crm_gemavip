/**
 * Rutas HTML de pedidos (CRUD, Excel, Hefame).
 */

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const db = require('../config/mysql-crm');
const { warn } = require('../lib/logger');
const {
  _n,
  renderErrorPage,
  requireAdmin,
  pickCI,
  pickNonZero,
  pickStr
} = require('../lib/app-helpers');
const {
  isAdminUser,
  requireLogin,
  createLoadPedidoAndCheckOwner
} = require('../lib/auth');
const { parsePagination } = require('../lib/pagination');
const { sendTransferExcelEmail, getSmtpStatus, getGraphStatus, APP_BASE_URL } = require('../lib/mailer');
const { loadMarcasForSelect } = require('../lib/articulo-helpers');
const { loadSimpleCatalogForSelect } = require('../lib/cliente-helpers');
let sendPushToAdmins = () => Promise.resolve();
try {
  const wp = require('../lib/web-push');
  if (wp && typeof wp.sendPushToAdmins === 'function') sendPushToAdmins = wp.sendPushToAdmins;
} catch (e) { warn('[pedidos] web-push load:', e?.message); }
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
  buildPedidosTermClauses,
  resolveDireccionEnvio
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

function filterOutTransferOptions(formasPago, tiposPedido) {
  const nameOf = (item) => String(item?.formp_nombre ?? item?.Nombre ?? item?.FormaPago ?? item?.nombre ?? item?.tipp_tipo ?? item?.Tipo ?? '');
  return {
    formasPago: (formasPago || []).filter((fp) => !/transfer/i.test(nameOf(fp))),
    tiposPedido: (tiposPedido || []).filter((tp) => !/transfer/i.test(nameOf(tp)))
  };
}

const N8N_APROBACION_PEDIDO_WEBHOOK = 'https://farmadescanso-n8n.6f4r35.easypanel.host/webhook/d6977a0f-a949-4fdc-bb45-09083fda4f8b';
const APROBACION_SECRET = () => (process.env.APROBACION_SECRET || process.env.API_KEY || 'crm-gemavip-aprobacion').trim();

function _signAprobacion(notifId, approved) {
  return crypto.createHmac('sha256', APROBACION_SECRET()).update(`notifId=${notifId}&approved=${approved}`).digest('hex');
}

async function _sendPedidoAprobacionWebhook(pedidoId, sessionUser) {
  const item = await db.getPedidoById(pedidoId).catch(() => null);
  if (!item) return;

  const idCliente = Number(_n(_n(item.Id_Cliente, item.id_cliente), item.ped_cli_id) || 0);
  const idComercial = Number(_n(_n(_n(item.Id_Cial, item.id_cial), item.ped_com_id) || 0));

  const [lineas, cliente, comercial] = await Promise.all([
    db.getArticulosByPedido(pedidoId).catch(() => []),
    idCliente ? db.getClienteById(idCliente).catch(() => null) : null,
    idComercial ? db.getComercialById(idComercial).catch(() => null) : null
  ]);

  const direccionEnvio = await resolveDireccionEnvio(db, item, idCliente).catch((e) => { warn('[pedidos] dirEnvio:', e?.message); return null; });

  let excelBase64 = null;
  let excelFilename = null;
  try {
    const built = await buildStandardPedidoXlsxBuffer({
      item, id: pedidoId, lineas, cliente, direccionEnvio,
      fmtDateES: (d) => { try { return new Date(d).toLocaleDateString('es-ES'); } catch (_) { return String(d || ''); } },
      mayoristaInfo: null
    });
    excelBase64 = built.buf.toString('base64');
    excelFilename = built.filename;
  } catch (e) {
    console.warn('[WEBHOOK] Error generando Excel para aprobación:', e?.message);
  }

  const notifId = await db.createSolicitudPedido(pedidoId, idComercial || (sessionUser?.id || 0), idCliente).catch((e) => {
    console.warn('[WEBHOOK] Error creando notificación pedido:', e?.message);
    return null;
  });

  let approvalUrlApprove = null;
  let approvalUrlDeny = null;
  if (notifId) {
    approvalUrlApprove = `${APP_BASE_URL}/webhook/aprobar-pedido?notifId=${notifId}&approved=1&sig=${_signAprobacion(notifId, true)}`;
    approvalUrlDeny = `${APP_BASE_URL}/webhook/aprobar-pedido?notifId=${notifId}&approved=0&sig=${_signAprobacion(notifId, false)}`;
  }

  const numPedido = String(_n(_n(_n(item.NumPedido, item.Num_Pedido), item.Numero_Pedido), '')).trim() || String(pedidoId);
  const comercialEmail = comercial?.com_email ?? comercial?.Email ?? comercial?.email ?? sessionUser?.email ?? null;
  const comercialNombre = comercial?.com_nombre ?? comercial?.Nombre ?? comercial?.nombre ?? sessionUser?.nombre ?? '';

  const _pickCI = pickCI;
  const _pickNonZero = pickNonZero;

  const dtoPedidoPct = _pickNonZero(item, ['ped_dto', 'Dto', 'Descuento'], 0);

  const payload = {
    pedido: {
      id: pedidoId,
      numero: numPedido,
      fecha: _n(_n(item.FechaPedido, item.ped_fecha), item.Fecha) || null,
      total: _n(_n(item.TotalPedido, item.ped_total), item.Total) || 0,
      subtotal: _n(item.SubtotalPedido, item.Subtotal) || 0,
      dtoPct: dtoPedidoPct,
      observaciones: _n(item.Observaciones, item.ped_observaciones) || '',
      estado: _n(_n(item.EstadoPedido, item.ped_estado_txt), 'Revisando')
    },
    cliente: cliente ? {
      id: _n(_n(cliente.Id, cliente.id), cliente.cli_id) || idCliente,
      nombre: cliente.Nombre_Razon_Social || cliente.cli_nombre_razon_social || cliente.Nombre || '',
      nombreComercial: cliente.Nombre_Cial || cliente.cli_nombre_cial || '',
      cif: _n(cliente.DNI_CIF, cliente.cli_dni_cif) || '',
      direccion: _n(cliente.Direccion, cliente.cli_direccion) || '',
      poblacion: _n(cliente.Poblacion, cliente.cli_poblacion) || '',
      cp: _n(cliente.CodigoPostal, cliente.cli_codigo_postal) || '',
      telefono: _n(cliente.Telefono, _n(cliente.cli_telefono, _n(cliente.Movil, cliente.cli_movil))) || '',
      email: _n(cliente.Email, cliente.cli_email) || ''
    } : null,
    comercial: {
      id: idComercial,
      nombre: comercialNombre,
      email: comercialEmail || '',
      movil: comercial?.com_movil ?? comercial?.Movil ?? ''
    },
    lineas: (lineas || []).map((l) => ({
      articuloId: Number(_pickCI(l, ['Id_Articulo', 'id_articulo', 'pedart_art_id']) || 0),
      codigo: String(_pickCI(l, ['art_sku', 'art_codigo_interno', 'art_codigo', 'SKU', 'Codigo']) || '').trim(),
      nombre: String(_pickCI(l, ['art_nombre', 'art_descripcion', 'Nombre', 'Descripcion', 'pedart_articulo_txt', 'Articulo']) || '').trim(),
      cantidad: Number(_pickCI(l, ['Linea_Cantidad', 'pedart_cantidad', 'Cantidad', 'Unidades']) || 0),
      precio: _pickNonZero(l, ['Linea_PVP', 'pedart_pvp', 'PVP', 'pvp', 'PrecioUnitario', 'PVL', 'Precio', 'art_pvl'], 0),
      dto: Number(_pickCI(l, ['Linea_Dto', 'pedart_dto', 'DtoLinea', 'dto_linea', 'Dto']) || 0),
      iva: _pickNonZero(l, ['Linea_IVA', 'pedart_iva', 'IVA', 'PorcIVA', 'PorcentajeIVA', 'TipoIVA', 'art_iva'], 0)
    })),
    direccionEnvio: direccionEnvio || null,
    excel: excelBase64 ? { filename: excelFilename, mime: XLSX_MIME, base64: excelBase64 } : null,
    approvalUrlApprove,
    approvalUrlDeny,
    emailDirector: 'info@farmadescanso.com',
    emailCcResponsable: '',
    emailComercial: comercialEmail || '',
    source: 'crm_gemavip',
    timestamp: new Date().toISOString()
  };

  const whResult = await axios.post(N8N_APROBACION_PEDIDO_WEBHOOK, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
    validateStatus: () => true
  }).then((r) => {
    if (r.status >= 400) console.warn('[WEBHOOK] n8n respondió', r.status, r.statusText, r.data);
    return { ok: r.status < 400, status: r.status };
  }).catch((err) => {
    console.warn('[WEBHOOK] Error enviando a n8n aprobación pedido:', err?.message);
    return { ok: false, error: err?.message };
  });
  return whResult;
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
    const colClienteId = pedidosMeta?.colCliente || 'ped_cli_id';
    const colTipoPedidoId = pickPedidoCol(['Id_TipoPedido', 'ped_tipp_id', 'id_tipo_pedido']);

    const transferSubqueries = colTipoPedidoId
      ? `CASE WHEN tp_t.tipp_tipo IS NOT NULL AND tp_t.tipp_tipo LIKE '%transfer%' THEN COALESCE(${colNumAsociadoHefame ? `NULLIF(p.\`${colNumAsociadoHefame}\`, '')` : 'NULL'}, (SELECT cc.detco_NumAsociado FROM clientes_cooperativas cc WHERE cc.detco_Id_Cliente = p.\`${colClienteId}\` ORDER BY cc.detco_id LIMIT 1)) ELSE NULL END AS NumAsociadoMayorista, CASE WHEN tp_t.tipp_tipo IS NOT NULL AND tp_t.tipp_tipo LIKE '%transfer%' THEN TRIM(REPLACE(tp_t.tipp_tipo, 'Transfer', '')) ELSE NULL END AS NombreMayorista`
      : `NULL AS NumAsociadoMayorista, NULL AS NombreMayorista`;
    const joinTipoPedido = colTipoPedidoId ? `LEFT JOIN tipos_pedidos tp_t ON tp_t.tipp_id = p.\`${colTipoPedidoId}\`` : '';

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
    } catch (e) { warn('[pedidos] estadoIdCol:', e?.message); }

    const currentYear = new Date().getFullYear();
    /** Siempre año calendario en curso (sin desplegable de año en la vista). */
    const selectedYear = currentYear;

    const rawMarca = String(req.query.marca || req.query.brand || '').trim();
    const parsedMarca = rawMarca && /^\d+$/.test(rawMarca) ? Number(rawMarca) : NaN;
    const selectedMarcaId = Number.isFinite(parsedMarca) && parsedMarca > 0 ? parsedMarca : null;

    const rawDesde = String(req.query.desde || '').trim();
    const rawHasta = String(req.query.hasta || '').trim();
    const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
    const selectedDesde = isValidDate(rawDesde) ? rawDesde : '';
    const selectedHasta = isValidDate(rawHasta) ? rawHasta : '';

    const selectedPeriodo = String(req.query.periodo || '').trim().toLowerCase();
    let periodoDateFrom = null;
    let periodoDateTo = null;

    if (selectedDesde || selectedHasta) {
      periodoDateFrom = selectedDesde || `${selectedYear}-01-01`;
      periodoDateTo = selectedHasta || `${selectedYear}-12-31`;
    } else if (selectedPeriodo) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (selectedPeriodo === 'hoy') {
        periodoDateFrom = fmtDate(now);
        periodoDateTo = fmtDate(now);
      } else if (selectedPeriodo === '7d') {
        const d = new Date(now); d.setDate(d.getDate() - 6);
        periodoDateFrom = fmtDate(d);
        periodoDateTo = fmtDate(now);
      } else if (selectedPeriodo === '30d') {
        const d = new Date(now); d.setDate(d.getDate() - 29);
        periodoDateFrom = fmtDate(d);
        periodoDateTo = fmtDate(now);
      } else if (selectedPeriodo === '90d') {
        const d = new Date(now); d.setDate(d.getDate() - 89);
        periodoDateFrom = fmtDate(d);
        periodoDateTo = fmtDate(now);
      } else if (selectedPeriodo === 'mes') {
        periodoDateFrom = `${selectedYear}-${pad(now.getMonth() + 1)}-01`;
        const lastDay = new Date(selectedYear, now.getMonth() + 1, 0).getDate();
        periodoDateTo = `${selectedYear}-${pad(now.getMonth() + 1)}-${pad(lastDay)}`;
      } else if (selectedPeriodo === 'trimestre') {
        const q = Math.floor(now.getMonth() / 3);
        const m1 = q * 3 + 1;
        periodoDateFrom = `${selectedYear}-${pad(m1)}-01`;
        const lastDay = new Date(selectedYear, q * 3 + 3, 0).getDate();
        periodoDateTo = `${selectedYear}-${pad(m1 + 2)}-${pad(lastDay)}`;
      } else if (selectedPeriodo === 'anio_actual') {
        periodoDateFrom = `${currentYear}-01-01`;
        periodoDateTo = `${currentYear}-12-31`;
      } else if (selectedPeriodo === 'anio_anterior') {
        const py = currentYear - 1;
        periodoDateFrom = `${py}-01-01`;
        periodoDateTo = `${py}-12-31`;
      }
    }

    const rawEstadoFilter = String(req.query.estado || '').trim();
    const selectedEstadoId = rawEstadoFilter && /^\d+$/.test(rawEstadoFilter) ? Number(rawEstadoFilter) : null;
    const rawComercialFilter = String(req.query.comercial || '').trim();
    const selectedComercialId = admin && rawComercialFilter && /^\d+$/.test(rawComercialFilter) ? Number(rawComercialFilter) : null;

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
      if (periodoDateFrom && periodoDateTo) {
        where.push(`p.\`${colFecha}\` >= ? AND p.\`${colFecha}\` < ? + INTERVAL 1 DAY`);
        params.push(periodoDateFrom, periodoDateTo);
      } else {
        where.push(`YEAR(p.\`${colFecha}\`) = ?`);
        params.push(selectedYear);
      }
      where.push(`a.\`${colArtMarca}\` = ?`);
      params.push(selectedMarcaId);
      if (scopeUserId) {
        where.push(`p.\`${colComercial}\` = ?`);
        params.push(scopeUserId);
      }
      if (selectedEstadoId && hasEstadoIdCol) {
        where.push(`p.\`${colEstadoId}\` = ?`);
        params.push(selectedEstadoId);
      }
      if (selectedComercialId && colComercial) {
        where.push(`p.\`${colComercial}\` = ?`);
        params.push(selectedComercialId);
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
          ${transferSubqueries},
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
        ${joinTipoPedido}
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
      if (periodoDateFrom && periodoDateTo) {
        where.push(`p.\`${colFecha}\` >= ? AND p.\`${colFecha}\` < ? + INTERVAL 1 DAY`);
        params.push(periodoDateFrom, periodoDateTo);
      } else {
        where.push(`YEAR(p.\`${colFecha}\`) = ?`);
        params.push(selectedYear);
      }
      if (scopeUserId) {
        where.push(`p.\`${colComercial}\` = ?`);
        params.push(scopeUserId);
      }
      if (selectedEstadoId && hasEstadoIdCol) {
        where.push(`p.\`${colEstadoId}\` = ?`);
        params.push(selectedEstadoId);
      }
      if (selectedComercialId && colComercial) {
        where.push(`p.\`${colComercial}\` = ?`);
        params.push(selectedComercialId);
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
          ${transferSubqueries},
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
        ${joinTipoPedido}
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

    await db.ensureEstadosPedidoTable().catch(() => null);
    const [estadosPedido, comercialesList] = await Promise.all([
      db.getEstadosPedidoActivos().catch(() => []),
      admin ? db.getComerciales().catch(() => []) : Promise.resolve([])
    ]);

    const sessionUser = res.locals.user;
    const sessionUserId = sessionUser?.id != null ? Number(sessionUser.id) : null;
    const _per = String(selectedPeriodo).toLowerCase();
    const pedidosAnioEtiqueta =
      !selectedDesde && !selectedHasta && _per === 'anio_anterior'
        ? currentYear - 1
        : currentYear;
    res.render('pedidos', {
      items: items || [],
      selectedYear,
      pedidosAnioEtiqueta,
      marcas: Array.isArray(marcas) ? marcas : [],
      selectedMarcaId,
      selectedPeriodo: (selectedDesde || selectedHasta) ? '' : (selectedPeriodo || ''),
      selectedDesde: selectedDesde || '',
      selectedHasta: selectedHasta || '',
      selectedEstadoId: selectedEstadoId || null,
      selectedComercialId: selectedComercialId || null,
      comercialesList: Array.isArray(comercialesList) ? comercialesList : [],
      q: rawQ,
      admin,
      userId: sessionUserId,
      user: sessionUser,
      estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
      paging: { page, limit, total: totalPedidos }
    });
  } catch (e) {
    next(e);
  }
});

// Cambiar estado del pedido: admin puede cambiar a cualquiera; comercial solo de Pendiente→Revisando
router.post('/:id([0-9]+)/estado', requireLogin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'ID no válido' });

    const admin = isAdminUser(res.locals.user);
    await db.ensureEstadosPedidoTable().catch(() => null);

    const estadoIdRaw = _n(_n(_n(_n(req.body && req.body.estadoId, req.body && req.body.estado_id), req.body && req.body.Id_EstadoPedido), req.body && req.body.id_estado_pedido), null);
    const estadoId = Number(estadoIdRaw);
    if (!Number.isFinite(estadoId) || estadoId <= 0) {
      return res.status(400).json({ ok: false, error: 'Estado no válido' });
    }

    const estado = await db.getEstadoPedidoById(estadoId).catch(() => null);
    if (!estado) return res.status(404).json({ ok: false, error: 'Estado no encontrado' });

    const nombre = String(
      estado.nombre ?? estado.Nombre ?? estado.estped_nombre ?? estado.name ?? ''
    ).trim();
    const color = String(
      estado.color ?? estado.Color ?? estado.estped_color ?? 'info'
    ).trim().toLowerCase() || 'info';

    if (!admin) {
      const pedido = await db.getPedidoById(id).catch(() => null);
      if (!pedido) return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });
      const owner = Number(_n(_n(pedido.ped_com_id, pedido.Id_Cial), pedido.id_cial) || 0);
      const uid = Number(res.locals.user?.id || 0);
      if (!uid || owner !== uid) return res.status(403).json({ ok: false, error: 'No tienes permiso sobre este pedido' });
      const estadoActual = String(_n(_n(_n(pedido.EstadoPedido, pedido.ped_estado_txt), pedido.Estado), 'pendiente')).trim().toLowerCase();
      if (!estadoActual.includes('pend')) {
        return res.status(403).json({ ok: false, error: 'Solo puedes cambiar el estado de pedidos en estado Pendiente' });
      }
      if (!nombre.toLowerCase().includes('revis')) {
        return res.status(403).json({ ok: false, error: 'Solo puedes pasar el pedido a estado Revisando' });
      }
    }

    await db.updatePedido(id, { Id_EstadoPedido: estadoId, EstadoPedido: nombre || undefined }).catch((e) => {
      throw e;
    });

    let webhook = null;
    if (nombre.toLowerCase().includes('revis')) {
      try {
        webhook = await _sendPedidoAprobacionWebhook(id, res.locals.user);
      } catch (whErr) {
        console.warn('[ESTADO] Error enviando webhook aprobación pedido:', whErr?.message);
        webhook = { ok: false, error: whErr?.message };
      }
    }

    return res.json({ ok: true, id, estado: { id: estadoId, nombre: nombre || '—', color }, webhook });
  } catch (e) {
    next(e);
  }
});

router.get('/new', requireLogin, async (_req, res, next) => {
  try {
    const [comerciales, tarifas, formasPago, tiposPedido, descuentosPedido, estadosPedido, estadoPendienteId, provincias, paises] = await Promise.all([
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => []),
      db.getTiposPedido().catch(() => []),
      db.getDescuentosPedidoActivos().catch(() => []),
      db.getEstadosPedidoActivos().catch(() => []),
      db.getEstadoPedidoIdByCodigo('pendiente').catch(() => null),
      loadSimpleCatalogForSelect(db, 'provincias'),
      loadSimpleCatalogForSelect(db, 'paises')
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
    const _filtered = filterOutTransferOptions(formasPago, tiposPedido);
    res.render('pedido-form', {
      mode: 'create',
      admin,
      comerciales: Array.isArray(comerciales) ? comerciales : [],
      tarifas: Array.isArray(tarifas) ? tarifas : [],
      formasPago: _filtered.formasPago,
      tiposPedido: _filtered.tiposPedido,
      descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
      estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
      articulos: Array.isArray(articulos) ? articulos : [],
      provincias: Array.isArray(provincias) ? provincias : [],
      paises: Array.isArray(paises) ? paises : [],
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
    const [comerciales, tarifas, formasPago, tiposPedido, descuentosPedido, estadosPedido, provincias, paises] = await Promise.all([
      db.getComerciales().catch(() => []),
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => []),
      db.getTiposPedido().catch(() => []),
      db.getDescuentosPedidoActivos().catch(() => []),
      db.getEstadosPedidoActivos().catch(() => []),
      loadSimpleCatalogForSelect(db, 'provincias'),
      loadSimpleCatalogForSelect(db, 'paises')
    ]);
    const articulos = await db.getArticulos({}).catch(() => []);
    const body = req.body || {};
    const admin = isAdminUser(res.locals.user);
    const clientesFilters = { comercial: res.locals.user?.id };
    const _ftCreate = filterOutTransferOptions(formasPago, tiposPedido);
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
        formasPago: _ftCreate.formasPago,
        tiposPedido: _ftCreate.tiposPedido,
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        articulos,
        provincias: Array.isArray(provincias) ? provincias : [],
        paises: Array.isArray(paises) ? paises : [],
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
        formasPago: _ftCreate.formasPago,
        tiposPedido: _ftCreate.tiposPedido,
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        articulos,
        provincias: Array.isArray(provincias) ? provincias : [],
        paises: Array.isArray(paises) ? paises : [],
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
        formasPago: _ftCreate.formasPago,
        tiposPedido: _ftCreate.tiposPedido,
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        articulos,
        provincias: Array.isArray(provincias) ? provincias : [],
        paises: Array.isArray(paises) ? paises : [],
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
        formasPago: _ftCreate.formasPago,
        tiposPedido: _ftCreate.tiposPedido,
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        articulos,
        provincias: Array.isArray(provincias) ? provincias : [],
        paises: Array.isArray(paises) ? paises : [],
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
        formasPago: _ftCreate.formasPago,
        tiposPedido: _ftCreate.tiposPedido,
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        articulos,
        provincias: Array.isArray(provincias) ? provincias : [],
        paises: Array.isArray(paises) ? paises : [],
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
      const cliente = await db.getClienteById(finalPayload.Id_Cliente).catch(() => null);
      const clienteNombre = cliente?.cli_nombre_razon_social ?? cliente?.Nombre_Razon_Social ?? cliente?.Nombre ?? ('Cliente ' + finalPayload.Id_Cliente);
      await sendPushToAdmins({
        title: 'Nuevo pedido especial',
        body: `${res.locals.user?.nombre || 'Comercial'} solicita pedido especial: ${clienteNombre}`,
        url: '/notificaciones',
        tipo: 'pedido_especial',
        pedidoId,
        clienteId: finalPayload.Id_Cliente,
        clienteNombre,
        cliente,
        userId: res.locals.user?.id,
        userName: res.locals.user?.nombre,
        userEmail: res.locals.user?.email,
        lineas
      }).catch(() => {});
    }
    return res.redirect(`/pedidos/${pedidoId}`);
  } catch (e) {
    next(e);
  }
});

router.get('/:id([0-9]+)/duplicate', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
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
    const lineas = Array.isArray(lineasRaw) && lineasRaw.length
      ? lineasRaw.map((l) => ({
          Id_Articulo: _n(pickCI(l, ['Id_Articulo', 'id_articulo', 'ArticuloId', 'Articulo_Id']), ''),
          Cantidad: _n(pickCI(l, ['Cantidad', 'cantidad', 'Unidades', 'Uds']), 1),
          Dto: _n(pickCI(l, ['Linea_Dto', 'DtoLinea', 'Dto', 'dto', 'Descuento']), ''),
          PrecioUnitario: _n(pickCI(l, ['Linea_PVP', 'PVP', 'PrecioUnitario', 'Precio', 'PVL']), '')
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

router.get('/:id([0-9]+)', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
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

    const clientePk = Number(cliente?.Id ?? cliente?.cli_id ?? cliente?.id ?? 0) || 0;
    const direccionEnvio = await resolveDireccionEnvio(db, item, clientePk).catch(() => null);

    const estadoNorm = String(_n(_n(_n(item.EstadoPedido, item.Estado), item.ped_estado_txt), '')).trim().toLowerCase() || 'pendiente';
    const userId = Number(res.locals.user?.id);
    const owner = Number(item.ped_com_id ?? item.Id_Cial ?? item.id_cial ?? item.ComercialId ?? item.comercialId ?? 0) || 0;
    const canEdit =
      admin ? !estadoNorm.includes('pagad') : (Number.isFinite(userId) && userId === owner && estadoNorm.includes('pend'));

    const clienteLabel = pickStr(cliente, ['Nombre_Razon_Social', 'cli_nombre_razon_social', 'Nombre', 'nombre']);
    const comercialLabel = pickStr(comercial, ['Nombre', 'com_nombre', 'nombre']);
    const formaPagoLabel = pickStr(formaPago, ['FormaPago', 'formp_nombre', 'Nombre', 'nombre', 'forma_pago']);
    const tarifaLabel = pickStr(tarifa, ['NombreTarifa', 'Nombre', 'nombre', 'tarcli_nombre']);
    const tipoPedidoLabel = pickStr(tipoPedido, ['Nombre', 'Tipo', 'tipp_tipo', 'nombre', 'tipo']);
    const estadoLabel = pickStr(estadoPedido, ['nombre', 'Nombre', 'estped_nombre']) || pickStr(item, ['EstadoPedido', 'Estado', 'ped_estado_txt']) || '';

    let lineasToRender = lineas || [];
    const artIdsNeedingPvl = (lineasToRender || [])
      .map((l) => Number(l.pedart_art_id ?? l.Id_Articulo ?? l.id_articulo ?? l.art_id ?? 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    const needsEnrichment = !isTransfer && (lineasToRender || []).some((l) => {
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

router.get('/:id([0-9]+).xlsx', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    const id = Number(req.params.id);
    let lineas = await db.getArticulosByPedido(id).catch(() => []);
    const cliente = item?.Id_Cliente ? await db.getClienteById(Number(item.Id_Cliente)).catch(() => null) : null;

    const canShowHefame = await canShowHefameForPedido(db, item);
    const mayoristaInfo = canShowHefame ? await resolveMayoristaInfo(db, item) : null;

    const esTransfer = await isTransferPedido(db, item);
    const idTarifa = _n(item?.Id_Tarifa, item?.id_tarifa);
    const artIdsNeedingPvl = (lineas || [])
      .map((l) => Number(l.pedart_art_id ?? l.Id_Articulo ?? l.id_articulo ?? l.art_id ?? 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    const needsEnrichment = !esTransfer && (lineas || []).some((l) => {
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
        const direccionEnvio = await resolveDireccionEnvio(db, item, cliente?.Id).catch(() => null);
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
      const direccionEnvio = await resolveDireccionEnvio(db, item, cliente?.Id).catch(() => null);
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
router.get('/:id([0-9]+)/hefame-send-email', requireLogin, loadPedidoAndCheckOwner, async (req, res) => {
  const item = res.locals.pedido;
  if (!(await canShowHefameForPedido(db, item))) {
    res.status(403).send('HEFAME solo disponible para pedidos con forma de pago Transfer y tipo HEFAME.');
    return;
  }
  const id = Number(req.params.id);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderHefameInfoPage(true, 'El envío por email está temporalmente deshabilitado.\n\nPuede descargar la plantilla Excel con los datos del pedido para Hefame usando el enlace siguiente.', id));
});

router.get('/:id([0-9]+)/transfer-imprimir', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
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

    const numPedido = item?.NumPedido ?? item?.ped_numero ?? item?.Numero_Pedido ?? '';
    const clienteNombre = pickStr(cliente, ['Nombre_Razon_Social', 'cli_nombre_razon_social', 'Nombre', 'nombre']) || item?.Id_Cliente || '';
    const codigoAsociado = mayoristaInfo?.codigoAsociado || String(item?.NumAsociadoHefame ?? item?.num_asociado_hefame ?? '').trim() || '';
    const telefono = pickStr(cliente, ['cli_telefono', 'cli_movil', 'Telefono', 'Movil', 'Teléfono']) || '';
    const cp = String(pickStr(cliente, ['cli_codigo_postal', 'CodigoPostal', 'codigo_postal']) || '').trim();
    const poblacion = String(pickStr(cliente, ['cli_poblacion', 'Poblacion', 'poblacion']) || '').trim();
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

router.get('/:id([0-9]+)/transfer.xlsx', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
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

router.get('/:id([0-9]+)/hefame.xlsx', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
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

router.get('/:id([0-9]+)/edit', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const item = res.locals.pedido;
    const admin = res.locals.pedidoAdmin;
    const id = Number(req.params.id);
    const [tarifas, formasPago, comerciales, tiposPedido, descuentosPedido, estadosPedido, provincias, paises] = await Promise.all([
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => []),
      db.getComerciales().catch(() => []),
      db.getTiposPedido().catch(() => []),
      db.getDescuentosPedidoActivos().catch(() => []),
      db.getEstadosPedidoActivos().catch(() => []),
      loadSimpleCatalogForSelect(db, 'provincias'),
      loadSimpleCatalogForSelect(db, 'paises')
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
    const lineas = Array.isArray(lineasRaw) && lineasRaw.length
      ? lineasRaw.map((l) => ({
          Id_Articulo:
            _n(pickCI(l, [
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
            _n(pickCI(l, ['pedart_cantidad', 'Cantidad', 'cantidad', 'Unidades', 'unidades', 'Uds', 'uds', 'Cant', 'cant']), 1),
          Dto:
            _n(pickCI(l, ['pedart_dto', 'Linea_Dto', 'DtoLinea', 'dto_linea', 'Dto', 'dto', 'DTO', 'Descuento', 'descuento', 'PorcentajeDescuento', 'porcentaje_descuento']), ''),
          PrecioUnitario:
            _n(pickCI(l, ['pedart_pvp', 'Linea_PVP', 'PVP', 'pvp', 'PrecioUnitario', 'precio_unitario', 'Precio', 'precio', 'PVL', 'pvl']), '')
        }))
      : [{ Id_Articulo: '', Cantidad: 1, Dto: '' }];
    const _ftEdit = filterOutTransferOptions(formasPago, tiposPedido);
    res.render('pedido-form', {
      mode: 'edit',
      admin,
      item,
      lineas,
      tarifas,
      formasPago: _ftEdit.formasPago,
      tiposPedido: _ftEdit.tiposPedido,
      descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
      estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
      comerciales,
      articulos,
      provincias: Array.isArray(provincias) ? provincias : [],
      paises: Array.isArray(paises) ? paises : [],
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

router.post('/:id([0-9]+)/edit', requireLogin, loadPedidoAndCheckOwner, async (req, res, next) => {
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

    const [tarifas, formasPago, comerciales, tiposPedido, descuentosPedido, estadosPedido, provincias, paises] = await Promise.all([
      db.getTarifas().catch(() => []),
      db.getFormasPago().catch(() => []),
      db.getComerciales().catch(() => []),
      db.getTiposPedido().catch(() => []),
      db.getDescuentosPedidoActivos().catch(() => []),
      db.getEstadosPedidoActivos().catch(() => []),
      loadSimpleCatalogForSelect(db, 'provincias'),
      loadSimpleCatalogForSelect(db, 'paises')
    ]);
    const articulos = await db.getArticulos({}).catch(() => []);
    const _ftUpdate = filterOutTransferOptions(formasPago, tiposPedido);

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
      ...((esEspecial || (body.Dto != null && body.Dto !== '')) ? { Dto: Number(String(body.Dto || '').replace(',', '.')) || 0 } : {}),
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
        formasPago: _ftUpdate.formasPago,
        tiposPedido: _ftUpdate.tiposPedido,
        descuentosPedido: Array.isArray(descuentosPedido) ? descuentosPedido : [],
        estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
        comerciales,
        articulos,
        provincias: Array.isArray(provincias) ? provincias : [],
        paises: Array.isArray(paises) ? paises : [],
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
      const cliente = await db.getClienteById(pedidoPayload.Id_Cliente).catch(() => null);
      const clienteNombre = cliente?.cli_nombre_razon_social ?? cliente?.Nombre_Razon_Social ?? cliente?.Nombre ?? ('Cliente ' + pedidoPayload.Id_Cliente);
      await sendPushToAdmins({
        title: 'Nuevo pedido especial',
        body: `${res.locals.user?.nombre || 'Comercial'} solicita pedido especial: ${clienteNombre}`,
        url: '/notificaciones',
        tipo: 'pedido_especial',
        pedidoId: id,
        clienteId: pedidoPayload.Id_Cliente,
        clienteNombre,
        cliente,
        userId: res.locals.user?.id,
        userName: res.locals.user?.nombre,
        userEmail: res.locals.user?.email,
        lineas
      }).catch(() => {});
    }
    return res.redirect(`/pedidos/${id}`);
  } catch (e) {
    next(e);
  }
});

router.post('/:id([0-9]+)/delete', requireLogin, requireAdmin, loadPedidoAndCheckOwner, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.deletePedido(id);
    return res.redirect('/pedidos');
  } catch (e) {
    next(e);
  }
});
module.exports = router;
