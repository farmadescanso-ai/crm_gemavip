/**
 * Ruta del dashboard CRM.
 * Vista Admin: 5 filtros, 7 KPIs, Ranking Comerciales/Zona, Ranking Productos.
 * Vista Comercial: 3 filtros, 6 KPIs, Mis Clientes, Pedidos Recientes, Ranking Productos, Próximas Visitas.
 */

const express = require('express');
const db = require('../config/mysql-crm');
const { _n } = require('../lib/app-helpers');
const { isAdminUser, requireLogin } = require('../lib/auth');
const {
  PERIOD_OPTIONS,
  parseDashboardFilters,
  getSqlDateRange
} = require('../lib/dashboard-utils');

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

    const { from: dateFrom, to: dateTo } = getSqlDateRange(filters);
    const hasDateFilter = dateFrom && dateTo;

    const metaVisitas = await db._ensureVisitasMeta().catch(() => null);
    const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
    const clientesMeta = await db._ensureClientesMeta().catch(() => null);
    const comercialesMeta = await db._ensureComercialesMeta().catch(() => null);

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
        where.push(`DATE(p.\`${colPedFecha}\`) BETWEEN ? AND ?`);
        params.push(dateFrom, dateTo);
      }
      return { where, params };
    };

    const ccaaJoin = `LEFT JOIN codigos_postales cp ON (cp.codpos_id = c.cli_codp_id OR (c.cli_codp_id IS NULL AND cp.codpos_CodigoPostal = c.cli_codigo_postal))`;
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
    let ventasSql = `SELECT COALESCE(SUM(COALESCE(p.\`${colPedTotal}\`, 0)), 0) AS total, COUNT(*) AS n FROM \`${tPedidos}\` p`;
    let ventasParams = [];

    if (pedidosWithZone) {
      ventasSql += ` INNER JOIN \`${tClientes}\` c ON c.\`${pkClientes}\` = p.\`${colPedCliente}\` ${ccaaJoin} ${pedWhereClause} ${zoneCondition}`;
      ventasParams = [...pedWhereParams, ...zoneParams];
    } else {
      ventasSql += ` ${pedWhereClause}`;
      ventasParams = pedWhereParams;
    }

    try {
      const [ventasRow] = await db.query(ventasSql, ventasParams);
      ventas = Number(_n(ventasRow?.total, 0));
      numPedidos = Number(_n(ventasRow?.n, 0));
    } catch (_) {}

    ticketMedio = numPedidos > 0 ? Math.round((ventas / numPedidos) * 100) / 100 : null;

    if (metaVisitas?.table) {
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
        visWhere.push(`DATE(\`${metaVisitas.colFecha}\`) BETWEEN ? AND ?`);
        visParams.push(dateFrom, dateTo);
      }
      const visWhereSql = visWhere.length ? `WHERE ${visWhere.join(' AND ')}` : '';
      try {
        const [visRow] = await db.query(`SELECT COUNT(*) AS n FROM \`${metaVisitas.table}\` ${visWhereSql}`, visParams);
        numVisitas = Number(_n(visRow?.n, 0));
      } catch (_) {}
    }

    const clientesCols = await db._getColumns(tClientes).catch(() => []);
    const hasCreadoHolded = clientesCols.some((c) => /creado_holded/i.test(c));
    if (hasCreadoHolded && hasDateFilter) {
      try {
        const cliWhere = [];
        const cliParams = [];
        if (admin && filters.comercial) {
          cliWhere.push(`c.\`${clientesMeta?.colComercial || 'cli_com_id'}\` = ?`);
          cliParams.push(filters.comercial);
        } else if (!admin && hasUserId) {
          cliWhere.push(`c.\`${clientesMeta?.colComercial || 'cli_com_id'}\` = ?`);
          cliParams.push(userId);
        }
        cliWhere.push(`DATE(c.cli_creado_holded) BETWEEN ? AND ?`);
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
        contactosNuevos = Number(_n(cnRow?.n, 0));
      } catch (_) {
        contactosNuevos = null;
      }
    }

    if (admin && hasDateFilter) {
      try {
        const faWhere = []; const faParams = [];
        if (filters.comercial) {
          faWhere.push(`p.\`${colPedComercial}\` = ?`);
          faParams.push(filters.comercial);
        }
        faWhere.push(`DATE(p.\`${colPedFecha}\`) BETWEEN ? AND ?`);
        faParams.push(dateFrom, dateTo);
        const faJoin = filters.zone ? `INNER JOIN \`${tClientes}\` c ON c.\`${pkClientes}\` = p.\`${colPedCliente}\` ${ccaaJoin} ${zoneCondition}` : '';
        const [faRow] = await db.query(
          `SELECT COUNT(DISTINCT p.\`${colPedCliente}\`) AS n FROM \`${tPedidos}\` p ${faJoin} WHERE ${faWhere.join(' AND ')}`,
          filters.zone ? [...faParams, ...zoneParams] : faParams
        );
        farmaciasActivas = Number(_n(faRow?.n, 0));
      } catch (_) {}

      try {
        const ccJoin = buildClienteCCAAJoin();
        const ccWhere = []; const ccParams = [];
        if (filters.comercial) {
          ccWhere.push(`p.\`${colPedComercial}\` = ?`);
          ccParams.push(filters.comercial);
        }
        ccWhere.push(`DATE(p.\`${colPedFecha}\`) BETWEEN ? AND ?`);
        ccParams.push(dateFrom, dateTo);
        const [ccRow] = await db.query(
          `SELECT COUNT(DISTINCT COALESCE(cp.codpos_ComunidadAutonoma, 'Sin CCAA')) AS n
           FROM \`${tPedidos}\` p INNER JOIN \`${tClientes}\` c ON c.\`${pkClientes}\` = p.\`${colPedCliente}\`
           ${ccJoin} WHERE ${ccWhere.join(' AND ')}`,
          ccParams
        );
        coberturaCCAA = Number(_n(ccRow?.n, 0));
      } catch (_) {}
    }

    if (!admin && hasUserId) {
      try {
        const caWhere = []; const caParams = [userId];
        if (hasDateFilter) {
          caWhere.push(`DATE(p.\`${colPedFecha}\`) BETWEEN ? AND ?`);
          caParams.push(dateFrom, dateTo);
        }
        const caWhereSql = caWhere.length ? `AND ${caWhere.join(' AND ')}` : '';
        const [caRow] = await db.query(
          `SELECT COUNT(DISTINCT p.\`${colPedCliente}\`) AS n FROM \`${tPedidos}\` p
           WHERE p.\`${colPedComercial}\` = ? ${caWhereSql}`,
          caParams
        );
        clientesActivos = Number(_n(caRow?.n, 0));
      } catch (_) {}
    }

    let numClientes = 0;
    if (admin) {
      try {
        const cliWhere = []; const cliParams = [];
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
        numClientes = Number(_n(cliRow?.n, 0));
      } catch (_) {}
    } else if (hasUserId) {
      numClientes = await db.countClientesOptimizado({ comercial: userId }).catch(() => 0);
    }

    let numComerciales = null;
    if (admin) {
      try {
        const [comRow] = await db.query('SELECT COUNT(*) AS n FROM comerciales');
        numComerciales = Number(_n(comRow?.n, 0));
      } catch (_) {}
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
      const colEstadoId = db._pickCIFromColumns(pedidosCols, ['Id_EstadoPedido', 'id_estado_pedido', 'ped_estped_id']);
      if (colEstadoId) {
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
        desgloseEstado = await db.query(deSql, deParams);
      }
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
    const colPoblacion = db._pickCIFromColumns(clientesCols, ['cli_poblacion', 'Poblacion']) || 'cli_poblacion';
    const colCodigoPostal = db._pickCIFromColumns(clientesCols, ['cli_codigo_postal', 'CodigoPostal']) || 'cli_codigo_postal';
    const colOK_KO = db._pickCIFromColumns(clientesCols, ['cli_ok_ko', 'OK_KO']) || 'cli_ok_ko';

    if (admin) {
      if (filters.zone) {
        try {
          const rzWhere = ['cp.codpos_ComunidadAutonoma = ?']; const rzParams = [filters.zone];
          if (hasDateFilter) {
            rzWhere.push(`DATE(p.\`${colPedFecha}\`) BETWEEN ? AND ?`);
            rzParams.push(dateFrom, dateTo);
          }
          if (filters.comercial) {
            rzWhere.push(`p.\`${colPedComercial}\` = ?`);
            rzParams.push(filters.comercial);
          }
          rankingZona = await db.query(
            `SELECT cp.codpos_ComunidadAutonoma AS Zona,
              COALESCE(SUM(COALESCE(p.\`${colPedTotal}\`, 0)), 0) AS Ventas,
              COUNT(*) AS Pedidos,
              COALESCE(SUM(COALESCE(p.\`${colPedTotal}\`, 0)), 0) / NULLIF(COUNT(*), 0) AS TicketMedio
             FROM \`${tPedidos}\` p INNER JOIN \`${tClientes}\` c ON c.\`${pkClientes}\` = p.\`${colPedCliente}\`
             ${ccaaJoin} WHERE ${rzWhere.join(' AND ')}
             GROUP BY cp.codpos_ComunidadAutonoma ORDER BY Ventas DESC LIMIT 10`,
            rzParams
          );
        } catch (e) {
          dashboardErrors.rankingZona = e?.message;
        }
      } else {
        try {
          const rcWhere = []; const rcParams = [];
          if (hasDateFilter) {
            rcWhere.push(`DATE(p.\`${colPedFecha}\`) BETWEEN ? AND ?`);
            rcParams.push(dateFrom, dateTo);
          } else {
            rcWhere.push('1=1');
          }
          if (filters.comercial) {
            rcWhere.push(`p.\`${colPedComercial}\` = ?`);
            rcParams.push(filters.comercial);
          }
          const provJoin = comercialesMeta?.table ? `LEFT JOIN provincias prov ON prov.prov_id = co.com_prov_id` : '';
          rankingComerciales = await db.query(
            `SELECT co.\`${comercialesMeta?.pk || 'com_id'}\` AS ComercialId, co.\`${comercialesMeta?.colNombre || 'com_nombre'}\` AS Comercial,
              prov.prov_nombre AS Zona,
              COALESCE(SUM(COALESCE(p.\`${colPedTotal}\`, 0)), 0) AS Ventas,
              COUNT(*) AS Pedidos,
              COALESCE(SUM(COALESCE(p.\`${colPedTotal}\`, 0)), 0) / NULLIF(COUNT(*), 0) AS TicketMedio
             FROM \`${tPedidos}\` p
             INNER JOIN \`${comercialesMeta?.table || 'comerciales'}\` co ON co.\`${comercialesMeta?.pk || 'com_id'}\` = p.\`${colPedComercial}\`
             ${provJoin}
             WHERE ${rcWhere.join(' AND ')}
             GROUP BY co.\`${comercialesMeta?.pk || 'com_id'}\`, co.\`${comercialesMeta?.colNombre || 'com_nombre'}\`, prov.prov_nombre
             ORDER BY Ventas DESC LIMIT 10`,
            rcParams
          );
        } catch (e) {
          dashboardErrors.rankingComerciales = e?.message;
        }
      }

      try {
        const paMeta = await db._ensurePedidosArticulosMeta().catch(() => null);
        const tPA = paMeta?.table || 'pedidos_articulos';
        const colPaPedId = paMeta?.colPedidoId || 'pedart_ped_id';
        const colPaArtId = paMeta?.colArticulo || 'pedart_art_id';
        const paCols = await db._getColumns(tPA).catch(() => []);
        const colPaCantidad = db._pickCIFromColumns(paCols, ['pedart_cantidad', 'Cantidad']) || 'pedart_cantidad';
        const colPaPvp = db._pickCIFromColumns(paCols, ['pedart_pvp', 'PVP', 'pvp']) || 'pedart_pvp';

        const rpWhere = []; const rpParams = [];
        if (hasDateFilter) {
          rpWhere.push(`DATE(p.\`${colPedFecha}\`) BETWEEN ? AND ?`);
          rpParams.push(dateFrom, dateTo);
        }
        if (filters.comercial) {
          rpWhere.push(`p.\`${colPedComercial}\` = ?`);
          rpParams.push(filters.comercial);
        }
        if (filters.marca) {
          rpWhere.push('a.art_mar_id = ?');
          rpParams.push(filters.marca);
        }
        if (rpWhere.length === 0) rpWhere.push('1=1');

        rpWhere.push('(COALESCE(a.art_activo, 1) = 1)');
        rankingProductos = await db.query(
          `SELECT a.art_id AS ArtId, a.art_nombre AS Producto,
            COALESCE(SUM(COALESCE(pa.\`${colPaCantidad}\`, 0) * COALESCE(pa.\`${colPaPvp}\`, 0)), 0) AS Ventas,
            COALESCE(SUM(COALESCE(pa.\`${colPaCantidad}\`, 0)), 0) AS Unidades
           FROM \`${tPedidos}\` p
           INNER JOIN \`${tPA}\` pa ON pa.\`${colPaPedId}\` = p.ped_id
           INNER JOIN articulos a ON a.art_id = pa.\`${colPaArtId}\`
           WHERE ${rpWhere.join(' AND ')}
           GROUP BY a.art_id, a.art_nombre ORDER BY Ventas DESC LIMIT 15`,
          rpParams
        );

        const totalVentasProd = rankingProductos.reduce((s, r) => s + Number(r.Ventas || 0), 0);
        rankingProductos = rankingProductos.map((r) => ({
          ...r,
          PctTotal: totalVentasProd > 0 ? Math.round((Number(r.Ventas || 0) / totalVentasProd) * 100) : 0
        }));
      } catch (e) {
        dashboardErrors.rankingProductos = e?.message;
      }

      try {
        const adminCliWhere = [];
        const adminCliParams = [];
        if (filters.zone) adminCliParams.push(filters.zone);
        if (hasDateFilter && colPedFecha) {
          adminCliWhere.push(`DATE(p.\`${colPedFecha}\`) BETWEEN ? AND ?`);
          adminCliParams.push(dateFrom, dateTo);
        }
        if (filters.comercial) {
          adminCliWhere.push(`p.\`${colPedComercial}\` = ?`);
          adminCliParams.push(filters.comercial);
        }
        const adminCliWhereSql = adminCliWhere.length ? `WHERE ${adminCliWhere.join(' AND ')}` : '';
        latest.clientes = await db.query(
          `SELECT c.\`${pkClientes}\` AS Id, c.\`${colNombreRazon}\` AS Nombre_Razon_Social, c.\`${colPoblacion}\` AS Poblacion, c.\`${colCodigoPostal}\` AS CodigoPostal, c.\`${colOK_KO}\` AS OK_KO,
            COALESCE(SUM(COALESCE(p.\`${colPedTotal}\`, 0)), 0) AS TotalFacturado
           FROM \`${tClientes}\` c
           INNER JOIN \`${tPedidos}\` p ON p.\`${colClientePedido}\` = c.\`${pkClientes}\`
           ${filters.zone ? `INNER JOIN codigos_postales cp ON (cp.codpos_id = c.cli_codp_id OR (c.cli_codp_id IS NULL AND cp.codpos_CodigoPostal = c.cli_codigo_postal)) AND cp.codpos_ComunidadAutonoma = ?` : ''}
           ${adminCliWhereSql}
           GROUP BY c.\`${pkClientes}\`, c.\`${colNombreRazon}\`, c.\`${colPoblacion}\`, c.\`${colCodigoPostal}\`, c.\`${colOK_KO}\`
           ORDER BY TotalFacturado DESC LIMIT ${limitAdmin}`,
          adminCliParams
        );
      } catch (e) {
        latest.clientes = [];
        dashboardErrors.clientes = e?.message;
      }

      const pedWhereAdmin = buildPedidosBaseWhere();
      const pedWhereAdminClause = pedWhereAdmin.where.length ? `WHERE ${pedWhereAdmin.where.join(' AND ')}` : '';
      try {
        latest.pedidos = await db.query(
          `SELECT p.ped_id AS Id, p.\`${colPedNum}\` AS NumPedido, p.\`${colPedFecha}\` AS FechaPedido, p.\`${colPedTotal}\` AS TotalPedido, p.\`${colPedEstado}\` AS EstadoPedido
           FROM \`${tPedidos}\` p ${pedWhereAdminClause} ORDER BY p.ped_id DESC LIMIT ${limitAdmin}`,
          pedWhereAdmin.params
        );
      } catch (e) {
        latest.pedidos = [];
        dashboardErrors.pedidos = e?.message;
      }

      if (metaVisitas?.table) {
        const visWhere = []; const visParams = [];
        if (hasDateFilter && metaVisitas.colFecha) {
          visWhere.push(`DATE(v.\`${metaVisitas.colFecha}\`) BETWEEN ? AND ?`);
          visParams.push(dateFrom, dateTo);
        }
        if (filters.comercial) {
          visWhere.push(`v.\`${metaVisitas.colComercial}\` = ?`);
          visParams.push(filters.comercial);
        }
        const visWhereSql = visWhere.length ? `WHERE ${visWhere.join(' AND ')}` : '';
        try {
          const tClientesQ = clientesMeta?.tClientes ? `\`${clientesMeta.tClientes}\`` : '`clientes`';
          const tComercialesQ = comercialesMeta?.table ? `\`${comercialesMeta.table}\`` : '`comerciales`';
          latest.visitas = await db.query(
            `SELECT v.\`${metaVisitas.pk}\` AS Id, v.\`${metaVisitas.colFecha}\` AS Fecha, v.\`${metaVisitas.colTipo}\` AS TipoVisita, v.\`${metaVisitas.colEstado}\` AS Estado,
              c.\`${colNombreRazon}\` AS ClienteNombre, co.\`${comercialesMeta?.colNombre || 'com_nombre'}\` AS ComercialNombre
             FROM \`${metaVisitas.table}\` v
             LEFT JOIN ${tClientesQ} c ON c.\`${pkClientes}\` = v.\`${metaVisitas.colCliente}\`
             LEFT JOIN ${tComercialesQ} co ON co.\`${comercialesMeta?.pk || 'com_id'}\` = v.\`${metaVisitas.colComercial}\`
             ${visWhereSql} ORDER BY v.\`${metaVisitas.pk}\` DESC LIMIT 10`,
            visParams
          );
        } catch (_) {}
      }
    } else {
      try {
        const mcParams = [userId];
        if (hasDateFilter) mcParams.push(dateFrom, dateTo);
        latest.clientes = await db.query(
          `SELECT c.\`${pkClientes}\` AS Id, c.\`${colNombreRazon}\` AS Nombre_Razon_Social,
            COALESCE(SUM(p.\`${colPedTotal}\`), 0) AS TotalFacturado,
            COUNT(p.ped_id) AS NumPedidos,
            (SELECT MAX(v.\`${metaVisitas?.colFecha}\`) FROM \`${metaVisitas?.table}\` v WHERE v.\`${metaVisitas?.colCliente}\` = c.\`${pkClientes}\` AND v.\`${metaVisitas?.colComercial}\` = ?) AS UltimaVisita,
            MAX(p.\`${colPedFecha}\`) AS UltimoPedido
           FROM \`${tClientes}\` c
           LEFT JOIN \`${tPedidos}\` p ON p.\`${colPedCliente}\` = c.\`${pkClientes}\` AND p.\`${colPedComercial}\` = ? ${hasDateFilter ? `AND DATE(p.\`${colPedFecha}\`) BETWEEN ? AND ?` : ''}
           WHERE c.\`${clientesMeta?.colComercial || 'cli_com_id'}\` = ?
           GROUP BY c.\`${pkClientes}\`, c.\`${colNombreRazon}\`
           ORDER BY TotalFacturado DESC LIMIT ${limitComercial}`,
          hasDateFilter ? [userId, userId, dateFrom, dateTo, userId] : [userId, userId, userId]
        );
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
        latest.pedidos = await db.query(
          `SELECT p.ped_id AS Id, p.\`${colPedNum}\` AS NumPedido, p.\`${colPedFecha}\` AS FechaPedido, p.\`${colPedTotal}\` AS TotalPedido, p.\`${colPedEstado}\` AS EstadoPedido,
            c.\`${colNombreRazon}\` AS ClienteNombre
           FROM \`${tPedidos}\` p LEFT JOIN \`${tClientes}\` c ON c.\`${pkClientes}\` = p.\`${colPedCliente}\`
           WHERE p.\`${colPedComercial}\` = ? ${hasDateFilter ? `AND DATE(p.\`${colPedFecha}\`) BETWEEN ? AND ?` : ''} ${pedEstadoFilter}
           ORDER BY p.ped_id DESC LIMIT ${limitComercial}`,
          [userId, ...(hasDateFilter ? [dateFrom, dateTo] : []), ...pedEstadoParam]
        );
      } catch (_) {
        latest.pedidos = [];
      }

      try {
        const paMeta = await db._ensurePedidosArticulosMeta().catch(() => null);
        const tPA = paMeta?.table || 'pedidos_articulos';
        const colPaPedId = paMeta?.colPedidoId || 'pedart_ped_id';
        const colPaArtId = paMeta?.colArticulo || 'pedart_art_id';
        const paCols = await db._getColumns(tPA).catch(() => []);
        const colPaCantidad = db._pickCIFromColumns(paCols, ['pedart_cantidad', 'Cantidad']) || 'pedart_cantidad';
        const colPaPvp = db._pickCIFromColumns(paCols, ['pedart_pvp', 'PVP']) || 'pedart_pvp';

        const rpWhere = ['p.\`' + colPedComercial + '\` = ?']; const rpParams = [userId];
        if (hasDateFilter) {
          rpWhere.push(`DATE(p.\`${colPedFecha}\`) BETWEEN ? AND ?`);
          rpParams.push(dateFrom, dateTo);
        }
        if (filters.marca) {
          rpWhere.push('a.art_mar_id = ?');
          rpParams.push(filters.marca);
        }
        rpWhere.push('(COALESCE(a.art_activo, 1) = 1)');

        rankingProductos = await db.query(
          `SELECT a.art_nombre AS Producto, COALESCE(SUM(pa.\`${colPaCantidad}\` * pa.\`${colPaPvp}\`), 0) AS Ventas, COALESCE(SUM(pa.\`${colPaCantidad}\`), 0) AS Unidades
           FROM \`${tPedidos}\` p INNER JOIN \`${tPA}\` pa ON pa.\`${colPaPedId}\` = p.ped_id INNER JOIN articulos a ON a.art_id = pa.\`${colPaArtId}\`
           WHERE ${rpWhere.join(' AND ')} GROUP BY a.art_id, a.art_nombre ORDER BY Ventas DESC LIMIT 10`,
          rpParams
        );
      } catch (_) {}

      if (metaVisitas?.table) {
        try {
          const hoy = now.toISOString().slice(0, 10);
          latest.proximasVisitas = await db.query(
            `SELECT v.\`${metaVisitas.pk}\` AS Id, v.\`${metaVisitas.colFecha}\` AS Fecha, v.\`${metaVisitas.colTipo}\` AS TipoVisita, v.\`${metaVisitas.colEstado}\` AS Estado,
              c.\`${colNombreRazon}\` AS ClienteNombre
             FROM \`${metaVisitas.table}\` v
             LEFT JOIN \`${tClientes}\` c ON c.\`${pkClientes}\` = v.\`${metaVisitas.colCliente}\`
             WHERE v.\`${metaVisitas.colComercial}\` = ? AND DATE(v.\`${metaVisitas.colFecha}\`) >= ?
             ORDER BY v.\`${metaVisitas.colFecha}\` ASC LIMIT 10`,
            [userId, hoy]
          );
        } catch (_) {}
      }
    }

    let zonas = [];
    let comercialesList = [];
    let marcasList = [];
    if (admin) {
      try {
        const zonasRows = await db.query(
          'SELECT DISTINCT codpos_ComunidadAutonoma AS value FROM codigos_postales WHERE codpos_ComunidadAutonoma IS NOT NULL AND codpos_ComunidadAutonoma != "" ORDER BY codpos_ComunidadAutonoma'
        );
        zonas = Array.isArray(zonasRows) ? zonasRows : [];
      } catch (_) {}
      try {
        const rows = await db.query(
          `SELECT \`${comercialesMeta?.pk || 'com_id'}\` AS id, \`${comercialesMeta?.colNombre || 'com_nombre'}\` AS nombre FROM \`${comercialesMeta?.table || 'comerciales'}\` ORDER BY \`${comercialesMeta?.colNombre || 'com_nombre'}\``
        );
        comercialesList = Array.isArray(rows) ? rows : [];
      } catch (_) {}
    }
    try {
      const rows = await db.query('SELECT mar_id AS id, mar_nombre AS nombre FROM marcas ORDER BY mar_nombre');
      marcasList = Array.isArray(rows) ? rows : [];
    } catch (_) {}

    res.render('dashboard', {
      stats,
      latest,
      rankingComerciales,
      rankingZona,
      rankingProductos,
      desgloseEstado: Array.isArray(desgloseEstado) ? desgloseEstado : [],
      dashboardErrors: dashboardErrors || {},
      years,
      selectedYear,
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
