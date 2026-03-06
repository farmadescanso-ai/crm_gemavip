/**
 * Dominio: Catálogos
 * Provincias, países, formas de pago, tipos de pedido, especialidades.
 * Se invoca con db como contexto (this) para acceder a query, _getColumns, etc.
 */
'use strict';

module.exports = {
  async getFormasPago() {
    try {
      const table = await this._getFormasPagoTableName();
      if (!table) {
        console.warn('⚠️ [FORMAS-PAGO] La tabla de formas de pago no existe (formas_pago/Formas_Pago).');
        return [];
      }
      const cols = await this._getColumns(table).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['formp_id', 'id', 'Id']) || 'id';
      const colNombre = this._pickCIFromColumns(cols, ['formp_nombre', 'FormaPago', 'Nombre', 'nombre']) || 'FormaPago';
      const rows = await this.query(`SELECT * FROM \`${table}\` ORDER BY \`${pk}\` ASC`);
      return (rows || []).map(r => ({
        ...r,
        id: r?.[pk] ?? r?.id ?? r?.Id ?? r?.ID ?? null,
        Id: r?.[pk] ?? r?.id ?? r?.Id ?? null,
        Nombre: r?.[colNombre] ?? r?.Nombre ?? r?.FormaPago ?? r?.formaPago ?? r?.nombre ?? null
      }));
    } catch (error) {
      console.error('❌ Error obteniendo formas de pago:', error.message);
      return [];
    }
  },

  async getFormaPagoById(id) {
    try {
      const table = await this._getFormasPagoTableName();
      if (!table) return null;
      const cols = await this._getColumns(table).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['formp_id', 'id', 'Id']) || 'id';
      const rows = await this.query(`SELECT * FROM \`${table}\` WHERE \`${pk}\` = ? LIMIT 1`, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo forma de pago por ID:', error.message);
      return null;
    }
  },

  async getFormaPagoByNombre(nombre) {
    try {
      const table = await this._getFormasPagoTableName();
      if (!table) return null;
      const cols = await this._getColumns(table).catch(() => []);
      const colNombre = this._pickCIFromColumns(cols, ['formp_nombre', 'FormaPago', 'Nombre', 'nombre']) || 'formp_nombre';
      const sql = `SELECT * FROM \`${table}\` WHERE \`${colNombre}\` = ? OR \`${colNombre}\` LIKE ? LIMIT 1`;
      const nombreExacto = nombre.trim();
      const nombreLike = `%${nombreExacto}%`;
      const rows = await this.query(sql, [nombreExacto, nombreLike]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo forma de pago por nombre:', error.message);
      return null;
    }
  },

  async createFormaPago(payload) {
    try {
      const table = await this._getFormasPagoTableName();
      if (!table) throw new Error('La tabla de formas de pago no existe (formas_pago/Formas_Pago).');
      const keys = this._filterPayloadKeys(payload);
      const fields = keys.map(key => `\`${key}\``).join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map(key => payload[key]);
      const sql = `INSERT INTO ${table} (${fields}) VALUES (${placeholders})`;
      const result = await this.query(sql, values);
      return { insertId: result.insertId || result.insertId };
    } catch (error) {
      console.error('❌ Error creando forma de pago:', error.message);
      throw error;
    }
  },

  async updateFormaPago(id, payload) {
    try {
      const table = await this._getFormasPagoTableName();
      if (!table) throw new Error('La tabla de formas de pago no existe (formas_pago/Formas_Pago).');
      const cols = await this._getColumns(table).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['formp_id', 'id', 'Id']) || 'id';
      const keys = this._filterPayloadKeys(payload);
      const fields = keys.map(key => `\`${key}\` = ?`).join(', ');
      const values = [...keys.map(key => payload[key]), id];
      const sql = `UPDATE ${table} SET ${fields} WHERE \`${pk}\` = ?`;
      await this.query(sql, values);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando forma de pago:', error.message);
      throw error;
    }
  },

  async deleteFormaPago(id) {
    try {
      const table = await this._getFormasPagoTableName();
      if (!table) throw new Error('La tabla de formas de pago no existe (formas_pago/Formas_Pago).');
      const cols = await this._getColumns(table).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['formp_id', 'id', 'Id']) || 'id';
      await this.query(`DELETE FROM ${table} WHERE \`${pk}\` = ?`, [id]);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error eliminando forma de pago:', error.message);
      throw error;
    }
  },

  async getTiposPedido() {
    try {
      const table = await this._resolveTableNameCaseInsensitive('tipos_pedidos').catch(() => null)
        || await this._resolveTableNameCaseInsensitive('tipos_pedido').catch(() => null);
      if (!table) return [];
      const cols = await this._getColumns(table).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['tipp_id', 'id', 'Id']) || 'id';
      const colNombre = this._pickCIFromColumns(cols, ['tipp_tipo', 'Tipo', 'tipo', 'Nombre', 'nombre']) || 'Tipo';
      let rows = [];
      try {
        rows = await this.query(`SELECT * FROM \`${table}\` ORDER BY \`${pk}\` ASC`);
      } catch (e1) {
        rows = await this.query(`SELECT * FROM \`${table}\` ORDER BY Id ASC`).catch(() => []);
      }
      return (rows || []).map((r) => ({
        ...r,
        id: r?.[pk] ?? r?.tipp_id ?? r?.id ?? r?.Id ?? r?.ID ?? null,
        Id: r?.[pk] ?? r?.tipp_id ?? r?.id ?? r?.Id ?? null,
        tipp_id: r?.[pk] ?? r?.tipp_id ?? null,
        tipp_tipo: r?.[colNombre] ?? r?.tipp_tipo ?? null,
        Nombre: r?.[colNombre] ?? r?.Tipo ?? r?.tipo ?? r?.Nombre ?? r?.nombre ?? ''
      }));
    } catch (error) {
      console.error('❌ Error obteniendo tipos de pedido:', error.message);
      return [];
    }
  },

  async getTiposClientes() {
    try {
      const t = await this._resolveTableNameCaseInsensitive('tipos_clientes').catch(() => 'tipos_clientes');
      const table = t || 'tipos_clientes';
      const rows = await this.query(`SELECT * FROM \`${table}\` ORDER BY 1 ASC`);
      const r0 = (rows || [])[0];
      const keys = r0 ? Object.keys(r0) : [];
      const pk = keys.find((k) => /tipc_id|^id$|^Id$/i.test(k)) || keys[0];
      const nom = keys.find((k) => /tipc_tipo|tipc_nombre|^Nombre$|^nombre$|^Tipo$/i.test(k)) || keys.find((k) => k !== pk) || pk;
      return (rows || []).map((r) => ({
        ...r,
        tipc_id: r[pk] ?? r.tipc_id ?? r.id ?? r.Id,
        tipc_tipo: r[nom] ?? r.tipc_tipo ?? r.tipc_nombre ?? r.Tipo ?? r.Nombre ?? '',
        id: r[pk] ?? r.tipc_id ?? r.id ?? r.Id,
        Nombre: r[nom] ?? r.tipc_tipo ?? r.tipc_nombre ?? r.Nombre ?? r.nombre ?? ''
      }));
    } catch (error) {
      console.error('❌ Error obteniendo tipos_clientes:', error.message);
      return [];
    }
  },

  async getEstadosCliente() {
    for (const tableKey of ['estdoClientes', 'estadoClientes']) {
      try {
        const t = await this._resolveTableNameCaseInsensitive(tableKey);
        const table = t || tableKey;
        const rows = await this.query(`SELECT * FROM \`${table}\` ORDER BY 1 ASC`);
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const r0 = rows[0];
        const keys = r0 ? Object.keys(r0) : [];
        const pk = keys.find((k) => /estcli_id|^id$|^Id$/i.test(k)) || keys[0];
        const nom = keys.find((k) => /estcli_nombre|^Nombre$|^nombre$|^Estado$/i.test(k)) || keys.find((k) => k !== pk) || pk;
        return rows.map((r) => {
          const val = r[nom] ?? r.estcli_nombre ?? r.Nombre ?? r.nombre ?? '';
          const pkVal = r[pk] ?? r.estcli_id ?? r.id ?? r.Id;
          return {
            ...r,
            estcli_id: pkVal,
            estcli_nombre: val,
            id: pkVal,
            Nombre: val,
            nombre: val,
            Estado: val,
            estado: val
          };
        });
      } catch (error) {
        continue;
      }
    }
    return [];
  },

  async getEspecialidades() {
    try {
      const t = await this._resolveTableNameCaseInsensitive('especialidades').catch(() => 'especialidades');
      const table = t || 'especialidades';
      const rows = await this.query(`SELECT * FROM \`${table}\` ORDER BY 1 ASC`);
      const r0 = (rows || [])[0];
      const keys = r0 ? Object.keys(r0) : [];
      const pk = keys.find((k) => /esp_id|^id$|^Id$/i.test(k)) || keys[0];
      const nom = keys.find((k) => /esp_nombre|^Nombre$|^nombre$|^Especialidad$/i.test(k)) || keys.find((k) => k !== pk) || pk;
      return (rows || []).map((r) => {
        const val = r[nom] ?? r.esp_nombre ?? r.Nombre ?? r.nombre ?? '';
        const pkVal = r[pk] ?? r.esp_id ?? r.id ?? r.Id;
        return {
          ...r,
          esp_id: pkVal,
          esp_nombre: val,
          id: pkVal,
          Nombre: val,
          nombre: val,
          Especialidad: val
        };
      });
    } catch (error) {
      console.error('❌ Error obteniendo especialidades:', error.message);
      return [];
    }
  },

  async getEspecialidadById(id) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('especialidades').catch(() => null);
      const table = t || 'especialidades';
      const cols = await this._getColumns(table).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['esp_id', 'id', 'Id']) || 'id';
      const rows = await this.query(`SELECT * FROM \`${table}\` WHERE \`${pk}\` = ? LIMIT 1`, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo especialidad por ID:', error.message);
      return null;
    }
  },

  async createEspecialidad(payload) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('especialidades').catch(() => null);
      const table = t || 'especialidades';
      const keys = this._filterPayloadKeys(payload);
      const fields = keys.map(key => `\`${key}\``).join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map(key => payload[key]);
      const sql = `INSERT INTO \`${table}\` (${fields}) VALUES (${placeholders})`;
      const result = await this.query(sql, values);
      return { insertId: result.insertId || result.insertId };
    } catch (error) {
      console.error('❌ Error creando especialidad:', error.message);
      throw error;
    }
  },

  async updateEspecialidad(id, payload) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('especialidades').catch(() => null);
      const table = t || 'especialidades';
      const cols = await this._getColumns(table).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['esp_id', 'id', 'Id']) || 'id';
      const keys = this._filterPayloadKeys(payload);
      const fields = keys.map(key => `\`${key}\` = ?`).join(', ');
      const values = [...keys.map(key => payload[key]), id];
      const sql = `UPDATE \`${table}\` SET ${fields} WHERE \`${pk}\` = ?`;
      await this.query(sql, values);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando especialidad:', error.message);
      throw error;
    }
  },

  async deleteEspecialidad(id) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('especialidades').catch(() => null);
      const table = t || 'especialidades';
      const cols = await this._getColumns(table).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['esp_id', 'id', 'Id']) || 'id';
      await this.query(`DELETE FROM \`${table}\` WHERE \`${pk}\` = ?`, [id]);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error eliminando especialidad:', error.message);
      throw error;
    }
  },

  async getProvincias(filtroPais = null) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('provincias').catch(() => null);
      if (!t) return [];
      const cols = await this._getColumns(t).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['prov_id', 'id', 'Id']) || 'id';
      const colNombre = this._pickCIFromColumns(cols, ['prov_nombre', 'Nombre_provincia', 'Nombre', 'nombre', 'Provincia']) || 'Nombre';
      const colPais = this._pickCIFromColumns(cols, ['prov_pais', 'Pais', 'pais']) || 'Pais';
      const colCodigoPais = this._pickCIFromColumns(cols, ['prov_codigo_pais', 'prov_codpais', 'CodigoPais', 'codigo_pais']);
      let sql = `SELECT * FROM \`${t}\``;
      const params = [];
      if (filtroPais && colCodigoPais) {
        sql += ` WHERE \`${colCodigoPais}\` = ?`;
        params.push(filtroPais);
      }
      sql += ` ORDER BY \`${colNombre}\` ASC`;
      const rows = await this.query(sql, params);
      try {
        const { normalizeTitleCaseES } = require('../../utils/normalize-utf8');
        return (rows || []).map(r => {
          const idVal = r[pk] ?? r.id ?? r.Id ?? r.prov_id ?? null;
          const nombreVal = r[colNombre] ?? r.Nombre ?? r.prov_nombre ?? r.nombre ?? '';
          const paisVal = r[colPais] ?? r.Pais ?? r.prov_pais ?? r.pais ?? '';
          return {
            ...r,
            id: idVal,
            Id: idVal,
            Nombre: normalizeTitleCaseES(String(nombreVal)),
            nombre: normalizeTitleCaseES(String(nombreVal)),
            Pais: normalizeTitleCaseES(String(paisVal))
          };
        });
      } catch (_) {
        return (rows || []).map(r => {
          const idVal = r[pk] ?? r.id ?? r.Id ?? r.prov_id ?? null;
          const nombreVal = r[colNombre] ?? r.Nombre ?? r.prov_nombre ?? r.nombre ?? '';
          return { ...r, id: idVal, Id: idVal, Nombre: String(nombreVal), nombre: String(nombreVal) };
        });
      }
    } catch (error) {
      console.error('❌ Error obteniendo provincias:', error.message);
      return [];
    }
  },

  async getProvinciaById(id) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('provincias').catch(() => 'provincias');
      const cols = await this._getColumns(t).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['prov_id', 'id', 'Id']) || 'prov_id';
      const sql = `SELECT * FROM \`${t}\` WHERE \`${pk}\` = ? LIMIT 1`;
      const rows = await this.query(sql, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo provincia por ID:', error.message);
      return null;
    }
  },

  async getProvinciaByCodigo(codigo) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('provincias').catch(() => 'provincias');
      const cols = await this._getColumns(t).catch(() => []);
      const colCodigo = this._pickCIFromColumns(cols, ['prov_codigo', 'Codigo', 'codigo']) || 'prov_codigo';
      const sql = `SELECT * FROM \`${t}\` WHERE \`${colCodigo}\` = ? LIMIT 1`;
      const rows = await this.query(sql, [codigo]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo provincia por código:', error.message);
      return null;
    }
  },

  async getPaises() {
    try {
      const t = await this._resolveTableNameCaseInsensitive('paises').catch(() => null);
      if (!t) return [];
      const cols = await this._getColumns(t).catch(() => []);
      const colNombre = this._pickCIFromColumns(cols, ['pais_nombre', 'Nombre_pais', 'Nombre', 'nombre', 'Pais']) || 'Nombre_pais';
      const sql = `SELECT * FROM \`${t}\` ORDER BY \`${colNombre}\` ASC`;
      const rows = await this.query(sql);
      try {
        const { normalizeTitleCaseES } = require('../../utils/normalize-utf8');
        return (rows || []).map(r => ({
          ...r,
          Nombre_pais: normalizeTitleCaseES(r.Nombre_pais || '')
        }));
      } catch (_) {
        return rows;
      }
    } catch (error) {
      console.error('❌ Error obteniendo países:', error.message);
      return [];
    }
  },

  async getPaisById(id) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('paises').catch(() => 'paises');
      const cols = await this._getColumns(t).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['pais_id', 'id', 'Id']) || 'pais_id';
      const sql = `SELECT * FROM \`${t}\` WHERE \`${pk}\` = ? LIMIT 1`;
      const rows = await this.query(sql, [id]);
      const row = rows.length > 0 ? rows[0] : null;
      if (!row) return null;
      const colNombre = this._pickCIFromColumns(cols, ['pais_nombre', 'Nombre_pais', 'Nombre', 'nombre']) || 'pais_nombre';
      const nombrePais = row[colNombre] ?? row.Nombre_pais ?? row.pais_nombre ?? '';
      try {
        const { normalizeTitleCaseES } = require('../../utils/normalize-utf8');
        return { ...row, Nombre_pais: normalizeTitleCaseES(String(nombrePais)) };
      } catch (_) {
        return { ...row, Nombre_pais: String(nombrePais) };
      }
    } catch (error) {
      console.error('❌ Error obteniendo país por ID:', error.message);
      return null;
    }
  },

  async getPaisByCodigoISO(codigoISO) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('paises').catch(() => 'paises');
      const cols = await this._getColumns(t).catch(() => []);
      const colCodigo = this._pickCIFromColumns(cols, ['pais_codigo', 'Id_pais', 'id_pais', 'codigo']) || 'pais_codigo';
      const sql = `SELECT * FROM \`${t}\` WHERE \`${colCodigo}\` = ? LIMIT 1`;
      const rows = await this.query(sql, [codigoISO]);
      const row = rows.length > 0 ? rows[0] : null;
      if (!row) return null;
      const colNombre = this._pickCIFromColumns(cols, ['pais_nombre', 'Nombre_pais', 'Nombre', 'nombre']) || 'pais_nombre';
      const nombrePais = row[colNombre] ?? row.Nombre_pais ?? row.pais_nombre ?? '';
      try {
        const { normalizeTitleCaseES } = require('../../utils/normalize-utf8');
        return { ...row, Nombre_pais: normalizeTitleCaseES(String(nombrePais)) };
      } catch (_) {
        return { ...row, Nombre_pais: String(nombrePais) };
      }
    } catch (error) {
      console.error('❌ Error obteniendo país por código ISO:', error.message);
      return null;
    }
  }
};
