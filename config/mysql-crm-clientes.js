/**
 * Módulo clientes para MySQLCRM.
 * Métodos extraídos de mysql-crm.js para mezclar en MySQLCRM.prototype vía Object.assign.
 * Requiere: this.query, this.pool, this._getColumns, this._resolveTableNameCaseInsensitive,
 * this._pickCIFromColumns, this.connect, this._ensureNotificacionesTable,
 * this.getClienteById, this.getCooperativaById, this.createCooperativa.
 */
'use strict';

const { debug } = require('../lib/logger');

module.exports = {
  async _ensureClientesMeta() {
    if (this._metaCache?.clientesMeta) return this._metaCache.clientesMeta;

    const tClientes = await this._resolveTableNameCaseInsensitive('clientes');
    const cols = await this._getColumns(tClientes).catch(() => []);

    const colsLower = new Set(cols.map(c => c.toLowerCase()));
    const pickCI = (cands) => {
      for (const cand of (cands || [])) {
        const cl = String(cand).toLowerCase();
        if (colsLower.has(cl)) {
          const idx = cols.findIndex(c => c.toLowerCase() === cl);
          return idx >= 0 ? cols[idx] : cand;
        }
      }
      return null;
    };

    const pk = pickCI(['cli_id', 'Id', 'id']) || 'cli_id';
    const colComercial = pickCI([
      'cli_com_id',
      'Id_Cial',
      'id_cial',
      'Id_Comercial',
      'id_comercial',
      'ComercialId',
      'comercialId',
      'comercial_id'
    ]);
    const colProvincia = pickCI(['cli_prov_id', 'Id_Provincia', 'id_provincia']);
    const colTipoCliente = pickCI(['cli_tipc_id', 'Id_TipoCliente', 'id_tipo_cliente']);
    const colNombreRazonSocial = pickCI(['cli_nombre_razon_social', 'Nombre_Razon_Social', 'nombre_razon_social']);
    const colEstadoCliente = pickCI([
      'cli_estcli_id',
      'Id_EstdoCliente',
      'id_estdo_cliente',
      'Id_EstadoCliente',
      'id_estado_cliente',
      'EstadoClienteId',
      'estadoClienteId'
    ]);
    const colTipoContacto = pickCI(['cli_tipo_contacto', 'TipoContacto', 'tipo_contacto', 'Tipo_Contacto']);
    const colObservaciones = pickCI(['Observaciones', 'observaciones', 'Notas', 'notas', 'Comentarios', 'comentarios']);

    const meta = { tClientes, pk, colComercial, colProvincia, colTipoCliente, colNombreRazonSocial, colEstadoCliente, colTipoContacto, colObservaciones, cols };
    this._metaCache.clientesMeta = meta;
    return meta;
  },

  _normalizeDniCif(value) {
    return String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/-/g, '');
  },

  _isValidDniCif(value) {
    const v = this._normalizeDniCif(value);
    if (!v) return false;
    if (['PENDIENTE', 'NULL', 'N/A', 'NA'].includes(v)) return false;
    if (v.startsWith('SIN_DNI')) return false;

    const dni = /^[0-9]{8}[A-Z]$/;
    const nie = /^[XYZ][0-9]{7}[A-Z]$/;
    const cif = /^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/;
    return dni.test(v) || nie.test(v) || cif.test(v);
  },

  _getTipoContactoFromDniCif(value) {
    const v = this._normalizeDniCif(value);
    if (!v || ['PENDIENTE', 'NULL', 'N/A', 'NA'].includes(v) || v.startsWith('SIN_DNI')) return 'Otros';
    const dni = /^[0-9]{8}[A-Z]$/;
    const nie = /^[XYZ][0-9]{7}[A-Z]$/;
    const cif = /^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/;
    if (cif.test(v)) return 'Empresa';
    if (dni.test(v) || nie.test(v)) return 'Persona';
    return 'Otros';
  },

  async _getEstadoClienteIds() {
    if (this._metaCache?.estadoClienteIds) return this._metaCache.estadoClienteIds;
    const tEstados = await this._resolveTableNameCaseInsensitive('estdoClientes');
    const rows = await this.query(`SELECT id, Nombre FROM \`${tEstados}\``).catch(() => []);
    const map = new Map((rows || []).map(r => [String(r.Nombre || '').toLowerCase(), Number(r.id)]));
    const ids = {
      potencial: map.get('potencial') || 1,
      activo: map.get('activo') || 2,
      inactivo: map.get('inactivo') || 3
    };
    this._metaCache.estadoClienteIds = ids;
    return ids;
  },

  async ensureClientesIndexes() {
    if (this._clientesIndexesEnsured) return;
    this._clientesIndexesEnsured = true;

    try {
      if (!this.pool) return;
      const { tClientes, pk, colComercial, colEstadoCliente } = await this._ensureClientesMeta();
      const cols = await this._getColumns(tClientes);
      const colsSet = new Set(cols);
      const hasCol = (c) => c && colsSet.has(c);

      const idxRows = await this.query(`SHOW INDEX FROM \`${tClientes}\``).catch(() => []);
      const existing = new Set((idxRows || []).map(r => String(r.Key_name || r.key_name || '').trim()).filter(Boolean));

      const createIfMissing = async (name, colsToUse, kind = 'INDEX') => {
        if (!name || existing.has(name)) return;
        const cleanCols = (colsToUse || []).filter(hasCol);
        if (!cleanCols.length) return;
        const colsSql = cleanCols.map(c => `\`${c}\``).join(', ');
        const stmt =
          kind === 'FULLTEXT'
            ? `CREATE FULLTEXT INDEX \`${name}\` ON \`${tClientes}\` (${colsSql})`
            : `CREATE INDEX \`${name}\` ON \`${tClientes}\` (${colsSql})`;
        await this.query(stmt);
        existing.add(name);
        debug('✅ [INDEX] Creado', name, 'en', tClientes);
      };

      await createIfMissing('idx_clientes_provincia', ['cli_prov_id', 'Id_Provincia']);
      await createIfMissing('idx_clientes_tipocliente', ['cli_tipc_id', 'Id_TipoCliente']);
      await createIfMissing('idx_clientes_comercial', [colComercial]);
      await createIfMissing('idx_clientes_estado_cliente', [colEstadoCliente]);
      await createIfMissing('idx_clientes_cp', ['cli_codigo_postal', 'CodigoPostal']);
      await createIfMissing('idx_clientes_poblacion', ['cli_poblacion', 'Poblacion']);
      await createIfMissing('idx_clientes_nombre', ['cli_nombre_razon_social', 'Nombre_Razon_Social']);

      await createIfMissing(
        'ft_clientes_busqueda',
        ['cli_nombre_razon_social', 'cli_nombre_cial', 'cli_dni_cif', 'cli_email', 'cli_telefono', 'cli_movil', 'cli_poblacion', 'cli_codigo_postal', 'Nombre_Razon_Social', 'Nombre_Cial', 'DNI_CIF', 'Email', 'Telefono', 'Movil', 'Poblacion', 'CodigoPostal', 'NomContacto', 'Observaciones'].filter(hasCol),
        'FULLTEXT'
      );
      await createIfMissing('ft_clientes_busqueda_basica', ['cli_nombre_razon_social', 'cli_nombre_cial', 'cli_dni_cif', 'Nombre_Razon_Social', 'Nombre_Cial', 'DNI_CIF'].filter(hasCol), 'FULLTEXT');

      if (hasCol(pk)) {
        await createIfMissing('idx_clientes_pk', [pk]);
      }
    } catch (e) {
      console.warn('⚠️ [INDEX] No se pudieron asegurar índices en clientes:', e?.message || e);
    }
  },

  async _getClientesNombresByIds(ids) {
    const map = {};
    if (!ids || ids.length === 0) return map;
    const uniq = [...new Set(ids.filter((id) => id != null && id !== ''))];
    if (uniq.length === 0) return map;
    try {
      const meta = await this._ensureClientesMeta();
      const placeholders = uniq.map(() => '?').join(',');
      const colNombre = meta.colNombreRazonSocial || 'cli_nombre_razon_social';
      const sql = `SELECT \`${meta.pk}\` AS id, \`${colNombre}\` AS nombre FROM \`${meta.tClientes}\` WHERE \`${meta.pk}\` IN (${placeholders})`;
      const rows = await this.query(sql, uniq);
      const list = Array.isArray(rows) ? rows : [];
      list.forEach((r) => {
        const id = r.id ?? r.Id ?? r.id_contacto;
        const nombre = r.nombre ?? r.Nombre_Razon_Social ?? r.Nombre ?? '';
        if (id != null) map[Number(id)] = nombre;
      });
    } catch (e) {
      console.warn('⚠️ [NOTIF] No se pudieron cargar nombres de contactos:', e?.message);
    }
    return map;
  },

  async ensureNotificacionPedidoEspecial(pedidoId, clienteId, idComercialSolicitante, notas = null) {
    await this._ensureNotificacionesTable();
    const pid = Number.parseInt(String(pedidoId ?? '').trim(), 10);
    const cid = Number.parseInt(String(clienteId ?? '').trim(), 10);
    const sid = Number.parseInt(String(idComercialSolicitante ?? '').trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    if (!Number.isFinite(cid) || cid <= 0) return null;
    if (!Number.isFinite(sid) || sid <= 0) return null;
    try {
      const existing = await this.query(
        'SELECT id FROM `notificaciones` WHERE tipo = ? AND estado = ? AND id_pedido = ? LIMIT 1',
        ['pedido_especial', 'pendiente', pid]
      );
      if (Array.isArray(existing) && existing.length) return existing[0]?.id ?? null;
    } catch (_) {}
    try {
      const r = await this.query(
        'INSERT INTO `notificaciones` (tipo, id_contacto, id_pedido, id_comercial_solicitante, estado, notas) VALUES (?, ?, ?, ?, ?, ?)',
        ['pedido_especial', cid, pid, sid, 'pendiente', notas ? String(notas).slice(0, 500) : null]
      );
      return r?.insertId ?? r?.affectedRows ?? null;
    } catch (_e) {
      const safeNotes = (notas ? String(notas) : '').trim();
      const fallbackNotes = `${safeNotes ? (safeNotes + ' · ') : ''}pedidoId=${pid}`.slice(0, 500);
      const r = await this.query(
        'INSERT INTO `notificaciones` (tipo, id_contacto, id_comercial_solicitante, estado, notas) VALUES (?, ?, ?, ?, ?)',
        ['pedido_especial', cid, sid, 'pendiente', fallbackNotes]
      );
      return r?.insertId ?? r?.affectedRows ?? null;
    }
  },

  async checkNumeroAsociadoDuplicado(cooperativaId, numeroAsociado, excludeId = null) {
    try {
      if (!numeroAsociado || numeroAsociado.trim() === '') return false;

      let sql = 'SELECT id FROM `Clientes_Cooperativas` WHERE Id_Cooperativa = ? AND NumAsociado = ?';
      let params = [cooperativaId, numeroAsociado.trim()];

      if (excludeId) {
        sql += ' AND id != ?';
        params.push(excludeId);
      }
      sql += ' LIMIT 1';

      let rows;
      try {
        rows = await this.query(sql, params);
      } catch (error1) {
        sql = 'SELECT id FROM clientes_cooperativas WHERE Id_Cooperativa = ? AND NumAsociado = ?';
        params = [cooperativaId, numeroAsociado.trim()];
        if (excludeId) {
          sql += ' AND id != ?';
          params.push(excludeId);
        }
        sql += ' LIMIT 1';
        rows = await this.query(sql, params);
      }

      return rows.length > 0;
    } catch (error) {
      console.error('❌ Error verificando número de asociado duplicado:', error.message);
      return false;
    }
  },

  async getClientesCooperativa() {
    try {
      const tRel = await this._resolveTableNameCaseInsensitive('clientes_cooperativas');
      const tClientes = await this._resolveTableNameCaseInsensitive('clientes');
      const tCooperativas = await this._resolveTableNameCaseInsensitive('cooperativas');

      const sql = `
        SELECT 
          cc.id,
          cc.Id_Cliente,
          cc.Id_Cooperativa,
          cc.NumAsociado,
          COALESCE(c.cli_nombre_razon_social, c.Nombre_Razon_Social) as ClienteNombre,
          co.Nombre as CooperativaNombre
        FROM \`${tRel}\` cc
        LEFT JOIN \`${tClientes}\` c ON cc.Id_Cliente = c.id
        LEFT JOIN \`${tCooperativas}\` co ON cc.Id_Cooperativa = co.id
        ORDER BY cc.id DESC
      `;
      const rows = await this.query(sql);
      return rows || [];
    } catch (error) {
      console.error('❌ Error obteniendo clientes_cooperativas:', error.message);
      return [];
    }
  },

  async getClienteCooperativaById(id) {
    try {
      let sqlSimple = 'SELECT id, Id_Cliente, Id_Cooperativa, NumAsociado FROM `Clientes_Cooperativas` WHERE id = ? LIMIT 1';
      let rowSimple;

      try {
        const rowsSimple = await this.query(sqlSimple, [id]);
        if (rowsSimple.length > 0) {
          rowSimple = rowsSimple[0];
        }
      } catch (error1) {
        try {
          sqlSimple = 'SELECT id, Id_Cliente, Id_Cooperativa, NumAsociado FROM clientes_cooperativas WHERE id = ? LIMIT 1';
          const rowsSimple2 = await this.query(sqlSimple, [id]);
          if (rowsSimple2.length > 0) {
            rowSimple = rowsSimple2[0];
          }
        } catch (error2) {}
      }

      if (!rowSimple) return null;

      let sql = `
        SELECT 
          cc.*,
          c.cli_nombre_razon_social as ClienteNombre,
          co.Nombre as CooperativaNombre
        FROM \`Clientes_Cooperativas\` cc
        LEFT JOIN clientes c ON cc.Id_Cliente = c.id
        LEFT JOIN cooperativas co ON cc.Id_Cooperativa = co.id
        WHERE cc.id = ? LIMIT 1
      `;
      let rows;

      try {
        rows = await this.query(sql, [id]);
        if (rows.length > 0) return rows[0];
      } catch (error3) {}

      sql = `
        SELECT 
          cc.*,
          c.cli_nombre_razon_social as ClienteNombre,
          co.Nombre as CooperativaNombre
        FROM clientes_cooperativas cc
        LEFT JOIN clientes c ON cc.Id_Cliente = c.id
        LEFT JOIN cooperativas co ON cc.Id_Cooperativa = co.id
        WHERE cc.id = ? LIMIT 1
      `;
      try {
        rows = await this.query(sql, [id]);
        if (rows.length > 0) return rows[0];
      } catch (error4) {}

      return {
        ...rowSimple,
        ClienteNombre: null,
        CooperativaNombre: null
      };
    } catch (error) {
      console.error('❌ Error obteniendo cliente_cooperativa por ID:', error.message);
      return null;
    }
  },

  /** Cooperativas del cliente con NumAsociado. Join: clientes_cooperativas.Id_Cooperativa = cooperativas.id (o coop_id).
   * Soporta BD legacy (id, Nombre) y normalizada (coop_id, coop_nombre). */
  async getCooperativasByClienteId(clienteId) {
    try {
      const variants = [
        { joinOn: 'cc.Id_Cooperativa = c.id', colNombre: 'c.Nombre' },
        { joinOn: 'cc.Id_Cooperativa = c.coop_id', colNombre: 'c.coop_nombre' }
      ];
      for (const tRel of ['Clientes_Cooperativas', 'clientes_cooperativas']) {
        for (const v of variants) {
          try {
            const sql = `
              SELECT cc.Id_Cooperativa, ${v.colNombre} AS Nombre, cc.NumAsociado
              FROM \`${tRel}\` cc
              INNER JOIN cooperativas c ON ${v.joinOn}
              WHERE cc.Id_Cliente = ?
              ORDER BY ${v.colNombre} ASC
            `;
            const rows = await this.query(sql, [clienteId]);
            if (rows && rows.length >= 0) return rows;
          } catch (_) {}
        }
      }
      return [];
    } catch (error) {
      console.error('❌ Error obteniendo cooperativas del cliente:', error.message);
      return [];
    }
  },

  /** Obtiene NumAsociado de clientes_cooperativas por Id_Cliente e Id_Cooperativa.
   * Tablas: cooperativas (id/coop_id, Nombre), clientes_cooperativas (Id_Cliente, Id_Cooperativa, NumAsociado) */
  async getNumAsociadoByClienteAndCooperativaId(clienteId, cooperativaId) {
    if (!clienteId || !cooperativaId) return null;
    try {
      for (const tRel of ['Clientes_Cooperativas', 'clientes_cooperativas']) {
        try {
          const sql = `SELECT NumAsociado, numAsociado FROM \`${tRel}\` WHERE Id_Cliente = ? AND Id_Cooperativa = ? LIMIT 1`;
          const rows = await this.query(sql, [clienteId, cooperativaId]);
          const r = rows?.[0];
          const val = r?.NumAsociado ?? r?.numAsociado;
          if (val != null && String(val).trim() !== '') return String(val).trim();
        } catch (_) {}
      }
      return null;
    } catch (error) {
      console.error('❌ Error obteniendo NumAsociado por cliente y cooperativa:', error.message);
      return null;
    }
  },

  async getClientesGruposCompras() {
    try {
      const tRel = await this._resolveTableNameCaseInsensitive('clientes_gruposCompras');
      const tGr = await this._resolveTableNameCaseInsensitive('gruposCompras');
      const tClientes = await this._resolveTableNameCaseInsensitive('clientes');
      const sql = `
        SELECT
          cg.id,
          cg.Id_Cliente,
          cg.Id_GrupoCompras,
          cg.NumSocio,
          cg.Observaciones,
          cg.Activa,
          cg.Fecha_Alta,
          cg.Fecha_Baja,
          c.cli_nombre_razon_social as ClienteNombre,
          g.Nombre as GrupoNombre
        FROM \`${tRel}\` cg
        LEFT JOIN \`${tClientes}\` c ON cg.Id_Cliente = c.id
        LEFT JOIN \`${tGr}\` g ON cg.Id_GrupoCompras = g.id
        ORDER BY cg.id DESC
      `;
      const rows = await this.query(sql);
      return rows || [];
    } catch (error) {
      console.error('❌ Error obteniendo clientes_gruposCompras:', error.message);
      return [];
    }
  },

  async getClienteGrupoComprasById(id) {
    try {
      const tRel = await this._resolveTableNameCaseInsensitive('clientes_gruposCompras');
      const tGr = await this._resolveTableNameCaseInsensitive('gruposCompras');
      const tClientes = await this._resolveTableNameCaseInsensitive('clientes');
      const sql = `
        SELECT
          cg.*,
          c.cli_nombre_razon_social as ClienteNombre,
          g.Nombre as GrupoNombre
        FROM \`${tRel}\` cg
        LEFT JOIN \`${tClientes}\` c ON cg.Id_Cliente = c.id
        LEFT JOIN \`${tGr}\` g ON cg.Id_GrupoCompras = g.id
        WHERE cg.id = ? LIMIT 1
      `;
      const rows = await this.query(sql, [id]);
      return rows?.[0] || null;
    } catch (error) {
      console.error('❌ Error obteniendo cliente_grupoCompras por ID:', error.message);
      return null;
    }
  },

  async getGrupoComprasActivoByClienteId(clienteId) {
    try {
      const tRel = await this._resolveTableNameCaseInsensitive('clientes_gruposCompras');
      const tGr = await this._resolveTableNameCaseInsensitive('gruposCompras');
      const sql = `
        SELECT cg.*, g.Nombre as GrupoNombre
        FROM \`${tRel}\` cg
        LEFT JOIN \`${tGr}\` g ON cg.Id_GrupoCompras = g.id
        WHERE cg.Id_Cliente = ? AND cg.Activa = 1
        ORDER BY cg.id DESC
        LIMIT 1
      `;
      const rows = await this.query(sql, [clienteId]);
      return rows?.[0] || null;
    } catch (error) {
      console.error('❌ Error obteniendo grupoCompras activo del cliente:', error.message);
      return null;
    }
  },

  async createClienteGrupoCompras(payload) {
    if (!this.pool) await this.connect();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const tRel = await this._resolveTableNameCaseInsensitive('clientes_gruposCompras');

      await connection.execute(
        `UPDATE \`${tRel}\` SET Activa = 0, Fecha_Baja = NOW() WHERE Id_Cliente = ? AND Activa = 1`,
        [payload.Id_Cliente]
      );

      const insertPayload = {
        Id_Cliente: payload.Id_Cliente,
        Id_GrupoCompras: payload.Id_GrupoCompras,
        NumSocio: payload.NumSocio || null,
        Observaciones: payload.Observaciones || null,
        Activa: 1
      };

      const fields = Object.keys(insertPayload).map(k => `\`${k}\``).join(', ');
      const placeholders = Object.keys(insertPayload).map(() => '?').join(', ');
      const values = Object.values(insertPayload);

      const [result] = await connection.execute(
        `INSERT INTO \`${tRel}\` (${fields}) VALUES (${placeholders})`,
        values
      );

      await connection.commit();
      return { insertId: result.insertId };
    } catch (error) {
      try { await connection.rollback(); } catch (_) {}
      console.error('❌ Error creando cliente_grupoCompras:', error.message);
      throw error;
    } finally {
      connection.release();
    }
  },

  async updateClienteGrupoCompras(id, payload) {
    try {
      const tRel = await this._resolveTableNameCaseInsensitive('clientes_gruposCompras');
      const ALLOWED_COLUMNS = new Set(['Activa', 'Fecha_Baja', 'NumSocio', 'Observaciones']);
      const keys = this._filterPayloadKeys(payload).filter((k) => ALLOWED_COLUMNS.has(k));
      if (keys.length === 0) return { affectedRows: 0 };
      const fields = keys.map(k => `\`${k}\` = ?`).join(', ');
      const values = keys.map(k => payload[k]);
      values.push(id);
      const sql = `UPDATE \`${tRel}\` SET ${fields} WHERE id = ?`;
      await this.query(sql, values);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando cliente_grupoCompras:', error.message);
      throw error;
    }
  },

  async cerrarClienteGrupoCompras(id) {
    try {
      const tRel = await this._resolveTableNameCaseInsensitive('clientes_gruposCompras');
      await this.query(`UPDATE \`${tRel}\` SET Activa = 0, Fecha_Baja = NOW() WHERE id = ?`, [id]);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error cerrando cliente_grupoCompras:', error.message);
      throw error;
    }
  },

  async findCooperativaByNombre(nombre) {
    try {
      const sql = 'SELECT id, Nombre, Email, Telefono, Contacto FROM cooperativas WHERE Nombre = ? OR nombre = ? LIMIT 1';
      const rows = await this.query(sql, [nombre, nombre]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error buscando cooperativa por nombre:', error.message);
      return null;
    }
  },

  async createClienteCooperativa(payload) {
    try {
      if (!this.connected && !this.pool) {
        await this.connect();
      }

      if (payload.NumAsociado && payload.NumAsociado.trim() !== '') {
        const existeDuplicado = await this.checkNumeroAsociadoDuplicado(
          payload.Id_Cooperativa,
          payload.NumAsociado
        );

        if (existeDuplicado) {
          const cooperativa = await this.getCooperativaById(payload.Id_Cooperativa);
          const nombreCooperativa = cooperativa ? (cooperativa.Nombre || cooperativa.nombre) : `Cooperativa #${payload.Id_Cooperativa}`;
          throw new Error(`El número de asociado "${payload.NumAsociado}" ya existe en la cooperativa "${nombreCooperativa}". Cada cooperativa debe tener números de asociado únicos.`);
        }
      }

      const keys = this._filterPayloadKeys(payload);
      const fields = keys.map(key => `\`${key}\``).join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map(key => payload[key]);

      let sql = `INSERT INTO \`Clientes_Cooperativas\` (${fields}) VALUES (${placeholders})`;
      let result;
      let insertId;

      try {
        [result] = await this.pool.execute(sql, values);
        insertId = result.insertId;
      } catch (error1) {
        sql = `INSERT INTO clientes_cooperativas (${fields}) VALUES (${placeholders})`;
        try {
          [result] = await this.pool.execute(sql, values);
          insertId = result.insertId;
        } catch (error2) {
          throw error2;
        }
      }

      if (!insertId) {
        throw new Error('No se pudo obtener el ID de la relación creada');
      }
      return { insertId, Id: insertId, id: insertId };
    } catch (error) {
      console.error('❌ Error creando cliente_cooperativa:', error.message);
      throw error;
    }
  },

  async updateClienteCooperativa(id, payload) {
    try {
      if (payload.NumAsociado && payload.NumAsociado.trim() !== '') {
        const cooperativaId = payload.Id_Cooperativa;
        if (cooperativaId) {
          const existeDuplicado = await this.checkNumeroAsociadoDuplicado(
            cooperativaId,
            payload.NumAsociado,
            id
          );

          if (existeDuplicado) {
            const cooperativa = await this.getCooperativaById(cooperativaId);
            const nombreCooperativa = cooperativa ? (cooperativa.Nombre || cooperativa.nombre) : `Cooperativa #${cooperativaId}`;
            throw new Error(`El número de asociado "${payload.NumAsociado}" ya existe en la cooperativa "${nombreCooperativa}". Cada cooperativa debe tener números de asociado únicos.`);
          }
        }
      }

      const fields = [];
      const values = [];

      for (const [key, value] of Object.entries(payload)) {
        fields.push(`\`${key}\` = ?`);
        values.push(value);
      }

      values.push(id);

      let sql = `UPDATE \`Clientes_Cooperativas\` SET ${fields.join(', ')} WHERE id = ?`;
      try {
        await this.query(sql, values);
      } catch (error1) {
        sql = `UPDATE clientes_cooperativas SET ${fields.join(', ')} WHERE id = ?`;
        await this.query(sql, values);
      }

      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando cliente_cooperativa:', error.message);
      throw error;
    }
  },

  async deleteClienteCooperativa(id) {
    try {
      try {
        const sql = 'DELETE FROM `Clientes_Cooperativas` WHERE id = ?';
        await this.query(sql, [id]);
        return { affectedRows: 1 };
      } catch (error1) {
        const sql = 'DELETE FROM clientes_cooperativas WHERE id = ?';
        await this.query(sql, [id]);
        return { affectedRows: 1 };
      }
    } catch (error) {
      console.error('❌ Error eliminando cliente_cooperativa:', error.message);
      throw error;
    }
  },

  async upsertClienteCooperativa({ clienteId, cooperativaNombre, numeroAsociado }) {
    try {
      let cooperativa = await this.findCooperativaByNombre(cooperativaNombre);

      if (!cooperativa) {
        const result = await this.createCooperativa(cooperativaNombre);
        cooperativa = { id: result.insertId };
      }

      const sqlCheck = 'SELECT id, Id_Cliente, Id_Cooperativa, NumAsociado FROM `Clientes_Cooperativas` WHERE Id_Cliente = ? AND Id_Cooperativa = ? LIMIT 1';
      const cooperativaId = cooperativa.id || cooperativa.Id;
      const existing = await this.query(sqlCheck, [clienteId, cooperativaId]);

      if (existing.length > 0) {
        return await this.updateClienteCooperativa(existing[0].id, { NumAsociado: numeroAsociado });
      } else {
        return await this.createClienteCooperativa({
          Id_Cliente: clienteId,
          Id_Cooperativa: cooperativaId,
          NumAsociado: numeroAsociado
        });
      }
    } catch (error) {
      console.error('❌ Error en upsert cliente_cooperativa:', error.message);
      throw error;
    }
  },

  async _ensureClientesContactosTable() {
    try {
      await this.query(`
        CREATE TABLE IF NOT EXISTS \`clientes_contactos\` (
          \`Id\` INT NOT NULL AUTO_INCREMENT,
          \`Id_Cliente\` INT NOT NULL,
          \`Id_Contacto\` INT NOT NULL,
          \`Rol\` VARCHAR(120) NULL,
          \`Es_Principal\` TINYINT(1) NOT NULL DEFAULT 0,
          \`Notas\` VARCHAR(500) NULL,
          \`VigenteDesde\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`VigenteHasta\` DATETIME NULL,
          \`MotivoBaja\` VARCHAR(200) NULL,
          \`CreadoEn\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`Id\`),
          KEY \`idx_cc_cliente_vigente\` (\`Id_Cliente\`, \`VigenteHasta\`),
          KEY \`idx_cc_contacto_vigente\` (\`Id_Contacto\`, \`VigenteHasta\`),
          KEY \`idx_cc_cliente_principal\` (\`Id_Cliente\`, \`Es_Principal\`, \`VigenteHasta\`),
          KEY \`idx_cc_rol\` (\`Rol\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      return true;
    } catch (e) {
      console.warn('⚠️ [AGENDA] No se pudo asegurar tabla clientes_contactos:', e?.message || e);
      return false;
    }
  },

  async actualizarClientesPorCodigosPostales(Ids_CodigosPostales, Id_Marca = null) {
    try {
      const { sql: inClause, params: inParams } = this._buildInClauseSafe('c.Id_CodigoPostal', Ids_CodigosPostales);
      if (inParams.length === 0) {
        return { success: true, clientesActualizados: 0 };
      }

      let sql = `
        UPDATE Clientes c
        INNER JOIN Codigos_Postales cp ON c.Id_CodigoPostal = cp.id
        INNER JOIN Comerciales_Codigos_Postales_Marcas ccp ON cp.id = ccp.Id_CodigoPostal
        SET c.Id_Cial = ccp.Id_Comercial
        WHERE ${inClause}
          AND ccp.Activo = 1
          AND (ccp.FechaFin IS NULL OR ccp.FechaFin >= CURDATE())
          AND (ccp.FechaInicio IS NULL OR ccp.FechaInicio <= CURDATE())
      `;
      const params = [...inParams];

      if (Id_Marca !== null) {
        sql += ' AND ccp.Id_Marca = ?';
        params.push(Id_Marca);
      }

      sql += `
        AND (
          c.Id_Cial IS NULL 
          OR c.Id_Cial = 0
          OR ccp.Prioridad >= (
            SELECT COALESCE(MAX(ccp2.Prioridad), 0)
            FROM Comerciales_Codigos_Postales_Marcas ccp2
            INNER JOIN Codigos_Postales cp2 ON ccp2.Id_CodigoPostal = cp2.id
            WHERE cp2.id = c.Id_CodigoPostal
              AND ccp2.Id_Comercial = c.Id_Cial
              AND ccp2.Activo = 1
          )
        )
      `;

      const result = await this.query(sql, params);

      return {
        success: true,
        clientesActualizados: result.affectedRows || 0
      };
    } catch (error) {
      console.error('❌ Error actualizando clientes por códigos postales:', error.message);
      throw error;
    }
  }
};
