/**
 * Módulo pedidos para MySQLCRM.
 * Métodos extraídos de mysql-crm.js para gestión de pedidos, líneas, estados, descuentos.
 * Requiere: this.query, this.pool, this._getColumns, this._resolveTableNameCaseInsensitive,
 * this._pickCIFromColumns, this.connect, this.getClienteById, this._ensureDireccionesEnvioMeta.
 */
'use strict';

const pedidosCrud = require('./mysql-crm-pedidos-crud');

const base = {
  async _ensurePedidosMeta() {
    if (this._metaCache?.pedidosMeta) return this._metaCache.pedidosMeta;

    const tPedidos = await this._resolveTableNameCaseInsensitive('pedidos');
    const cols = await this._getColumns(tPedidos);
    const pickCI = (cands) => this._pickCIFromColumns(cols, cands);

    const pk = pickCI(['ped_id', 'Id', 'id']) || 'ped_id';
    const colComercial = pickCI([
      'ped_com_id',
      'Id_Cial',
      'id_cial',
      'Comercial_id',
      'comercial_id',
      'ComercialId',
      'comercialId',
      'Id_Comercial',
      'id_comercial'
    ]);
    const colCliente = pickCI([
      'ped_cli_id',
      'Id_Cliente',
      'id_cliente',
      'Cliente_id',
      'cliente_id',
      'ClienteId',
      'clienteId'
    ]);
    const colFecha = pickCI([
      'ped_fecha',
      'FechaPedido',
      'Fecha_Pedido',
      'Fecha',
      'fecha',
      'created_at',
      'CreatedAt'
    ]);
    const colNumPedido = pickCI([
      'ped_numero',
      'NumPedido',
      'Numero_Pedido',
      'numero_pedido',
      'Número_Pedido',
      'Número Pedido',
      'NumeroPedido',
      'numeroPedido'
    ]);

    const colEstado = pickCI(['ped_estado_txt', 'EstadoPedido', 'estado_pedido', 'Estado', 'estado']);
    const colEstadoId = pickCI(['ped_estped_id', 'Id_EstadoPedido', 'id_estado_pedido', 'EstadoPedidoId', 'estado_pedido_id']);
    const meta = { tPedidos, pk, colComercial, colCliente, colFecha, colNumPedido, colEstado, colEstadoId };
    this._metaCache.pedidosMeta = meta;
    return meta;
  },

  async _ensurePedidosArticulosMeta() {
    if (this._metaCache?.pedidosArticulosMeta) return this._metaCache.pedidosArticulosMeta;

    const t = await this._resolveTableNameCaseInsensitive('pedidos_articulos');
    const cols = await this._getColumns(t);
    const pickCI = (cands) => this._pickCIFromColumns(cols, cands);

    const pk = pickCI(['pedart_id', 'Id', 'id']) || 'pedart_id';
    const colNumPedido = pickCI(['pedart_numero', 'NumPedido', 'numPedido', 'NumeroPedido', 'numeroPedido', 'Numero_Pedido', 'Número_Pedido', 'Número Pedido']);
    const colPedidoId = pickCI(['pedart_ped_id', 'PedidoId', 'pedidoId', 'Id_Pedido', 'id_pedido', 'pedido_id', 'IdPedido', 'idPedido']);
    const colPedidoIdNum = pickCI(['pedart_ped_id', 'Id_NumPedido', 'id_numpedido', 'id_num_pedido', 'PedidoIdNum', 'pedidoIdNum', 'IdNumPedido', 'idNumPedido']);
    const colArticulo = pickCI(['pedart_art_id', 'Id_Articulo', 'id_articulo', 'ArticuloId', 'articuloId', 'IdArticulo', 'idArticulo']);

    const meta = { table: t, pk, colNumPedido, colPedidoId, colPedidoIdNum, colArticulo };
    this._metaCache.pedidosArticulosMeta = meta;
    return meta;
  },

  async _ensureDescuentosPedidoMeta() {
    if (this._metaCache?.descuentosPedidoMeta) return this._metaCache.descuentosPedidoMeta;

    const t = await this._resolveTableNameCaseInsensitive('descuentos_pedido');
    const cols = await this._getColumns(t).catch(() => []);
    const pickCI = (cands) => this._pickCIFromColumns(cols, cands);

    const pk = pickCI(['descped_id', 'id', 'Id']) || 'descped_id';
    const colDesde = pickCI(['descped_importe_desde', 'importe_desde', 'Importe_Desde', 'ImporteDesde', 'desde', 'importe_min', 'min']);
    const colHasta = pickCI(['descped_importe_hasta', 'importe_hasta', 'Importe_Hasta', 'ImporteHasta', 'hasta', 'importe_max', 'max']);
    const colDto = pickCI(['descped_pct', 'dto_pct', 'DtoPct', 'dto', 'Dto', 'porcentaje', 'Porcentaje']);
    const colActivo = pickCI(['descped_activo', 'activo', 'Activo']) || 'descped_activo';
    const colOrden = pickCI(['descped_orden', 'orden', 'Orden', 'prioridad', 'Prioridad']) || 'descped_orden';

    const meta = { table: t, pk, colDesde, colHasta, colDto, colActivo, colOrden };
    this._metaCache.descuentosPedidoMeta = meta;
    return meta;
  },

  async _ensureEstadosPedidoMeta() {
    if (this._metaCache?.estadosPedidoMeta) return this._metaCache.estadosPedidoMeta;
    const table = await this._resolveTableNameCaseInsensitive('estados_pedido');
    const cols = await this._getColumns(table).catch(() => []);
    const pick = (cands) => this._pickCIFromColumns(cols, cands);
    const pk = pick(['estped_id', 'id', 'Id']) || 'estped_id';
    const colCodigo = pick(['estped_codigo', 'codigo', 'Codigo', 'code']) || 'estped_codigo';
    const colNombre = pick(['estped_nombre', 'nombre', 'Nombre', 'name']) || 'estped_nombre';
    const colColor = pick(['estped_color', 'color', 'Color']) || 'estped_color';
    const colActivo = pick(['estped_activo', 'activo', 'Activo']) || 'estped_activo';
    const colOrden = pick(['estped_orden', 'orden', 'Orden']) || 'estped_orden';
    const meta = { table, pk, colCodigo, colNombre, colColor, colActivo, colOrden, cols };
    this._metaCache.estadosPedidoMeta = meta;
    return meta;
  },

  async ensureEstadosPedidoTable() {
    try {
      await this.query(`
        CREATE TABLE IF NOT EXISTS \`estados_pedido\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`codigo\` VARCHAR(32) NOT NULL,
          \`nombre\` VARCHAR(64) NOT NULL,
          \`color\` ENUM('ok','info','warn','danger') NOT NULL DEFAULT 'info',
          \`activo\` TINYINT(1) NOT NULL DEFAULT 1,
          \`orden\` INT NOT NULL DEFAULT 0,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uq_estados_pedido_codigo\` (\`codigo\`),
          KEY \`idx_estados_pedido_activo_orden\` (\`activo\`, \`orden\`, \`nombre\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await this.query(
        `
          INSERT INTO \`estados_pedido\` (\`codigo\`, \`nombre\`, \`color\`, \`activo\`, \`orden\`)
          VALUES
            ('pendiente', 'Pendiente', 'warn', 1, 10),
            ('aprobado',  'Aprobado',  'ok',   1, 20),
            ('entregado', 'Entregado', 'info', 1, 25),
            ('pagado',    'Pagado',    'ok',   1, 30),
            ('denegado',  'Denegado',  'danger', 1, 40)
          ON DUPLICATE KEY UPDATE
            \`nombre\`=VALUES(\`nombre\`),
            \`color\`=VALUES(\`color\`),
            \`activo\`=VALUES(\`activo\`),
            \`orden\`=VALUES(\`orden\`)
        `
      );
      await this._ensureEstadosPedidoMeta().catch(() => null);
      return true;
    } catch (e) {
      console.warn('⚠️ [SCHEMA] No se pudo asegurar estados_pedido:', e?.message || e);
      return false;
    }
  },

  async getEstadosPedidoActivos() {
    await this.ensureEstadosPedidoTable();
    try {
      const meta = await this._ensureEstadosPedidoMeta().catch(() => null);
      if (!meta?.table) return [];
      const sql = `
        SELECT
          \`${meta.pk}\` AS id,
          \`${meta.colCodigo}\` AS codigo,
          \`${meta.colNombre}\` AS nombre,
          \`${meta.colColor}\` AS color,
          \`${meta.colOrden}\` AS orden
        FROM \`${meta.table}\`
        WHERE \`${meta.colActivo}\` = 1
        ORDER BY \`${meta.colOrden}\` ASC, \`${meta.colNombre}\` ASC
      `;
      const rows = await this.query(sql).catch(() => []);
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  },

  async getEstadoPedidoIdByCodigo(codigo) {
    const code = String(codigo || '').trim().toLowerCase();
    if (!code) return null;
    await this.ensureEstadosPedidoTable();
    try {
      const meta = await this._ensureEstadosPedidoMeta().catch(() => null);
      if (!meta?.table) return null;
      const rows = await this.query(
        `SELECT \`${meta.pk}\` AS id FROM \`${meta.table}\` WHERE LOWER(TRIM(\`${meta.colCodigo}\`)) = ? LIMIT 1`,
        [code]
      );
      const id = rows?.[0]?.id;
      const n = Number(id);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch (_) {
      return null;
    }
  },

  async getEstadoPedidoById(id) {
    const n = Number.parseInt(String(id ?? '').trim(), 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    await this.ensureEstadosPedidoTable();
    try {
      const meta = await this._ensureEstadosPedidoMeta().catch(() => null);
      if (!meta?.table) return null;
      const rows = await this.query(`SELECT * FROM \`${meta.table}\` WHERE \`${meta.pk}\` = ? LIMIT 1`, [n]);
      return rows?.[0] ?? null;
    } catch (_) {
      return null;
    }
  },

  async getDescuentosPedidoActivos(conn = null) {
    try {
      const meta = await this._ensureDescuentosPedidoMeta();
      if (!meta?.table || !meta.colDesde || !meta.colDto) return [];

      const selectCols = [
        meta.colDesde ? `\`${meta.colDesde}\` AS importe_desde` : null,
        meta.colHasta ? `\`${meta.colHasta}\` AS importe_hasta` : 'NULL AS importe_hasta',
        meta.colDto ? `\`${meta.colDto}\` AS dto_pct` : null,
        meta.colOrden ? `\`${meta.colOrden}\` AS orden` : '0 AS orden'
      ].filter(Boolean);

      const where = meta.colActivo ? `WHERE \`${meta.colActivo}\` = 1` : '';
      const orderBy = `ORDER BY orden ASC, importe_desde ASC`;
      const sql = `SELECT ${selectCols.join(', ')} FROM \`${meta.table}\` ${where} ${orderBy}`;

      let rows = [];
      if (conn) {
        const [r] = await conn.execute(sql);
        rows = r;
      } else {
        rows = await this.query(sql).catch(() => []);
      }
      const out = [];
      for (const row of (rows || [])) {
        const desde = Number(String(row.importe_desde ?? '').replace(',', '.'));
        const hastaRaw = row.importe_hasta;
        const hasta =
          hastaRaw === null || hastaRaw === undefined || String(hastaRaw).trim() === ''
            ? null
            : Number(String(hastaRaw).replace(',', '.'));
        const dto = Number(String(row.dto_pct ?? '').replace(',', '.'));
        if (!Number.isFinite(desde)) continue;
        if (hasta !== null && !Number.isFinite(hasta)) continue;
        if (!Number.isFinite(dto)) continue;
        out.push({ importe_desde: desde, importe_hasta: hasta, dto_pct: dto, orden: Number(row.orden || 0) || 0 });
      }
      return out;
    } catch (_) {
      return [];
    }
  },

  async getDtoPedidoPctForSubtotal(subtotal, conn = null) {
    const x = Number(subtotal);
    if (!Number.isFinite(x) || x <= 0) return 0;
    const tramos = await this.getDescuentosPedidoActivos(conn);
    for (const t of (tramos || [])) {
      const desde = Number(t.importe_desde);
      const hasta = t.importe_hasta === null || t.importe_hasta === undefined ? null : Number(t.importe_hasta);
      if (!Number.isFinite(desde)) continue;
      if (x >= desde && (hasta === null || (!Number.isNaN(hasta) && x < hasta))) {
        const dto = Number(t.dto_pct);
        return Number.isFinite(dto) ? Math.max(0, Math.min(100, dto)) : 0;
      }
    }
    return 0;
  },

  async getDescuentosPedidoAdmin() {
    try {
      const meta = await this._ensureDescuentosPedidoMeta();
      if (!meta?.table) return null;
      const cols = await this._getColumns(meta.table).catch(() => []);
      if (!Array.isArray(cols) || cols.length === 0) return null;
      const pickCI = (cands) => this._pickCIFromColumns(cols, cands);
      const pk = meta.pk || pickCI(['id', 'Id']) || 'id';
      const colDesde = meta.colDesde || pickCI(['importe_desde']);
      const colHasta = meta.colHasta || pickCI(['importe_hasta']);
      const colDto = meta.colDto || pickCI(['dto_pct']);
      const colActivo = meta.colActivo || pickCI(['activo']);
      const colOrden = meta.colOrden || pickCI(['orden']);
      const colUpdatedAt = pickCI(['updated_at', 'UpdatedAt', 'Actualizado', 'actualizado', 'FechaActualizacion', 'fecha_actualizacion']);

      const selectCols = [
        `\`${pk}\` AS id`,
        colDesde ? `\`${colDesde}\` AS importe_desde` : '0 AS importe_desde',
        colHasta ? `\`${colHasta}\` AS importe_hasta` : 'NULL AS importe_hasta',
        colDto ? `\`${colDto}\` AS dto_pct` : '0 AS dto_pct',
        colActivo ? `\`${colActivo}\` AS activo` : '1 AS activo',
        colOrden ? `\`${colOrden}\` AS orden` : '0 AS orden',
        colUpdatedAt ? `\`${colUpdatedAt}\` AS updated_at` : 'NULL AS updated_at'
      ];
      const sql = `SELECT ${selectCols.join(', ')} FROM \`${meta.table}\` ORDER BY orden ASC, importe_desde ASC`;
      const rows = await this.query(sql).catch(() => null);
      return rows;
    } catch (_) {
      return null;
    }
  },

  async getDescuentoPedidoById(id) {
    try {
      const idNum = Number(id);
      if (!Number.isFinite(idNum) || idNum <= 0) return null;
      const meta = await this._ensureDescuentosPedidoMeta();
      if (!meta?.table) return null;
      const sql = `SELECT * FROM \`${meta.table}\` WHERE \`${meta.pk}\` = ? LIMIT 1`;
      const rows = await this.query(sql, [idNum]).catch(() => []);
      return rows && rows[0] ? rows[0] : null;
    } catch (_) {
      return null;
    }
  },

  async createDescuentoPedido(payload) {
    const meta = await this._ensureDescuentosPedidoMeta();
    if (!meta?.table) throw new Error('Tabla descuentos_pedido no disponible');
    const data = payload && typeof payload === 'object' ? payload : {};
    const cols = await this._getColumns(meta.table).catch(() => []);
    const colsLower = new Map((cols || []).map((c) => [String(c).toLowerCase(), c]));
    const out = {};
    const put = (key, value) => {
      const real = colsLower.get(String(key).toLowerCase());
      if (real) out[real] = value;
    };
    put('importe_desde', data.importe_desde);
    put('importe_hasta', data.importe_hasta);
    put('dto_pct', data.dto_pct);
    put('activo', data.activo ?? 1);
    put('orden', data.orden ?? 0);
    const keys = Object.keys(out);
    if (!keys.length) throw new Error('Payload vacío');
    const fields = keys.map((c) => `\`${c}\``).join(', ');
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map((c) => out[c]);
    const sql = `INSERT INTO \`${meta.table}\` (${fields}) VALUES (${placeholders})`;
    return await this.query(sql, values);
  },

  async updateDescuentoPedido(id, payload) {
    const meta = await this._ensureDescuentosPedidoMeta();
    if (!meta?.table) throw new Error('Tabla descuentos_pedido no disponible');
    const idNum = Number(id);
    if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('ID no válido');
    const data = payload && typeof payload === 'object' ? payload : {};
    const cols = await this._getColumns(meta.table).catch(() => []);
    const colsLower = new Map((cols || []).map((c) => [String(c).toLowerCase(), c]));
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      const real = colsLower.get(String(k).toLowerCase());
      if (!real) continue;
      if (String(real).toLowerCase() === String(meta.pk).toLowerCase()) continue;
      out[real] = v;
    }
    const keys = Object.keys(out);
    if (!keys.length) return { affectedRows: 0 };
    const fields = keys.map((c) => `\`${c}\` = ?`).join(', ');
    const values = keys.map((c) => out[c]);
    values.push(idNum);
    const sql = `UPDATE \`${meta.table}\` SET ${fields} WHERE \`${meta.pk}\` = ?`;
    return await this.query(sql, values);
  },

  async toggleDescuentoPedidoActivo(id) {
    const meta = await this._ensureDescuentosPedidoMeta();
    if (!meta?.table) throw new Error('Tabla descuentos_pedido no disponible');
    const idNum = Number(id);
    if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('ID no válido');
    const item = await this.getDescuentoPedidoById(idNum);
    if (!item) throw new Error('No encontrado');
    const cols = await this._getColumns(meta.table).catch(() => []);
    const pickCI = (cands) => this._pickCIFromColumns(cols, cands);
    const colActivo = meta.colActivo || pickCI(['activo', 'Activo']) || 'activo';
    const cur = Number(item[colActivo] ?? item.activo ?? 0) === 1 ? 1 : 0;
    const next = cur ? 0 : 1;
    const sql = `UPDATE \`${meta.table}\` SET \`${colActivo}\` = ? WHERE \`${meta.pk}\` = ?`;
    return await this.query(sql, [next, idNum]);
  },

  async deleteDescuentoPedido(id) {
    const meta = await this._ensureDescuentosPedidoMeta();
    if (!meta?.table) throw new Error('Tabla descuentos_pedido no disponible');
    const idNum = Number(id);
    if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('ID no válido');
    const sql = `DELETE FROM \`${meta.table}\` WHERE \`${meta.pk}\` = ?`;
    return await this.query(sql, [idNum]);
  },

  async ensurePedidosIndexes() {
    if (this._pedidosIndexesEnsured) return;
    this._pedidosIndexesEnsured = true;

    try {
      if (!this.pool) return;
      const { tPedidos, pk, colComercial, colCliente, colFecha, colNumPedido } = await this._ensurePedidosMeta();
      const cols = await this._getColumns(tPedidos);
      const colsSet = new Set(cols);
      const hasCol = (c) => c && colsSet.has(c);

      const idxRows = await this.query(`SHOW INDEX FROM \`${tPedidos}\``).catch(() => []);
      const existing = new Set((idxRows || []).map(r => String(r.Key_name || r.key_name || '').trim()).filter(Boolean));

      const createIfMissing = async (name, colsToUse) => {
        if (!name || existing.has(name)) return;
        const cleanCols = (colsToUse || []).filter(hasCol);
        if (!cleanCols.length) return;
        const colsSql = cleanCols.map(c => `\`${c}\``).join(', ');
        await this.query(`CREATE INDEX \`${name}\` ON \`${tPedidos}\` (${colsSql})`);
        existing.add(name);
        console.log(`✅ [INDEX] Creado ${name} en ${tPedidos} (${colsSql})`);
      };

      await createIfMissing('idx_pedidos_cliente', [colCliente]);
      await createIfMissing('idx_pedidos_comercial', [colComercial]);
      await createIfMissing('idx_pedidos_fecha', [colFecha]);
      await createIfMissing('idx_pedidos_cliente_fecha', [colCliente, colFecha]);
      await createIfMissing('idx_pedidos_comercial_fecha', [colComercial, colFecha]);
      await createIfMissing('idx_pedidos_num_pedido', [colNumPedido]);

      if (hasCol(pk)) {
        await createIfMissing('idx_pedidos_pk', [pk]);
      }
    } catch (e) {
      console.warn('⚠️ [INDEX] No se pudieron asegurar índices en pedidos:', e?.message || e);
    }
  },

  async ensurePedidosArticulosIndexes() {
    if (this._pedidosArticulosIndexesEnsured) return;
    this._pedidosArticulosIndexesEnsured = true;

    try {
      if (!this.pool) return;
      const meta = await this._ensurePedidosArticulosMeta();
      const t = meta.table;
      const cols = await this._getColumns(t);
      const colsSet = new Set(cols);
      const hasCol = (c) => c && colsSet.has(c);

      const idxRows = await this.query(`SHOW INDEX FROM \`${t}\``).catch(() => []);
      const existing = new Set((idxRows || []).map(r => String(r.Key_name || r.key_name || '').trim()).filter(Boolean));

      const createIfMissing = async (name, colsToUse) => {
        if (!name || existing.has(name)) return;
        const cleanCols = (colsToUse || []).filter(hasCol);
        if (!cleanCols.length) return;
        const colsSql = cleanCols.map(c => `\`${c}\``).join(', ');
        await this.query(`CREATE INDEX \`${name}\` ON \`${t}\` (${colsSql})`);
        existing.add(name);
        console.log(`✅ [INDEX] Creado ${name} en ${t} (${colsSql})`);
      };

      await createIfMissing('idx_pedidos_articulos_num_pedido', [meta.colNumPedido]);
      await createIfMissing('idx_pedidos_articulos_pedido_id', [meta.colPedidoId]);
      await createIfMissing('idx_pedidos_articulos_id_num_pedido', [meta.colPedidoIdNum]);
      await createIfMissing('idx_pedidos_articulos_articulo', [meta.colArticulo]);
      await createIfMissing('idx_pedidos_articulos_num_articulo', [meta.colNumPedido, meta.colArticulo]);

      if (hasCol(meta.pk)) {
        await createIfMissing('idx_pedidos_articulos_pk', [meta.pk]);
      }
    } catch (e) {
      console.warn('⚠️ [INDEX] No se pudieron asegurar índices en pedidos_articulos:', e?.message || e);
    }
  },

  async getNextNumeroPedido() {
    try {
      const year = new Date().getFullYear().toString().slice(-2);
      const yearPrefix = `P${year}`;

      const sql = `
        SELECT
          ped_numero AS NumPedido,
          CAST(SUBSTRING(ped_numero, 4) AS UNSIGNED) as secuencia
        FROM pedidos
        WHERE ped_numero LIKE ?
        ORDER BY secuencia DESC
        LIMIT 1
      `;

      const rows = await this.query(sql, [`${yearPrefix}%`]);

      let maxSecuencia = 0;
      if (rows.length > 0 && rows[0].secuencia) {
        maxSecuencia = parseInt(rows[0].secuencia, 10) || 0;
      }

      const nextSecuencia = (maxSecuencia + 1).toString().padStart(4, '0');
      const nextNumero = `${yearPrefix}${nextSecuencia}`;

      console.log(`📝 [NUMERO PEDIDO] Año: ${year}, Máxima secuencia encontrada: ${maxSecuencia}, Siguiente: ${nextNumero}`);

      return nextNumero;
    } catch (error) {
      console.error('❌ Error obteniendo siguiente número de pedido:', error.message);
      const year = new Date().getFullYear().toString().slice(-2);
      return `P${year}0001`;
    }
  },

  async _enrichPedidoWithEstado(pedidoRow) {
    const p = pedidoRow && typeof pedidoRow === 'object' ? pedidoRow : null;
    if (!p) return pedidoRow;
    try {
      const meta = await this._ensurePedidosMeta().catch(() => null);
      const { pk, colComercial, colCliente, colFecha, colNumPedido, colEstado, colEstadoId } = meta || {};

      const alias = (col, legacy) => {
        if (col && p[col] !== undefined && (p[legacy] === undefined || p[legacy] === null)) p[legacy] = p[col];
      };
      if (pk) {
        alias(pk, 'Id');
        alias(pk, 'id');
      }
      alias(colCliente, 'Id_Cliente');
      alias(colComercial, 'Id_Cial');
      alias(colFecha, 'FechaPedido');
      alias(colFecha, 'Fecha');
      alias(colNumPedido, 'NumPedido');
      alias(colEstado, 'EstadoPedido');
      alias(colEstado, 'Estado');
      alias(colEstadoId, 'Id_EstadoPedido');
      const extraAliases = [
        ['ped_direnv_id', 'Id_DireccionEnvio'],
        ['ped_formp_id', 'Id_FormaPago'],
        ['ped_tipp_id', 'Id_TipoPedido'],
        ['ped_tarcli_id', 'Id_Tarifa'],
        ['ped_total', 'TotalPedido'],
        ['ped_base', 'BaseImponible'],
        ['ped_iva', 'TotalIva'],
        ['ped_dto', 'Dto'],
        ['ped_descuento', 'Descuento'],
        ['ped_observaciones', 'Observaciones'],
        ['ped_num_asoc_hefame', 'NumAsociadoHefame'],
        ['ped_es_especial', 'EsEspecial'],
        ['ped_especial_estado', 'EspecialEstado'],
        ['ped_num_pedido_cliente', 'NumPedidoCliente'],
        ['ped_fecha_entrega', 'FechaEntrega']
      ];
      for (const [col, legacy] of extraAliases) {
        if (p[col] !== undefined && (p[legacy] === undefined || p[legacy] === null)) p[legacy] = p[col];
      }

      const colEstadoIdMeta = colEstadoId || meta?.colEstadoId;
      const colEstadoTxt = colEstado || meta?.colEstado;
      if (!colEstadoIdMeta && !colEstadoTxt) return p;

      const rawId = colEstadoIdMeta ? p[colEstadoIdMeta] : (p.Id_EstadoPedido ?? p.id_estado_pedido ?? null);
      let estadoId = Number.parseInt(String(rawId ?? '').trim(), 10);
      if (!Number.isFinite(estadoId) || estadoId <= 0) estadoId = null;

      if (!estadoId && colEstadoTxt) {
        const txt = String(p[colEstadoTxt] ?? p.EstadoPedido ?? p.Estado ?? '').trim().toLowerCase();
        if (txt) estadoId = await this.getEstadoPedidoIdByCodigo(txt).catch(() => null);
      }

      if (!estadoId) return p;
      const estado = await this.getEstadoPedidoById(estadoId).catch(() => null);
      if (!estado) return p;

      const eMeta = await this._ensureEstadosPedidoMeta().catch(() => null);
      const nombre = eMeta?.colNombre ? estado[eMeta.colNombre] : (estado.nombre ?? null);
      const color = eMeta?.colColor ? estado[eMeta.colColor] : (estado.color ?? null);

      if (nombre) p.EstadoPedido = String(nombre);
      if (color) p.EstadoColor = String(color);
      p.Id_EstadoPedido = estadoId;
      return p;
    } catch (_) {
      return pedidoRow;
    }
  },

  async ensurePedidosSchema() {
    if (this._pedidosSchemaEnsured) return;
    this._pedidosSchemaEnsured = true;
    try {
      if (!this.connected || !this.pool) await this.connect();
      const { tPedidos } = await this._ensurePedidosMeta();
      const cols = await this._getColumns(tPedidos).catch(() => []);
      const colsLower = new Set((cols || []).map((c) => String(c).toLowerCase()));

      if (!colsLower.has('numpedidocliente') && !colsLower.has('num_pedido_cliente')) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`NumPedidoCliente\` VARCHAR(255) NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.NumPedidoCliente");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.NumPedidoCliente:', e.message);
        }
      }

      const hasDto =
        colsLower.has('dto') ||
        colsLower.has('descuento') ||
        colsLower.has('descuentopedido') ||
        colsLower.has('porcentajedescuento') ||
        colsLower.has('porcentaje_descuento');
      if (!hasDto) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`Dto\` DECIMAL(5,2) NULL DEFAULT 0`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.Dto");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.Dto:', e.message);
        }
      }

      const hasNumAsociadoHefame =
        colsLower.has('numasociadohefame') ||
        colsLower.has('num_asociado_hefame') ||
        colsLower.has('numasociado_hefame');
      if (!hasNumAsociadoHefame) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`NumAsociadoHefame\` VARCHAR(50) NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.NumAsociadoHefame");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.NumAsociadoHefame:', e.message);
        }
      }

      const hasEsEspecial =
        colsLower.has('esespecial') ||
        colsLower.has('es_especial') ||
        colsLower.has('pedidoespecial') ||
        colsLower.has('pedido_especial');
      if (!hasEsEspecial) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`EsEspecial\` TINYINT(1) NOT NULL DEFAULT 0`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.EsEspecial");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.EsEspecial:', e.message);
        }
      }

      const hasEspecialEstado =
        colsLower.has('especialestado') ||
        colsLower.has('especial_estado') ||
        colsLower.has('estadoespecial') ||
        colsLower.has('estado_especial');
      if (!hasEspecialEstado) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`EspecialEstado\` VARCHAR(16) NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.EspecialEstado");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.EspecialEstado:', e.message);
        }
      }

      const hasEspecialNotas =
        colsLower.has('especialnotas') ||
        colsLower.has('especial_notas') ||
        colsLower.has('notasespecial') ||
        colsLower.has('notas_especial');
      if (!hasEspecialNotas) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`EspecialNotas\` VARCHAR(500) NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.EspecialNotas");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.EspecialNotas:', e.message);
        }
      }

      const hasEspecialFechaSolicitud =
        colsLower.has('especialfechasolicitud') ||
        colsLower.has('especial_fecha_solicitud') ||
        colsLower.has('fechasolicitudespecial') ||
        colsLower.has('fecha_solicitud_especial');
      if (!hasEspecialFechaSolicitud) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`EspecialFechaSolicitud\` DATETIME NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.EspecialFechaSolicitud");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.EspecialFechaSolicitud:', e.message);
        }
      }

      const hasEspecialFechaResolucion =
        colsLower.has('especialfecharesolucion') ||
        colsLower.has('especial_fecha_resolucion') ||
        colsLower.has('fecharesolucionespecial') ||
        colsLower.has('fecha_resolucion_especial');
      if (!hasEspecialFechaResolucion) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`EspecialFechaResolucion\` DATETIME NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.EspecialFechaResolucion");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.EspecialFechaResolucion:', e.message);
        }
      }

      const hasEspecialIdAdmin =
        colsLower.has('especialidadadminresolvio') ||
        colsLower.has('especial_id_admin_resolvio') ||
        colsLower.has('idadminresolviospecial') ||
        colsLower.has('id_admin_resolvio_especial');
      if (!hasEspecialIdAdmin) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`EspecialIdAdminResolvio\` INT NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.EspecialIdAdminResolvio");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.EspecialIdAdminResolvio:', e.message);
        }
      }

      const hasEstadoId =
        colsLower.has('id_estadopedido') ||
        colsLower.has('id_estado_pedido') ||
        colsLower.has('estadopedidoid') ||
        colsLower.has('estado_pedido_id');
      if (!hasEstadoId) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`Id_EstadoPedido\` INT NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.Id_EstadoPedido");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.Id_EstadoPedido:', e.message);
        }
      }
      try {
        const idxRows = await this.query(`SHOW INDEX FROM \`${tPedidos}\``).catch(() => []);
        const existing = new Set((idxRows || []).map((r) => String(r.Key_name || r.key_name || '').trim()).filter(Boolean));
        if (!existing.has('idx_pedidos_estado_pedido')) {
          await this.query(`CREATE INDEX \`idx_pedidos_estado_pedido\` ON \`${tPedidos}\` (\`Id_EstadoPedido\`)`);
        }
      } catch (_) {}

      try {
        await this.ensureEstadosPedidoTable();
        const fkName = 'fk_pedidos_estado_pedido';
        try {
          await this.query(
            `ALTER TABLE \`${tPedidos}\` ADD CONSTRAINT \`${fkName}\` FOREIGN KEY (\`Id_EstadoPedido\`) REFERENCES \`estados_pedido\`(\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT`
          );
          console.log(`✅ [FK] Creada ${fkName}`);
        } catch (e) {
          const msg = String(e?.message || e);
          if (!msg.toLowerCase().includes('duplicate') && !msg.toLowerCase().includes('already') && !msg.toLowerCase().includes('exists')) {}
        }
      } catch (_) {}
    } catch (e) {
      console.warn('⚠️ [SCHEMA] No se pudo asegurar esquema de pedidos:', e?.message || e);
    }
  },

  async getPreciosArticulosParaTarifa(tarifaId, articuloIds) {
    const tId = Number.parseInt(String(tarifaId ?? '').trim(), 10);
    const ids = (Array.isArray(articuloIds) ? articuloIds : [])
      .map((x) => Number.parseInt(String(x ?? '').trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 200);
    if (!Number.isFinite(tId) || tId < 0 || ids.length === 0) return {};

    if (!this.connected && !this.pool) await this.connect();

    let effectiveTarifaId = tId;
    if (tId > 0) {
      try {
        const tTar = await this._resolveTableNameCaseInsensitive('tarifasClientes');
        const tarCols = await this._getColumns(tTar).catch(() => []);
        const pickTar = (cands) => this._pickCIFromColumns(tarCols, cands);
        const tarPk = pickTar(['Id', 'id']) || 'Id';
        const colActiva = pickTar(['Activa', 'activa']);
        const colInicio = pickTar(['FechaInicio', 'fecha_inicio', 'Fecha_Inicio', 'inicio']);
        const colFin = pickTar(['FechaFin', 'fecha_fin', 'Fecha_Fin', 'fin']);

        const [tRows] = await this.pool.query(`SELECT * FROM \`${tTar}\` WHERE \`${tarPk}\` = ? LIMIT 1`, [tId]);
        const row = (tRows && tRows[0]) ? tRows[0] : null;
        if (row) {
          const activaRaw = colActiva ? row[colActiva] : 1;
          const activa =
            activaRaw === 1 || activaRaw === '1' || activaRaw === true ||
            (typeof activaRaw === 'string' && ['ok', 'si', 'sí', 'true'].includes(activaRaw.trim().toLowerCase()));

          const now = new Date();
          const start = colInicio && row[colInicio] ? new Date(row[colInicio]) : null;
          const end = colFin && row[colFin] ? new Date(row[colFin]) : null;
          const inRange = (!start || now >= start) && (!end || now <= end);
          if (!(activa && inRange)) effectiveTarifaId = 0;
        }
      } catch (_) {
        effectiveTarifaId = tId;
      }
    }

    let preciosTarifa = new Map();
    let preciosPVL = new Map();
    try {
      const tTP = await this._resolveTableNameCaseInsensitive('tarifasClientes_precios');
      const tpCols = await this._getColumns(tTP).catch(() => []);
      const pickTP = (cands) => this._pickCIFromColumns(tpCols, cands);
      const cTar = pickTP(['Id_Tarifa', 'id_tarifa', 'TarifaId', 'tarifa_id']) || 'Id_Tarifa';
      const cArt = pickTP(['Id_Articulo', 'id_articulo', 'ArticuloId', 'articulo_id']) || 'Id_Articulo';
      const cPrecio = pickTP(['Precio', 'precio', 'PrecioUnitario', 'precio_unitario', 'PVL', 'pvl']) || 'Precio';

      const inPlaceholders = ids.map(() => '?').join(', ');
      const sql = `
        SELECT \`${cTar}\` AS Id_Tarifa, \`${cArt}\` AS Id_Articulo, \`${cPrecio}\` AS Precio
        FROM \`${tTP}\`
        WHERE \`${cTar}\` IN (?, 0) AND \`${cArt}\` IN (${inPlaceholders})
      `;
      const rows = await this.query(sql, [effectiveTarifaId, ...ids]).catch(() => []);
      for (const r of (rows || [])) {
        const aid = Number.parseInt(String(r.Id_Articulo ?? '').trim(), 10);
        const tid = Number.parseInt(String(r.Id_Tarifa ?? '').trim(), 10);
        const precio = Number(String(r.Precio ?? '').replace(',', '.'));
        if (!Number.isFinite(aid) || aid <= 0 || !Number.isFinite(precio)) continue;
        if (tid === effectiveTarifaId) preciosTarifa.set(aid, precio);
        if (tid === 0) preciosPVL.set(aid, precio);
      }
    } catch (_) {}

    let articulosPVL = new Map();
    try {
      const tArt = await this._resolveTableNameCaseInsensitive('articulos');
      const aCols = await this._getColumns(tArt).catch(() => []);
      const pickA = (cands) => this._pickCIFromColumns(aCols, cands);
      const aPk = pickA(['id', 'Id']) || 'id';
      const cPVL = pickA(['PVL', 'pvl', 'Precio', 'precio']) || 'PVL';
      const inPlaceholders = ids.map(() => '?').join(', ');
      const rows = await this.query(
        `SELECT \`${aPk}\` AS Id, \`${cPVL}\` AS PVL FROM \`${tArt}\` WHERE \`${aPk}\` IN (${inPlaceholders})`,
        ids
      ).catch(() => []);
      for (const r of (rows || [])) {
        const aid = Number.parseInt(String(r.Id ?? '').trim(), 10);
        const pvl = Number(String(r.PVL ?? '').replace(',', '.'));
        if (!Number.isFinite(aid) || aid <= 0) continue;
        if (Number.isFinite(pvl)) articulosPVL.set(aid, pvl);
      }
    } catch (_) {}

    const out = {};
    for (const aid of ids) {
      const precio =
        preciosTarifa.has(aid) ? preciosTarifa.get(aid)
        : preciosPVL.has(aid) ? preciosPVL.get(aid)
        : articulosPVL.has(aid) ? articulosPVL.get(aid)
        : undefined;
      if (precio !== undefined) out[String(aid)] = precio;
    }
    return out;
  },

  async deletePedidoLinea(id) {
    try {
      const idNum = Number(id);
      if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('ID no válido');

      const meta = await this._ensurePedidosArticulosMeta();
      const sql = `DELETE FROM \`${meta.table}\` WHERE \`${meta.pk}\` = ?`;
      const result = await this.query(sql, [idNum]);
      return { affectedRows: result?.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error eliminando línea de pedido:', error.message);
      throw error;
    }
  },

  async deletePedido(id) {
    try {
      const idNum = Number(id);
      if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('ID no válido');

      if (!this.connected && !this.pool) await this.connect();

      const pedido = await this.getPedidoById(idNum);
      if (!pedido) return { affectedRows: 0, deletedLineas: 0 };

      const pedidosMeta = await this._ensurePedidosMeta();
      const paMeta = await this._ensurePedidosArticulosMeta();

      const colNumPedidoPedido = pedidosMeta.colNumPedido;
      const numPedido = colNumPedidoPedido ? (pedido[colNumPedidoPedido] ?? pedido.NumPedido ?? pedido.Numero_Pedido ?? null) : null;

      const numPedidoStr = numPedido !== null && numPedido !== undefined ? String(numPedido).trim() : null;

      const conn = await this.pool.getConnection();
      try {
        try { await conn.query("SET time_zone = 'Europe/Madrid'"); } catch (_) {}
        await conn.beginTransaction();

        let deletedLineas = 0;
        const delExec = async (sql, params) => {
          const [r] = await conn.execute(sql, params);
          deletedLineas += r?.affectedRows || 0;
        };

        if (paMeta.colPedidoId) {
          await delExec(`DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colPedidoId}\` = ?`, [idNum]);

          if (paMeta.colPedidoIdNum) {
            await delExec(
              `DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colPedidoIdNum}\` = ? AND (\`${paMeta.colPedidoId}\` IS NULL OR \`${paMeta.colPedidoId}\` = 0)`,
              [idNum]
            );
          }
          if (paMeta.colNumPedido && numPedidoStr) {
            const extra = paMeta.colPedidoIdNum
              ? ` AND (\`${paMeta.colPedidoIdNum}\` IS NULL OR \`${paMeta.colPedidoIdNum}\` = 0)`
              : '';
            await delExec(
              `DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colNumPedido}\` = ? AND (\`${paMeta.colPedidoId}\` IS NULL OR \`${paMeta.colPedidoId}\` = 0)${extra}`,
              [numPedidoStr]
            );
          }
        } else if (paMeta.colPedidoIdNum) {
          await delExec(`DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colPedidoIdNum}\` = ?`, [idNum]);
          if (paMeta.colNumPedido && numPedidoStr) {
            await delExec(
              `DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colNumPedido}\` = ? AND (\`${paMeta.colPedidoIdNum}\` IS NULL OR \`${paMeta.colPedidoIdNum}\` = 0)`,
              [numPedidoStr]
            );
          }
        } else if (paMeta.colNumPedido && numPedidoStr) {
          await delExec(`DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colNumPedido}\` = ?`, [numPedidoStr]);
        }

        const [delPedidoRes] = await conn.execute(
          `DELETE FROM \`${pedidosMeta.tPedidos}\` WHERE \`${pedidosMeta.pk}\` = ?`,
          [idNum]
        );
        await conn.commit();
        return { affectedRows: delPedidoRes?.affectedRows || 0, deletedLineas };
      } catch (e) {
        try { await conn.rollback(); } catch (_) {}
        throw e;
      } finally {
        conn.release();
      }
    } catch (error) {
      console.error('❌ Error eliminando pedido:', error.message);
      throw error;
    }
  },

  async updatePedidoLinea(id, payload) {
    try {
      const idNum = Number(id);
      if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('ID no válido');
      if (!payload || typeof payload !== 'object') throw new Error('Payload no válido');

      if (!this.connected && !this.pool) await this.connect();

      const meta = await this._ensurePedidosArticulosMeta();
      const cols = await this._getColumns(meta.table).catch(() => []);
      const colsLower = new Map((cols || []).map((c) => [String(c).toLowerCase(), c]));

      const filtered = {};
      for (const [k, v] of Object.entries(payload)) {
        const real = colsLower.get(String(k).toLowerCase());
        if (real && String(real).toLowerCase() !== String(meta.pk).toLowerCase()) filtered[real] = v;
      }
      const keys = Object.keys(filtered);
      if (!keys.length) return { affectedRows: 0 };

      const fields = keys.map((k) => `\`${k}\` = ?`).join(', ');
      const values = keys.map((k) => filtered[k]);
      values.push(idNum);

      const sql = `UPDATE \`${meta.table}\` SET ${fields} WHERE \`${meta.pk}\` = ?`;
      const [result] = await this.pool.execute(sql, values);
      return { affectedRows: result?.affectedRows || 0, changedRows: result?.changedRows || 0 };
    } catch (error) {
      console.error('❌ Error actualizando línea de pedido:', error.message);
      throw error;
    }
  },

  async togglePedidoActivo(id, value) {
    try {
      const sql = 'UPDATE pedidos SET Activo = ? WHERE Id = ?';
      await this.query(sql, [value ? 1 : 0, id]);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando estado de pedido:', error.message);
      throw error;
    }
  },

  async createPedidoLinea(payload) {
    try {
      if (!this.connected && !this.pool) await this.connect();

      const meta = await this._ensurePedidosArticulosMeta();
      const cols = await this._getColumns(meta.table).catch(() => []);
      const colsLower = new Map((cols || []).map((c) => [String(c).toLowerCase(), c]));

      const mysqlData = {};
      const input = payload && typeof payload === 'object' ? payload : {};
      for (const [key, value] of Object.entries(input)) {
        const real = colsLower.get(String(key).toLowerCase());
        if (!real) continue;
        if (String(real).toLowerCase() === String(meta.pk).toLowerCase()) continue;
        if (Array.isArray(value) && value.length > 0 && value[0]?.Id) {
          mysqlData[real] = value[0].Id;
        } else if (value === null || value === undefined) {
          mysqlData[real] = null;
        } else {
          mysqlData[real] = value;
        }
      }

      if (Object.keys(mysqlData).length === 0) {
        throw new Error('No hay campos válidos para crear la línea de pedido');
      }

      const fields = Object.keys(mysqlData).map((k) => `\`${k}\``).join(', ');
      const placeholders = Object.keys(mysqlData).map(() => '?').join(', ');
      const values = Object.values(mysqlData);

      const sql = `INSERT INTO \`${meta.table}\` (${fields}) VALUES (${placeholders})`;
      const [result] = await this.pool.execute(sql, values);
      const insertId = result.insertId;

      if (!insertId) {
        console.error('❌ No se pudo obtener insertId del resultado:', result);
        throw new Error('No se pudo obtener el ID de la línea de pedido creada');
      }

      console.log(`✅ Línea de pedido creada con ID: ${insertId}`);
      return { Id: insertId, id: insertId, insertId: insertId };
    } catch (error) {
      console.error('❌ Error creando línea de pedido:', error.message);
      console.error('❌ Datos que fallaron:', JSON.stringify(payload, null, 2));
      throw error;
    }
  }
};

module.exports = Object.assign({}, base, pedidosCrud);
