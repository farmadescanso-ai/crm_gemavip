/**
 * Dominio: Clientes
 * Consultas y lógica específica de clientes.
 * Se invoca con db como contexto (this) para acceder a query, _ensureClientesMeta, etc.
 */
'use strict';

const clientesCrud = require('./clientes-crud');

module.exports = {
  async getClientes(comercialId = null) {
    try {
      const { tClientes, pk, colComercial } = await this._ensureClientesMeta();
      let sql = `SELECT * FROM \`${tClientes}\``;
      const params = [];

      if (comercialId) {
        if (!colComercial) {
          console.warn('⚠️ [GET_CLIENTES] No se pudo resolver la columna de comercial en clientes. Devolviendo vacío por seguridad.');
          return [];
        }
        sql += ` WHERE \`${colComercial}\` = ?`;
        params.push(comercialId);
        console.log(`🔐 [GET_CLIENTES] Filtro aplicado: ${colComercial} = ${comercialId}`);
      }

      sql += ` ORDER BY \`${pk}\` ASC`;

      const rows = await this.query(sql, params);
      console.log(`✅ Obtenidos ${rows.length} clientes${comercialId ? ` (filtrado por comercial ${comercialId})` : ''}`);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo clientes:', error.message);
      return [];
    }
  },

  async getClientesByComercial(comercialId) {
    try {
      const { pk, colComercial } = await this._ensureClientesMeta();
      const sql = `SELECT * FROM clientes WHERE \`${colComercial || 'cli_com_id'}\` = ? ORDER BY \`${pk}\` ASC`;
      const rows = await this.query(sql, [comercialId]);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo clientes por comercial:', error.message);
      return [];
    }
  },

  async getClientesByCodigoPostal(idCodigoPostal) {
    try {
      const sql = `
        SELECT 
          c.*,
          c.cli_nombre_razon_social AS Nombre,
          c.cli_poblacion AS Poblacion,
          com.com_nombre AS NombreComercial
        FROM clientes c
        LEFT JOIN comerciales com ON c.cli_com_id = com.com_id
        WHERE c.cli_codp_id = ?
        ORDER BY c.cli_nombre_razon_social ASC
      `;
      const rows = await this.query(sql, [idCodigoPostal]);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo clientes por código postal:', error.message);
      return [];
    }
  },

  async getClientesCount() {
    try {
      const sql = 'SELECT COUNT(*) as count FROM clientes';
      const rows = await this.query(sql);
      const count = rows[0]?.count || rows[0]?.COUNT || 0;
      console.log(`📊 [COUNT CLIENTES] Total de clientes: ${count}`);
      return parseInt(count, 10) || 0;
    } catch (error) {
      console.error('❌ Error obteniendo conteo de clientes:', error.message);
      try {
        const todos = await this.getClientes();
        const fallbackCount = Array.isArray(todos) ? todos.length : 0;
        console.log(`⚠️ [COUNT CLIENTES] Usando fallback, contados: ${fallbackCount}`);
        return fallbackCount;
      } catch (fallbackError) {
        console.error('❌ Error en fallback de conteo:', fallbackError.message);
        return 0;
      }
    }
  },

  async getClientesEstadisticas() {
    try {
      const sqlTotal = 'SELECT COUNT(*) as total FROM clientes';
      const rowsTotal = await this.query(sqlTotal);
      const total = parseInt(rowsTotal[0]?.total || rowsTotal[0]?.COUNT || 0, 10);

      const sqlActivos = `
        SELECT COUNT(*) as activos 
        FROM clientes 
        WHERE (OK_KO = 1 OR UPPER(TRIM(COALESCE(OK_KO, ''))) = 'OK')
      `;
      let activos = 0;
      try {
        const rowsActivos = await this.query(sqlActivos);
        activos = parseInt(rowsActivos[0]?.activos || rowsActivos[0]?.ACTIVOS || 0, 10);
      } catch (errorActivos) {
        throw errorActivos;
      }

      const inactivos = total - activos;
      console.log(`📊 [ESTADISTICAS CLIENTES] Total: ${total}, Activos: ${activos}, Inactivos: ${inactivos}`);

      return { total, activos, inactivos };
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas de clientes:', error.message);
      try {
        const todos = await this.getClientes();
        const total = Array.isArray(todos) ? todos.length : 0;
        let activos = 0;
        todos.forEach(cliente => {
          const okKo = cliente.OK_KO;
          if (okKo === 1 || okKo === true || okKo === '1' || (typeof okKo === 'string' && okKo.toUpperCase().trim() === 'OK')) {
            activos++;
          }
        });
        const inactivos = total - activos;
        return { total, activos, inactivos };
      } catch (fallbackError) {
        return { total: 0, activos: 0, inactivos: 0 };
      }
    }
  },

  async getClienteById(id) {
    try {
      const meta = await this._ensureClientesMeta().catch(() => null);
      const tClientes = meta?.tClientes || await this._resolveTableNameCaseInsensitive('clientes');
      const pk = meta?.pk || 'Id';
      const colComercial = meta?.colComercial || null;
      const colProvincia = meta?.colProvincia || 'Id_Provincia';
      const colTipoCliente = meta?.colTipoCliente || 'Id_TipoCliente';
      const colEstadoCliente = meta?.colEstadoCliente || null;

      const tEstados = colEstadoCliente ? await this._resolveTableNameCaseInsensitive('estdoClientes').catch(() => null) : null;
      const tTiposClientes = await this._resolveTableNameCaseInsensitive('tipos_clientes').catch(() => null);
      const tProvincias = await this._resolveTableNameCaseInsensitive('provincias').catch(() => null);
      const tComerciales = colComercial ? await this._resolveTableNameCaseInsensitive('comerciales').catch(() => null) : null;
      const comercialMeta = (colComercial && tComerciales) ? await this._ensureComercialesMeta().catch(() => null) : null;
      const comercialPk = comercialMeta?.pk || 'id';
      const comercialColNombre = comercialMeta?.colNombre || 'Nombre';

      const sql = `
        SELECT
          c.*,
          ${tProvincias ? 'p.Nombre as ProvinciaNombre' : 'NULL as ProvinciaNombre'},
          ${tTiposClientes ? 'tc.Tipo as TipoClienteNombre' : 'NULL as TipoClienteNombre'},
          ${(colComercial && tComerciales) ? `cial.\`${comercialColNombre}\` as ComercialNombre` : 'NULL as ComercialNombre'},
          ${(colEstadoCliente && tEstados) ? 'ec.Nombre as EstadoClienteNombre' : 'NULL as EstadoClienteNombre'},
          ${(colEstadoCliente) ? `c.\`${colEstadoCliente}\` as EstadoClienteId` : 'NULL as EstadoClienteId'}
        FROM \`${tClientes}\` c
        ${tProvincias ? `LEFT JOIN \`${tProvincias}\` p ON c.\`${colProvincia}\` = p.id` : ''}
        ${tTiposClientes ? `LEFT JOIN \`${tTiposClientes}\` tc ON c.\`${colTipoCliente}\` = tc.id` : ''}
        ${(colComercial && tComerciales) ? `LEFT JOIN \`${tComerciales}\` cial ON c.\`${colComercial}\` = cial.\`${comercialPk}\`` : ''}
        ${(colEstadoCliente && tEstados) ? `LEFT JOIN \`${tEstados}\` ec ON c.\`${colEstadoCliente}\` = ec.estcli_id` : ''}
        WHERE c.\`${pk}\` = ?
        LIMIT 1
      `;
      const rows = await this.query(sql, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo cliente por ID:', error.message);
      try {
        const meta = await this._ensureClientesMeta().catch(() => null);
        const tClientes = meta?.tClientes || await this._resolveTableNameCaseInsensitive('clientes');
        const pk = meta?.pk || 'Id';
        const rows = await this.query(`SELECT * FROM \`${tClientes}\` WHERE \`${pk}\` = ? LIMIT 1`, [id]);
        return rows.length > 0 ? rows[0] : null;
      } catch (_) {
        return null;
      }
    }
  },

  async canComercialEditCliente(clienteId, userId) {
    if (!clienteId || !userId) return false;
    const cliente = await this.getClienteById(clienteId);
    if (!cliente) return false;
    const { colComercial } = await this._ensureClientesMeta();
    if (!colComercial) return false;
    const asignado = Number(cliente[colComercial] ?? cliente.cli_com_id ?? 0) || 0;
    if (asignado === Number(userId)) return true;
    const poolId = await this.getComercialIdPool();
    return poolId != null && asignado === Number(poolId);
  },

  async isContactoAsignadoAPoolOSinAsignar(clienteId) {
    if (!clienteId) return false;
    const cliente = await this.getClienteById(clienteId);
    if (!cliente) return false;
    const { colComercial } = await this._ensureClientesMeta();
    if (!colComercial) return false;
    const asignado = Number(cliente[colComercial] ?? cliente.cli_com_id ?? 0) || 0;
    if (asignado === 0) return true;
    const poolId = await this.getComercialIdPool();
    return poolId != null && asignado === Number(poolId);
  },

  async findPosiblesDuplicadosClientes({ dniCif, nombre, nombreCial } = {}, { limit = 6, userId = null, isAdmin = false } = {}) {
    const out = { matches: [], otherCount: 0 };
    try {
      const meta = await this._ensureClientesMeta().catch(() => null);
      const tClientes = meta?.tClientes || await this._resolveTableNameCaseInsensitive('clientes');
      const pk = meta?.pk || 'Id';
      const colComercial = meta?.colComercial || null;

      const normDni = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(/-/g, '');
      const normName = (s) => {
        try {
          return String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
        } catch (_) {
          return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
        }
      };

      const dni = normDni(dniCif);
      const n1 = normName(nombre);
      const n2 = normName(nombreCial);

      const whereOr = [];
      const paramsOr = [];

      if (dni && dni.length >= 8) {
        whereOr.push(`REPLACE(REPLACE(UPPER(COALESCE(c.DNI_CIF,'')),' ',''),'-','') = ?`);
        paramsOr.push(dni);
      }
      if (n1 && n1.length >= 6) {
        whereOr.push(`LOWER(TRIM(COALESCE(c.cli_nombre_razon_social,''))) LIKE ?`);
        paramsOr.push(`%${n1}%`);
      }
      if (n2 && n2.length >= 6) {
        whereOr.push(`LOWER(TRIM(COALESCE(c.Nombre_Cial,''))) LIKE ?`);
        paramsOr.push(`%${n2}%`);
      }

      if (!whereOr.length) return out;

      const baseWhere = `(${whereOr.join(' OR ')})`;
      const lim = Math.max(1, Math.min(20, Number(limit) || 6));

      if (isAdmin || !userId || !colComercial) {
        const rows = await this.query(
          `SELECT c.\`${pk}\` as Id, c.cli_nombre_razon_social, c.Nombre_Cial, c.DNI_CIF, c.CodigoPostal, c.Poblacion
           FROM \`${tClientes}\` c WHERE ${baseWhere} ORDER BY c.\`${pk}\` DESC LIMIT ?`,
          [...paramsOr, lim]
        );
        out.matches = Array.isArray(rows) ? rows : [];
        return out;
      }

      const poolId = await this.getComercialIdPool().catch(() => null);
      const allowed = [Number(userId), ...(poolId ? [Number(poolId)] : []), 0].filter((x) => Number.isFinite(x));
      const allowedPlaceholders = allowed.map(() => '?').join(',');

      const rows = await this.query(
        `SELECT c.\`${pk}\` as Id, c.cli_nombre_razon_social, c.Nombre_Cial, c.DNI_CIF, c.CodigoPostal, c.Poblacion
         FROM \`${tClientes}\` c
         WHERE ${baseWhere} AND (c.\`${colComercial}\` IN (${allowedPlaceholders}) OR c.\`${colComercial}\` IS NULL)
         ORDER BY c.\`${pk}\` DESC LIMIT ?`,
        [...paramsOr, ...allowed, lim]
      );
      out.matches = Array.isArray(rows) ? rows : [];

      const other = await this.query(
        `SELECT COUNT(*) as n FROM \`${tClientes}\` c
         WHERE ${baseWhere} AND (c.\`${colComercial}\` NOT IN (${allowedPlaceholders}) AND c.\`${colComercial}\` IS NOT NULL)`,
        [...paramsOr, ...allowed]
      ).catch(() => []);
      out.otherCount = Number(other?.[0]?.n ?? 0) || 0;
      return out;
    } catch (e) {
      console.warn('⚠️ [DUPLICADOS CLIENTES] No se pudo buscar duplicados:', e?.message || e);
      return out;
    }
  },

  async getClientesOptimizado(filters = {}) {
    let sql = '';
    try {
      const { pk, colComercial, colProvincia, colTipoCliente, colEstadoCliente, colNombreRazonSocial, colTipoContacto } = await this._ensureClientesMeta();
      const tEstados = colEstadoCliente ? await this._resolveTableNameCaseInsensitive('estdoClientes') : null;
      const whereConditions = [];
      const params = [];
      const colProv = colProvincia || 'cli_prov_id';
      const colTipC = colTipoCliente || 'cli_tipc_id';

      sql = `
        SELECT 
          c.*,
          p.prov_nombre as ProvinciaNombre,
          tc.tipc_tipo as TipoClienteNombre,
          ${colComercial ? 'cial.com_nombre as ComercialNombre' : 'NULL as ComercialNombre'},
          ${colEstadoCliente ? 'ec.estcli_nombre as EstadoClienteNombre' : 'NULL as EstadoClienteNombre'},
          ${colEstadoCliente ? `c.\`${colEstadoCliente}\` as EstadoClienteId` : 'NULL as EstadoClienteId'}
        FROM clientes c
        LEFT JOIN provincias p ON c.\`${colProv}\` = p.prov_id
        LEFT JOIN tipos_clientes tc ON c.\`${colTipC}\` = tc.tipc_id
        ${colComercial ? `LEFT JOIN comerciales cial ON c.\`${colComercial}\` = cial.com_id` : ''}
        ${colEstadoCliente ? `LEFT JOIN \`${tEstados}\` ec ON c.\`${colEstadoCliente}\` = ec.estcli_id` : ''}
      `;

      if (filters.tipoCliente !== null && filters.tipoCliente !== undefined && filters.tipoCliente !== '' && !isNaN(filters.tipoCliente)) {
        const tipoClienteId = typeof filters.tipoCliente === 'number' ? filters.tipoCliente : parseInt(filters.tipoCliente);
        if (!isNaN(tipoClienteId) && tipoClienteId > 0) {
          whereConditions.push(`c.\`${colTipC}\` = ?`);
          params.push(tipoClienteId);
          console.log('✅ [OPTIMIZADO] Filtro tipoCliente aplicado:', tipoClienteId);
        }
      }

      if (colTipoContacto && filters.tipoContacto !== null && filters.tipoContacto !== undefined && String(filters.tipoContacto).trim() !== '') {
        const tipoVal = String(filters.tipoContacto).trim();
        if (['Empresa', 'Persona', 'Otros'].includes(tipoVal)) {
          whereConditions.push(`c.\`${colTipoContacto}\` = ?`);
          params.push(tipoVal);
        }
      }

      if (filters.provincia !== null && filters.provincia !== undefined && filters.provincia !== '' && !isNaN(filters.provincia)) {
        const provinciaId = typeof filters.provincia === 'number' ? filters.provincia : parseInt(filters.provincia);
        if (!isNaN(provinciaId) && provinciaId > 0) {
          whereConditions.push(`c.\`${colProv}\` = ?`);
          params.push(provinciaId);
          console.log('✅ [OPTIMIZADO] Filtro provincia aplicado:', provinciaId);
        }
      }

      if (filters.comercial !== null && filters.comercial !== undefined && filters.comercial !== '' && !isNaN(filters.comercial)) {
        const comercialId = typeof filters.comercial === 'number' ? filters.comercial : parseInt(filters.comercial);
        if (!isNaN(comercialId) && comercialId > 0) {
          if (!colComercial) {
            throw new Error('No se encontró columna de comercial en tabla clientes');
          }
          if (filters.comercialIncludePool && comercialId !== 1) {
            whereConditions.push(`(c.\`${colComercial}\` = ? OR c.\`${colComercial}\` = 1)`);
          } else {
            whereConditions.push(`c.\`${colComercial}\` = ?`);
          }
          params.push(comercialId);
          console.log(`✅ [OPTIMIZADO] Filtro comercial aplicado: c.${colComercial} = ${comercialId}${filters.comercialIncludePool && comercialId !== 1 ? ' (+pool=1)' : ''}`);
        } else {
          console.warn(`⚠️ [OPTIMIZADO] Filtro comercial inválido (valor recibido: ${filters.comercial}, tipo: ${typeof filters.comercial})`);
        }
      } else {
        console.log(`ℹ️ [OPTIMIZADO] No se aplica filtro de comercial (valor: ${filters.comercial}, tipo: ${typeof filters.comercial})`);
      }

      if (colEstadoCliente && filters.estadoCliente !== null && filters.estadoCliente !== undefined && filters.estadoCliente !== '' && !isNaN(filters.estadoCliente)) {
        const estadoId = typeof filters.estadoCliente === 'number' ? filters.estadoCliente : parseInt(filters.estadoCliente);
        if (!isNaN(estadoId) && estadoId > 0) {
          whereConditions.push(`c.\`${colEstadoCliente}\` = ?`);
          params.push(estadoId);
        }
      }

      if (filters.conVentas !== undefined && filters.conVentas !== null && filters.conVentas !== '') {
        if (filters.conVentas === true || filters.conVentas === 'true' || filters.conVentas === '1') {
          whereConditions.push(`EXISTS (SELECT 1 FROM pedidos WHERE ped_cli_id = c.\`${pk}\`)`);
          console.log('✅ [OPTIMIZADO] Filtro conVentas aplicado: true');
        } else if (filters.conVentas === false || filters.conVentas === 'false' || filters.conVentas === '0') {
          whereConditions.push(`NOT EXISTS (SELECT 1 FROM pedidos WHERE ped_cli_id = c.\`${pk}\`)`);
          console.log('✅ [OPTIMIZADO] Filtro conVentas aplicado: false');
        }
      }

      if (whereConditions.length > 0) {
        sql += ' WHERE ' + whereConditions.join(' AND ');
        console.log(`✅ [OPTIMIZADO] ${whereConditions.length} condición(es) WHERE aplicada(s)`);
      } else {
        console.log('⚠️ [OPTIMIZADO] No hay condiciones WHERE, devolviendo todos los clientes');
      }

      sql += ` ORDER BY c.\`${pk}\` ASC`;

      console.log('🔍 [OPTIMIZADO] SQL:', sql);
      console.log('🔍 [OPTIMIZADO] Params:', params);

      const rows = await this.query(sql, params);

      if (rows && rows.length > 0) {
        const clienteIds = rows.map(c => c.cli_id || c.id || c.Id).filter(id => id);
        if (clienteIds.length > 0) {
          try {
            const placeholders = clienteIds.map(() => '?').join(',');
            const pedidosCount = await this.query(
              `SELECT ped_cli_id, COUNT(*) as total 
               FROM pedidos 
               WHERE ped_cli_id IN (${placeholders})
               GROUP BY ped_cli_id`,
              clienteIds
            ).catch(() => []);

            const pedidosMap = new Map();
            pedidosCount.forEach(p => {
              const clienteId = p.ped_cli_id || p.Id_Cliente || p.id_Cliente;
              pedidosMap.set(clienteId, parseInt(p.total || 0));
            });

            rows.forEach(cliente => {
              const clienteId = cliente.cli_id || cliente.id || cliente.Id;
              cliente.TotalPedidos = pedidosMap.get(clienteId) || 0;
            });
          } catch (pedidosError) {
            console.warn('⚠️ [OPTIMIZADO] Error obteniendo conteo de pedidos:', pedidosError.message);
            rows.forEach(cliente => {
              cliente.TotalPedidos = 0;
            });
          }
        }
      }

      console.log(`✅ [OPTIMIZADO] Obtenidos ${rows.length} clientes con filtros:`, filters);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo clientes optimizado:', error.message);
      console.error('❌ Stack:', error.stack);
      console.error('❌ SQL que falló:', sql);
      console.log('⚠️ [FALLBACK] Usando método getClientes() original');
      return await this.getClientes();
    }
  },

  async getClientesOptimizadoPaged(filters = {}, options = {}) {
    let sql = '';
    try {
      const { pk, colComercial, colProvincia, colTipoCliente, colEstadoCliente, colTipoContacto, colNombreRazonSocial } = await this._ensureClientesMeta();
      const tEstados = colEstadoCliente ? await this._resolveTableNameCaseInsensitive('estdoClientes') : null;
      const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.min(500, Number(options.limit))) : 50;
      const offset = Number.isFinite(Number(options.offset)) ? Math.max(0, Number(options.offset)) : 0;
      const compact = options.compact === true || options.compact === '1';
      const compactSearch = options.compactSearch === true || options.compactSearch === '1';
      const order = String(options.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      const sortBy = String(options.sortBy || '').toLowerCase();
      const orderByNombre = sortBy === 'nombre' || sortBy === 'nombre_razon_social';

      const whereConditions = [];
      const params = [];
      const colProv = colProvincia || 'cli_prov_id';
      const colTipC = colTipoCliente || 'cli_tipc_id';
      const colNombre = colNombreRazonSocial || 'cli_nombre_razon_social';

      sql = `
        SELECT 
          ${
            compact
              ? [
                  `c.\`${pk}\` as Id`,
                  `c.\`${colNombre}\` as Nombre_Razon_Social`,
                  'c.cli_nombre_cial as Nombre_Cial',
                  'c.cli_dni_cif as DNI_CIF',
                  'c.cli_email as Email',
                  'c.cli_telefono as Telefono',
                  'c.cli_movil as Movil',
                  'c.cli_codigo_postal as CodigoPostal',
                  'c.cli_poblacion as Poblacion',
                  `c.\`${colProv}\` as Id_Provincia`,
                  `c.\`${colTipC}\` as Id_TipoCliente`,
                  ...(colTipoContacto ? [`c.\`${colTipoContacto}\` as TipoContacto`] : [])
                ].join(',\n          ')
              : 'c.*'
          },
          p.prov_nombre as ProvinciaNombre,
          tc.tipc_tipo as TipoClienteNombre,
          ${colComercial ? 'cial.com_nombre as ComercialNombre' : 'NULL as ComercialNombre'},
          ${colEstadoCliente ? 'ec.estcli_nombre as EstadoClienteNombre' : 'NULL as EstadoClienteNombre'},
          ${colEstadoCliente ? `c.\`${colEstadoCliente}\` as EstadoClienteId` : 'NULL as EstadoClienteId'}
        FROM clientes c
        LEFT JOIN provincias p ON c.\`${colProv}\` = p.prov_id
        LEFT JOIN tipos_clientes tc ON c.\`${colTipC}\` = tc.tipc_id
        ${colComercial ? `LEFT JOIN comerciales cial ON c.\`${colComercial}\` = cial.com_id` : ''}
        ${colEstadoCliente ? `LEFT JOIN \`${tEstados}\` ec ON c.\`${colEstadoCliente}\` = ec.estcli_id` : ''}
      `;

      if (!this.__pedidosClienteCol) {
        try {
          const colsRows = await this.query('SHOW COLUMNS FROM pedidos').catch(() => []);
          const cols = new Set((colsRows || []).map(r => String(r.Field || '').trim()).filter(Boolean));
          this.__pedidosClienteCol =
            ['ped_cli_id', 'Id_Cliente', 'Cliente_id', 'id_cliente', 'cliente_id', 'ClienteId', 'clienteId'].find(c => cols.has(c)) || 'ped_cli_id';
          this.__pedidosFechaCol =
            ['ped_fecha', 'FechaPedido', 'Fecha', 'fecha', 'CreatedAt', 'created_at', 'Fecha_Pedido', 'fecha_pedido'].find(c => cols.has(c)) || null;
        } catch (_) {
          this.__pedidosClienteCol = 'ped_cli_id';
          this.__pedidosFechaCol = null;
        }
      }

      if (colEstadoCliente) {
        if (filters.estadoCliente !== undefined && filters.estadoCliente !== null && String(filters.estadoCliente).trim() !== '' && !isNaN(filters.estadoCliente)) {
          const estadoId = Number(filters.estadoCliente);
          if (Number.isFinite(estadoId) && estadoId > 0) {
            whereConditions.push(`c.\`${colEstadoCliente}\` = ?`);
            params.push(estadoId);
          }
        } else if (filters.estado && typeof filters.estado === 'string') {
          const ids = await this._getEstadoClienteIds();
          const e = filters.estado.trim().toLowerCase();
          if (e === 'activos') {
            whereConditions.push(`c.\`${colEstadoCliente}\` = ?`);
            params.push(ids.activo);
          } else if (e === 'inactivos') {
            whereConditions.push(`c.\`${colEstadoCliente}\` = ?`);
            params.push(ids.inactivo);
          }
        }
      } else {
        const colOkKo = 'cli_ok_ko';
        if (filters.estado === 'activos') {
          whereConditions.push(`(c.\`${colOkKo}\` = 1 OR c.\`${colOkKo}\` = '1' OR UPPER(c.\`${colOkKo}\`) = 'OK')`);
        } else if (filters.estado === 'inactivos') {
          whereConditions.push(`(c.\`${colOkKo}\` = 0 OR c.\`${colOkKo}\` = '0' OR UPPER(c.\`${colOkKo}\`) = 'KO')`);
        }
      }

      if (filters.tipoCliente !== null && filters.tipoCliente !== undefined && filters.tipoCliente !== '' && !isNaN(filters.tipoCliente)) {
        const tipoClienteId = typeof filters.tipoCliente === 'number' ? filters.tipoCliente : parseInt(filters.tipoCliente);
        if (!isNaN(tipoClienteId) && tipoClienteId > 0) {
          whereConditions.push(`c.\`${colTipC}\` = ?`);
          params.push(tipoClienteId);
        }
      }

      if (colTipoContacto && filters.tipoContacto !== null && filters.tipoContacto !== undefined && String(filters.tipoContacto).trim() !== '') {
        const tipoVal = String(filters.tipoContacto).trim();
        if (['Empresa', 'Persona', 'Otros'].includes(tipoVal)) {
          whereConditions.push(`c.\`${colTipoContacto}\` = ?`);
          params.push(tipoVal);
        }
      }

      if (filters.provincia !== null && filters.provincia !== undefined && filters.provincia !== '' && !isNaN(filters.provincia)) {
        const provinciaId = typeof filters.provincia === 'number' ? filters.provincia : parseInt(filters.provincia);
        if (!isNaN(provinciaId) && provinciaId > 0) {
          whereConditions.push(`c.\`${colProv}\` = ?`);
          params.push(provinciaId);
        }
      }

      if (filters.comercial !== null && filters.comercial !== undefined && filters.comercial !== '' && !isNaN(filters.comercial)) {
        const comercialId = typeof filters.comercial === 'number' ? filters.comercial : parseInt(filters.comercial);
        if (!isNaN(comercialId) && comercialId > 0) {
          if (!colComercial) {
            throw new Error('No se encontró columna de comercial en tabla clientes');
          }
          const poolId = filters.comercialPoolId != null && !isNaN(filters.comercialPoolId) ? Number(filters.comercialPoolId) : null;
          if (poolId != null && poolId > 0 && poolId !== comercialId) {
            whereConditions.push(`(c.\`${colComercial}\` = ? OR c.\`${colComercial}\` = ?)`);
            params.push(comercialId, poolId);
          } else if (filters.comercialIncludePool && comercialId !== 1) {
            whereConditions.push(`(c.\`${colComercial}\` = ? OR c.\`${colComercial}\` = 1)`);
            params.push(comercialId);
          } else {
            whereConditions.push(`c.\`${colComercial}\` = ?`);
            params.push(comercialId);
          }
        }
      }

      if (filters.conVentas !== undefined && filters.conVentas !== null && filters.conVentas !== '') {
        if (filters.conVentas === true || filters.conVentas === 'true' || filters.conVentas === '1') {
          whereConditions.push(`EXISTS (SELECT 1 FROM pedidos p2 WHERE p2.\`${this.__pedidosClienteCol}\` = c.\`${pk}\`)`);
        } else if (filters.conVentas === false || filters.conVentas === 'false' || filters.conVentas === '0') {
          whereConditions.push(`NOT EXISTS (SELECT 1 FROM pedidos p2 WHERE p2.\`${this.__pedidosClienteCol}\` = c.\`${pk}\`)`);
        }
      }

      if (filters.q && typeof filters.q === 'string' && filters.q.trim().length >= 1) {
        const raw = filters.q.trim();
        const rawDigits = raw.replace(/\D/g, '');
        const isOnlyDigits = rawDigits.length === raw.length;
        const canTextSearch = !isOnlyDigits && raw.length >= 3;
        const ftCacheKey = compactSearch ? '__clientesFulltextCols_basic' : '__clientesFulltextCols';
        const ftIndexName = compactSearch ? 'ft_clientes_busqueda_basica' : 'ft_clientes_busqueda';
        if (this[ftCacheKey] === undefined) {
          try {
            const { tClientes } = await this._ensureClientesMeta();
            const idx = await this.query(`SHOW INDEX FROM \`${tClientes}\``).catch(() => []);
            const ft = (idx || [])
              .filter(r => String(r.Key_name || r.key_name || '').trim() === ftIndexName)
              .filter(r => String(r.Index_type || r.index_type || '').toUpperCase() === 'FULLTEXT')
              .sort((a, b) => Number(a.Seq_in_index || a.seq_in_index || 0) - Number(b.Seq_in_index || b.seq_in_index || 0))
              .map(r => String(r.Column_name || r.column_name || '').trim())
              .filter(Boolean);
            this[ftCacheKey] = ft.length ? ft : null;
          } catch (_) {
            this[ftCacheKey] = null;
          }
        }

        const ftCols = Array.isArray(this[ftCacheKey]) ? this[ftCacheKey] : null;
        const canUseFulltext = ftCols && ftCols.length >= 1;

        let numericClause = null;
        let numericParams = null;
        if (isOnlyDigits && rawDigits.length > 0) {
          const n = Number(rawDigits);
          if (Number.isFinite(n) && n > 0) {
            numericClause = `(c.\`${pk}\` = ? OR c.CodigoPostal = ?)`;
            numericParams = [n, rawDigits];
          }
        }

        if (!canTextSearch) {
          if (numericClause) {
            whereConditions.push(numericClause);
            params.push(...numericParams);
          }
        } else if (canUseFulltext) {
          const terms = raw
            .split(/\s+/)
            .map(t => t.trim())
            .filter(Boolean)
            .map(t => `${t.replace(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ._@+-]/g, '')}*`)
            .filter(t => t !== '*')
            .join(' ');

          if (terms && terms.replace(/\*/g, '').length >= 3) {
            const colsSql = ftCols.map(cn => `c.\`${cn}\``).join(', ');
            whereConditions.push(
              numericClause
                ? `(${numericClause} OR (MATCH(${colsSql}) AGAINST (? IN BOOLEAN MODE)))`
                : `(MATCH(${colsSql}) AGAINST (? IN BOOLEAN MODE))`
            );
            if (numericParams) params.push(...numericParams);
            params.push(terms);
          } else {
            const termLower = raw.toLowerCase();
            const like = `%${termLower}%`;
            if (compactSearch) {
              whereConditions.push(`${numericClause ? `(${numericClause} OR (` : '('}
                LOWER(IFNULL(c.cli_nombre_razon_social,'')) LIKE ?
                OR LOWER(IFNULL(c.cli_nombre_cial,'')) LIKE ?
                OR LOWER(IFNULL(c.cli_dni_cif,'')) LIKE ?
              ${numericClause ? '))' : ')'}`);
              if (numericParams) params.push(...numericParams);
              params.push(like, like, like);
            } else {
              whereConditions.push(`${numericClause ? `(${numericClause} OR (` : '('}
                LOWER(IFNULL(c.cli_nombre_razon_social,'')) LIKE ?
                OR LOWER(IFNULL(c.cli_nombre_cial,'')) LIKE ?
                OR LOWER(IFNULL(c.cli_dni_cif,'')) LIKE ?
                OR LOWER(IFNULL(c.cli_email,'')) LIKE ?
                OR LOWER(IFNULL(c.cli_telefono,'')) LIKE ?
                OR LOWER(IFNULL(c.cli_movil,'')) LIKE ?
                OR LOWER(IFNULL(c.cli_numero_farmacia,'')) LIKE ?
                OR LOWER(IFNULL(c.cli_direccion,'')) LIKE ?
                OR LOWER(IFNULL(c.cli_poblacion,'')) LIKE ?
                OR LOWER(IFNULL(c.cli_codigo_postal,'')) LIKE ?
                OR LOWER(IFNULL(c.NomContacto,'')) LIKE ?
                OR LOWER(IFNULL(c.Observaciones,'')) LIKE ?
                OR LOWER(IFNULL(c.IBAN,'')) LIKE ?
                OR LOWER(IFNULL(c.CuentaContable,'')) LIKE ?
              ${numericClause ? '))' : ')'}`);
              if (numericParams) params.push(...numericParams);
              params.push(like, like, like, like, like, like, like, like, like, like, like, like, like, like);
            }
          }
        } else if (canTextSearch) {
          const termLower = raw.toLowerCase();
          const like = `%${termLower}%`;
          if (compactSearch) {
            whereConditions.push(`${numericClause ? `(${numericClause} OR (` : '('}
              LOWER(IFNULL(c.cli_nombre_razon_social,'')) LIKE ?
              OR LOWER(IFNULL(c.Nombre_Cial,'')) LIKE ?
              OR LOWER(IFNULL(c.DNI_CIF,'')) LIKE ?
            ${numericClause ? '))' : ')'}`);
            if (numericParams) params.push(...numericParams);
            params.push(like, like, like);
          } else {
            whereConditions.push(`${numericClause ? `(${numericClause} OR (` : '('}
              LOWER(IFNULL(c.cli_nombre_razon_social,'')) LIKE ?
              OR LOWER(IFNULL(c.Nombre_Cial,'')) LIKE ?
              OR LOWER(IFNULL(c.DNI_CIF,'')) LIKE ?
              OR LOWER(IFNULL(c.Email,'')) LIKE ?
              OR LOWER(IFNULL(c.Telefono,'')) LIKE ?
              OR LOWER(IFNULL(c.Movil,'')) LIKE ?
              OR LOWER(IFNULL(c.NumeroFarmacia,'')) LIKE ?
              OR LOWER(IFNULL(c.Direccion,'')) LIKE ?
              OR LOWER(IFNULL(c.Poblacion,'')) LIKE ?
              OR LOWER(IFNULL(c.CodigoPostal,'')) LIKE ?
              OR LOWER(IFNULL(c.NomContacto,'')) LIKE ?
              OR LOWER(IFNULL(c.Observaciones,'')) LIKE ?
              OR LOWER(IFNULL(c.IBAN,'')) LIKE ?
              OR LOWER(IFNULL(c.CuentaContable,'')) LIKE ?
            ${numericClause ? '))' : ')'}`);
            if (numericParams) params.push(...numericParams);
            params.push(like, like, like, like, like, like, like, like, like, like, like, like, like, like);
          }
        }
      }

      if (whereConditions.length > 0) {
        sql += ' WHERE ' + whereConditions.join(' AND ');
      }

      const hasSearch = !!(filters.q && String(filters.q).trim().length >= 3);
      const conVentas = (filters.conVentas === true || filters.conVentas === 'true' || filters.conVentas === '1');
      if (orderByNombre) {
        sql += ` ORDER BY NULLIF(TRIM(c.cli_nombre_razon_social), '') ${order}, c.\`${pk}\` ASC LIMIT ${limit} OFFSET ${offset}`;
      } else if (conVentas && !hasSearch && this.__pedidosFechaCol) {
        sql += ` ORDER BY (SELECT MAX(p3.\`${this.__pedidosFechaCol}\`) FROM pedidos p3 WHERE p3.\`${this.__pedidosClienteCol}\` = c.\`${pk}\`) DESC, c.\`${pk}\` ${order} LIMIT ${limit} OFFSET ${offset}`;
      } else {
        sql += ` ORDER BY c.\`${pk}\` ${order} LIMIT ${limit} OFFSET ${offset}`;
      }

      const rows = await this.query(sql, params);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo clientes paginados:', error.message);
      console.error('❌ SQL (paged):', sql);
      throw error;
    }
  },

  async countClientesOptimizado(filters = {}) {
    let sql = '';
    try {
      const { pk, colComercial, colEstadoCliente, colTipoContacto, colProvincia, colTipoCliente } = await this._ensureClientesMeta();
      const whereConditions = [];
      const colProv = colProvincia || 'cli_prov_id';
      const colTipC = colTipoCliente || 'cli_tipc_id';

      sql = 'SELECT COUNT(*) as total FROM clientes c';
      const params = [];

      if (colEstadoCliente) {
        if (filters.estadoCliente !== undefined && filters.estadoCliente !== null && String(filters.estadoCliente).trim() !== '' && !isNaN(filters.estadoCliente)) {
          const estadoId = Number(filters.estadoCliente);
          if (Number.isFinite(estadoId) && estadoId > 0) {
            whereConditions.push(`c.\`${colEstadoCliente}\` = ?`);
            params.push(estadoId);
          }
        } else if (filters.estado && typeof filters.estado === 'string') {
          const ids = await this._getEstadoClienteIds();
          const e = filters.estado.trim().toLowerCase();
          if (e === 'activos') {
            whereConditions.push(`c.\`${colEstadoCliente}\` = ?`);
            params.push(ids.activo);
          } else if (e === 'inactivos') {
            whereConditions.push(`c.\`${colEstadoCliente}\` = ?`);
            params.push(ids.inactivo);
          }
        }
      } else {
        if (filters.estado === 'activos') {
          whereConditions.push("(c.OK_KO = 1 OR c.OK_KO = '1' OR UPPER(c.OK_KO) = 'OK')");
        } else if (filters.estado === 'inactivos') {
          whereConditions.push("(c.OK_KO = 0 OR c.OK_KO = '0' OR UPPER(c.OK_KO) = 'KO')");
        }
      }

      if (!this.__pedidosClienteCol) {
        try {
          const colsRows = await this.query('SHOW COLUMNS FROM pedidos').catch(() => []);
          const cols = new Set((colsRows || []).map(r => String(r.Field || '').trim()).filter(Boolean));
          this.__pedidosClienteCol =
            ['Id_Cliente', 'Cliente_id', 'id_cliente', 'cliente_id', 'ClienteId', 'clienteId'].find(c => cols.has(c)) || 'Id_Cliente';
        } catch (_) {
          this.__pedidosClienteCol = 'Id_Cliente';
        }
      }

      if (filters.tipoCliente !== null && filters.tipoCliente !== undefined && filters.tipoCliente !== '' && !isNaN(filters.tipoCliente)) {
        const tipoClienteId = typeof filters.tipoCliente === 'number' ? filters.tipoCliente : parseInt(filters.tipoCliente);
        if (!isNaN(tipoClienteId) && tipoClienteId > 0) {
          whereConditions.push(`c.\`${colTipC}\` = ?`);
          params.push(tipoClienteId);
        }
      }

      if (colTipoContacto && filters.tipoContacto !== null && filters.tipoContacto !== undefined && String(filters.tipoContacto).trim() !== '') {
        const tipoVal = String(filters.tipoContacto).trim();
        if (['Empresa', 'Persona', 'Otros'].includes(tipoVal)) {
          whereConditions.push(`c.\`${colTipoContacto}\` = ?`);
          params.push(tipoVal);
        }
      }

      if (filters.provincia !== null && filters.provincia !== undefined && filters.provincia !== '' && !isNaN(filters.provincia)) {
        const provinciaId = typeof filters.provincia === 'number' ? filters.provincia : parseInt(filters.provincia);
        if (!isNaN(provinciaId) && provinciaId > 0) {
          whereConditions.push(`c.\`${colProv}\` = ?`);
          params.push(provinciaId);
        }
      }

      if (filters.comercial !== null && filters.comercial !== undefined && filters.comercial !== '' && !isNaN(filters.comercial)) {
        const comercialId = typeof filters.comercial === 'number' ? filters.comercial : parseInt(filters.comercial);
        if (!isNaN(comercialId) && comercialId > 0) {
          if (!colComercial) {
            throw new Error('No se encontró columna de comercial en tabla clientes');
          }
          const poolId = filters.comercialPoolId != null && !isNaN(filters.comercialPoolId) ? Number(filters.comercialPoolId) : null;
          if (poolId != null && poolId > 0 && poolId !== comercialId) {
            whereConditions.push(`(c.\`${colComercial}\` = ? OR c.\`${colComercial}\` = ?)`);
            params.push(comercialId, poolId);
          } else if (filters.comercialIncludePool && comercialId !== 1) {
            whereConditions.push(`(c.\`${colComercial}\` = ? OR c.\`${colComercial}\` = 1)`);
            params.push(comercialId);
          } else {
            whereConditions.push(`c.\`${colComercial}\` = ?`);
            params.push(comercialId);
          }
        }
      }

      if (filters.conVentas !== undefined && filters.conVentas !== null && filters.conVentas !== '') {
        if (filters.conVentas === true || filters.conVentas === 'true' || filters.conVentas === '1') {
          whereConditions.push(`EXISTS (SELECT 1 FROM pedidos p2 WHERE p2.\`${this.__pedidosClienteCol}\` = c.\`${pk}\`)`);
        } else if (filters.conVentas === false || filters.conVentas === 'false' || filters.conVentas === '0') {
          whereConditions.push(`NOT EXISTS (SELECT 1 FROM pedidos p2 WHERE p2.\`${this.__pedidosClienteCol}\` = c.\`${pk}\`)`);
        }
      }

      if (filters.q && typeof filters.q === 'string' && filters.q.trim().length >= 1) {
        const raw = filters.q.trim();
        const rawDigits = raw.replace(/\D/g, '');
        const isOnlyDigits = rawDigits.length === raw.length;
        const canTextSearch = !isOnlyDigits && raw.length >= 3;

        if (this.__clientesFulltextCols === undefined) {
          try {
            const { tClientes } = await this._ensureClientesMeta();
            const idx = await this.query(`SHOW INDEX FROM \`${tClientes}\``).catch(() => []);
            const ft = (idx || [])
              .filter(r => String(r.Key_name || r.key_name || '').trim() === 'ft_clientes_busqueda')
              .filter(r => String(r.Index_type || r.index_type || '').toUpperCase() === 'FULLTEXT')
              .sort((a, b) => Number(a.Seq_in_index || a.seq_in_index || 0) - Number(b.Seq_in_index || b.seq_in_index || 0))
              .map(r => String(r.Column_name || r.column_name || '').trim())
              .filter(Boolean);
            this.__clientesFulltextCols = ft.length ? ft : null;
          } catch (_) {
            this.__clientesFulltextCols = null;
          }
        }

        const ftCols = Array.isArray(this.__clientesFulltextCols) ? this.__clientesFulltextCols : null;
        const canUseFulltext = ftCols && ftCols.length >= 1;

        let numericClause = null;
        let numericParams = null;
        if (isOnlyDigits && rawDigits.length > 0) {
          const n = Number(rawDigits);
          if (Number.isFinite(n) && n > 0) {
            numericClause = `(c.\`${pk}\` = ? OR c.CodigoPostal = ?)`;
            numericParams = [n, rawDigits];
          }
        }

        if (!canTextSearch) {
          if (numericClause) {
            whereConditions.push(numericClause);
            params.push(...numericParams);
          }
        } else if (canUseFulltext) {
          const terms = raw
            .split(/\s+/)
            .map(t => t.trim())
            .filter(Boolean)
            .map(t => `${t.replace(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ._@+-]/g, '')}*`)
            .filter(t => t !== '*')
            .join(' ');

          if (terms && terms.replace(/\*/g, '').length >= 3) {
            const colsSql = ftCols.map(cn => `c.\`${cn}\``).join(', ');
            whereConditions.push(
              numericClause
                ? `(${numericClause} OR (MATCH(${colsSql}) AGAINST (? IN BOOLEAN MODE)))`
                : `(MATCH(${colsSql}) AGAINST (? IN BOOLEAN MODE))`
            );
            if (numericParams) params.push(...numericParams);
            params.push(terms);
          } else {
            const termLower = raw.toLowerCase();
            const like = `%${termLower}%`;
            whereConditions.push(`${numericClause ? `(${numericClause} OR (` : '('}
              LOWER(IFNULL(c.cli_nombre_razon_social,'')) LIKE ?
              OR LOWER(IFNULL(c.Nombre_Cial,'')) LIKE ?
              OR LOWER(IFNULL(c.DNI_CIF,'')) LIKE ?
              OR LOWER(IFNULL(c.Email,'')) LIKE ?
              OR LOWER(IFNULL(c.Telefono,'')) LIKE ?
              OR LOWER(IFNULL(c.Movil,'')) LIKE ?
              OR LOWER(IFNULL(c.NumeroFarmacia,'')) LIKE ?
              OR LOWER(IFNULL(c.Direccion,'')) LIKE ?
              OR LOWER(IFNULL(c.Poblacion,'')) LIKE ?
              OR LOWER(IFNULL(c.CodigoPostal,'')) LIKE ?
              OR LOWER(IFNULL(c.NomContacto,'')) LIKE ?
              OR LOWER(IFNULL(c.Observaciones,'')) LIKE ?
              OR LOWER(IFNULL(c.IBAN,'')) LIKE ?
              OR LOWER(IFNULL(c.CuentaContable,'')) LIKE ?
            ${numericClause ? '))' : ')'}`);
            if (numericParams) params.push(...numericParams);
            params.push(like, like, like, like, like, like, like, like, like, like, like, like, like, like);
          }
        } else if (canTextSearch) {
          const termLower = raw.toLowerCase();
          const like = `%${termLower}%`;
          whereConditions.push(`${numericClause ? `(${numericClause} OR (` : '('}
            LOWER(IFNULL(c.cli_nombre_razon_social,'')) LIKE ?
            OR LOWER(IFNULL(c.Nombre_Cial,'')) LIKE ?
            OR LOWER(IFNULL(c.DNI_CIF,'')) LIKE ?
            OR LOWER(IFNULL(c.Email,'')) LIKE ?
            OR LOWER(IFNULL(c.Telefono,'')) LIKE ?
            OR LOWER(IFNULL(c.Movil,'')) LIKE ?
            OR LOWER(IFNULL(c.NumeroFarmacia,'')) LIKE ?
            OR LOWER(IFNULL(c.Direccion,'')) LIKE ?
            OR LOWER(IFNULL(c.Poblacion,'')) LIKE ?
            OR LOWER(IFNULL(c.CodigoPostal,'')) LIKE ?
            OR LOWER(IFNULL(c.NomContacto,'')) LIKE ?
            OR LOWER(IFNULL(c.Observaciones,'')) LIKE ?
            OR LOWER(IFNULL(c.IBAN,'')) LIKE ?
            OR LOWER(IFNULL(c.CuentaContable,'')) LIKE ?
          ${numericClause ? '))' : ')'}`);
          if (numericParams) params.push(...numericParams);
          params.push(like, like, like, like, like, like, like, like, like, like, like, like, like, like);
        }
      }

      if (whereConditions.length > 0) {
        sql += ' WHERE ' + whereConditions.join(' AND ');
      }

      const rows = await this.query(sql, params);
      return rows?.[0]?.total ? Number(rows[0].total) : 0;
    } catch (error) {
      console.error('❌ Error contando clientes (optimizado):', error.message);
      console.error('❌ SQL (count):', sql);
      return 0;
    }
  },

  async moverClienteAPapelera(clienteId, eliminadoPor) {
    try {
      const cliente = await this.getClienteById(clienteId);
      if (!cliente) {
        throw new Error('Cliente no encontrado');
      }

      const datosPapelera = {
        id: cliente.id || cliente.Id,
        Id_Cial: cliente.Id_Cial || cliente.id_Cial,
        DNI_CIF: cliente.DNI_CIF,
        Nombre_Razon_Social: cliente.Nombre_Razon_Social || cliente.Nombre,
        Nombre_Cial: cliente.Nombre_Cial,
        NumeroFarmacia: cliente.NumeroFarmacia,
        Direccion: cliente.Direccion,
        Poblacion: cliente.Poblacion,
        Id_Provincia: cliente.Id_Provincia || cliente.id_Provincia,
        CodigoPostal: cliente.CodigoPostal,
        Movil: cliente.Movil,
        Telefono: cliente.Telefono,
        Email: cliente.Email,
        TipoCliente: cliente.TipoCliente,
        Id_TipoCliente: cliente.Id_TipoCliente || cliente.id_TipoCliente,
        CodPais: cliente.CodPais,
        Id_Pais: cliente.Id_Pais || cliente.id_Pais,
        Pais: cliente.Pais,
        Idioma: cliente.Idioma,
        Id_Idioma: cliente.Id_Idioma || cliente.id_Idioma,
        Moneda: cliente.Moneda,
        Id_Moneda: cliente.Id_Moneda || cliente.id_Moneda,
        NomContacto: cliente.NomContacto,
        Tarifa: cliente.Tarifa,
        Id_FormaPago: cliente.Id_FormaPago || cliente.id_FormaPago,
        Dto: cliente.Dto,
        CuentaContable: cliente.CuentaContable,
        RE: cliente.RE,
        Banco: cliente.Banco,
        Swift: cliente.Swift,
        IBAN: cliente.IBAN,
        Modelo_347: cliente.Modelo_347,
        FechaEliminacion: new Date(),
        EliminadoPor: eliminadoPor
      };

      const campos = Object.keys(datosPapelera).map(key => `\`${key}\``).join(', ');
      const placeholders = Object.keys(datosPapelera).map(() => '?').join(', ');
      const valores = Object.values(datosPapelera);

      const sqlInsert = `INSERT INTO \`Papelera-Clientes\` (${campos}) VALUES (${placeholders})`;
      console.log('📝 [PAPELERA] Insertando cliente en papelera:', { clienteId, eliminadoPor });
      await this.query(sqlInsert, valores);

      const sqlDelete = 'DELETE FROM clientes WHERE id = ?';
      await this.query(sqlDelete, [clienteId]);

      console.log(`✅ Cliente ${clienteId} movido a la papelera por usuario ${eliminadoPor}`);
      return { success: true, message: 'Cliente movido a la papelera correctamente' };
    } catch (error) {
      console.error('❌ Error moviendo cliente a la papelera:', error.message);
      throw error;
    }
  },

  async toggleClienteOkKo(id, value) {
    try {
      let okKoValue = 1;
      if (value === undefined || value === null || value === 'toggle') {
        const metaToggle = await this._ensureClientesMeta().catch(() => null);
        const pkToggle = metaToggle?.pk || 'cli_id';
        const colOkKo = 'cli_ok_ko';
        const current = await this.query(`SELECT \`${colOkKo}\` FROM clientes WHERE \`${pkToggle}\` = ?`, [id]);
        if (current && current.length > 0) {
          const currentValue = current[0][colOkKo];
          let esActivo = false;
          if (typeof currentValue === 'string') {
            esActivo = (currentValue.toUpperCase().trim() === 'OK');
          } else if (typeof currentValue === 'number') {
            esActivo = (currentValue === 1);
          } else if (typeof currentValue === 'boolean') {
            esActivo = currentValue;
          }
          okKoValue = esActivo ? 0 : 1;
        }
      } else {
        if (typeof value === 'string') {
          const valUpper = value.toUpperCase().trim();
          okKoValue = (valUpper === 'OK' || valUpper === 'ACTIVO' || valUpper === 'TRUE' || valUpper === '1') ? 1 : 0;
        } else if (typeof value === 'boolean') {
          okKoValue = value ? 1 : 0;
        } else if (typeof value === 'number') {
          okKoValue = (value === 0 || value === 1) ? value : 1;
        }
      }

      const meta = await this._ensureClientesMeta().catch(() => null);
      const colEstadoCliente = meta?.colEstadoCliente || null;
      let estadoFinal = null;
      let estadoNombre = null;
      if (colEstadoCliente) {
        const ids = await this._getEstadoClienteIds().catch(() => ({ potencial: 1, activo: 2, inactivo: 3 }));
        const cur = await this.query(`SELECT cli_dni_cif FROM clientes WHERE \`${meta?.pk || 'cli_id'}\` = ? LIMIT 1`, [id]).catch(() => []);
        const dni = cur && cur.length ? cur[0].cli_dni_cif : null;
        const dniValido = this._isValidDniCif(dni);
        estadoFinal = (okKoValue === 0) ? ids.inactivo : (dniValido ? ids.activo : ids.potencial);
        const sql = `UPDATE clientes SET cli_ok_ko = ?, \`${colEstadoCliente}\` = ? WHERE \`${meta?.pk || 'cli_id'}\` = ?`;
        await this.query(sql, [okKoValue, estadoFinal, id]);
        estadoNombre =
          estadoFinal === ids.inactivo ? 'Inactivo'
          : (estadoFinal === ids.activo ? 'Activo' : 'Potencial');
      } else {
        const metaElse = await this._ensureClientesMeta().catch(() => null);
        const pkElse = metaElse?.pk || 'cli_id';
        const sql = `UPDATE clientes SET cli_ok_ko = ? WHERE \`${pkElse}\` = ?`;
        await this.query(sql, [okKoValue, id]);
      }
      console.log(`✅ [TOGGLE OK_KO] Cliente ${id} actualizado: OK_KO = ${okKoValue} (${okKoValue === 1 ? 'Activo' : 'Inactivo'})`);
      if (colEstadoCliente) {
        return { affectedRows: 1, OK_KO: okKoValue, Id_EstdoCliente: estadoFinal, EstadoClienteNombre: estadoNombre };
      }
      return { affectedRows: 1, OK_KO: okKoValue };
    } catch (error) {
      console.error('❌ Error actualizando estado de cliente:', error.message);
      throw error;
    }
  },

  async updateCliente(id, payload) {
    return clientesCrud.updateCliente.call(this, id, payload);
  },

  async createCliente(payload) {
    return clientesCrud.createCliente.call(this, payload);
  }
};
