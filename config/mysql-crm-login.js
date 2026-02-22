/**
 * Módulo de login y recuperación de contraseña para MySQL CRM.
 * updateComercialPassword, tokens de reset, rate limiting.
 * Se asigna al prototipo de MySQLCRM con Object.assign.
 */
'use strict';

module.exports = {
  /**
   * Actualizar solo la contraseña de un comercial (hash bcrypt).
   * @param {number} comercialId - id del comercial
   * @param {string} hashedPassword - contraseña ya hasheada con bcrypt
   */
  async updateComercialPassword(comercialId, hashedPassword) {
    try {
      if (!this.connected && !this.pool) await this.connect();
      const t = await this._resolveTableNameCaseInsensitive('comerciales');
      const cols = await this._getColumns(t);
      const colPwd = this._pickCIFromColumns(cols, ['com_password', 'Password', 'password']) || 'Password';
      const pk = this._pickCIFromColumns(cols, ['com_id', 'Id', 'id']) || 'id';
      const sql = `UPDATE \`${t}\` SET \`${colPwd}\` = ? WHERE \`${pk}\` = ?`;
      const [result] = await this.pool.execute(sql, [hashedPassword, comercialId]);
      return (result?.affectedRows ?? 0) > 0;
    } catch (e) {
      console.error('❌ Error actualizando contraseña:', e?.message);
      throw e;
    }
  },

  async _ensurePasswordResetTokensTable() {
    try {
      await this.query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id INT NOT NULL AUTO_INCREMENT,
          comercial_id INT NOT NULL,
          token VARCHAR(128) NOT NULL,
          email VARCHAR(255) NOT NULL,
          expires_at DATETIME NOT NULL,
          used TINYINT(1) NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_token (token),
          KEY idx_email_created (email, created_at),
          KEY idx_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    } catch (e) {
      console.warn('⚠️ No se pudo asegurar tabla password_reset_tokens:', e?.message);
    }
  },

  async createPasswordResetToken(comercialId, email, token, expiresInHours = 1) {
    try {
      if (!this.connected && !this.pool) await this.connect();
      await this._ensurePasswordResetTokensTable();

      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expiresInHours);

      await this.pool.execute(
        'UPDATE password_reset_tokens SET used = 1 WHERE comercial_id = ? AND used = 0',
        [comercialId]
      );

      const sql = `INSERT INTO password_reset_tokens (comercial_id, token, email, expires_at, used) 
                   VALUES (?, ?, ?, ?, 0)`;
      const [result] = await this.pool.execute(sql, [comercialId, token, email, expiresAt]);
      return { insertId: result.insertId, expiresAt };
    } catch (error) {
      console.error('❌ Error creando token de recuperación:', error.message);
      throw error;
    }
  },

  async findPasswordResetToken(token) {
    try {
      if (!this.connected && !this.pool) await this.connect();
      await this._ensurePasswordResetTokensTable();

      const sql = `SELECT * FROM password_reset_tokens 
                   WHERE token = ? AND used = 0 AND expires_at > NOW() 
                   LIMIT 1`;
      const [rows] = await this.pool.execute(sql, [token]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error buscando token de recuperación:', error.message);
      return null;
    }
  },

  async markPasswordResetTokenAsUsed(token) {
    try {
      if (!this.connected && !this.pool) await this.connect();

      const sql = 'UPDATE password_reset_tokens SET used = 1 WHERE token = ?';
      const [result] = await this.pool.execute(sql, [token]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('❌ Error marcando token como usado:', error.message);
      return false;
    }
  },

  async cleanupExpiredTokens() {
    try {
      if (!this.connected && !this.pool) await this.connect();

      const sql = 'DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used = 1';
      const [result] = await this.pool.execute(sql);
      return result.affectedRows || 0;
    } catch (error) {
      console.error('❌ Error limpiando tokens expirados:', error.message);
      return 0;
    }
  },

  async countRecentPasswordResetAttempts(email, hours = 1) {
    try {
      if (!this.connected && !this.pool) await this.connect();
      await this._ensurePasswordResetTokensTable();

      const sql = `SELECT COUNT(*) as count FROM password_reset_tokens 
                   WHERE email = ? AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)`;
      const [rows] = await this.pool.execute(sql, [email, hours]);
      return rows[0]?.count || 0;
    } catch (error) {
      console.error('❌ Error contando intentos recientes:', error.message);
      return 0;
    }
  }
};
