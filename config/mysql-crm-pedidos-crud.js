/**
 * CRUD pesado de pedidos: createPedido, updatePedidoWithLineas.
 * Se mezcla con mysql-crm-pedidos.js para mantener el módulo en archivos manejables.
 */
'use strict';

module.exports = {
  async createPedido(pedidoData) {
    try {
      if (!this.connected && !this.pool) await this.connect();
      await this.ensurePedidosSchema();

      const { tPedidos, pk, colCliente, colFecha, colNumPedido } = await this._ensurePedidosMeta();
      const cols = await this._getColumns(tPedidos).catch(() => []);
      const colsLower = new Map((cols || []).map((c) => [String(c).toLowerCase(), c]));
      const pick = (cands) => this._pickCIFromColumns(cols, cands);

      const colTarifaId = pick(['Id_Tarifa', 'id_tarifa', 'TarifaId', 'tarifa_id']);
      const colTarifaLegacy = pick(['Tarifa', 'tarifa']);
      const colDtoPedido = pick(['Dto', 'DTO', 'Descuento', 'DescuentoPedido', 'PorcentajeDescuento', 'porcentaje_descuento']);
      const colEstadoTxt = pick(['EstadoPedido', 'estado_pedido', 'Estado', 'estado']);
      const colEstadoId = pick(['Id_EstadoPedido', 'id_estado_pedido', 'EstadoPedidoId', 'estado_pedido_id']);

      const pedidoLegacyToCol = {
        Id_Cial: 'ped_com_id', Id_Cliente: 'ped_cli_id', Id_DireccionEnvio: 'ped_direnv_id',
        Id_FormaPago: 'ped_formp_id', Id_TipoPedido: 'ped_tipp_id', Id_Tarifa: 'ped_tarcli_id',
        Id_EstadoPedido: 'ped_estped_id', NumPedido: 'ped_numero', FechaPedido: 'ped_fecha',
        EstadoPedido: 'ped_estado_txt', TotalPedido: 'ped_total', BaseImponible: 'ped_base',
        TotalIva: 'ped_iva', TotalDescuento: 'ped_descuento', Dto: 'ped_dto',
        NumPedidoCliente: 'ped_num_pedido_cliente', NumAsociadoHefame: 'ped_num_asoc_hefame',
        FechaEntrega: 'ped_fecha_entrega', Observaciones: 'ped_observaciones',
        EsEspecial: 'ped_es_especial', EspecialEstado: 'ped_especial_estado',
        EspecialFechaSolicitud: 'ped_especial_fecha_solicitud'
      };

      const mysqlData = {};
      const input = pedidoData && typeof pedidoData === 'object' ? pedidoData : {};
      for (const [key, value] of Object.entries(input)) {
        const mappedKey = pedidoLegacyToCol[key] || key;
        const real = colsLower.get(String(mappedKey).toLowerCase()) || colsLower.get(String(key).toLowerCase());
        if (!real) continue;
        if (String(real).toLowerCase() === String(pk).toLowerCase()) continue;

        if (Array.isArray(value) && value.length > 0 && value[0]?.Id) {
          mysqlData[real] = value[0].Id;
        } else if (value === null || value === undefined || value === '') {
          continue;
        } else {
          mysqlData[real] = value;
        }
      }

      if (colNumPedido && (mysqlData[colNumPedido] === undefined || mysqlData[colNumPedido] === null || String(mysqlData[colNumPedido]).trim() === '')) {
        mysqlData[colNumPedido] = await this.getNextNumeroPedido();
      }
      if (colFecha && mysqlData[colFecha] === undefined) {
        mysqlData[colFecha] = new Date();
      }

      try {
        const clienteId = colCliente ? Number(mysqlData[colCliente] ?? input[colCliente] ?? input.ped_cli_id ?? input.Id_Cliente ?? input.ClienteId) : NaN;
        const hasTarifa = (colTarifaId && mysqlData[colTarifaId] !== undefined) || (colTarifaLegacy && mysqlData[colTarifaLegacy] !== undefined);
        const hasDto = colDtoPedido && mysqlData[colDtoPedido] !== undefined;
        if (colCliente && Number.isFinite(clienteId) && clienteId > 0 && (!hasTarifa || !hasDto)) {
          const cliente = await this.getClienteById(clienteId);
          if (cliente) {
            const tarifaCliente =
              cliente.cli_tarcli_id ?? cliente.cli_tarifa_legacy ?? cliente.Id_Tarifa ?? cliente.id_tarifa ?? cliente.Tarifa ?? cliente.tarifa ?? 0;
            const dtoCliente = cliente.cli_dto ?? cliente.Dto ?? cliente.dto ?? null;
            if (!hasTarifa) {
              let tId = Number(tarifaCliente);
              if (!Number.isFinite(tId) || tId < 0) tId = 0;
              if (tId > 0) {
                try {
                  const tTar = await this._resolveTableNameCaseInsensitive('tarifasClientes');
                  const tarCols = await this._getColumns(tTar).catch(() => []);
                  const pickTar = (cands) => this._pickCIFromColumns(tarCols, cands);
                  const tarPk = pickTar(['Id', 'id']) || 'Id';
                  const colActiva = pickTar(['Activa', 'activa']);
                  const colInicio = pickTar(['FechaInicio', 'fecha_inicio', 'Fecha_Inicio', 'inicio']);
                  const colFin = pickTar(['FechaFin', 'fecha_fin', 'Fecha_Fin', 'fin']);
                  const rows = await this.query(`SELECT * FROM \`${tTar}\` WHERE \`${tarPk}\` = ? LIMIT 1`, [tId]);
                  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
                  if (!row) {
                    tId = 0;
                  } else {
                    const activaRaw = colActiva ? row[colActiva] : 1;
                    const activa =
                      activaRaw === 1 || activaRaw === '1' || activaRaw === true ||
                      (typeof activaRaw === 'string' && ['ok', 'si', 'sí', 'true'].includes(activaRaw.trim().toLowerCase()));
                    const now = new Date();
                    const start = colInicio && row[colInicio] ? new Date(row[colInicio]) : null;
                    const end = colFin && row[colFin] ? new Date(row[colFin]) : null;
                    const inRange = (!start || now >= start) && (!end || now <= end);
                    if (!activa || !inRange) tId = 0;
                  }
                } catch (_) {
                  tId = 0;
                }
              }
              if (colTarifaId) mysqlData[colTarifaId] = tId;
              else if (colTarifaLegacy) mysqlData[colTarifaLegacy] = tId;
            }
            if (!hasDto && colDtoPedido && dtoCliente !== null && dtoCliente !== undefined && dtoCliente !== '') {
              mysqlData[colDtoPedido] = Number(dtoCliente) || 0;
            }
          }
        }
      } catch (_) {}

      try {
        await this.ensureEstadosPedidoTable();
        let estadoId = null;

        if (colEstadoId) {
          const raw = mysqlData[colEstadoId] ?? input.Id_EstadoPedido ?? input.id_estado_pedido ?? input.EstadoPedidoId ?? input.estado_pedido_id;
          const n = Number.parseInt(String(raw ?? '').trim(), 10);
          if (Number.isFinite(n) && n > 0) estadoId = n;
        }

        if (!estadoId) {
          const rawTxt = colEstadoTxt ? (mysqlData[colEstadoTxt] ?? input.EstadoPedido ?? input.Estado ?? null) : (input.EstadoPedido ?? input.Estado ?? null);
          const code = String(rawTxt ?? '').trim().toLowerCase();
          if (code) estadoId = await this.getEstadoPedidoIdByCodigo(code).catch(() => null);
        }

        if (!estadoId) estadoId = await this.getEstadoPedidoIdByCodigo('pendiente').catch(() => null);

        if (colEstadoId && estadoId && mysqlData[colEstadoId] === undefined) {
          mysqlData[colEstadoId] = estadoId;
        }

        if (colEstadoTxt && (mysqlData[colEstadoTxt] === undefined || mysqlData[colEstadoTxt] === null || String(mysqlData[colEstadoTxt]).trim() === '') && estadoId) {
          const est = await this.getEstadoPedidoById(estadoId).catch(() => null);
          const eMeta = await this._ensureEstadosPedidoMeta().catch(() => null);
          const nombre = eMeta?.colNombre && est ? est[eMeta.colNombre] : (est?.nombre ?? null);
          if (nombre) mysqlData[colEstadoTxt] = String(nombre);
        }
      } catch (_) {}

      if (Object.keys(mysqlData).length === 0) {
        throw new Error('No hay campos válidos para crear el pedido');
      }

      const buildInsert = (dataObj) => {
        const fields = Object.keys(dataObj).map(key => `\`${key}\``).join(', ');
        const placeholders = Object.keys(dataObj).map(() => '?').join(', ');
        const values = Object.values(dataObj);
        const sql = `INSERT INTO \`${tPedidos}\` (${fields}) VALUES (${placeholders})`;
        return { sql, values, fields };
      };

      let insert = buildInsert(mysqlData);
      console.log('🔍 [CREATE PEDIDO] SQL:', insert.sql);
      console.log('🔍 [CREATE PEDIDO] Values:', insert.values);

      let result;
      try {
        [result] = await this.pool.execute(insert.sql, insert.values);
      } catch (err) {
        const msg = String(err?.sqlMessage || err?.message || '');
        const isUnknownColumn = err?.code === 'ER_BAD_FIELD_ERROR' && /Unknown column/i.test(msg) && /Id_Tarifa/i.test(msg);
        if (isUnknownColumn && Object.prototype.hasOwnProperty.call(mysqlData, 'Id_Tarifa')) {
          console.warn('⚠️ [CREATE PEDIDO] La BD no tiene Id_Tarifa. Reintentando INSERT sin Id_Tarifa...');
          delete mysqlData.Id_Tarifa;
          insert = buildInsert(mysqlData);
          [result] = await this.pool.execute(insert.sql, insert.values);
        } else {
          throw err;
        }
      }
      const insertId = result.insertId;

      if (!insertId) {
        console.error('❌ [CREATE PEDIDO] No se pudo obtener insertId del resultado:', result);
        throw new Error('No se pudo obtener el ID del pedido creado');
      }

      console.log(`✅ [CREATE PEDIDO] Pedido creado con ID: ${insertId}`);
      return { Id: insertId, id: insertId, insertId: insertId };
    } catch (error) {
      console.error('❌ [CREATE PEDIDO] Error creando pedido:', error.message);
      console.error('❌ [CREATE PEDIDO] Datos que fallaron:', JSON.stringify(pedidoData, null, 2));
      throw error;
    }
  },

  async updatePedidoWithLineas(id, pedidoPayload, lineasPayload, options = {}) {
    const impl = require('./mysql-crm-pedidos-with-lineas');
    return impl.call(this, id, pedidoPayload, lineasPayload, options);
  }
};
