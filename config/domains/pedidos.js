/**
 * Dominio: Pedidos
 * Consultas y lógica específica de pedidos.
 * Se invoca con db como contexto (this) para acceder a query, _ensurePedidosMeta, etc.
 * getPedidoById usa this._enrichPedidoWithEstado (definido en mysql-crm.js).
 */
'use strict';

module.exports = {
  async getPedidos(comercialId = null) {
    try {
      let sql = 'SELECT * FROM pedidos';
      const params = [];

      if (comercialId) {
        sql += ' WHERE ped_com_id = ?';
        params.push(comercialId);
        console.log(`🔐 [GET_PEDIDOS] Filtro aplicado: ped_com_id = ${comercialId}`);
      }

      sql += ' ORDER BY ped_id DESC';

      const rows = await this.query(sql, params);
      console.log(`📊 [GET PEDIDOS] Total pedidos obtenidos: ${rows ? rows.length : 0}${comercialId ? ` (filtrado por comercial ${comercialId})` : ''}`);
      if (rows && rows.length > 0) {
        console.log(`📋 [GET PEDIDOS] Primer pedido (muestra):`, {
          Id: rows[0].Id || rows[0].id,
          NumPedido: rows[0].NumPedido || rows[0].Numero_Pedido || rows[0].numero,
          FechaPedido: rows[0].FechaPedido || rows[0]['Fecha Pedido'] || rows[0].fecha,
          Cliente_id: rows[0].Cliente_id || rows[0].Id_Cliente,
          Id_Cial: rows[0].Id_Cial || rows[0].id_cial,
          todasLasClaves: Object.keys(rows[0])
        });
      }
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo pedidos:', error.message);
      console.error('❌ Stack:', error.stack);
      return [];
    }
  },

  async getPedidosPaged(filters = {}, options = {}) {
    const { tPedidos, pk, colComercial, colCliente, colFecha, colNumPedido } = await this._ensurePedidosMeta();
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.min(500, Number(options.limit))) : 100;
    const offset = Number.isFinite(Number(options.offset)) ? Math.max(0, Number(options.offset)) : 0;

    const where = [];
    const params = [];

    const comercialId = filters.comercialId ? Number(filters.comercialId) : null;
    const clienteId = filters.clienteId ? Number(filters.clienteId) : null;
    const from = filters.from ? String(filters.from).slice(0, 10) : null;
    const to = filters.to ? String(filters.to).slice(0, 10) : null;
    const search = filters.search ? String(filters.search).trim().toLowerCase() : '';

    if (comercialId && colComercial) {
      where.push(`p.\`${colComercial}\` = ?`);
      params.push(comercialId);
    }
    if (clienteId && colCliente) {
      where.push(`p.\`${colCliente}\` = ?`);
      params.push(clienteId);
    }
    if (colFecha && (from || to)) {
      if (from && to) {
        where.push(`DATE(p.\`${colFecha}\`) BETWEEN ? AND ?`);
        params.push(from, to);
      } else if (from) {
        where.push(`DATE(p.\`${colFecha}\`) >= ?`);
        params.push(from);
      } else if (to) {
        where.push(`DATE(p.\`${colFecha}\`) <= ?`);
        params.push(to);
      }
    }
    if (search && colNumPedido) {
      where.push(`LOWER(COALESCE(CONCAT(p.\`${colNumPedido}\`,''),'')) LIKE ?`);
      params.push(`%${search}%`);
    }

    let sql = `SELECT p.* FROM \`${tPedidos}\` p`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');

    if (colFecha) {
      sql += ` ORDER BY p.\`${colFecha}\` DESC, p.\`${pk}\` DESC`;
    } else {
      sql += ` ORDER BY p.\`${pk}\` DESC`;
    }
    sql += ` LIMIT ${limit} OFFSET ${offset}`;

    return await this.query(sql, params);
  },

  async countPedidos(filters = {}) {
    try {
      const { tPedidos, colComercial, colCliente, colFecha, colNumPedido } = await this._ensurePedidosMeta();
      const where = [];
      const params = [];

      const comercialId = filters.comercialId ? Number(filters.comercialId) : null;
      const clienteId = filters.clienteId ? Number(filters.clienteId) : null;
      const from = filters.from ? String(filters.from).slice(0, 10) : null;
      const to = filters.to ? String(filters.to).slice(0, 10) : null;
      const search = filters.search ? String(filters.search).trim().toLowerCase() : '';

      if (comercialId && colComercial) {
        where.push(`p.\`${colComercial}\` = ?`);
        params.push(comercialId);
      }
      if (clienteId && colCliente) {
        where.push(`p.\`${colCliente}\` = ?`);
        params.push(clienteId);
      }
      if (colFecha && (from || to)) {
        if (from && to) {
          where.push(`DATE(p.\`${colFecha}\`) BETWEEN ? AND ?`);
          params.push(from, to);
        } else if (from) {
          where.push(`DATE(p.\`${colFecha}\`) >= ?`);
          params.push(from);
        } else if (to) {
          where.push(`DATE(p.\`${colFecha}\`) <= ?`);
          params.push(to);
        }
      }
      if (search && colNumPedido) {
        where.push(`LOWER(COALESCE(CONCAT(p.\`${colNumPedido}\`,''),'')) LIKE ?`);
        params.push(`%${search}%`);
      }

      let sql = `SELECT COUNT(*) as total FROM \`${tPedidos}\` p`;
      if (where.length) sql += ' WHERE ' + where.join(' AND ');

      const rows = await this.query(sql, params);
      return rows?.[0]?.total ? Number(rows[0].total) : 0;
    } catch (e) {
      return 0;
    }
  },

  async getPedidosByComercial(comercialId) {
    try {
      const { tPedidos, pk, colComercial } = await this._ensurePedidosMeta();
      if (colComercial) {
        return await this.query(`SELECT * FROM \`${tPedidos}\` WHERE \`${colComercial}\` = ? ORDER BY \`${pk}\` DESC`, [comercialId]);
      }
      const sql = 'SELECT * FROM pedidos WHERE Id_Cial = ? OR id_cial = ? OR Comercial_id = ? OR comercial_id = ? ORDER BY Id DESC';
      return await this.query(sql, [comercialId, comercialId, comercialId, comercialId]);
    } catch (error) {
      console.error('❌ Error obteniendo pedidos por comercial:', error.message);
      return [];
    }
  },

  async getPedidosByCliente(clienteId) {
    try {
      const { tPedidos, pk, colCliente } = await this._ensurePedidosMeta();
      if (colCliente) {
        return await this.query(`SELECT * FROM \`${tPedidos}\` WHERE \`${colCliente}\` = ? ORDER BY \`${pk}\` DESC`, [clienteId]);
      }
      const sql = 'SELECT * FROM pedidos WHERE ClienteId = ? OR clienteId = ? ORDER BY Id DESC';
      return await this.query(sql, [clienteId, clienteId]);
    } catch (error) {
      console.error('❌ Error obteniendo pedidos por cliente:', error.message);
      return [];
    }
  },

  async getPedidoById(id) {
    try {
      const meta = await this._ensurePedidosMeta().catch(() => null);
      const tPedidos = meta?.tPedidos || 'pedidos';
      const pk = meta?.pk || 'id';
      const colNumPedido = meta?.colNumPedido || null;

      const raw = id;
      const asNum = Number(raw);
      const isNum = Number.isFinite(asNum) && asNum > 0;
      const asStr = String(raw || '').trim();

      if (isNum) {
        const rows = await this.query(`SELECT * FROM \`${tPedidos}\` WHERE \`${pk}\` = ? LIMIT 1`, [asNum]);
        if (rows && rows.length > 0) return await this._enrichPedidoWithEstado(rows[0]);
      }

      if (isNum && colNumPedido) {
        const sec = String(asNum).padStart(4, '0');
        const nowYear = new Date().getFullYear();
        const yearsToTry = [0, 1, 2, 3, 4, 5].map(d => nowYear - d);
        for (const y of yearsToTry) {
          const yy = String(y).slice(-2);
          const numPedido = `P${yy}${sec}`;
          const rowsByNum = await this.query(`SELECT * FROM \`${tPedidos}\` WHERE \`${colNumPedido}\` = ? LIMIT 1`, [numPedido]);
          if (rowsByNum && rowsByNum.length > 0) return await this._enrichPedidoWithEstado(rowsByNum[0]);
        }
      }

      if (asStr && colNumPedido) {
        const rowsNum = await this.query(`SELECT * FROM \`${tPedidos}\` WHERE \`${colNumPedido}\` = ? LIMIT 1`, [asStr]);
        if (rowsNum && rowsNum.length > 0) return await this._enrichPedidoWithEstado(rowsNum[0]);
      }

      return null;
    } catch (error) {
      console.error('❌ Error obteniendo pedido por ID:', error.message);
      console.error('❌ ID usado:', id);
      return null;
    }
  },

  async getPedidosArticulos() {
    try {
      const sql = 'SELECT * FROM pedidos_articulos ORDER BY Id ASC';
      const rows = await this.query(sql);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo pedidos_articulos:', error.message);
      return [];
    }
  },

  async getArticulosByPedido(pedidoId) {
    try {
      const idNum = Number(pedidoId);
      if (!Number.isFinite(idNum) || idNum <= 0) return [];

      const pedido = await this.getPedidoById(idNum);
      if (!pedido) return [];

      const pedidosMeta = await this._ensurePedidosMeta();
      const paMeta = await this._ensurePedidosArticulosMeta();
      const tPA = paMeta.table;
      const paCols = await this._getColumns(tPA).catch(() => []);

      const tArt = await this._resolveTableNameCaseInsensitive('articulos').catch(() => null);
      const aCols = tArt ? await this._getColumns(tArt).catch(() => []) : [];
      const aPk = this._pickCIFromColumns(aCols, ['Id', 'id']) || 'Id';

      const where = [];
      const params = [];

      if (paMeta.colPedidoId) {
        where.push(`pa.\`${paMeta.colPedidoId}\` = ?`);
        params.push(idNum);
      }
      if (paMeta.colPedidoIdNum) {
        where.push(`pa.\`${paMeta.colPedidoIdNum}\` = ?`);
        params.push(idNum);
      }

      const colNumPedidoPedido = pedidosMeta.colNumPedido;
      const colNumPedidoLinea = paMeta.colNumPedido;
      const numPedido = colNumPedidoPedido ? (pedido[colNumPedidoPedido] ?? pedido.NumPedido ?? pedido.Numero_Pedido ?? null) : null;
      if (numPedido && colNumPedidoLinea) {
        where.push(`pa.\`${colNumPedidoLinea}\` = ?`);
        params.push(String(numPedido).trim());
      }

      if (!where.length && Array.isArray(paCols) && paCols.length) {
        const colLower = (c) => String(c).toLowerCase();
        const idLink = paCols.find((c) => {
          const l = colLower(c);
          return /id_numpedido|id_num_pedido|pedido_id|id_pedido|pedidoid|idpedido/.test(l);
        });
        if (idLink) {
          where.push(`pa.\`${idLink}\` = ?`);
          params.push(idNum);
        }
        if (!where.length && numPedido) {
          const numLink = paCols.find((c) => {
            const l = colLower(c);
            return /numpedido|numero_pedido|num_pedido|numeropedido/.test(l);
          });
          if (numLink) {
            where.push(`pa.\`${numLink}\` = ?`);
            params.push(String(numPedido).trim());
          }
        }
      }

      if (!where.length) return [];

      const joinArticulo = (tArt && paMeta.colArticulo)
        ? `LEFT JOIN \`${tArt}\` a ON pa.\`${paMeta.colArticulo}\` = a.\`${aPk}\``
        : '';

      const pickPaCol = (cands) => this._pickCIFromColumns(paCols, cands);
      const colPvp = pickPaCol(['PVP', 'pvp', 'PVPUnit', 'Precio', 'precio', 'PrecioUnitario', 'precio_unitario']);
      const colDto = pickPaCol(['DtoLinea', 'dto_linea', 'dtoLinea', 'Dto', 'dto', 'DTO', 'Descuento', 'descuento']);
      const colIva = pickPaCol(['IVA', 'iva', 'PorcIVA', 'porc_iva', 'PorcentajeIVA', 'porcentaje_iva', 'TipoIVA', 'tipo_iva']);
      const extraSelect = [
        colPvp ? `pa.\`${colPvp}\` AS Linea_PVP` : null,
        colDto ? `pa.\`${colDto}\` AS Linea_Dto` : null,
        colIva ? `pa.\`${colIva}\` AS Linea_IVA` : null
      ].filter(Boolean).join(', ');

      const sql = `
        SELECT pa.*${extraSelect ? `, ${extraSelect}` : ''}${joinArticulo ? ', a.*' : ''}
        FROM \`${tPA}\` pa
        ${joinArticulo}
        WHERE (${where.join(' OR ')})
        ORDER BY pa.\`${paMeta.pk}\` ASC
      `;
      return await this.query(sql, params);
    } catch (error) {
      console.error('❌ Error obteniendo artículos por pedido:', error.message);
      return [];
    }
  },

  async updatePedido(id, payload) {
    try {
      const idNum = Number(id);
      if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('ID no válido');
      if (!payload || typeof payload !== 'object') throw new Error('Payload no válido');

      if (!this.connected && !this.pool) await this.connect();

      const { tPedidos, pk } = await this._ensurePedidosMeta();
      const cols = await this._getColumns(tPedidos).catch(() => []);
      const colsLower = new Map((cols || []).map((c) => [String(c).toLowerCase(), c]));

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

      const filtered = {};
      for (const [k, v] of Object.entries(payload)) {
        const mappedKey = pedidoLegacyToCol[k] || k;
        const real = colsLower.get(String(mappedKey).toLowerCase()) || colsLower.get(String(k).toLowerCase());
        if (real && String(real).toLowerCase() !== String(pk).toLowerCase()) filtered[real] = v;
      }

      const keys = Object.keys(filtered);
      if (!keys.length) return { affectedRows: 0 };

      const fields = keys.map((k) => `\`${k}\` = ?`).join(', ');
      const values = keys.map((k) => filtered[k]);
      values.push(idNum);

      const sql = `UPDATE \`${tPedidos}\` SET ${fields} WHERE \`${pk}\` = ?`;
      const [result] = await this.pool.execute(sql, values);
      return { affectedRows: result?.affectedRows || 0, changedRows: result?.changedRows || 0 };
    } catch (error) {
      console.error('❌ Error actualizando pedido:', error.message);
      throw error;
    }
  }
};
