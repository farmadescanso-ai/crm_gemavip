/**
 * Módulo notificaciones para MySQLCRM.
 * Métodos de soporte usados por el dominio notificaciones.
 */
'use strict';

module.exports = {
  async _ensureNotificacionesTable() {
    try {
      await this.query(`
        CREATE TABLE IF NOT EXISTS \`notificaciones\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`tipo\` VARCHAR(64) NOT NULL DEFAULT 'asignacion_contacto',
          \`id_contacto\` INT NOT NULL,
          \`id_pedido\` INT NULL,
          \`id_comercial_solicitante\` INT NOT NULL,
          \`estado\` ENUM('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'pendiente',
          \`id_admin_resolvio\` INT NULL,
          \`fecha_creacion\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`fecha_resolucion\` DATETIME NULL,
          \`notas\` VARCHAR(500) NULL,
          PRIMARY KEY (\`id\`),
          KEY \`idx_notif_estado\` (\`estado\`),
          KEY \`idx_notif_contacto\` (\`id_contacto\`),
          KEY \`idx_notif_pedido\` (\`id_pedido\`),
          KEY \`idx_notif_comercial\` (\`id_comercial_solicitante\`),
          KEY \`idx_notif_tipo_estado\` (\`tipo\`, \`estado\`, \`fecha_creacion\`),
          KEY \`idx_notif_fecha_creacion\` (\`fecha_creacion\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      try {
        const cols = await this._getColumns('notificaciones').catch(() => []);
        const colsLower = new Set((cols || []).map((c) => String(c).toLowerCase()));
        if (!colsLower.has('id_pedido')) {
          try { await this.query('ALTER TABLE `notificaciones` ADD COLUMN `id_pedido` INT NULL'); } catch (_) {}
        }
        try { await this.query('ALTER TABLE `notificaciones` ADD KEY `idx_notif_pedido` (`id_pedido`)'); } catch (_) {}
        try { await this.query('ALTER TABLE `notificaciones` ADD KEY `idx_notif_tipo_estado` (`tipo`, `estado`, `fecha_creacion`)'); } catch (_) {}
      } catch (_) {}
      return true;
    } catch (e) {
      console.warn('⚠️ [NOTIF] No se pudo crear tabla notificaciones:', e?.message);
      return false;
    }
  },

  async _getPedidosNumsByIds(ids) {
    const map = {};
    if (!ids || ids.length === 0) return map;
    const uniq = [...new Set(ids.filter((id) => id != null && id !== ''))]
      .map((x) => Number.parseInt(String(x).trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (uniq.length === 0) return map;
    try {
      const meta = await this._ensurePedidosMeta().catch(() => null);
      if (!meta?.tPedidos) return map;
      const cols = await this._getColumns(meta.tPedidos).catch(() => []);
      const pick = (cands) => this._pickCIFromColumns(cols, cands);
      const pk = meta.pk || pick(['Id', 'id']) || 'Id';
      const colNum = meta.colNumPedido || pick(['NumPedido', 'NumeroPedido', 'Numero_Pedido', 'num_pedido']);
      if (!colNum) return map;
      const placeholders = uniq.map(() => '?').join(',');
      const sql = `SELECT \`${pk}\` AS id, \`${colNum}\` AS num FROM \`${meta.tPedidos}\` WHERE \`${pk}\` IN (${placeholders})`;
      const rows = await this.query(sql, uniq);
      const list = Array.isArray(rows) ? rows : [];
      list.forEach((r) => {
        const id = Number(r.id ?? r.Id);
        const num = r.num ?? r.NumPedido ?? r.NumeroPedido ?? null;
        if (Number.isFinite(id)) map[id] = (num != null ? String(num).trim() : null);
      });
    } catch (e) {
      console.warn('⚠️ [NOTIF] No se pudieron cargar nº de pedido:', e?.message);
    }
    return map;
  }
};
