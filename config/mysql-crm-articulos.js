/**
 * Módulo de gestión de artículos para MySQL CRM.
 * toggleArticuloOkKo, copyTarifaMirafarmaToPvl.
 * Se asigna al prototipo de MySQLCRM con Object.assign.
 */
'use strict';

module.exports = {
  async toggleArticuloOkKo(id, value) {
    try {
      let activoValue = 1;
      if (typeof value === 'string') {
        const valLower = value.toLowerCase();
        activoValue = (valLower === 'activo' || valLower === 'ok' || valLower === 'true' || valLower === '1') ? 1 : 0;
      } else if (typeof value === 'boolean') {
        activoValue = value ? 1 : 0;
      } else if (typeof value === 'number') {
        activoValue = value ? 1 : 0;
      }

      const tArt = await this._resolveTableNameCaseInsensitive('articulos');
      const aCols = await this._getColumns(tArt).catch(() => []);
      const aPk = this._pickCIFromColumns(aCols, ['art_id', 'id', 'Id']) || 'art_id';
      const colActivo = this._pickCIFromColumns(aCols, ['art_activo', 'Activo', 'activo']) || 'art_activo';
      const sql = `UPDATE \`${tArt}\` SET \`${colActivo}\` = ? WHERE \`${aPk}\` = ?`;
      await this.query(sql, [activoValue, id]);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando Activo de artículo:', error.message);
      throw error;
    }
  },

  /**
   * Copia los precios de la tarifa MIRAFARMA al PVL de artículos (articulos.PVL).
   * Para cada artículo con precio en la tarifa MIRAFARMA, actualiza articulos.PVL = ese precio.
   * @returns { Promise<{ tarifaId: number, updated: number, error?: string }> }
   */
  async copyTarifaMirafarmaToPvl() {
    try {
      if (!this.connected && !this.pool) await this.connect();

      const tTar = await this._resolveTableNameCaseInsensitive('tarifasClientes').catch(() => null);
      if (!tTar) return { tarifaId: 0, updated: 0, error: 'Tabla tarifasClientes no encontrada' };

      const tarCols = await this._getColumns(tTar).catch(() => []);
      const tarPk = this._pickCIFromColumns(tarCols, ['Id', 'id']) || 'Id';
      const colNombre = this._pickCIFromColumns(tarCols, ['NombreTarifa', 'Nombre', 'nombre', 'nombre_tarifa']) || 'NombreTarifa';

      const [tarRows] = await this.pool.execute(
        `SELECT \`${tarPk}\` AS id FROM \`${tTar}\` WHERE UPPER(TRIM(\`${colNombre}\`)) = 'MIRAFARMA' LIMIT 1`
      );
      if (!tarRows || tarRows.length === 0) return { tarifaId: 0, updated: 0, error: 'Tarifa MIRAFARMA no encontrada' };
      const tarifaId = Number(tarRows[0].id);
      if (!Number.isFinite(tarifaId) || tarifaId <= 0) return { tarifaId: 0, updated: 0, error: 'Id tarifa MIRAFARMA no válido' };

      const tTP = await this._resolveTableNameCaseInsensitive('tarifasClientes_precios').catch(() => null);
      if (!tTP) return { tarifaId, updated: 0, error: 'Tabla tarifasClientes_precios no encontrada' };

      const tpCols = await this._getColumns(tTP).catch(() => []);
      const cTar = this._pickCIFromColumns(tpCols, ['Id_Tarifa', 'id_tarifa', 'TarifaId', 'tarifa_id']) || 'Id_Tarifa';
      const cArt = this._pickCIFromColumns(tpCols, ['Id_Articulo', 'id_articulo', 'ArticuloId', 'articulo_id']) || 'Id_Articulo';
      const cPrecio = this._pickCIFromColumns(tpCols, ['Precio', 'precio', 'PrecioUnitario', 'precio_unitario', 'PVL', 'pvl']) || 'Precio';

      const [precioRows] = await this.pool.execute(
        `SELECT \`${cArt}\` AS Id_Articulo, \`${cPrecio}\` AS Precio FROM \`${tTP}\` WHERE \`${cTar}\` = ?`,
        [tarifaId]
      );
      if (!precioRows || precioRows.length === 0) return { tarifaId, updated: 0, error: 'Sin precios en tarifa MIRAFARMA' };

      const tArt = await this._resolveTableNameCaseInsensitive('articulos').catch(() => null);
      if (!tArt) return { tarifaId, updated: 0, error: 'Tabla articulos no encontrada' };
      const artCols = await this._getColumns(tArt).catch(() => []);
      const artPk = this._pickCIFromColumns(artCols, ['id', 'Id']) || 'id';
      const cPVL = this._pickCIFromColumns(artCols, ['PVL', 'pvl', 'Precio', 'precio']) || 'PVL';

      let updated = 0;
      for (const r of precioRows) {
        const idArt = Number(r.Id_Articulo);
        const precio = Number(String(r.Precio ?? '').replace(',', '.'));
        if (!Number.isFinite(idArt) || idArt <= 0 || !Number.isFinite(precio)) continue;
        const [result] = await this.pool.execute(
          `UPDATE \`${tArt}\` SET \`${cPVL}\` = ? WHERE \`${artPk}\` = ?`,
          [precio, idArt]
        );
        if (result && result.affectedRows > 0) updated += result.affectedRows;
      }
      return { tarifaId, updated };
    } catch (e) {
      console.error('❌ [copyTarifaMirafarmaToPvl]', e?.message || e);
      return { tarifaId: 0, updated: 0, error: e?.message || String(e) };
    }
  }
};
