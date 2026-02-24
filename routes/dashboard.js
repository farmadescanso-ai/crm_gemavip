/**
 * Ruta del dashboard.
 */

const express = require('express');
const db = require('../config/mysql-crm');
const { _n } = require('../lib/app-helpers');
const { isAdminUser, requireLogin } = require('../lib/auth');

const router = express.Router();

router.get('/dashboard', requireLogin, async (req, res, next) => {
  try {
    const MIN_YEAR = 2025;
    const now = new Date();
    const currentYear = now.getFullYear();
    // A partir del 01/09 del año en curso, habilitamos seleccionar el año siguiente.
    // Ej.: desde 01/09/2026 aparecen 2025, 2026 y 2027.
    const switchDate = new Date(currentYear, 8, 1, 0, 0, 0, 0); // 1 Sep (mes 8)
    const maxYear = now >= switchDate ? currentYear + 1 : currentYear;
    const years = [];
    for (let y = MIN_YEAR; y <= maxYear; y += 1) years.push(y);
    const selectedYearRaw = String(req.query?.year || '').trim().toLowerCase();
    const selectedYearParsed = Number(selectedYearRaw);
    const selectedYear =
      selectedYearRaw === 'all' || selectedYearRaw === 'todos'
        ? 'all'
        : (Number.isFinite(selectedYearParsed) && selectedYearParsed >= MIN_YEAR && selectedYearParsed <= maxYear
            ? selectedYearParsed
            : currentYear);
    const yearFrom = selectedYear === 'all' ? null : `${selectedYear}-01-01`;
    const yearTo = selectedYear === 'all' ? null : `${selectedYear}-12-31`;

    const safeCount = async (table) => {
      try {
        const rows = await db.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
        return Number(_n(rows && rows[0] && rows[0].n, 0));
      } catch (_) {
        return null;
      }
    };

    const admin = isAdminUser(res.locals.user);
    const metaVisitas = await db._ensureVisitasMeta().catch(() => null);
    const visitasTable = metaVisitas?.table ? metaVisitas.table : 'visitas';

    const userId = Number(res.locals.user?.id);
    const hasUserId = Number.isFinite(userId) && userId > 0;

    const countPedidosWithYear = async () => {
      // Best-effort: si no hay columna fecha, contamos todos
      try {
        const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
        const tPedidos = pedidosMeta?.tPedidos || 'pedidos';
        const colFecha = pedidosMeta?.colFecha || null;
        if (selectedYear === 'all' || !colFecha) return await safeCount(tPedidos);
        const rows = await db.query(
          `SELECT COUNT(*) AS n FROM \`${tPedidos}\` WHERE DATE(\`${colFecha}\`) BETWEEN ? AND ?`,
          [yearFrom, yearTo]
        );
        return Number(_n(rows && rows[0] && rows[0].n, 0));
      } catch (_) {
        return null;
      }
    };

    const countVisitasWithYear = async () => {
      try {
        if (!metaVisitas?.table) return await safeCount(visitasTable);
        if (selectedYear === 'all' || !metaVisitas.colFecha) return await safeCount(metaVisitas.table);
        const rows = await db.query(
          `SELECT COUNT(*) AS n FROM \`${metaVisitas.table}\` WHERE DATE(\`${metaVisitas.colFecha}\`) BETWEEN ? AND ?`,
          [yearFrom, yearTo]
        );
        return Number(_n(rows && rows[0] && rows[0].n, 0));
      } catch (_) {
        return null;
      }
    };

    const [clientes, pedidos, visitasTotal, comerciales] = await Promise.all([
      admin
        ? safeCount('clientes')
        : (hasUserId ? db.countClientesOptimizado({ comercial: userId }) : 0),
      admin
        ? countPedidosWithYear()
        : (hasUserId
            ? (selectedYear === 'all' ? db.countPedidos({ comercialId: userId }) : db.countPedidos({ comercialId: userId, from: yearFrom, to: yearTo }))
            : 0),
      countVisitasWithYear(),
      admin ? safeCount('comerciales') : null
    ]);

    let visitas = visitasTotal;
    if (!admin) {
      try {
        const meta = await db._ensureVisitasMeta();
        const owner = db._buildVisitasOwnerWhere(meta, res.locals.user, 'v');
        if (owner.clause) {
          const where = [owner.clause];
          const params = [...(owner.params || [])];
          if (selectedYear !== 'all' && meta.colFecha) {
            where.push(`DATE(v.\`${meta.colFecha}\`) BETWEEN ? AND ?`);
            params.push(yearFrom, yearTo);
          }
          const rows = await db.query(`SELECT COUNT(*) AS n FROM \`${meta.table}\` v WHERE ${where.join(' AND ')}`, params);
          visitas = Number(_n(rows && rows[0] && rows[0].n, 0));
        } else {
          visitas = 0;
        }
      } catch (_) {
        visitas = 0;
      }
    }

    const stats = { clientes, pedidos, visitas, comerciales };

    // Ventas (suma de importes de pedidos)
    // - Comercial: solo sus ventas acumuladas
    // - Admin: total de ventas de todos los comerciales
    let ventas = null;
    try {
      const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
      const tPedidos = pedidosMeta?.tPedidos || 'pedidos';
      const colComercial = pedidosMeta?.colComercial || null;
      const colFecha = pedidosMeta?.colFecha || null;
      const pedidosCols = await db._getColumns(tPedidos).catch(() => []);
      const colTotal =
        db._pickCIFromColumns(pedidosCols, ['ped_total', 'TotalPedido', 'Total', 'ImporteTotal', 'total_pedido', 'total']) || null;

      if (colTotal) {
        if (admin) {
          const where = [];
          const params = [];
          if (selectedYear !== 'all' && colFecha) {
            where.push(`DATE(\`${colFecha}\`) BETWEEN ? AND ?`);
            params.push(yearFrom, yearTo);
          }
          const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
          const rows = await db.query(`SELECT COALESCE(SUM(COALESCE(\`${colTotal}\`, 0)), 0) AS total FROM \`${tPedidos}\`${whereSql}`, params);
          ventas = Number(_n(rows && rows[0] && rows[0].total, 0)) || 0;
        } else if (hasUserId) {
          if (colComercial) {
            const where = [`\`${colComercial}\` = ?`];
            const params = [userId];
            if (selectedYear !== 'all' && colFecha) {
              where.push(`DATE(\`${colFecha}\`) BETWEEN ? AND ?`);
              params.push(yearFrom, yearTo);
            }
            const rows = await db.query(
              `SELECT COALESCE(SUM(COALESCE(\`${colTotal}\`, 0)), 0) AS total FROM \`${tPedidos}\` WHERE ${where.join(' AND ')}`,
              params
            );
            ventas = Number(_n(rows && rows[0] && rows[0].total, 0)) || 0;
          } else {
            // Fallback legacy: usar el método existente (puede ser más costoso, pero evita "Unknown column")
            const rows = await db.getPedidosByComercial(userId).catch(() => []);
            ventas = (Array.isArray(rows) ? rows : []).reduce((acc, r) => {
              const v = Number(_n(_n(_n(_n(_n(r && r[colTotal], r && r.ped_total), r && r.TotalPedido), r && r.Total), r && r.ImporteTotal), 0));
              // Si tenemos fecha en el row, filtramos por año en memoria
              if (selectedYear !== 'all' && colFecha) {
                const fv = r?.[colFecha];
                const year = fv ? Number(String(fv).slice(0, 4)) : NaN;
                if (Number.isFinite(year) && year !== selectedYear) return acc;
              }
              return acc + (Number.isFinite(v) ? v : 0);
            }, 0);
          }
        } else {
          ventas = 0;
        }
      }
    } catch (_) {
      ventas = null;
    }
    stats.ventas = ventas;

    const latest = { clientes: [], pedidos: [], visitas: [] };
    const limitLatest = 8;
    const limitAdmin = 10;
    let dashboardErrors = {}; // para mostrar errores a admin si fallan las consultas

    if (admin) {
      // Admin: 10 clientes con más facturación (SUM de total pedidos); 10 últimos pedidos.
      try {
        const clientesMeta = await db._ensureClientesMeta().catch(() => null);
        const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
        const tClientes = clientesMeta?.tClientes || 'clientes';
        const pkClientes = clientesMeta?.pk || 'Id';
        const colClientePedido = pedidosMeta?.colCliente || 'Id_Cliente';
        const tPedidos = pedidosMeta?.tPedidos || 'pedidos';
        const colFecha = pedidosMeta?.colFecha || null;
        const pedidosCols = await db._getColumns(tPedidos).catch(() => []);
        const colTotal = db._pickCIFromColumns(pedidosCols, ['ped_total', 'TotalPedido', 'Total', 'ImporteTotal', 'total_pedido', 'total']) || 'ped_total';
        const clientesCols = await db._getColumns(tClientes).catch(() => []);
        const colNombreRazon = db._pickCIFromColumns(clientesCols, ['cli_nombre_razon_social', 'Nombre_Razon_Social', 'nombre_razon_social']) || 'cli_nombre_razon_social';
        const colPoblacion = db._pickCIFromColumns(clientesCols, ['cli_poblacion', 'Poblacion', 'poblacion']) || 'cli_poblacion';
        const colCodigoPostal = db._pickCIFromColumns(clientesCols, ['cli_codigo_postal', 'CodigoPostal', 'codigo_postal']) || 'cli_codigo_postal';
        const colOK_KO = db._pickCIFromColumns(clientesCols, ['cli_ok_ko', 'OK_KO', 'ok_ko']) || 'cli_ok_ko';
        const yearWhere = (selectedYear !== 'all' && colFecha) ? `WHERE DATE(p.\`${colFecha}\`) BETWEEN ? AND ?` : '';
        const yearParams = (selectedYear !== 'all' && colFecha) ? [yearFrom, yearTo] : [];
        latest.clientes = await db.query(
          `SELECT c.\`${pkClientes}\` AS Id, c.\`${colNombreRazon}\` AS Nombre_Razon_Social, c.\`${colPoblacion}\` AS Poblacion, c.\`${colCodigoPostal}\` AS CodigoPostal, c.\`${colOK_KO}\` AS OK_KO,
            COALESCE(SUM(COALESCE(p.\`${colTotal}\`, 0)), 0) AS TotalFacturado
           FROM \`${tClientes}\` c
           INNER JOIN \`${tPedidos}\` p ON p.\`${colClientePedido}\` = c.\`${pkClientes}\`
           ${yearWhere}
           GROUP BY c.\`${pkClientes}\`, c.\`${colNombreRazon}\`, c.\`${colPoblacion}\`, c.\`${colCodigoPostal}\`, c.\`${colOK_KO}\`
           ORDER BY TotalFacturado DESC
           LIMIT ${Number(limitAdmin) || 10}`
          , yearParams
        );
        if (!Array.isArray(latest.clientes)) latest.clientes = [];
      } catch (e) {
        console.error('Dashboard [admin] error clientes:', e?.message || e);
        latest.clientes = [];
        dashboardErrors.clientes = e?.message || String(e);
      }
      try {
        const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
        const tPedidos = pedidosMeta?.tPedidos || 'pedidos';
        const pk = pedidosMeta?.pk || 'id';
        const colNum = pedidosMeta?.colNumPedido || 'NumPedido';
        const colFecha = pedidosMeta?.colFecha || 'FechaPedido';
        const pedidosCols = await db._getColumns(tPedidos).catch(() => []);
        const colTotal = db._pickCIFromColumns(pedidosCols, ['ped_total', 'TotalPedido', 'Total', 'ImporteTotal', 'total_pedido', 'total']) || 'ped_total';
        const colEstado = db._pickCIFromColumns(pedidosCols, ['ped_estado_txt', 'EstadoPedido', 'estado_pedido', 'Estado', 'estado']) || 'ped_estado_txt';
        const where = (selectedYear !== 'all' && colFecha) ? `WHERE DATE(\`${colFecha}\`) BETWEEN ? AND ?` : '';
        const params = (selectedYear !== 'all' && colFecha) ? [yearFrom, yearTo] : [];
        latest.pedidos = await db.query(
          `SELECT \`${pk}\` AS Id, \`${colNum}\` AS NumPedido, \`${colFecha}\` AS FechaPedido, \`${colTotal}\` AS TotalPedido, \`${colEstado}\` AS EstadoPedido FROM \`${tPedidos}\` ${where} ORDER BY \`${pk}\` DESC LIMIT ${Number(limitAdmin) || 10}`,
          params
        );
        if (!Array.isArray(latest.pedidos)) latest.pedidos = [];
      } catch (e) {
        console.error('Dashboard [admin] error pedidos:', e?.message || e);
        latest.pedidos = [];
        dashboardErrors.pedidos = e?.message || String(e);
      }
    } else {
      // Comercial: solo sus últimos clientes y sus últimos pedidos.
      try {
        const list = await db.getClientesOptimizadoPaged(
          { comercial: userId },
          { limit: limitLatest, offset: 0, order: 'desc', compact: true }
        );
        latest.clientes = Array.isArray(list) ? list : [];
      } catch (_) {
        latest.clientes = [];
      }
      try {
        if (hasUserId) {
          const pedidosMeta = await db._ensurePedidosMeta().catch(() => null);
          const tPedidos = pedidosMeta?.tPedidos || 'pedidos';
          const pk = pedidosMeta?.pk || 'id';
          const colComercial = pedidosMeta?.colComercial || null;
          const colFecha = pedidosMeta?.colFecha || null;
          if (colComercial && colFecha) {
            const sql =
              selectedYear === 'all'
                ? `SELECT * FROM \`${tPedidos}\` WHERE \`${colComercial}\` = ? ORDER BY \`${pk}\` DESC LIMIT ${Number(limitLatest) || 8}`
                : `SELECT * FROM \`${tPedidos}\` WHERE \`${colComercial}\` = ? AND DATE(\`${colFecha}\`) BETWEEN ? AND ? ORDER BY \`${pk}\` DESC LIMIT ${Number(limitLatest) || 8}`;
            const params = selectedYear === 'all' ? [userId] : [userId, yearFrom, yearTo];
            const rows = await db.query(sql, params);
            latest.pedidos = Array.isArray(rows) ? rows : [];
          } else {
            const rows = await db.getPedidosByComercial(userId).catch(() => []);
            const filtered = (Array.isArray(rows) ? rows : []).filter((r) => {
              if (selectedYear === 'all') return true;
              const fv = _n(_n(r && r.FechaPedido, r && r.Fecha), null);
              const y = fv ? Number(String(fv).slice(0, 4)) : NaN;
              return !Number.isFinite(y) ? true : y === selectedYear;
            });
            latest.pedidos = filtered.slice(0, limitLatest);
          }
        } else {
          latest.pedidos = [];
        }
      } catch (_) {
        latest.pedidos = [];
      }
      // Visitas del comercial (mostrar abajo de clientes y pedidos)
      try {
        if (!metaVisitas?.table) throw new Error('Sin meta visitas');
        const clientesMeta = await db._ensureClientesMeta().catch(() => null);
        const comercialesMeta = await db._ensureComercialesMeta().catch(() => null);
        const tClientes = clientesMeta?.tClientes ? `\`${clientesMeta.tClientes}\`` : '`clientes`';
        const pkClientes = clientesMeta?.pk || 'Id';
        const tComerciales = comercialesMeta?.table ? `\`${comercialesMeta.table}\`` : '`comerciales`';
        const pkComerciales = comercialesMeta?.pk || 'id';
        const colNombreRazon = clientesMeta?.colNombreRazonSocial || 'cli_nombre_razon_social';
        const colComercialNombre = comercialesMeta?.colNombre || 'com_nombre';
        const joinCliente = metaVisitas.colCliente ? `LEFT JOIN ${tClientes} c ON v.\`${metaVisitas.colCliente}\` = c.\`${pkClientes}\`` : '';
        const joinComercial = metaVisitas.colComercial ? `LEFT JOIN ${tComerciales} co ON v.\`${metaVisitas.colComercial}\` = co.\`${pkComerciales}\`` : '';
        const selectClienteNombre = metaVisitas.colCliente ? `c.\`${colNombreRazon}\` as ClienteNombre` : 'NULL as ClienteNombre';
        const selectComercialNombre = metaVisitas.colComercial ? `co.\`${colComercialNombre}\` as ComercialNombre` : 'NULL as ComercialNombre';
        const where = [];
        const params = [];
        if (metaVisitas.colComercial && Number.isFinite(userId) && userId > 0) {
          where.push(`v.\`${metaVisitas.colComercial}\` = ?`);
          params.push(userId);
        }
        if (selectedYear !== 'all' && metaVisitas.colFecha) {
          where.push(`DATE(v.\`${metaVisitas.colFecha}\`) BETWEEN ? AND ?`);
          params.push(yearFrom, yearTo);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        latest.visitas = await db.query(
          `
          SELECT
            v.\`${metaVisitas.pk}\` as Id,
            ${metaVisitas.colFecha ? `v.\`${metaVisitas.colFecha}\` as Fecha,` : 'NULL as Fecha,'}
            ${metaVisitas.colTipo ? `v.\`${metaVisitas.colTipo}\` as TipoVisita,` : "'' as TipoVisita,"}
            ${metaVisitas.colEstado ? `v.\`${metaVisitas.colEstado}\` as Estado,` : "'' as Estado,"}
            ${metaVisitas.colCliente ? `v.\`${metaVisitas.colCliente}\` as ClienteId,` : 'NULL as ClienteId,'}
            ${metaVisitas.colComercial ? `v.\`${metaVisitas.colComercial}\` as ComercialId,` : 'NULL as ComercialId,'}
            ${selectClienteNombre},
            ${selectComercialNombre}
          FROM \`${metaVisitas.table}\` v
          ${joinCliente}
          ${joinComercial}
          ${whereSql}
          ORDER BY v.\`${metaVisitas.pk}\` DESC
          LIMIT 10
        `,
          params
        );
      } catch (_) {
        latest.visitas = [];
      }
    }
    if (admin) {
      try {
        if (!metaVisitas?.table) throw new Error('Sin meta visitas');

        const clientesMeta = await db._ensureClientesMeta().catch(() => null);
        const comercialesMeta = await db._ensureComercialesMeta().catch(() => null);
        const tClientes = clientesMeta?.tClientes ? `\`${clientesMeta.tClientes}\`` : '`clientes`';
        const pkClientes = clientesMeta?.pk || 'Id';
        const tComerciales = comercialesMeta?.table ? `\`${comercialesMeta.table}\`` : '`comerciales`';
        const pkComerciales = comercialesMeta?.pk || 'id';

        const colNombreRazon = clientesMeta?.colNombreRazonSocial || 'cli_nombre_razon_social';
        const colComercialNombre = comercialesMeta?.colNombre || 'com_nombre';
        const joinCliente = metaVisitas.colCliente ? `LEFT JOIN ${tClientes} c ON v.\`${metaVisitas.colCliente}\` = c.\`${pkClientes}\`` : '';
        const joinComercial = metaVisitas.colComercial ? `LEFT JOIN ${tComerciales} co ON v.\`${metaVisitas.colComercial}\` = co.\`${pkComerciales}\`` : '';
        const selectClienteNombre = metaVisitas.colCliente ? `c.\`${colNombreRazon}\` as ClienteNombre` : 'NULL as ClienteNombre';
        const selectComercialNombre = metaVisitas.colComercial ? `co.\`${colComercialNombre}\` as ComercialNombre` : 'NULL as ComercialNombre';

        const where = [];
        const params = [];
        if (selectedYear !== 'all' && metaVisitas.colFecha) {
          where.push(`DATE(v.\`${metaVisitas.colFecha}\`) BETWEEN ? AND ?`);
          params.push(yearFrom, yearTo);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        latest.visitas = await db.query(
          `
          SELECT
            v.\`${metaVisitas.pk}\` as Id,
            ${metaVisitas.colFecha ? `v.\`${metaVisitas.colFecha}\` as Fecha,` : 'NULL as Fecha,'}
            ${metaVisitas.colTipo ? `v.\`${metaVisitas.colTipo}\` as TipoVisita,` : "'' as TipoVisita,"}
            ${metaVisitas.colEstado ? `v.\`${metaVisitas.colEstado}\` as Estado,` : "'' as Estado,"}
            ${metaVisitas.colCliente ? `v.\`${metaVisitas.colCliente}\` as ClienteId,` : 'NULL as ClienteId,'}
            ${metaVisitas.colComercial ? `v.\`${metaVisitas.colComercial}\` as ComercialId,` : 'NULL as ComercialId,'}
            ${selectClienteNombre},
            ${selectComercialNombre}
          FROM \`${metaVisitas.table}\` v
          ${joinCliente}
          ${joinComercial}
          ${whereSql}
          ORDER BY v.\`${metaVisitas.pk}\` DESC
          LIMIT 10
        `,
          params
        );
      } catch (_) {
        latest.visitas = [];
      }
    }

    res.render('dashboard', {
      stats,
      latest,
      dashboardErrors: dashboardErrors || {},
      years,
      selectedYear
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
