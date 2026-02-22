/**
 * Dominio: Agenda / Contactos
 * Consultas y lógica de agenda (tabla agenda/contactos) y relación clientes_contactos.
 * Se invoca con db como contexto (this) para acceder a query, _resolveAgendaTableName, etc.
 */
'use strict';

module.exports = {
  async getAgendaRoles(options = {}) {
    await this._ensureTiposCargoRolTable();
    try {
      const includeInactivos = Boolean(options.includeInactivos);
      const where = includeInactivos ? '' : 'WHERE Activo = 1';
      const rows = await this.query(`SELECT id, Nombre, Activo FROM \`tiposcargorol\` ${where} ORDER BY Nombre ASC`).catch(() => []);
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      return [];
    }
  },

  async createAgendaRol(nombre) {
    await this._ensureTiposCargoRolTable();
    const n = this._normalizeAgendaCatalogLabel(nombre);
    if (!n) throw new Error('Nombre de rol obligatorio');
    try {
      const existing = await this.query('SELECT id, Nombre FROM `tiposcargorol` WHERE Nombre = ? LIMIT 1', [n]).catch(() => []);
      if (existing && existing.length) {
        return { insertId: existing[0].id ?? null, nombre: existing[0].Nombre ?? n };
      }
    } catch (_) {}
    try {
      const r = await this.query('INSERT INTO `tiposcargorol` (Nombre, Activo) VALUES (?, 1)', [n]);
      return { insertId: r?.insertId ?? null, nombre: n };
    } catch (e) {
      const rows = await this.query('SELECT id, Nombre FROM `tiposcargorol` WHERE Nombre = ? LIMIT 1', [n]).catch(() => []);
      const id = rows?.[0]?.id ?? null;
      const nombreOut = rows?.[0]?.Nombre ?? n;
      return { insertId: id, nombre: nombreOut };
    }
  },

  async getAgendaEspecialidades(options = {}) {
    await this._ensureEspecialidadesIndexes();
    try {
      const t = await this._resolveTableNameCaseInsensitive('especialidades').catch(() => 'especialidades');
      const rows = await this.query(`SELECT id, Especialidad FROM \`${t}\` ORDER BY Especialidad ASC`).catch(() => []);
      const list = Array.isArray(rows) ? rows : [];
      return list
        .map((r) => ({ id: r?.id ?? r?.Id, Nombre: r?.Especialidad ?? r?.nombre ?? r?.Nombre ?? '' }))
        .filter((r) => r.id && r.Nombre);
    } catch (e) {
      return [];
    }
  },

  async createAgendaEspecialidad(nombre) {
    await this._ensureEspecialidadesIndexes();
    const n = this._normalizeAgendaCatalogLabel(nombre);
    if (!n) throw new Error('Nombre de especialidad obligatorio');
    try {
      const t = await this._resolveTableNameCaseInsensitive('especialidades').catch(() => 'especialidades');
      const existing = await this.query(`SELECT id, Especialidad FROM \`${t}\` WHERE Especialidad = ? LIMIT 1`, [n]).catch(() => []);
      if (existing && existing.length) return { insertId: existing[0].id ?? null, nombre: existing[0].Especialidad ?? n };
    } catch (_) {}
    try {
      const t = await this._resolveTableNameCaseInsensitive('especialidades').catch(() => 'especialidades');
      const r = await this.query(`INSERT INTO \`${t}\` (Especialidad, Observaciones) VALUES (?, NULL)`, [n]);
      return { insertId: r?.insertId ?? null, nombre: n };
    } catch (_e) {
      const t = await this._resolveTableNameCaseInsensitive('especialidades').catch(() => 'especialidades');
      const rows = await this.query(`SELECT id, Especialidad FROM \`${t}\` WHERE Especialidad = ? LIMIT 1`, [n]).catch(() => []);
      const id = rows?.[0]?.id ?? null;
      const nombreOut = rows?.[0]?.Especialidad ?? n;
      return { insertId: id, nombre: nombreOut };
    }
  },

  async getContactos(options = {}) {
    try {
      const search = String(options.search || '').trim();
      const includeInactivos = Boolean(options.includeInactivos);
      const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.min(500, Number(options.limit))) : 50;
      const offset = Number.isFinite(Number(options.offset)) ? Math.max(0, Number(options.offset)) : 0;

      const tAgenda = await this._resolveAgendaTableName();
      const colsAgenda = await this._getColumns(tAgenda).catch(() => []);
      const pick = (cands) => this._pickCIFromColumns(colsAgenda, cands);

      const colActivo = pick(['ag_activo', 'Activo', 'activo']) || 'ag_activo';
      const colNombre = pick(['ag_nombre', 'Nombre', 'nombre']) || 'ag_nombre';
      const colApellidos = pick(['ag_apellidos', 'Apellidos', 'apellidos']) || 'ag_apellidos';
      const colEmpresa = pick(['ag_empresa', 'Empresa', 'empresa']) || 'ag_empresa';
      const colEmail = pick(['ag_email', 'Email', 'email']) || 'ag_email';
      const colMovil = pick(['ag_movil', 'Movil', 'movil']) || 'ag_movil';
      const colTelefono = pick(['ag_telefono', 'Telefono', 'telefono']) || 'ag_telefono';
      const colTipoCargoRol = pick(['ag_tipcar_id', 'Id_TipoCargoRol', 'id_tipocargorol', 'IdTipoCargoRol']);
      const colEspId = pick(['ag_esp_id', 'Id_Especialidad', 'id_especialidad', 'IdEspecialidad', 'idEspecialidad']);

      const where = [];
      const params = [];

      if (!includeInactivos) {
        where.push(`TRIM(UPPER(COALESCE(CONCAT(a.\`${colActivo}\`,''),''))) IN ('1','OK','TRUE','SI','SÍ')`);
      }

      if (search) {
        const terms = search
          .split(/\s+/)
          .map(t => t.trim())
          .filter(Boolean)
          .map(t => `${t.replace(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ._@+-]/g, '')}*`)
          .filter(t => t !== '*')
          .join(' ');

        if (terms && terms.replace(/\*/g, '').length >= 3) {
          const matchCols = [colNombre, colApellidos, colEmpresa, colEmail, colMovil, colTelefono].map(c => `a.\`${c}\``).join(', ');
          where.push(`(MATCH(${matchCols}) AGAINST (? IN BOOLEAN MODE))`);
          params.push(terms);
        } else {
          where.push(`(a.\`${colNombre}\` LIKE ? OR a.\`${colApellidos}\` LIKE ? OR a.\`${colEmpresa}\` LIKE ? OR a.\`${colEmail}\` LIKE ? OR a.\`${colMovil}\` LIKE ? OR a.\`${colTelefono}\` LIKE ?)`);
          const like = `%${search}%`;
          params.push(like, like, like, like, like, like);
        }
      }

      const joins = [];
      const selectExtra = [];
      if (colTipoCargoRol) {
        const tTCR = await this._resolveTableNameCaseInsensitive('tiposcargorol').catch(() => 'tiposcargorol');
        const colsTCR = await this._getColumns(tTCR).catch(() => []);
        const tcrPk = this._pickCIFromColumns(colsTCR, ['tipcar_id', 'id', 'Id']) || 'tipcar_id';
        const tcrNombre = this._pickCIFromColumns(colsTCR, ['tipcar_nombre', 'Nombre', 'nombre']) || 'tipcar_nombre';
        joins.push(`LEFT JOIN \`${tTCR}\` tcr ON tcr.\`${tcrPk}\` = a.\`${colTipoCargoRol}\``);
        selectExtra.push(`tcr.\`${tcrNombre}\` AS CargoNombre`);
      }
      if (colEspId) {
        const tEsp = await this._resolveTableNameCaseInsensitive('especialidades').catch(() => 'especialidades');
        const colsEsp = await this._getColumns(tEsp).catch(() => []);
        const espPk = this._pickCIFromColumns(colsEsp, ['esp_id', 'id', 'Id']) || 'esp_id';
        const espNombre = this._pickCIFromColumns(colsEsp, ['esp_nombre', 'Especialidad', 'especialidad']) || 'esp_nombre';
        joins.push(`LEFT JOIN \`${tEsp}\` esp ON esp.\`${espPk}\` = a.\`${colEspId}\``);
        selectExtra.push(`esp.\`${espNombre}\` AS EspecialidadNombre`);
      }

      let sql = `SELECT a.*${selectExtra.length ? ', ' + selectExtra.join(', ') : ''} FROM \`${tAgenda}\` a ${joins.length ? joins.join(' ') : ''}`;
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      sql += ` ORDER BY a.\`${colApellidos}\` ASC, a.\`${colNombre}\` ASC`;
      sql += ` LIMIT ${limit} OFFSET ${offset}`;

      try {
        const rows = await this.query(sql, params);
        if (Array.isArray(rows) && (colTipoCargoRol || colEspId)) {
          for (const r of rows) {
            r.Cargo = r.CargoNombre ?? r.ag_cargo ?? r.Cargo ?? '';
            r.Especialidad = r.EspecialidadNombre ?? r.ag_especialidad ?? r.Especialidad ?? '';
          }
        }
        return rows;
      } catch (e) {
        const msg = String(e?.message || '');
        if (search && msg.toLowerCase().includes('match') && msg.toLowerCase().includes('against')) {
          const where2 = where.filter(w => !w.includes('MATCH('));
          const params2 = params.slice(0, params.length - 1);
          where2.push(`(a.\`${colNombre}\` LIKE ? OR a.\`${colApellidos}\` LIKE ? OR a.\`${colEmpresa}\` LIKE ? OR a.\`${colEmail}\` LIKE ? OR a.\`${colMovil}\` LIKE ? OR a.\`${colTelefono}\` LIKE ?)`);
          const like = `%${search}%`;
          params2.push(like, like, like, like, like, like);
          let sql2 = `SELECT a.*${selectExtra.length ? ', ' + selectExtra.join(', ') : ''} FROM \`${tAgenda}\` a ${joins.length ? joins.join(' ') : ''}`;
          if (where2.length) sql2 += ' WHERE ' + where2.join(' AND ');
          sql2 += ` ORDER BY a.\`${colApellidos}\` ASC, a.\`${colNombre}\` ASC`;
          sql2 += ` LIMIT ${limit} OFFSET ${offset}`;
          const rows2 = await this.query(sql2, params2);
          if (Array.isArray(rows2) && (colTipoCargoRol || colEspId)) {
            for (const r of rows2) {
              if (r && r.CargoNombre && !r.Cargo) r.Cargo = r.CargoNombre;
              if (r && r.EspecialidadNombre && !r.Especialidad) r.Especialidad = r.EspecialidadNombre;
            }
          }
          return rows2;
        }
        throw e;
      }
    } catch (error) {
      console.error('❌ Error obteniendo contactos:', error.message);
      throw error;
    }
  },

  async getContactoById(id) {
    try {
      const tAgenda = await this._resolveAgendaTableName();
      const cols = await this._getColumns(tAgenda).catch(() => []);
      const pick = (cands) => this._pickCIFromColumns(cols, cands);
      const colPk = pick(['ag_id', 'Id', 'id']) || 'ag_id';
      const colTipoCargoRol = pick(['ag_tipcar_id', 'Id_TipoCargoRol', 'id_tipocargorol', 'IdTipoCargoRol']);
      const colEspId = pick(['ag_esp_id', 'Id_Especialidad', 'id_especialidad', 'IdEspecialidad', 'idEspecialidad']);

      const joins = [];
      const selectExtra = [];
      if (colTipoCargoRol) {
        const tTCR = await this._resolveTableNameCaseInsensitive('tiposcargorol').catch(() => 'tiposcargorol');
        const colsTCR = await this._getColumns(tTCR).catch(() => []);
        const tcrPk = this._pickCIFromColumns(colsTCR, ['tipcar_id', 'id', 'Id']) || 'tipcar_id';
        const tcrNombre = this._pickCIFromColumns(colsTCR, ['tipcar_nombre', 'Nombre', 'nombre']) || 'tipcar_nombre';
        joins.push(`LEFT JOIN \`${tTCR}\` tcr ON tcr.\`${tcrPk}\` = a.\`${colTipoCargoRol}\``);
        selectExtra.push(`tcr.\`${tcrNombre}\` AS CargoNombre`);
      }
      if (colEspId) {
        const tEsp = await this._resolveTableNameCaseInsensitive('especialidades').catch(() => 'especialidades');
        const colsEsp = await this._getColumns(tEsp).catch(() => []);
        const espPk = this._pickCIFromColumns(colsEsp, ['esp_id', 'id', 'Id']) || 'esp_id';
        const espNombre = this._pickCIFromColumns(colsEsp, ['esp_nombre', 'Especialidad', 'especialidad']) || 'esp_nombre';
        joins.push(`LEFT JOIN \`${tEsp}\` esp ON esp.\`${espPk}\` = a.\`${colEspId}\``);
        selectExtra.push(`esp.\`${espNombre}\` AS EspecialidadNombre`);
      }

      const sql = `
        SELECT a.*${selectExtra.length ? ', ' + selectExtra.join(', ') : ''}
        FROM \`${tAgenda}\` a
        ${joins.join('\n')}
        WHERE a.\`${colPk}\` = ? LIMIT 1
      `;
      const rows = await this.query(sql, [id]);
      const item = rows?.[0] || null;
      if (item) {
        item.Cargo = item.CargoNombre ?? item.ag_cargo ?? item.Cargo ?? '';
        item.Especialidad = item.EspecialidadNombre ?? item.ag_especialidad ?? item.Especialidad ?? '';
      }
      return item;
    } catch (error) {
      console.error('❌ Error obteniendo contacto por ID:', error.message);
      return null;
    }
  },

  async createContacto(payload) {
    try {
      if (!this.connected && !this.pool) await this.connect();

      const canonicalToCols = {
        Nombre: ['ag_nombre', 'Nombre', 'nombre'],
        Apellidos: ['ag_apellidos', 'Apellidos', 'apellidos'],
        Cargo: ['ag_cargo', 'Cargo', 'cargo'],
        Especialidad: ['ag_especialidad', 'Especialidad', 'especialidad'],
        Id_TipoCargoRol: ['ag_tipcar_id', 'Id_TipoCargoRol', 'id_tipocargorol'],
        Id_Especialidad: ['ag_esp_id', 'Id_Especialidad', 'id_especialidad'],
        Empresa: ['ag_empresa', 'Empresa', 'empresa'],
        Email: ['ag_email', 'Email', 'email'],
        Movil: ['ag_movil', 'Movil', 'movil'],
        Telefono: ['ag_telefono', 'Telefono', 'telefono'],
        Extension: ['ag_extension', 'Extension', 'extension'],
        Notas: ['ag_notas', 'Notas', 'notas'],
        Activo: ['ag_activo', 'Activo', 'activo']
      };

      const raw = {};
      for (const [k, v] of Object.entries(payload || {})) {
        if (!canonicalToCols[k]) continue;
        raw[k] = (v === undefined ? null : v);
      }

      if (raw.Cargo) raw.Cargo = this._normalizeAgendaCatalogLabel(raw.Cargo) || raw.Cargo;
      if (raw.Especialidad) raw.Especialidad = this._normalizeAgendaCatalogLabel(raw.Especialidad) || raw.Especialidad;

      if (!raw.Nombre || String(raw.Nombre).trim() === '') {
        throw new Error('El campo Nombre es obligatorio');
      }

      const tAgenda = await this._resolveAgendaTableName();
      const cols = await this._getColumns(tAgenda).catch(() => []);
      const pick = (cands) => this._pickCIFromColumns(cols, cands);

      const data = {};
      for (const [canonical, v] of Object.entries(raw)) {
        const col = pick(canonicalToCols[canonical]);
        if (col) data[col] = v;
      }

      if (!Object.keys(data).length) throw new Error('No hay campos válidos para insertar');

      const fields = Object.keys(data).map(k => `\`${k}\``).join(', ');
      const placeholders = Object.keys(data).map(() => '?').join(', ');
      const values = Object.values(data);
      const sql = `INSERT INTO \`${tAgenda}\` (${fields}) VALUES (${placeholders})`;
      const result = await this.query(sql, values);
      return { insertId: result.insertId };
    } catch (error) {
      console.error('❌ Error creando contacto:', error.message);
      throw error;
    }
  },

  async updateContacto(id, payload) {
    try {
      if (!this.connected && !this.pool) await this.connect();

      const canonicalToCols = {
        Nombre: ['ag_nombre', 'Nombre', 'nombre'],
        Apellidos: ['ag_apellidos', 'Apellidos', 'apellidos'],
        Cargo: ['ag_cargo', 'Cargo', 'cargo'],
        Especialidad: ['ag_especialidad', 'Especialidad', 'especialidad'],
        Id_TipoCargoRol: ['ag_tipcar_id', 'Id_TipoCargoRol', 'id_tipocargorol'],
        Id_Especialidad: ['ag_esp_id', 'Id_Especialidad', 'id_especialidad'],
        Empresa: ['ag_empresa', 'Empresa', 'empresa'],
        Email: ['ag_email', 'Email', 'email'],
        Movil: ['ag_movil', 'Movil', 'movil'],
        Telefono: ['ag_telefono', 'Telefono', 'telefono'],
        Extension: ['ag_extension', 'Extension', 'extension'],
        Notas: ['ag_notas', 'Notas', 'notas'],
        Activo: ['ag_activo', 'Activo', 'activo']
      };

      const tAgenda = await this._resolveAgendaTableName();
      const cols = await this._getColumns(tAgenda).catch(() => []);
      const pick = (cands) => this._pickCIFromColumns(cols, cands);

      const fields = [];
      const values = [];
      for (const [canonical, v] of Object.entries(payload || {})) {
        const col = pick(canonicalToCols[canonical]);
        if (!col) continue;
        fields.push(`\`${col}\` = ?`);
        if (canonical === 'Cargo' && v) values.push(this._normalizeAgendaCatalogLabel(v) || v);
        else if (canonical === 'Especialidad' && v) values.push(this._normalizeAgendaCatalogLabel(v) || v);
        else values.push(v === undefined ? null : v);
      }

      if (!fields.length) return { affectedRows: 0 };

      values.push(id);
      const colPk = pick(['ag_id', 'Id', 'id']) || 'ag_id';
      const sql = `UPDATE \`${tAgenda}\` SET ${fields.join(', ')} WHERE \`${colPk}\` = ?`;
      const result = await this.query(sql, values);
      return { affectedRows: result.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error actualizando contacto:', error.message);
      throw error;
    }
  },

  async getContactosByCliente(clienteId, options = {}) {
    try {
      await this._ensureClientesContactosTable();
      const includeHistorico = Boolean(options.includeHistorico);
      const params = [clienteId];

      const tClientesContactos = await this._resolveTableNameCaseInsensitive('clientes_contactos');
      const tAgenda = await this._resolveAgendaTableName();
      const colsCC = await this._getColumns(tClientesContactos).catch(() => []);
      const colsAg = await this._getColumns(tAgenda).catch(() => []);
      const pickCC = (cands) => this._pickCIFromColumns(colsCC, cands);
      const pickAg = (cands) => this._pickCIFromColumns(colsAg, cands);

      const ccId = pickCC(['clicont_id', 'Id', 'id']) || 'Id';
      const ccIdCliente = pickCC(['clicont_cli_id', 'Id_Cliente', 'id_cliente']) || 'Id_Cliente';
      const ccIdContacto = pickCC(['clicont_ag_id', 'Id_Contacto', 'id_contacto']) || 'Id_Contacto';
      const ccRol = pickCC(['clicont_rol', 'Rol', 'rol']) || 'Rol';
      const ccEsPrincipal = pickCC(['clicont_es_principal', 'Es_Principal', 'es_principal']) || 'Es_Principal';
      const ccVigenteHasta = pickCC(['clicont_vigente_hasta', 'VigenteHasta', 'vigente_hasta']) || 'VigenteHasta';
      const ccVigenteDesde = pickCC(['clicont_vigente_desde', 'VigenteDesde', 'vigente_desde']) || 'VigenteDesde';
      const ccMotivoBaja = pickCC(['clicont_motivo_baja', 'MotivoBaja', 'motivo_baja']) || 'MotivoBaja';
      const ccNotas = pickCC(['clicont_notas', 'Notas', 'notas']) || 'Notas';

      const agId = pickAg(['ag_id', 'Id', 'id']) || 'ag_id';
      const agCargo = pickAg(['ag_cargo', 'Cargo', 'cargo']) || 'Cargo';
      const agApellidos = pickAg(['ag_apellidos', 'Apellidos', 'apellidos']) || 'Apellidos';
      const agNombre = pickAg(['ag_nombre', 'Nombre', 'nombre']) || 'Nombre';

      let sql = `
        SELECT
          cc.\`${ccId}\` AS Id_Relacion,
          cc.\`${ccIdCliente}\` AS Id_Cliente,
          cc.\`${ccIdContacto}\` AS Id_Contacto,
          COALESCE(NULLIF(TRIM(cc.\`${ccRol}\`), ''), NULLIF(TRIM(c.\`${agCargo}\`), '')) AS Rol,
          cc.\`${ccRol}\` AS RolRelacion,
          cc.\`${ccEsPrincipal}\` AS Es_Principal,
          cc.\`${ccNotas}\` AS NotasRelacion,
          cc.\`${ccVigenteDesde}\` AS VigenteDesde,
          cc.\`${ccVigenteHasta}\` AS VigenteHasta,
          cc.\`${ccMotivoBaja}\` AS MotivoBaja,
          c.*
        FROM \`${tClientesContactos}\` cc
        INNER JOIN \`${tAgenda}\` c ON c.\`${agId}\` = cc.\`${ccIdContacto}\`
        WHERE cc.\`${ccIdCliente}\` = ?
      `;

      if (!includeHistorico) sql += ` AND cc.\`${ccVigenteHasta}\` IS NULL`;

      sql += ` ORDER BY (cc.\`${ccVigenteHasta}\` IS NULL) DESC, cc.\`${ccEsPrincipal}\` DESC, c.\`${agApellidos}\` ASC, c.\`${agNombre}\` ASC, cc.\`${ccId}\` DESC`;

      return await this.query(sql, params);
    } catch (error) {
      console.error('❌ Error obteniendo contactos por cliente:', error.message);
      throw error;
    }
  },

  async vincularContactoACliente(clienteId, contactoId, options = {}) {
    const rol = options.Rol ?? options.rol ?? null;
    const notas = options.Notas ?? options.notas ?? null;
    const esPrincipal = (options.Es_Principal ?? options.es_principal ?? options.esPrincipal) ? 1 : 0;

    await this._ensureClientesContactosTable();
    if (!this.pool) await this.connect();
    const tClientesContactos = await this._resolveTableNameCaseInsensitive('clientes_contactos');
    const conn = await this.pool.getConnection();

    try {
      try { await conn.query("SET time_zone = 'Europe/Madrid'"); } catch (_) {}
      await conn.beginTransaction();

      if (esPrincipal) {
        await conn.execute(
          `UPDATE \`${tClientesContactos}\` SET Es_Principal = 0 WHERE Id_Cliente = ? AND VigenteHasta IS NULL`,
          [clienteId]
        );
      }

      const [rows] = await conn.execute(
        `SELECT Id FROM \`${tClientesContactos}\` WHERE Id_Cliente = ? AND Id_Contacto = ? AND VigenteHasta IS NULL ORDER BY Id DESC LIMIT 1`,
        [clienteId, contactoId]
      );

      if (rows && rows.length > 0) {
        const relId = rows[0].Id;
        await conn.execute(
          `UPDATE \`${tClientesContactos}\` SET Rol = ?, Notas = ?, Es_Principal = ? WHERE Id = ?`,
          [rol, notas, esPrincipal, relId]
        );
        await conn.commit();
        return { action: 'updated', Id_Relacion: relId };
      }

      const [ins] = await conn.execute(
        `INSERT INTO \`${tClientesContactos}\` (Id_Cliente, Id_Contacto, Rol, Es_Principal, Notas) VALUES (?, ?, ?, ?, ?)`,
        [clienteId, contactoId, rol, esPrincipal, notas]
      );

      await conn.commit();
      return { action: 'inserted', Id_Relacion: ins.insertId };
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      console.error('❌ Error vinculando contacto a cliente:', error.message);
      throw error;
    } finally {
      conn.release();
    }
  },

  async setContactoPrincipalForCliente(clienteId, contactoId) {
    await this._ensureClientesContactosTable();
    if (!this.pool) await this.connect();
    const tClientesContactos = await this._resolveTableNameCaseInsensitive('clientes_contactos');
    const conn = await this.pool.getConnection();
    try {
      try { await conn.query("SET time_zone = 'Europe/Madrid'"); } catch (_) {}
      await conn.beginTransaction();

      await conn.execute(
        `UPDATE \`${tClientesContactos}\` SET Es_Principal = 0 WHERE Id_Cliente = ? AND VigenteHasta IS NULL`,
        [clienteId]
      );

      const [rows] = await conn.execute(
        `SELECT Id FROM \`${tClientesContactos}\` WHERE Id_Cliente = ? AND Id_Contacto = ? AND VigenteHasta IS NULL ORDER BY Id DESC LIMIT 1`,
        [clienteId, contactoId]
      );

      if (rows && rows.length > 0) {
        const relId = rows[0].Id;
        await conn.execute(
          `UPDATE \`${tClientesContactos}\` SET Es_Principal = 1 WHERE Id = ?`,
          [relId]
        );
        await conn.commit();
        return { action: 'updated', Id_Relacion: relId };
      }

      const [ins] = await conn.execute(
        `INSERT INTO \`${tClientesContactos}\` (Id_Cliente, Id_Contacto, Rol, Es_Principal, Notas) VALUES (?, ?, ?, 1, ?)`,
        [clienteId, contactoId, null, null]
      );
      await conn.commit();
      return { action: 'inserted', Id_Relacion: ins.insertId };
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      console.error('❌ Error marcando principal contacto-cliente:', error.message);
      throw error;
    } finally {
      conn.release();
    }
  },

  async cerrarVinculoContactoCliente(clienteId, contactoId, options = {}) {
    try {
      const motivo = options.MotivoBaja ?? options.motivoBaja ?? options.motivo ?? null;
      if (!this.connected && !this.pool) await this.connect();
      await this._ensureClientesContactosTable();
      const tClientesContactos = await this._resolveTableNameCaseInsensitive('clientes_contactos');
      const sql = `
        UPDATE \`${tClientesContactos}\`
        SET VigenteHasta = NOW(), MotivoBaja = ?, Es_Principal = 0
        WHERE Id_Cliente = ? AND Id_Contacto = ? AND VigenteHasta IS NULL
        ORDER BY Id DESC
        LIMIT 1
      `;
      const result = await this.query(sql, [motivo, clienteId, contactoId]);
      return { affectedRows: result.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error cerrando vínculo contacto-cliente:', error.message);
      throw error;
    }
  },

  async getClientesByContacto(contactoId, options = {}) {
    try {
      await this._ensureClientesContactosTable();
      const includeHistorico = Boolean(options.includeHistorico);
      const id = Number(contactoId);
      if (!Number.isFinite(id) || id <= 0) return [];
      const params = [id];
      const tClientesContactos = await this._resolveTableNameCaseInsensitive('clientes_contactos');
      const tClientes = await this._resolveTableNameCaseInsensitive('clientes');
      const { pk } = await this._ensureClientesMeta().catch(() => ({ pk: 'Id' }));
      const tAgenda = await this._resolveAgendaTableName();

      const colsCC = await this._getColumns(tClientesContactos).catch(() => []);
      const colsAg = await this._getColumns(tAgenda).catch(() => []);
      const pickCC = (cands) => this._pickCIFromColumns(colsCC, cands);
      const pickAg = (cands) => this._pickCIFromColumns(colsAg, cands);

      const ccId = pickCC(['clicont_id', 'Id', 'id']) || 'Id';
      const ccIdCliente = pickCC(['clicont_cli_id', 'Id_Cliente', 'id_cliente']) || 'Id_Cliente';
      const ccIdContacto = pickCC(['clicont_ag_id', 'Id_Contacto', 'id_contacto']) || 'Id_Contacto';
      const ccRol = pickCC(['clicont_rol', 'Rol', 'rol']) || 'Rol';
      const ccEsPrincipal = pickCC(['clicont_es_principal', 'Es_Principal', 'es_principal']) || 'Es_Principal';
      const ccVigenteHasta = pickCC(['clicont_vigente_hasta', 'VigenteHasta', 'vigente_hasta']) || 'VigenteHasta';
      const ccVigenteDesde = pickCC(['clicont_vigente_desde', 'VigenteDesde', 'vigente_desde']) || 'VigenteDesde';
      const ccMotivoBaja = pickCC(['clicont_motivo_baja', 'MotivoBaja', 'motivo_baja']) || 'MotivoBaja';
      const ccNotas = pickCC(['clicont_notas', 'Notas', 'notas']) || 'Notas';

      const agId = pickAg(['ag_id', 'Id', 'id']) || 'ag_id';
      const agCargo = pickAg(['ag_cargo', 'Cargo', 'cargo']) || 'Cargo';

      let sql = `
        SELECT
          cc.\`${ccId}\` AS Id_Relacion,
          cc.\`${ccIdCliente}\` AS Id_Cliente,
          cc.\`${ccIdContacto}\` AS Id_Contacto,
          COALESCE(NULLIF(TRIM(cc.\`${ccRol}\`), ''), NULLIF(TRIM(a.\`${agCargo}\`), '')) AS Rol,
          cc.\`${ccRol}\` AS RolRelacion,
          cc.\`${ccEsPrincipal}\` AS Es_Principal,
          cc.\`${ccNotas}\` AS NotasRelacion,
          cc.\`${ccVigenteDesde}\` AS VigenteDesde,
          cc.\`${ccVigenteHasta}\` AS VigenteHasta,
          cc.\`${ccMotivoBaja}\` AS MotivoBaja,
          c.*,
          a.\`${agCargo}\` AS ContactoCargo
        FROM \`${tClientesContactos}\` cc
        INNER JOIN \`${tClientes}\` c ON c.\`${pk}\` = cc.\`${ccIdCliente}\`
        INNER JOIN \`${tAgenda}\` a ON a.\`${agId}\` = cc.\`${ccIdContacto}\`
        WHERE cc.\`${ccIdContacto}\` = ?
      `;

      if (!includeHistorico) sql += ` AND cc.\`${ccVigenteHasta}\` IS NULL`;

      sql += ` ORDER BY (cc.\`${ccVigenteHasta}\` IS NULL) DESC, cc.\`${ccEsPrincipal}\` DESC, c.\`${pk}\` ASC, cc.\`${ccId}\` DESC`;
      const rows = await this.query(sql, params);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('❌ Error obteniendo clientes por contacto:', error.message);
      throw error;
    }
  }
};
