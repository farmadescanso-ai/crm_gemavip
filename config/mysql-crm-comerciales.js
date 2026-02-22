/**
 * Módulo de gestión de comerciales para MySQL CRM.
 * Metadatos, schema reuniones, estadísticas, helpers.
 * Se asigna al prototipo de MySQLCRM con Object.assign.
 */
'use strict';

module.exports = {
  async _ensureComercialesMeta() {
    if (this._metaCache?.comercialesMeta) return this._metaCache.comercialesMeta;
    const t = await this._resolveTableNameCaseInsensitive('comerciales');
    const cols = await this._getColumns(t);
    const pickCI = (cands) => this._pickCIFromColumns(cols, cands);
    const pk = pickCI(['com_id', 'id', 'Id']) || 'com_id';
    const colNombre = pickCI(['com_nombre', 'Nombre', 'nombre']) || 'com_nombre';
    const meta = { table: t, pk, colNombre };
    this._metaCache.comercialesMeta = meta;
    return meta;
  },

  async ensureComercialesReunionesNullable() {
    if (this._schemaEnsured) return;
    this._schemaEnsured = true;

    try {
      if (!this.pool) return;
      const dbName = this.config.database;
      const columnas = [
        'teams_access_token',
        'teams_refresh_token',
        'teams_email',
        'teams_token_expires_at',
        'meet_access_token',
        'meet_refresh_token',
        'meet_email',
        'meet_token_expires_at'
      ];

      const placeholders = columnas.map(() => '?').join(', ');
      const [rows] = await this.pool.query(
        `
          SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ?
            AND TABLE_NAME = 'comerciales'
            AND COLUMN_NAME IN (${placeholders})
        `,
        [dbName, ...columnas]
      );

      if (!rows || rows.length === 0) return;

      const cambios = [];
      for (const r of rows) {
        if (r && r.IS_NULLABLE === 'NO' && r.COLUMN_NAME && r.COLUMN_TYPE) {
          cambios.push(`MODIFY \`${r.COLUMN_NAME}\` ${r.COLUMN_TYPE} NULL`);
        }
      }

      if (cambios.length === 0) return;

      const sql = `ALTER TABLE \`comerciales\` ${cambios.join(', ')}`;
      await this.pool.query(sql);
      console.log(`✅ [SCHEMA] Columnas de reuniones en 'comerciales' ahora permiten NULL: ${cambios.length}`);
    } catch (error) {
      console.warn('⚠️ [SCHEMA] No se pudo asegurar NULL en campos de reuniones:', error.message);
    }
  },

  /**
   * Obtiene nombres de comerciales por lista de IDs. Devuelve Map(id -> nombre).
   */
  async _getComercialesNombresByIds(ids) {
    const map = {};
    if (!ids || ids.length === 0) return map;
    const uniq = [...new Set(ids.filter((id) => id != null && id !== ''))];
    if (uniq.length === 0) return map;
    try {
      const meta = await this._ensureComercialesMeta();
      const placeholders = uniq.map(() => '?').join(',');
      const sql = `SELECT \`${meta.pk}\` AS id, \`${meta.colNombre || 'com_nombre'}\` AS nombre FROM \`${meta.table}\` WHERE \`${meta.pk}\` IN (${placeholders})`;
      const rows = await this.query(sql, uniq);
      const list = Array.isArray(rows) ? rows : [];
      list.forEach((r) => {
        const id = r.id ?? r.Id;
        const nombre = r.nombre ?? r.Nombre ?? '';
        if (id != null) map[Number(id)] = nombre;
      });
    } catch (e) {
      console.warn('⚠️ [NOTIF] No se pudieron cargar nombres de comerciales:', e?.message);
    }
    return map;
  },

  async getEstadisticasComercial(comercialId) {
    try {
      const stats = {
        totalClientes: 0,
        totalPedidos: 0,
        totalVisitas: 0,
        pedidosActivos: 0
      };

      const [clientes] = await this.pool.execute('SELECT COUNT(*) as count FROM clientes WHERE ComercialId = ? OR comercialId = ?', [comercialId, comercialId]);
      stats.totalClientes = clientes[0]?.count || 0;

      const [pedidos] = await this.pool.execute('SELECT COUNT(*) as count FROM pedidos WHERE ComercialId = ? OR comercialId = ?', [comercialId, comercialId]);
      stats.totalPedidos = pedidos[0]?.count || 0;

      const [visitas] = await this.pool.execute('SELECT COUNT(*) as count FROM visitas WHERE ComercialId = ? OR comercialId = ?', [comercialId, comercialId]);
      stats.totalVisitas = visitas[0]?.count || 0;

      const [activos] = await this.pool.execute('SELECT COUNT(*) as count FROM pedidos WHERE (ComercialId = ? OR comercialId = ?) AND Activo = 1', [comercialId, comercialId]);
      stats.pedidosActivos = activos[0]?.count || 0;

      return stats;
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas:', error.message);
      return {
        totalClientes: 0,
        totalPedidos: 0,
        totalVisitas: 0,
        pedidosActivos: 0
      };
    }
  }
};
