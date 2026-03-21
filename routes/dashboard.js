/**
 * Ruta del dashboard CRM.
 * Vista Admin: 5 filtros, 7 KPIs, Ranking Comerciales/Zona, Ranking Productos.
 * Vista Comercial: 3 filtros, 6 KPIs, Mis Clientes, Pedidos Recientes, Ranking Productos, Próximas Visitas.
 */

const express = require('express');
const db = require('../config/mysql-crm');
const { _n } = require('../lib/app-helpers');
const { isAdminUser, requireLogin } = require('../lib/auth');
const { warn } = require('../lib/logger');
const {
  PERIOD_OPTIONS,
  parseDashboardFilters,
  getSqlDateRange
} = require('../lib/dashboard-utils');
const {
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
} = require('../lib/dashboard-queries');

const router = express.Router();

router.get('/dashboard', requireLogin, async (req, res, next) => {
  try {
    const MIN_YEAR = 2025;
    const now = new Date();
    const currentYear = now.getFullYear();
    const switchDate = new Date(currentYear, 8, 1, 0, 0, 0, 0);
    const maxYear = now >= switchDate ? currentYear + 1 : currentYear;
    const years = [];
    for (let y = MIN_YEAR; y <= maxYear; y += 1) years.push(y);

    const admin = isAdminUser(res.locals.user);
    const userId = Number(res.locals.user?.id);
    const hasUserId = Number.isFinite(userId) && userId > 0;

    const filters = parseDashboardFilters(req.query, admin);
    const yearRaw = String(req.query?.year || '').trim().toLowerCase();
    const yearParsed = Number(yearRaw);
    const selectedYear =
      yearRaw === 'all' || yearRaw === 'todos'
        ? 'all'
        : (Number.isFinite(yearParsed) && yearParsed >= MIN_YEAR && yearParsed <= maxYear
            ? yearParsed
            : currentYear);
    filters.year = selectedYear;

    const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
    const rawDesde = String(req.query.desde || '').trim();
    const rawHasta = String(req.query.hasta || '').trim();
    const selectedDesde = isValidDate(rawDesde) ? rawDesde : '';
    const selectedHasta = isValidDate(rawHasta) ? rawHasta : '';

    const selectedPeriodo = String(req.query.periodo || '').trim().toLowerCase();
    let dateFrom, dateTo;

    if (selectedDesde || selectedHasta) {
      dateFrom = selectedDesde || `${selectedYear === 'all' ? new Date().getFullYear() : selectedYear}-01-01`;
      dateTo = selectedHasta || `${selectedYear === 'all' ? new Date().getFullYear() : selectedYear}-12-31`;
    } else if (['hoy', '7d', '30d', '90d', 'mes', 'trimestre'].includes(selectedPeriodo)) {
      const _now = new Date();
      const _pad = (n) => String(n).padStart(2, '0');
      const _fmt = (d) => `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
      const _yr = selectedYear === 'all' ? _now.getFullYear() : Number(selectedYear);
      if (selectedPeriodo === 'hoy') { dateFrom = _fmt(_now); dateTo = _fmt(_now); }
      else if (selectedPeriodo === '7d') { const d = new Date(_now); d.setDate(d.getDate() - 6); dateFrom = _fmt(d); dateTo = _fmt(_now); }
      else if (selectedPeriodo === '30d') { const d = new Date(_now); d.setDate(d.getDate() - 29); dateFrom = _fmt(d); dateTo = _fmt(_now); }
      else if (selectedPeriodo === '90d') { const d = new Date(_now); d.setDate(d.getDate() - 89); dateFrom = _fmt(d); dateTo = _fmt(_now); }
      else if (selectedPeriodo === 'mes') { dateFrom = `${_yr}-${_pad(_now.getMonth() + 1)}-01`; dateTo = `${_yr}-${_pad(_now.getMonth() + 1)}-${_pad(new Date(_yr, _now.getMonth() + 1, 0).getDate())}`; }
      else if (selectedPeriodo === 'trimestre') { const q = Math.floor(_now.getMonth() / 3); const m1 = q * 3 + 1; dateFrom = `${_yr}-${_pad(m1)}-01`; dateTo = `${_yr}-${_pad(m1 + 2)}-${_pad(new Date(_yr, q * 3 + 3, 0).getDate())}`; }
    } else {
      const range = getSqlDateRange(filters);
      dateFrom = range.from;
      dateTo = range.to;
    }
    const hasDateFilter = dateFrom && dateTo;

    const rawEstadoFilter = String(req.query.estado || '').trim();
    const selectedEstadoId = rawEstadoFilter && /^\d+$/.test(rawEstadoFilter) ? Number(rawEstadoFilter) : null;

    const meta = await resolveDashboardMeta(db);
    const { metaVisitas, pedidosMeta, clientesMeta, comercialesMeta,
      tPedidos, tClientes, pkClientes,
      colPedComercial, colPedCliente, colPedFecha, colPedNum,
      colPedTotal, colPedEstado, colEstadoId,
      colNombreRazon, colPoblacion, colCodigoPostal, colOK_KO,
      pedidosCols } = meta;

    const buildPedidosBaseWhere = (comercialId = null) => {
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
      return { where, params };
    };

    const ccaaJoin = CCAA_JOIN;
    const zoneCondition = admin && filters.zone ? `AND cp.codpos_ComunidadAutonoma = ?` : '';
    const zoneParams = admin && filters.zone ? [filters.zone] : [];

    let ventas = 0;
    let numPedidos = 0;
    let numVisitas = 0;
    let contactosNuevos = null;
    let farmaciasActivas = null;
    let coberturaCCAA = null;
    let clientesActivos = null;
    let ticketMedio = null;

    const pedWhere = buildPedidosBaseWhere();
    const pedWhereClause = pedWhere.where.length ? `WHERE ${pedWhere.where.join(' AND ')}` : '';
    const pedWhereParams = pedWhere.params;

    const pedidosWithZone = admin && filters.zone;

    try {
      const { total, n } = await queryKpiVentasYPedidos(db, {
        tPedidos, tClientes, pkClientes, colPedCliente, colPedTotal,
        pedWhereClause, pedWhereParams, pedidosWithZone, ccaaJoin, zoneCondition, zoneParams
      });
      ventas = Number(_n(total, 0));
      numPedidos = Number(_n(n, 0));
    } catch (e) { warn('[dashboard]', e?.message); }

    ticketMedio = numPedidos > 0 ? Math.round((ventas / numPedidos) * 100) / 100 : null;

    if (metaVisitas?.table) {
      try {
        numVisitas = Number(_n(await queryKpiNumVisitas(db, metaVisitas, {
          admin, filters, hasUserId, userId, hasDateFilter, dateFrom, dateTo
        }), 0));
      } catch (e) { warn('[dashboard]', e?.message); }
    }

    const hasCreadoHolded = meta.clientesCols.some((c) => /creado_holded/i.test(c));
    if (hasCreadoHolded && hasDateFilter) {
      try {
        contactosNuevos = Number(_n(await queryKpiContactosNuevosHolded(db, {
          tClientes, clientesMeta, ccaaJoin, admin, filters, hasUserId, userId,
          hasDateFilter, dateFrom, dateTo
        }), 0));
      } catch (e) {
        warn('[dashboard] contactosNuevos', e?.message);
        contactosNuevos = null;
      }
    }

    if (admin && hasDateFilter) {
      try {
        farmaciasActivas = Number(_n(await queryKpiFarmaciasActivas(db, {
          tPedidos, tClientes, pkClientes, colPedCliente, colPedComercial, colPedFecha,
          ccaaJoin, zoneCondition, zoneParams, filters, hasDateFilter, dateFrom, dateTo
        }), 0));
      } catch (e) { warn('[dashboard]', e?.message); }

      try {
        coberturaCCAA = Number(_n(await queryKpiCoberturaCCAA(db, {
          tPedidos, tClientes, pkClientes, colPedCliente, colPedComercial, colPedFecha,
          ccaaJoin, filters, hasDateFilter, dateFrom, dateTo
        }), 0));
      } catch (e) { warn('[dashboard]', e?.message); }
    }

    if (!admin && hasUserId) {
      try {
        clientesActivos = Number(_n(await queryKpiClientesActivosComercial(db, {
          tPedidos, colPedCliente, colPedComercial, colPedFecha, userId, hasDateFilter, dateFrom, dateTo
        }), 0));
      } catch (e) { warn('[dashboard]', e?.message); }
    }

    let numClientes = 0;
    if (admin) {
      try {
        numClientes = Number(_n(await queryKpiNumClientesAdmin(db, {
          tClientes, clientesMeta, filters
        }), 0));
      } catch (e) { warn('[dashboard]', e?.message); }
    } else if (hasUserId) {
      numClientes = await db.countClientesOptimizado({ comercial: userId }).catch(() => 0);
    }

    let numComerciales = null;
    if (admin) {
      try {
        numComerciales = Number(_n(await queryKpiNumComerciales(db), 0));
      } catch (e) { warn('[dashboard]', e?.message); }
    }

    const stats = {
      ventas,
      pedidos: numPedidos,
      visitas: numVisitas,
      clientes: numClientes,
      comerciales: numComerciales,
      ticketMedio,
      contactosNuevos,
      farmaciasActivas,
      coberturaCCAA,
      clientesActivos
    };

    let desgloseEstado = [];
    try {
      desgloseEstado = await queryDesgloseEstadoPedidos(db, pedidosCols, {
        tPedidos, tClientes, pkClientes, colPedCliente, colPedTotal,
        pedWhere, pedidosWithZone, ccaaJoin, zoneParams
      });
    } catch (e) {
      desgloseEstado = [];
    }

    const pendientesCount = desgloseEstado.reduce((n, r) => n + (String(r.estado || '').toLowerCase().includes('pend') ? Number(r.pedidos || 0) : 0), 0);
    stats.pendientes = pendientesCount;

    const limitAdmin = 10;
    const limitComercial = 8;
    const latest = { clientes: [], pedidos: [], visitas: [], proximasVisitas: [] };
    let rankingComerciales = [];
    let rankingZona = [];
    let rankingProductos = [];
    let dashboardErrors = {};

    const colClientePedido = pedidosMeta?.colCliente || 'ped_cli_id';

    if (admin) {
      if (filters.zone) {
        try {
          rankingZona = await queryRankingZonaPedidos(db, {
            tPedidos, tClientes, pkClientes, colPedCliente, colPedTotal, colPedFecha, colPedComercial,
            ccaaJoin, filters, hasDateFilter, dateFrom, dateTo
          });
        } catch (e) {
          dashboardErrors.rankingZona = e?.message;
        }
      } else {
        try {
          rankingComerciales = await queryRankingComercialesPedidos(db, comercialesMeta, {
            tPedidos, colPedFecha, colPedComercial, colPedTotal, filters, hasDateFilter, dateFrom, dateTo
          });
        } catch (e) {
          dashboardErrors.rankingComerciales = e?.message;
        }
      }

      try {
        rankingProductos = await queryRankingProductos(db, {
          tPedidos, colPedFecha, colPedComercial,
          dateFrom: hasDateFilter ? dateFrom : null,
          dateTo: hasDateFilter ? dateTo : null,
          comercialId: filters.comercial || null,
          marcaId: filters.marca || null,
          limit: 15
        });
      } catch (e) {
        dashboardErrors.rankingProductos = e?.message;
      }

      try {
        latest.clientes = await queryLatestClientesAdminDashboard(db, {
          tClientes, tPedidos, pkClientes, colNombreRazon, colPoblacion, colCodigoPostal, colOK_KO,
          colPedTotal, colPedFecha, colPedComercial, colClientePedido,
          filters, hasDateFilter, dateFrom, dateTo, limitAdmin
        });
      } catch (e) {
        latest.clientes = [];
        dashboardErrors.clientes = e?.message;
      }

      const pedWhereAdmin = buildPedidosBaseWhere();
      const pedWhereAdminClause = pedWhereAdmin.where.length ? `WHERE ${pedWhereAdmin.where.join(' AND ')}` : '';
      try {
        latest.pedidos = await queryLatestPedidosAdminDashboard(db, {
          tPedidos, colPedNum, colPedFecha, colPedTotal, colPedEstado,
          pedWhereClause: pedWhereAdminClause, pedWhereParams: pedWhereAdmin.params, limitAdmin
        });
      } catch (e) {
        latest.pedidos = [];
        dashboardErrors.pedidos = e?.message;
      }

      if (metaVisitas?.table) {
        try {
          latest.visitas = await queryLatestVisitasAdminDashboard(db, metaVisitas, clientesMeta, comercialesMeta, {
            colNombreRazon, pkClientes, hasDateFilter, dateFrom, dateTo, filters
          });
        } catch (e) { warn('[dashboard]', e?.message); }
      }
    } else {
      try {
        latest.clientes = await queryMisClientesComercialDashboard(db, metaVisitas, clientesMeta, {
          tClientes, tPedidos, pkClientes, colNombreRazon, colPedTotal, colPedFecha, colPedCliente, colPedComercial,
          userId, hasDateFilter, dateFrom, dateTo, limitComercial
        });
        if (!Array.isArray(latest.clientes)) latest.clientes = [];
        latest.clientes.forEach((c) => {
          c.TicketMedio = c.NumPedidos > 0 ? Math.round((Number(c.TotalFacturado || 0) / c.NumPedidos) * 100) / 100 : null;
        });
      } catch (e) {
        latest.clientes = [];
      }

      const pedEstadoFilter = filters.pedidoEstado !== 'todos' ? `AND p.\`${colPedEstado}\` LIKE ?` : '';
      const pedEstadoParam = filters.pedidoEstado !== 'todos' ? [`%${filters.pedidoEstado}%`] : [];
      try {
        latest.pedidos = await queryLatestPedidosComercialDashboard(db, {
          tPedidos, tClientes, pkClientes, colPedCliente, colNombreRazon,
          colPedNum, colPedFecha, colPedTotal, colPedEstado, colPedComercial,
          userId, hasDateFilter, dateFrom, dateTo, pedEstadoFilter, pedEstadoParam, limitComercial
        });
      } catch (e) {
        warn('[dashboard] pedidos comercial', e?.message);
        latest.pedidos = [];
      }

      try {
        rankingProductos = await queryRankingProductos(db, {
          tPedidos, colPedFecha, colPedComercial,
          dateFrom: hasDateFilter ? dateFrom : null,
          dateTo: hasDateFilter ? dateTo : null,
          comercialId: userId,
          marcaId: filters.marca || null,
          limit: 10
        });
      } catch (e) { warn('[dashboard]', e?.message); }

      if (metaVisitas?.table) {
        try {
          const hoy = now.toISOString().slice(0, 10);
          latest.proximasVisitas = await queryProximasVisitasComercialDashboard(db, metaVisitas, {
            colNombreRazon, pkClientes, tClientes, userId, hoy
          });
        } catch (e) { warn('[dashboard]', e?.message); }
      }
    }

    const filterCatalogs = admin
      ? await loadDashboardFilterCatalogs(db, comercialesMeta)
      : { zonas: [], comercialesList: [], marcasList: [] };
    let { zonas, comercialesList, marcasList } = filterCatalogs;
    if (!admin) {
      const mc = await loadMarcasComercialesParaComercial(db, comercialesMeta);
      marcasList = mc.marcasList;
      comercialesList = mc.comercialesList;
    }

    await db.ensureEstadosPedidoTable().catch(() => null);
    const estadosPedido = await db.getEstadosPedidoActivos().catch(() => []);

    res.render('dashboard', {
      stats,
      latest,
      rankingComerciales,
      rankingZona,
      rankingProductos,
      desgloseEstado: Array.isArray(desgloseEstado) ? desgloseEstado : [],
      estadosPedido: Array.isArray(estadosPedido) ? estadosPedido : [],
      dashboardErrors: dashboardErrors || {},
      years,
      selectedYear,
      selectedPeriodo: (selectedDesde || selectedHasta) ? '' : selectedPeriodo,
      selectedDesde,
      selectedHasta,
      selectedEstadoId,
      filters,
      periodOptions: PERIOD_OPTIONS,
      zonas,
      comercialesList,
      marcasList
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
