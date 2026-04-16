/**
 * Web Push / suscripciones para MySQLCRM.
 */
'use strict';

module.exports = {
  async ensurePushSubscriptionsTable() {
    try {
      await this.query(`
      CREATE TABLE IF NOT EXISTS \`push_subscriptions\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`user_id\` INT NOT NULL,
        \`subscription\` JSON NOT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_push_user\` (\`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
      return true;
    } catch (e) {
      console.warn('⚠️ [PUSH] No se pudo crear tabla push_subscriptions:', e?.message || e);
      return false;
    }
  },

  async savePushSubscription(userId, subscription) {
    await this.ensurePushSubscriptionsTable();
    const sub = typeof subscription === 'string' ? subscription : JSON.stringify(subscription);
    const uid = Number(userId);
    if (!Number.isFinite(uid) || !sub) return null;
    try {
      await this.query('INSERT INTO `push_subscriptions` (user_id, subscription) VALUES (?, ?)', [uid, sub]);
      return true;
    } catch (_) {
      return false;
    }
  },

  async getAdminPushSubscriptions() {
    await this.ensurePushSubscriptionsTable();
    try {
      const tCom = await this._resolveTableNameCaseInsensitive('comerciales');
      const cols = await this._getColumns(tCom).catch(() => []);
      const pick = (cands) => this._pickCIFromColumns(cols, cands);
      const colRoll = pick(['com_roll', 'Roll', 'roll', 'Rol', 'rol']) || 'Roll';
      const colPk = pick(['com_id', 'Id', 'id']) || 'com_id';
      const rows = await this.query(
        `SELECT ps.id, ps.user_id, ps.subscription
       FROM \`push_subscriptions\` ps
       INNER JOIN \`${tCom}\` c ON c.\`${colPk}\` = ps.user_id
       WHERE LOWER(IFNULL(c.\`${colRoll}\`,'')) LIKE '%admin%'`
      );
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      return [];
    }
  }
};
