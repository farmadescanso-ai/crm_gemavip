/**
 * Módulo de direcciones de envío para MySQL CRM.
 * Metadatos, índices, CRUD y ensureDireccionEnvioFiscal.
 * Se asigna al prototipo de MySQLCRM con Object.assign.
 */
'use strict';

module.exports = {
  async _ensureDireccionesEnvioMeta() {
    if (this._metaCache?.direccionesEnvioMeta) return this._metaCache.direccionesEnvioMeta;

    const candidates = [
      'direccionesEnvio',
      'direcciones_envio',
      'direcciones_envios',
      'direccionesDeEnvio',
      'direcciones_de_envio',
      'clientes_direcciones_envio',
      'clientes_direccionesEnvio'
    ];

    let t = null;
    let cols = [];
    for (const base of candidates) {
      const tt = await this._resolveTableNameCaseInsensitive(base);
      const cc = await this._getColumns(tt);
      if (Array.isArray(cc) && cc.length) {
        t = tt;
        cols = cc;
        break;
      }
    }

    const pickCI = (cands) => this._pickCIFromColumns(cols, cands);
    const pk = pickCI(['direnv_id', 'id', 'Id']) || 'direnv_id';
    const colCliente = pickCI(['direnv_cli_id', 'Id_Cliente', 'id_cliente', 'ClienteId', 'clienteId', 'cliente_id']);
    const colActiva = pickCI(['direnv_activa', 'Activa', 'activa', 'Activo', 'activo']);
    const colPrincipal = pickCI(['direnv_es_principal', 'Es_Principal', 'es_principal', 'EsPrincipal', 'esPrincipal', 'Principal', 'principal']);
    const colContacto = pickCI(['direnv_ag_id', 'Id_Contacto', 'id_contacto', 'ContactoId', 'contactoId', 'contacto_id']);

    const meta = { table: t, pk, colCliente, colActiva, colPrincipal, colContacto, _cols: cols };
    this._metaCache.direccionesEnvioMeta = meta;
    return meta;
  },

  async ensureDireccionesEnvioIndexes() {
    if (this._direccionesEnvioIndexesEnsured) return;
    this._direccionesEnvioIndexesEnsured = true;

    try {
      if (!this.pool) return;
      const meta = await this._ensureDireccionesEnvioMeta();
      if (!meta?.table) return;

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

      await createIfMissing('idx_direnvio_cliente', [meta.colCliente]);
      await createIfMissing('idx_direnvio_cliente_activa', [meta.colCliente, meta.colActiva]);
      await createIfMissing('idx_direnvio_cliente_activa_principal', [meta.colCliente, meta.colActiva, meta.colPrincipal]);

      if (hasCol(meta.pk)) {
        await createIfMissing('idx_direnvio_pk', [meta.pk]);
      }
    } catch (e) {
      console.warn('⚠️ [INDEX] No se pudieron asegurar índices en direcciones de envío:', e?.message || e);
    }
  },

  async getDireccionesEnvioByCliente(clienteId, options = {}) {
    try {
      const includeInactivas = Boolean(options.includeInactivas);
      const compact = Boolean(options.compact);
      const meta = await this._ensureDireccionesEnvioMeta();
      if (!meta?.table || !meta?.colCliente) return [];

      const cols = Array.isArray(meta?._cols) ? meta._cols : [];
      const pickCI = (cands) => this._pickCIFromColumns(cols, cands);

      const colAlias = pickCI(['Alias', 'alias']);
      const colDest = pickCI(['Nombre_Destinatario', 'nombre_destinatario', 'Destinatario', 'destinatario', 'Nombre', 'nombre']);
      const colDir1 = pickCI(['Direccion', 'direccion', 'Dirección']);
      const colDir2 = pickCI(['Direccion2', 'direccion2', 'Dirección2']);
      const colPob = pickCI(['Poblacion', 'poblacion']);
      const colCP = pickCI(['CodigoPostal', 'codigo_postal', 'CP', 'cp']);
      const colPais = pickCI(['Pais', 'pais']);
      const colEmail = pickCI(['Email', 'email']);
      const colTel = pickCI(['Telefono', 'telefono', 'Tel', 'tel']);
      const colMov = pickCI(['Movil', 'movil', 'Móvil']);
      const colObs = pickCI(['Observaciones', 'observaciones', 'Notas', 'notas']);

      const select = [];
      select.push(`d.\`${meta.pk}\` AS id`);
      select.push(`d.\`${meta.colCliente}\` AS Id_Cliente`);
      if (colAlias) select.push(`d.\`${colAlias}\` AS Alias`);
      if (colDest) select.push(`d.\`${colDest}\` AS Nombre_Destinatario`);
      if (colDir1) select.push(`d.\`${colDir1}\` AS Direccion`);
      if (colDir2) select.push(`d.\`${colDir2}\` AS Direccion2`);
      if (colPob) select.push(`d.\`${colPob}\` AS Poblacion`);
      if (colCP) select.push(`d.\`${colCP}\` AS CodigoPostal`);
      if (colPais) select.push(`d.\`${colPais}\` AS Pais`);
      if (!compact) {
        if (colEmail) select.push(`d.\`${colEmail}\` AS Email`);
        if (colTel) select.push(`d.\`${colTel}\` AS Telefono`);
        if (colMov) select.push(`d.\`${colMov}\` AS Movil`);
        if (colObs) select.push(`d.\`${colObs}\` AS Observaciones`);
      }
      if (meta.colActiva) select.push(`d.\`${meta.colActiva}\` AS Activa`);
      if (meta.colPrincipal) select.push(`d.\`${meta.colPrincipal}\` AS Es_Principal`);

      let sql = `SELECT ${select.join(', ')} FROM \`${meta.table}\` d WHERE d.\`${meta.colCliente}\` = ?`;
      const params = [clienteId];

      if (!includeInactivas && meta.colActiva) {
        sql += ` AND d.\`${meta.colActiva}\` = 1`;
      }

      const order = [];
      if (meta.colActiva) order.push(`d.\`${meta.colActiva}\` DESC`);
      if (meta.colPrincipal) order.push(`d.\`${meta.colPrincipal}\` DESC`);
      order.push(`d.\`${meta.pk}\` DESC`);
      sql += ` ORDER BY ${order.join(', ')}`;

      return await this.query(sql, params);
    } catch (error) {
      const msg = String(error?.sqlMessage || error?.message || '');
      if (error?.code === 'ER_NO_SUCH_TABLE' || /doesn't exist/i.test(msg)) {
        return [];
      }
      console.error('❌ Error obteniendo direcciones de envío por cliente:', error.message);
      throw error;
    }
  },

  async getDireccionEnvioById(id) {
    try {
      const meta = await this._ensureDireccionesEnvioMeta();
      if (!meta?.table) return null;
      const cols = await this._getColumns(meta.table).catch(() => []);
      const colList = cols.length ? cols.map((c) => `\`${c}\``).join(', ') : '*';
      const rows = await this.query(
        `SELECT ${colList} FROM \`${meta.table}\` WHERE \`${meta.pk}\` = ? LIMIT 1`,
        [id]
      );
      return rows && rows.length > 0 ? rows[0] : null;
    } catch (error) {
      const msg = String(error?.sqlMessage || error?.message || '');
      if (error?.code === 'ER_NO_SUCH_TABLE' || /doesn't exist/i.test(msg)) return null;
      console.error('❌ Error obteniendo dirección de envío por ID:', error.message);
      throw error;
    }
  },

  async createDireccionEnvio(payload) {
    try {
      if (!this.connected && !this.pool) await this.connect();

      const allowed = new Set([
        'Id_Cliente',
        'Id_Contacto',
        'Alias',
        'Nombre_Destinatario',
        'Direccion',
        'Direccion2',
        'Poblacion',
        'CodigoPostal',
        'Id_Provincia',
        'Id_CodigoPostal',
        'Id_Pais',
        'Pais',
        'Telefono',
        'Movil',
        'Email',
        'Observaciones',
        'Es_Principal',
        'Activa'
      ]);

      const data = {};
      for (const [k, v] of Object.entries(payload || {})) {
        if (!allowed.has(k)) continue;
        data[k] = v === undefined ? null : v;
      }

      if (!data.Id_Cliente) throw new Error('Id_Cliente es obligatorio');

      const meta = await this._ensureDireccionesEnvioMeta();
      if (!meta?.table) throw new Error('Tabla direccionesEnvio no encontrada');

      const tDirecciones = meta.table;
      const cols = new Set(meta._cols || []);
      const pickCI = (cands) => this._pickCIFromColumns(meta._cols || [], cands);

      const payloadToCol = {
        Id_Cliente: meta.colCliente,
        Id_Contacto: meta.colContacto,
        Alias: pickCI(['direnv_alias', 'Alias']),
        Nombre_Destinatario: pickCI(['direnv_nombre_destinatario', 'Nombre_Destinatario']),
        Direccion: pickCI(['direnv_direccion', 'Direccion']),
        Direccion2: pickCI(['direnv_direccion2', 'Direccion2']),
        Poblacion: pickCI(['direnv_poblacion', 'Poblacion']),
        CodigoPostal: pickCI(['direnv_codigo_postal', 'CodigoPostal']),
        Id_Provincia: pickCI(['direnv_prov_id', 'Id_Provincia']),
        Id_CodigoPostal: pickCI(['direnv_codp_id', 'Id_CodigoPostal']),
        Id_Pais: pickCI(['direnv_pais_id', 'Id_Pais']),
        Pais: pickCI(['direnv_pais', 'Pais']),
        Telefono: pickCI(['direnv_telefono', 'Telefono']),
        Movil: pickCI(['direnv_movil', 'Movil']),
        Email: pickCI(['direnv_email', 'Email']),
        Observaciones: pickCI(['direnv_observaciones', 'Observaciones']),
        Es_Principal: meta.colPrincipal,
        Activa: meta.colActiva
      };

      const esPrincipal = Number(data.Es_Principal) === 1;
      const activa = (data.Activa === undefined || data.Activa === null) ? true : (Number(data.Activa) === 1);

      if (!this.pool) await this.connect();
      const conn = await this.pool.getConnection();
      try {
        await conn.beginTransaction();

        if (esPrincipal && activa && meta.colPrincipal && meta.colCliente && meta.colActiva) {
          await conn.execute(
            `UPDATE \`${tDirecciones}\` SET \`${meta.colPrincipal}\` = 0 WHERE \`${meta.colCliente}\` = ? AND \`${meta.colActiva}\` = 1`,
            [Number(data.Id_Cliente)]
          );
        }

        const dbFields = [];
        const values = [];
        for (const [apiKey, dbCol] of Object.entries(payloadToCol)) {
          if (!dbCol || !cols.has(dbCol) || !Object.prototype.hasOwnProperty.call(data, apiKey)) continue;
          dbFields.push(`\`${dbCol}\``);
          values.push(data[apiKey]);
        }
        if (dbFields.length === 0) throw new Error('No hay campos válidos para insertar');

        const placeholders = dbFields.map(() => '?').join(', ');
        const sql = `INSERT INTO \`${tDirecciones}\` (${dbFields.join(', ')}) VALUES (${placeholders})`;
        const [result] = await conn.execute(sql, values);

        await conn.commit();
        return { insertId: result.insertId };
      } catch (e) {
        try { await conn.rollback(); } catch (_) {}
        throw e;
      } finally {
        conn.release();
      }
    } catch (error) {
      console.error('❌ Error creando dirección de envío:', error.message);
      throw error;
    }
  },

  async ensureDireccionEnvioFiscal(clienteId) {
    const cid = Number.parseInt(String(clienteId ?? '').trim(), 10);
    if (!Number.isFinite(cid) || cid <= 0) return { created: false, id: null };
    try {
      const existing = await this.getDireccionesEnvioByCliente(cid, { compact: true }).catch(() => []);
      const arr = Array.isArray(existing) ? existing : [];
      if (arr.length > 0) {
        const firstId = Number.parseInt(String(arr[0]?.id ?? arr[0]?.Id ?? '').trim(), 10);
        return { created: false, id: Number.isFinite(firstId) ? firstId : null };
      }

      const c = await this.getClienteById(cid).catch(() => null);
      if (!c) return { created: false, id: null };

      const nombre = String(c.cli_nombre_razon_social ?? c.Nombre ?? '').trim();
      const direccion = String(c.Direccion ?? c.direccion ?? '').trim();
      const poblacion = String(c.Poblacion ?? c.poblacion ?? '').trim();
      const cp = String(c.CodigoPostal ?? c.codigo_postal ?? c.CP ?? c.cp ?? '').trim();
      const pais = String(c.Pais ?? c.pais ?? '').trim();

      if (!direccion && !poblacion && !cp) return { created: false, id: null };

      const created = await this.createDireccionEnvio({
        Id_Cliente: cid,
        Alias: 'Fiscal',
        Nombre_Destinatario: nombre || null,
        Direccion: direccion || null,
        Poblacion: poblacion || null,
        CodigoPostal: cp || null,
        Pais: pais || null,
        Es_Principal: 1,
        Activa: 1
      });
      const id = Number(created?.insertId ?? 0) || null;
      return { created: Boolean(id), id };
    } catch (e) {
      console.warn('⚠️ Error asegurando dirección envío fiscal:', e?.message || e);
      return { created: false, id: null };
    }
  },

  async updateDireccionEnvio(id, payload) {
    try {
      if (!this.connected && !this.pool) {
        await this.connect();
      }

      const allowed = new Set([
        'Id_Contacto',
        'Alias',
        'Nombre_Destinatario',
        'Direccion',
        'Direccion2',
        'Poblacion',
        'CodigoPostal',
        'Id_Provincia',
        'Id_CodigoPostal',
        'Id_Pais',
        'Pais',
        'Telefono',
        'Movil',
        'Email',
        'Observaciones',
        'Es_Principal',
        'Activa'
      ]);

      const meta = await this._ensureDireccionesEnvioMeta();
      if (!meta?.table) throw new Error('Tabla direccionesEnvio no encontrada');

      const cols = new Set(meta._cols || []);
      const pickCI = (cands) => this._pickCIFromColumns(meta._cols || [], cands);

      const payloadToCol = {
        Id_Contacto: meta.colContacto,
        Alias: pickCI(['direnv_alias', 'Alias']),
        Nombre_Destinatario: pickCI(['direnv_nombre_destinatario', 'Nombre_Destinatario']),
        Direccion: pickCI(['direnv_direccion', 'Direccion']),
        Direccion2: pickCI(['direnv_direccion2', 'Direccion2']),
        Poblacion: pickCI(['direnv_poblacion', 'Poblacion']),
        CodigoPostal: pickCI(['direnv_codigo_postal', 'CodigoPostal']),
        Id_Provincia: pickCI(['direnv_prov_id', 'Id_Provincia']),
        Id_CodigoPostal: pickCI(['direnv_codp_id', 'Id_CodigoPostal']),
        Id_Pais: pickCI(['direnv_pais_id', 'Id_Pais']),
        Pais: pickCI(['direnv_pais', 'Pais']),
        Telefono: pickCI(['direnv_telefono', 'Telefono']),
        Movil: pickCI(['direnv_movil', 'Movil']),
        Email: pickCI(['direnv_email', 'Email']),
        Observaciones: pickCI(['direnv_observaciones', 'Observaciones']),
        Es_Principal: meta.colPrincipal,
        Activa: meta.colActiva
      };

      const fields = [];
      const values = [];
      for (const [apiKey, dbCol] of Object.entries(payloadToCol)) {
        if (!dbCol || !cols.has(dbCol) || !Object.prototype.hasOwnProperty.call(payload || {}, apiKey)) continue;
        fields.push(`\`${dbCol}\` = ?`);
        values.push(payload[apiKey] === undefined ? null : payload[apiKey]);
      }
      if (!fields.length) return { affectedRows: 0 };

      const tDirecciones = meta.table;

      const willSetPrincipal = Object.prototype.hasOwnProperty.call(payload || {}, 'Es_Principal') && Number(payload.Es_Principal) === 1;
      const willBeActive = !Object.prototype.hasOwnProperty.call(payload || {}, 'Activa') || Number(payload.Activa) === 1;

      if (!this.pool) await this.connect();
      const conn = await this.pool.getConnection();
      try {
        await conn.beginTransaction();

        let clienteId = null;
        try {
          const [rows] = await conn.execute(
            `SELECT \`${meta.colCliente}\` FROM \`${tDirecciones}\` WHERE \`${meta.pk}\` = ? LIMIT 1`,
            [id]
          );
          clienteId = rows?.[0]?.[meta.colCliente] ?? null;
        } catch (_) {
          clienteId = null;
        }

        if (clienteId && willSetPrincipal && willBeActive && meta.colPrincipal && meta.colCliente && meta.colActiva) {
          await conn.execute(
            `UPDATE \`${tDirecciones}\` SET \`${meta.colPrincipal}\` = 0 WHERE \`${meta.colCliente}\` = ? AND \`${meta.colActiva}\` = 1`,
            [Number(clienteId)]
          );
        }

        values.push(id);
        const sql = `UPDATE \`${tDirecciones}\` SET ${fields.join(', ')} WHERE \`${meta.pk}\` = ?`;
        const [result] = await conn.execute(sql, values);

        await conn.commit();
        return { affectedRows: result.affectedRows || 0 };
      } catch (e) {
        try { await conn.rollback(); } catch (_) {}
        throw e;
      } finally {
        conn.release();
      }
    } catch (error) {
      console.error('❌ Error actualizando dirección de envío:', error.message);
      throw error;
    }
  },

  async desactivarDireccionEnvio(id) {
    try {
      if (!this.connected && !this.pool) {
        await this.connect();
      }
      const meta = await this._ensureDireccionesEnvioMeta();
      if (!meta?.table || !meta.colActiva || !meta.colPrincipal || !meta.pk) {
        throw new Error('Tabla direccionesEnvio no encontrada o sin columnas esperadas');
      }
      const sql = `UPDATE \`${meta.table}\` SET \`${meta.colActiva}\` = 0, \`${meta.colPrincipal}\` = 0 WHERE \`${meta.pk}\` = ?`;
      const result = await this.query(sql, [id]);
      return { affectedRows: result.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error desactivando dirección de envío:', error.message);
      throw error;
    }
  }
};
