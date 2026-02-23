/**
 * Módulo notificaciones para MySQLCRM.
 * Métodos de soporte usados por el dominio notificaciones.
 */
'use strict';

module.exports = {
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
