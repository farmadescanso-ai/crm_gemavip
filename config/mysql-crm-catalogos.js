/**
 * Módulo catálogos para MySQLCRM.
 * Métodos de soporte que deben estar en el prototipo (usados por ensureFormaPagoTransfer, etc.).
 */
'use strict';

module.exports = {
  async _getFormasPagoTableName() {
    this._cache = this._cache || {};
    if (this._cache.formasPagoTableName !== undefined) return this._cache.formasPagoTableName;
    try {
      const rows = await this.query(
        `SELECT table_name AS name
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND LOWER(table_name) = 'formas_pago'
         ORDER BY (table_name = 'formas_pago') DESC, table_name ASC
         LIMIT 1`
      );
      const name = rows?.[0]?.name || null;
      this._cache.formasPagoTableName = name;
      return name;
    } catch (_) {
      this._cache.formasPagoTableName = null;
      return null;
    }
  }
};
