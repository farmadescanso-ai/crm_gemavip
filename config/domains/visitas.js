/**
 * Dominio: Visitas
 * Consultas y lógica específica de visitas.
 * Se invoca con db como contexto (this) para acceder a query, _ensureVisitasMeta, etc.
 */
'use strict';

module.exports = {
  async getVisitas(comercialId = null) {
    try {
      let sql = 'SELECT * FROM visitas';
      const params = [];

      if (comercialId) {
        sql += ' WHERE Id_Cial = ? OR id_cial = ? OR ComercialId = ? OR comercialId = ? OR Comercial_id = ? OR comercial_id = ?';
        params.push(comercialId, comercialId, comercialId, comercialId, comercialId, comercialId);
      }

      sql += ' ORDER BY Id DESC';

      const rows = await this.query(sql, params);
      console.log(`✅ Obtenidas ${rows.length} visitas${comercialId ? ` (filtrado por comercial ${comercialId})` : ''}`);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo visitas:', error.message);
      return [];
    }
  },

  async getVisitasPaged(filters = {}, options = {}) {
    const meta = await this._ensureVisitasMeta();
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.min(500, Number(options.limit))) : 200;
    const offset = Number.isFinite(Number(options.offset)) ? Math.max(0, Number(options.offset)) : 0;

    const where = [];
    const params = [];

    const comercialId = filters.comercialId ? Number(filters.comercialId) : null;
    const clienteId = filters.clienteId ? Number(filters.clienteId) : null;
    const from = filters.from ? String(filters.from).slice(0, 10) : null;
    const to = filters.to ? String(filters.to).slice(0, 10) : null;

    if (comercialId && meta.colComercial) {
      where.push(`v.\`${meta.colComercial}\` = ?`);
      params.push(comercialId);
    }
    if (clienteId && meta.colCliente) {
      where.push(`v.\`${meta.colCliente}\` = ?`);
      params.push(clienteId);
    }
    if (meta.colFecha && (from || to)) {
      if (from && to) {
        where.push(`DATE(v.\`${meta.colFecha}\`) BETWEEN ? AND ?`);
        params.push(from, to);
      } else if (from) {
        where.push(`DATE(v.\`${meta.colFecha}\`) >= ?`);
        params.push(from);
      } else if (to) {
        where.push(`DATE(v.\`${meta.colFecha}\`) <= ?`);
        params.push(to);
      }
    }

    let sql = `SELECT v.* FROM \`${meta.table}\` v`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ` ORDER BY ${meta.colFecha ? `v.\`${meta.colFecha}\`` : `v.\`${meta.pk}\``} DESC, v.\`${meta.pk}\` DESC`;
    sql += ` LIMIT ${limit} OFFSET ${offset}`;
    return await this.query(sql, params);
  },

  async countVisitas(filters = {}) {
    try {
      const meta = await this._ensureVisitasMeta();
      const where = [];
      const params = [];

      const comercialId = filters.comercialId ? Number(filters.comercialId) : null;
      const clienteId = filters.clienteId ? Number(filters.clienteId) : null;
      const from = filters.from ? String(filters.from).slice(0, 10) : null;
      const to = filters.to ? String(filters.to).slice(0, 10) : null;

      if (comercialId && meta.colComercial) {
        where.push(`v.\`${meta.colComercial}\` = ?`);
        params.push(comercialId);
      }
      if (clienteId && meta.colCliente) {
        where.push(`v.\`${meta.colCliente}\` = ?`);
        params.push(clienteId);
      }
      if (meta.colFecha && (from || to)) {
        if (from && to) {
          where.push(`DATE(v.\`${meta.colFecha}\`) BETWEEN ? AND ?`);
          params.push(from, to);
        } else if (from) {
          where.push(`DATE(v.\`${meta.colFecha}\`) >= ?`);
          params.push(from);
        } else if (to) {
          where.push(`DATE(v.\`${meta.colFecha}\`) <= ?`);
          params.push(to);
        }
      }

      let sql = `SELECT COUNT(*) as total FROM \`${meta.table}\` v`;
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      const rows = await this.query(sql, params);
      return rows?.[0]?.total ? Number(rows[0].total) : 0;
    } catch (_) {
      return 0;
    }
  },

  async getVisitasByComercial(comercialId) {
    try {
      const meta = await this._ensureVisitasMeta();
      if (meta.colComercial) {
        return await this.query(
          `SELECT * FROM \`${meta.table}\` WHERE \`${meta.colComercial}\` = ? ORDER BY \`${meta.pk}\` DESC`,
          [comercialId]
        );
      }
      const sql = 'SELECT * FROM visitas WHERE Id_Cial = ? OR id_cial = ? OR ComercialId = ? OR comercialId = ? OR Comercial_id = ? OR comercial_id = ? ORDER BY Id DESC';
      return await this.query(sql, [comercialId, comercialId, comercialId, comercialId, comercialId, comercialId]);
    } catch (error) {
      console.error('❌ Error obteniendo visitas por comercial:', error.message);
      return [];
    }
  },

  async getVisitasByCliente(clienteId) {
    try {
      const meta = await this._ensureVisitasMeta();
      if (meta.colCliente) {
        return await this.query(
          `SELECT * FROM \`${meta.table}\` WHERE \`${meta.colCliente}\` = ? ORDER BY \`${meta.pk}\` DESC`,
          [clienteId]
        );
      }
      const sql = 'SELECT * FROM visitas WHERE ClienteId = ? OR clienteId = ? OR FarmaciaClienteId = ? OR farmaciaClienteId = ? ORDER BY Id DESC';
      return await this.query(sql, [clienteId, clienteId, clienteId, clienteId]);
    } catch (error) {
      console.error('❌ Error obteniendo visitas por cliente:', error.message);
      return [];
    }
  },

  async getVisitaById(id) {
    try {
      const meta = await this._ensureVisitasMeta();
      const t = meta?.table ? `\`${meta.table}\`` : '`visitas`';
      const pk = meta?.pk || 'Id';
      const rows = await this.query(`SELECT * FROM ${t} WHERE \`${pk}\` = ? LIMIT 1`, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo visita por ID:', error.message);
      return null;
    }
  },

  async createVisita(visitaData) {
    try {
      const meta = await this._ensureVisitasMeta();
      const t = meta?.table ? `\`${meta.table}\`` : '`visitas`';
      const fields = Object.keys(visitaData).map(key => `\`${key}\``).join(', ');
      const placeholders = Object.keys(visitaData).map(() => '?').join(', ');
      const values = Object.values(visitaData);

      const sql = `INSERT INTO ${t} (${fields}) VALUES (${placeholders})`;
      const result = await this.query(sql, values);
      return { insertId: result?.insertId || null };
    } catch (error) {
      console.error('❌ Error creando visita:', error.message);
      throw error;
    }
  },

  async updateVisita(visitaId, visitaData) {
    try {
      const meta = await this._ensureVisitasMeta();
      const t = meta?.table ? `\`${meta.table}\`` : '`visitas`';
      const pk = meta?.pk || 'Id';
      const fields = [];
      const values = [];

      for (const [key, value] of Object.entries(visitaData)) {
        fields.push(`\`${key}\` = ?`);
        values.push(value);
      }

      values.push(visitaId);
      const sql = `UPDATE ${t} SET ${fields.join(', ')} WHERE \`${pk}\` = ?`;
      const result = await this.query(sql, values);
      const affectedRows = result?.affectedRows ?? 0;
      return { affectedRows };
    } catch (error) {
      console.error('❌ Error actualizando visita:', error.message);
      throw error;
    }
  },

  async deleteVisita(id) {
    try {
      const meta = await this._ensureVisitasMeta();
      const t = meta?.table ? `\`${meta.table}\`` : '`visitas`';
      const pk = meta?.pk || 'Id';
      const sql = `DELETE FROM ${t} WHERE \`${pk}\` = ?`;
      const result = await this.query(sql, [id]);
      return { affectedRows: result?.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error eliminando visita:', error.message);
      throw error;
    }
  }
};
