/**
 * Dominio: Artículos
 * Consultas y lógica específica de artículos.
 * Se invoca con db como contexto (this) para acceder a query, _getColumns, etc.
 */
'use strict';

module.exports = {
  async getArticulos(options = {}) {
    try {
      const marcaIdRaw = options && typeof options === 'object' ? options.marcaId : null;
      const marcaId = Number(marcaIdRaw);
      const hasMarcaId = Number.isFinite(marcaId) && marcaId > 0;
      const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.min(500, Number(options.limit))) : null;
      const offset = Number.isFinite(Number(options.offset)) ? Math.max(0, Number(options.offset)) : 0;

      let rows = [];
      try {
        const tArt = await this._resolveTableNameCaseInsensitive('articulos');
        const aCols = await this._getColumns(tArt).catch(() => []);
        const aPk = this._pickCIFromColumns(aCols, ['art_id', 'id', 'Id']) || 'art_id';
        const aMarcaId = this._pickCIFromColumns(aCols, ['art_mar_id', 'Id_Marca', 'id_marca', 'MarcaId', 'marcaId']) || 'art_mar_id';

        const tMarcas = await this._resolveTableNameCaseInsensitive('marcas').catch(() => null);
        if (!tMarcas) throw new Error('Sin tabla marcas');

        const mCols = await this._getColumns(tMarcas).catch(() => []);
        const mColsLower = new Set((mCols || []).map((c) => String(c).toLowerCase()));
        const pick = (cands) => (cands || []).find((c) => mColsLower.has(String(c).toLowerCase())) || null;
        const mPk = pick(['mar_id', 'id', 'Id']) || 'mar_id';
        const mNombre =
          pick(['mar_nombre', 'Nombre', 'nombre', 'Marca', 'marca', 'Descripcion', 'descripcion', 'NombreMarca', 'nombre_marca']) || null;

        const selectMarcaNombre = mNombre
          ? `m.\`${mNombre}\` AS MarcaNombre`
          : `CAST(m.\`${mPk}\` AS CHAR) AS MarcaNombre`;

        const limitClause = limit ? ` LIMIT ${limit} OFFSET ${offset}` : '';
        const sql = `
          SELECT a.*, ${selectMarcaNombre}
          FROM \`${tArt}\` a
          LEFT JOIN \`${tMarcas}\` m ON m.\`${mPk}\` = a.\`${aMarcaId}\`
          ${hasMarcaId ? `WHERE a.\`${aMarcaId}\` = ?` : ''}
          ORDER BY a.\`${aPk}\` ASC
          ${limitClause}
        `;
        rows = hasMarcaId ? await this.query(sql, [marcaId]) : await this.query(sql);
      } catch (innerErr) {
        const tArt = await this._resolveTableNameCaseInsensitive('articulos');
        const aCols = await this._getColumns(tArt).catch(() => []);
        const aPk = this._pickCIFromColumns(aCols, ['art_id', 'id', 'Id']) || 'art_id';
        const aMarcaId = this._pickCIFromColumns(aCols, ['art_mar_id', 'Id_Marca', 'id_marca', 'MarcaId', 'marcaId']) || 'art_mar_id';
        const limitClause = limit ? ` LIMIT ${limit} OFFSET ${offset}` : '';
        const sql = hasMarcaId
          ? `SELECT * FROM \`${tArt}\` WHERE \`${aMarcaId}\` = ? ORDER BY \`${aPk}\` ASC${limitClause}`
          : `SELECT * FROM \`${tArt}\` ORDER BY \`${aPk}\` ASC${limitClause}`;
        rows = hasMarcaId ? await this.query(sql, [marcaId]) : await this.query(sql);
      }
      console.log(`✅ Obtenidos ${rows.length} artículos`);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo artículos:', error.message);
      throw error;
    }
  },

  async countArticulos(options = {}) {
    try {
      const marcaIdRaw = options && typeof options === 'object' ? options.marcaId : null;
      const marcaId = Number(marcaIdRaw);
      const hasMarcaId = Number.isFinite(marcaId) && marcaId > 0;

      const tArt = await this._resolveTableNameCaseInsensitive('articulos');
      const aCols = await this._getColumns(tArt).catch(() => []);
      const aMarcaId = this._pickCIFromColumns(aCols, ['art_mar_id', 'Id_Marca', 'id_marca', 'MarcaId', 'marcaId']) || 'art_mar_id';

      const sql = hasMarcaId
        ? `SELECT COUNT(*) AS total FROM \`${tArt}\` WHERE \`${aMarcaId}\` = ?`
        : `SELECT COUNT(*) AS total FROM \`${tArt}\``;
      const params = hasMarcaId ? [marcaId] : [];
      const rows = await this.query(sql, params);
      return Number(rows?.[0]?.total ?? 0);
    } catch (error) {
      console.error('❌ Error contando artículos:', error.message);
      return 0;
    }
  },

  async getArticuloById(id) {
    try {
      let rows = [];
      try {
        const tArt = await this._resolveTableNameCaseInsensitive('articulos');
        const aCols = await this._getColumns(tArt).catch(() => []);
        const aPk = this._pickCIFromColumns(aCols, ['art_id', 'id', 'Id']) || 'art_id';
        const aMarcaId = this._pickCIFromColumns(aCols, ['art_mar_id', 'Id_Marca', 'id_marca', 'MarcaId', 'marcaId']) || 'art_mar_id';

        const tMarcas = await this._resolveTableNameCaseInsensitive('marcas').catch(() => null);
        if (!tMarcas) throw new Error('Sin tabla marcas');

        const mCols = await this._getColumns(tMarcas).catch(() => []);
        const mColsLower = new Set((mCols || []).map((c) => String(c).toLowerCase()));
        const pick = (cands) => (cands || []).find((c) => mColsLower.has(String(c).toLowerCase())) || null;
        const mPk = pick(['mar_id', 'id', 'Id']) || 'mar_id';
        const mNombre =
          pick(['mar_nombre', 'Nombre', 'nombre', 'Marca', 'marca', 'Descripcion', 'descripcion', 'NombreMarca', 'nombre_marca']) || null;

        const selectMarcaNombre = mNombre
          ? `m.\`${mNombre}\` AS MarcaNombre`
          : `CAST(m.\`${mPk}\` AS CHAR) AS MarcaNombre`;

        const sql = `
          SELECT a.*, ${selectMarcaNombre}
          FROM \`${tArt}\` a
          LEFT JOIN \`${tMarcas}\` m ON m.\`${mPk}\` = a.\`${aMarcaId}\`
          WHERE a.\`${aPk}\` = ?
          LIMIT 1
        `;
        rows = await this.query(sql, [id]);
      } catch (_) {
        const tArt = await this._resolveTableNameCaseInsensitive('articulos');
        const aCols = await this._getColumns(tArt).catch(() => []);
        const aPk = this._pickCIFromColumns(aCols, ['art_id', 'id', 'Id']) || 'art_id';
        const sql = `SELECT * FROM \`${tArt}\` WHERE \`${aPk}\` = ? LIMIT 1`;
        rows = await this.query(sql, [id]);
      }
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo artículo por ID:', error.message);
      return null;
    }
  },

  async getArticulosByCategoria(categoria) {
    try {
      const sql = 'SELECT * FROM articulos WHERE Categoria = ? OR categoria = ? OR Categoria_Farmaceutica = ? OR categoria_farmaceutica = ? ORDER BY Id ASC';
      const rows = await this.query(sql, [categoria, categoria, categoria, categoria]);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo artículos por categoría:', error.message);
      return [];
    }
  },

  async updateArticulo(id, payload) {
    try {
      const tArt = await this._resolveTableNameCaseInsensitive('articulos');
      const aCols = await this._getColumns(tArt).catch(() => []);
      const pick = (cands) => this._pickCIFromColumns(aCols, cands);
      const colMap = {
        Nombre: pick(['art_nombre', 'Nombre', 'nombre']),
        SKU: pick(['art_sku', 'SKU', 'sku']),
        Presentacion: pick(['art_presentacion', 'Presentacion', 'presentacion']),
        PVL: pick(['art_pvl', 'PVL', 'pvl']),
        PCP: pick(['art_pcp', 'PCP', 'pcp']),
        Unidades_Caja: pick(['art_unidades_caja', 'Unidades_Caja', 'unidades_caja']),
        Imagen: pick(['art_imagen', 'Imagen', 'imagen']),
        Marca: pick(['art_marca', 'Marca', 'marca']),
        EAN13: pick(['art_ean13', 'EAN13', 'ean13']),
        Activo: pick(['art_activo', 'Activo', 'activo']),
        IVA: pick(['art_iva', 'IVA', 'iva']),
        Id_Marca: pick(['art_mar_id', 'Id_Marca', 'id_marca', 'MarcaId', 'marcaId'])
      };
      const columnasValidas = Object.keys(colMap);
      const payloadFiltrado = {};
      for (const [key, value] of Object.entries(payload)) {
        if (columnasValidas.includes(key) && colMap[key]) {
          payloadFiltrado[colMap[key]] = value;
        } else if (columnasValidas.includes(key)) {
          console.warn(`⚠️ [UPDATE ARTICULO] Columna '${key}' no encontrada en BD`);
        } else {
          console.warn(`⚠️ [UPDATE ARTICULO] Ignorando columna inválida: '${key}'`);
        }
      }

      if (Object.keys(payloadFiltrado).length === 0) {
        throw new Error('No hay columnas válidas para actualizar');
      }

      const fields = [];
      const values = [];

      for (const [key, value] of Object.entries(payloadFiltrado)) {
        fields.push(`\`${key}\` = ?`);
        values.push(value);
      }

      values.push(id);
      const aPk = pick(['art_id', 'id', 'Id']) || 'art_id';
      const sql = `UPDATE \`${tArt}\` SET ${fields.join(', ')} WHERE \`${aPk}\` = ?`;

      const result = await this.query(sql, values);

      if (result && typeof result === 'object' && !Array.isArray(result)) {
        return { affectedRows: result.affectedRows || 1, changedRows: result.changedRows || 0 };
      }

      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando artículo:', error.message);
      throw error;
    }
  },

  async createArticulo(payload) {
    try {
      const tArt = await this._resolveTableNameCaseInsensitive('articulos');
      const aCols = await this._getColumns(tArt).catch(() => []);
      const pick = (cands) => this._pickCIFromColumns(aCols, cands);
      const aPk = pick(['art_id', 'id', 'Id']) || 'art_id';
      const formToDb = {
        SKU: pick(['art_sku', 'SKU', 'sku']),
        Nombre: pick(['art_nombre', 'Nombre', 'nombre']),
        Presentacion: pick(['art_presentacion', 'Presentacion', 'presentacion']),
        Unidades_Caja: pick(['art_unidades_caja', 'Unidades_Caja', 'unidades_caja']),
        PVL: pick(['art_pvl', 'PVL', 'pvl']),
        IVA: pick(['art_iva', 'IVA', 'iva']),
        Imagen: pick(['art_imagen', 'Imagen', 'imagen']),
        Id_Marca: pick(['art_mar_id', 'Id_Marca', 'id_marca', 'MarcaId', 'marcaId']),
        EAN13: pick(['art_ean13', 'EAN13', 'ean13']),
        Activo: pick(['art_activo', 'Activo', 'activo'])
      };
      const dbPayload = {};
      for (const [formKey, dbCol] of Object.entries(formToDb)) {
        if (dbCol && payload && payload[formKey] !== undefined) dbPayload[dbCol] = payload[formKey];
      }

      if (dbPayload && typeof dbPayload === 'object' && dbPayload[aPk] === undefined) {
        const nextIdRows = await this.query(
          `
            SELECT
              CASE
                WHEN NOT EXISTS (SELECT 1 FROM \`${tArt}\`) THEN 1
                WHEN NOT EXISTS (SELECT 1 FROM \`${tArt}\` WHERE \`${aPk}\` = 1) THEN 1
                ELSE (
                  SELECT MIN(a.\`${aPk}\`) + 1
                  FROM \`${tArt}\` a
                  LEFT JOIN \`${tArt}\` b ON b.\`${aPk}\` = a.\`${aPk}\` + 1
                  WHERE b.\`${aPk}\` IS NULL
                )
              END AS next_id
          `
        ).catch(() => []);
        const nextId = Number(nextIdRows?.[0]?.next_id);
        if (Number.isFinite(nextId) && nextId > 0) {
          dbPayload[aPk] = nextId;
        }
      }

      const fields = Object.keys(dbPayload).map(key => `\`${key}\``).join(', ');
      const placeholders = Object.keys(dbPayload).map(() => '?').join(', ');
      const values = Object.values(dbPayload);

      const sql = `INSERT INTO \`${tArt}\` (${fields}) VALUES (${placeholders})`;
      const result = await this.query(sql, values);
      return { insertId: result.insertId || result.insertId };
    } catch (error) {
      console.error('❌ Error creando artículo:', error.message);
      throw error;
    }
  },

  async deleteArticulo(id) {
    try {
      const tArt = await this._resolveTableNameCaseInsensitive('articulos');
      const aCols = await this._getColumns(tArt).catch(() => []);
      const aPk = this._pickCIFromColumns(aCols, ['art_id', 'id', 'Id']) || 'art_id';
      const sql = `DELETE FROM \`${tArt}\` WHERE \`${aPk}\` = ?`;
      const result = await this.query(sql, [id]);
      return { affectedRows: result.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error eliminando artículo:', error.message);
      throw error;
    }
  }
};
