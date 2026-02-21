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

      const where = [];
      const params = [];

      if (!includeInactivos) {
        where.push("TRIM(UPPER(COALESCE(CONCAT(a.Activo,''),''))) IN ('1','OK','TRUE','SI','SÍ')");
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
          where.push('(MATCH(a.Nombre, a.Apellidos, a.Empresa, a.Email, a.Movil, a.Telefono) AGAINST (? IN BOOLEAN MODE))');
          params.push(terms);
        } else {
          where.push('(a.Nombre LIKE ? OR a.Apellidos LIKE ? OR a.Empresa LIKE ? OR a.Email LIKE ? OR a.Movil LIKE ? OR a.Telefono LIKE ?)');
          const like = `%${search}%`;
          params.push(like, like, like, like, like, like);
        }
      }

      const tAgenda = await this._resolveAgendaTableName();
      const colsAgenda = await this._getColumns(tAgenda).catch(() => []);
      const colTipoCargoRol = this._pickCIFromColumns(colsAgenda, ['Id_TipoCargoRol', 'id_tipocargorol', 'IdTipoCargoRol', 'idTipoCargoRol']);
      const colEspId = this._pickCIFromColumns(colsAgenda, ['Id_Especialidad', 'id_especialidad', 'IdEspecialidad', 'idEspecialidad']);

      const joins = [];
      const selectExtra = [];
      if (colTipoCargoRol) {
        joins.push('LEFT JOIN `tiposcargorol` tcr ON tcr.id = a.`' + colTipoCargoRol + '`');
        selectExtra.push('tcr.Nombre AS CargoNombre');
      }
      if (colEspId) {
        const tEsp = await this._resolveTableNameCaseInsensitive('especialidades').catch(() => 'especialidades');
        joins.push('LEFT JOIN `' + tEsp + '` esp ON esp.id = a.`' + colEspId + '`');
        selectExtra.push('esp.Especialidad AS EspecialidadNombre');
      }

      let sql = `SELECT a.*${selectExtra.length ? ', ' + selectExtra.join(', ') : ''} FROM \`${tAgenda}\` a ${joins.length ? joins.join(' ') : ''}`;
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      sql += ' ORDER BY a.Apellidos ASC, a.Nombre ASC';
      sql += ` LIMIT ${limit} OFFSET ${offset}`;

      try {
        const rows = await this.query(sql, params);
        if (Array.isArray(rows) && (colTipoCargoRol || colEspId)) {
          for (const r of rows) {
            if (r && r.CargoNombre && !r.Cargo) r.Cargo = r.CargoNombre;
            if (r && r.EspecialidadNombre && !r.Especialidad) r.Especialidad = r.EspecialidadNombre;
          }
        }
        return rows;
      } catch (e) {
        const msg = String(e?.message || '');
        if (search && msg.toLowerCase().includes('match') && msg.toLowerCase().includes('against')) {
          const where2 = where.filter(w => !w.includes('MATCH('));
          const params2 = params.slice(0, params.length - 1);
          where2.push('(a.Nombre LIKE ? OR a.Apellidos LIKE ? OR a.Empresa LIKE ? OR a.Email LIKE ? OR a.Movil LIKE ? OR a.Telefono LIKE ?)');
          const like = `%${search}%`;
          params2.push(like, like, like, like, like, like);
          let sql2 = `SELECT a.*${selectExtra.length ? ', ' + selectExtra.join(', ') : ''} FROM \`${tAgenda}\` a ${joins.length ? joins.join(' ') : ''}`;
          if (where2.length) sql2 += ' WHERE ' + where2.join(' AND ');
          sql2 += ' ORDER BY a.Apellidos ASC, a.Nombre ASC';
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
      const colTipoCargoRol = this._pickCIFromColumns(cols, ['Id_TipoCargoRol', 'id_tipocargorol', 'IdTipoCargoRol', 'idTipoCargoRol']);
      const colEspId = this._pickCIFromColumns(cols, ['Id_Especialidad', 'id_especialidad', 'IdEspecialidad', 'idEspecialidad']);

      const joins = [];
      const selectExtra = [];
      if (colTipoCargoRol) {
        joins.push('LEFT JOIN `tiposcargorol` tcr ON tcr.id = a.`' + colTipoCargoRol + '`');
        selectExtra.push('tcr.Nombre AS CargoNombre');
      }
      if (colEspId) {
        const tEsp = await this._resolveTableNameCaseInsensitive('especialidades').catch(() => 'especialidades');
        joins.push('LEFT JOIN `' + tEsp + '` esp ON esp.id = a.`' + colEspId + '`');
        selectExtra.push('esp.Especialidad AS EspecialidadNombre');
      }

      const sql = `
        SELECT a.*${selectExtra.length ? ', ' + selectExtra.join(', ') : ''}
        FROM \`${tAgenda}\` a
        ${joins.join('\n')}
        WHERE a.Id = ? LIMIT 1
      `;
      const rows = await this.query(sql, [id]);
      const item = rows?.[0] || null;
      if (item) {
        if (item.CargoNombre && !item.Cargo) item.Cargo = item.CargoNombre;
        if (item.EspecialidadNombre && !item.Especialidad) item.Especialidad = item.EspecialidadNombre;
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

      const allowed = new Set([
        'Nombre', 'Apellidos', 'Cargo', 'Especialidad', 'Id_TipoCargoRol', 'Id_Especialidad',
        'Empresa', 'Email', 'Movil', 'Telefono', 'Extension', 'Notas', 'Activo'
      ]);

      const data = {};
      for (const [k, v] of Object.entries(payload || {})) {
        if (!allowed.has(k)) continue;
        data[k] = (v === undefined ? null : v);
      }

      if (data.Cargo) data.Cargo = this._normalizeAgendaCatalogLabel(data.Cargo) || data.Cargo;
      if (data.Especialidad) data.Especialidad = this._normalizeAgendaCatalogLabel(data.Especialidad) || data.Especialidad;

      if (!data.Nombre || String(data.Nombre).trim() === '') {
        throw new Error('El campo Nombre es obligatorio');
      }

      const tAgenda = await this._resolveAgendaTableName();
      const cols = await this._getColumns(tAgenda).catch(() => []);
      const colsLower = new Set((cols || []).map(c => String(c || '').toLowerCase()));
      for (const k of Object.keys(data)) {
        if (!colsLower.has(String(k).toLowerCase())) delete data[k];
      }

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

      const allowed = new Set([
        'Nombre', 'Apellidos', 'Cargo', 'Especialidad', 'Id_TipoCargoRol', 'Id_Especialidad',
        'Empresa', 'Email', 'Movil', 'Telefono', 'Extension', 'Notas', 'Activo'
      ]);

      const tAgenda = await this._resolveAgendaTableName();
      const cols = await this._getColumns(tAgenda).catch(() => []);
      const colsLower = new Set((cols || []).map(c => String(c || '').toLowerCase()));

      const fields = [];
      const values = [];
      for (const [k, v] of Object.entries(payload || {})) {
        if (!allowed.has(k)) continue;
        if (!colsLower.has(String(k).toLowerCase())) continue;
        fields.push(`\`${k}\` = ?`);
        if (k === 'Cargo' && v) values.push(this._normalizeAgendaCatalogLabel(v) || v);
        else if (k === 'Especialidad' && v) values.push(this._normalizeAgendaCatalogLabel(v) || v);
        else values.push(v === undefined ? null : v);
      }

      if (!fields.length) return { affectedRows: 0 };

      values.push(id);
      const sql = `UPDATE \`${tAgenda}\` SET ${fields.join(', ')} WHERE Id = ?`;
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
      let sql = `
        SELECT
          cc.Id AS Id_Relacion,
          cc.Id_Cliente,
          cc.Id_Contacto,
          COALESCE(NULLIF(TRIM(cc.Rol), ''), NULLIF(TRIM(c.Cargo), '')) AS Rol,
          cc.Rol AS RolRelacion,
          cc.Es_Principal,
          cc.Notas AS NotasRelacion,
          cc.VigenteDesde,
          cc.VigenteHasta,
          cc.MotivoBaja,
          c.*
        FROM \`${tClientesContactos}\` cc
        INNER JOIN \`${tAgenda}\` c ON c.Id = cc.Id_Contacto
        WHERE cc.Id_Cliente = ?
      `;

      if (!includeHistorico) sql += ' AND cc.VigenteHasta IS NULL';

      sql += ' ORDER BY (cc.VigenteHasta IS NULL) DESC, cc.Es_Principal DESC, c.Apellidos ASC, c.Nombre ASC, cc.Id DESC';

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

      let sql = `
        SELECT
          cc.Id AS Id_Relacion,
          cc.Id_Cliente,
          cc.Id_Contacto,
          COALESCE(NULLIF(TRIM(cc.Rol), ''), NULLIF(TRIM(a.Cargo), '')) AS Rol,
          cc.Rol AS RolRelacion,
          cc.Es_Principal,
          cc.Notas AS NotasRelacion,
          cc.VigenteDesde,
          cc.VigenteHasta,
          cc.MotivoBaja,
          c.*,
          a.Cargo AS ContactoCargo
        FROM \`${tClientesContactos}\` cc
        INNER JOIN \`${tClientes}\` c ON c.\`${pk}\` = cc.Id_Cliente
        INNER JOIN \`${tAgenda}\` a ON a.Id = cc.Id_Contacto
        WHERE cc.Id_Contacto = ?
      `;

      if (!includeHistorico) sql += ' AND cc.VigenteHasta IS NULL';

      sql += ` ORDER BY (cc.VigenteHasta IS NULL) DESC, cc.Es_Principal DESC, c.\`${pk}\` ASC, cc.Id DESC`;
      const rows = await this.query(sql, params);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('❌ Error obteniendo clientes por contacto:', error.message);
      throw error;
    }
  }
};
