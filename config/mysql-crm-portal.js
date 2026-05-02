/**
 * Portal del cliente: acceso, configuración, enlaces, comentarios, tokens reset.
 * Se fusiona en MySQLCRM.prototype.
 */
'use strict';

const crypto = require('crypto');

module.exports = {
  async _ensurePortalTables() {
    if (this._portalSchemaEnsured) return;
    const stmts = [
      `CREATE TABLE IF NOT EXISTS portal_config (
          portcfg_id INT NOT NULL PRIMARY KEY DEFAULT 1,
          portcfg_activo TINYINT(1) NOT NULL DEFAULT 0,
          portcfg_enlaces_horas INT NOT NULL DEFAULT 48,
          portcfg_ver_facturas TINYINT(1) NOT NULL DEFAULT 1,
          portcfg_ver_pedidos TINYINT(1) NOT NULL DEFAULT 1,
          portcfg_ver_presupuestos TINYINT(1) NOT NULL DEFAULT 1,
          portcfg_ver_albaranes TINYINT(1) NOT NULL DEFAULT 1,
          portcfg_ver_catalogo TINYINT(1) NOT NULL DEFAULT 0,
          portcfg_stripe_activo TINYINT(1) NOT NULL DEFAULT 0,
          portcfg_actualizado_en DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `INSERT IGNORE INTO portal_config (portcfg_id, portcfg_activo) VALUES (1, 0)`,
      `CREATE TABLE IF NOT EXISTS portal_cliente_override (
          pco_id INT NOT NULL AUTO_INCREMENT,
          pco_cli_id INT NOT NULL,
          pco_heredar_global TINYINT(1) NOT NULL DEFAULT 1,
          pco_ver_facturas TINYINT(1) NULL DEFAULT NULL,
          pco_ver_pedidos TINYINT(1) NULL DEFAULT NULL,
          pco_ver_presupuestos TINYINT(1) NULL DEFAULT NULL,
          pco_ver_albaranes TINYINT(1) NULL DEFAULT NULL,
          pco_ver_catalogo TINYINT(1) NULL DEFAULT NULL,
          PRIMARY KEY (pco_id),
          UNIQUE KEY ux_pco_cli (pco_cli_id),
          CONSTRAINT fk_pco_cli FOREIGN KEY (pco_cli_id) REFERENCES clientes (cli_id) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS portal_acceso_cliente (
          pac_id INT NOT NULL AUTO_INCREMENT,
          pac_cli_id INT NOT NULL,
          pac_email_login VARCHAR(255) NOT NULL,
          pac_password_hash VARCHAR(255) NOT NULL,
          pac_activo TINYINT(1) NOT NULL DEFAULT 1,
          pac_invitado_en DATETIME NULL DEFAULT NULL,
          pac_ultimo_acceso_at DATETIME NULL DEFAULT NULL,
          PRIMARY KEY (pac_id),
          UNIQUE KEY ux_pac_cli (pac_cli_id),
          UNIQUE KEY ux_pac_email (pac_email_login),
          CONSTRAINT fk_pac_cli FOREIGN KEY (pac_cli_id) REFERENCES clientes (cli_id) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS portal_password_reset_tokens (
          pprt_id INT NOT NULL AUTO_INCREMENT,
          pprt_cli_id INT NOT NULL,
          pprt_token VARCHAR(128) NOT NULL,
          pprt_email VARCHAR(255) NOT NULL,
          pprt_expires_at DATETIME NOT NULL,
          pprt_used TINYINT(1) NOT NULL DEFAULT 0,
          pprt_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (pprt_id),
          UNIQUE KEY ux_pprt_token (pprt_token),
          KEY idx_pprt_email_created (pprt_email, pprt_created_at),
          KEY idx_pprt_cli (pprt_cli_id),
          CONSTRAINT fk_pprt_cli FOREIGN KEY (pprt_cli_id) REFERENCES clientes (cli_id) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS portal_documento_enlace (
          pde_id INT NOT NULL AUTO_INCREMENT,
          pde_cli_id INT NOT NULL,
          pde_tipo_doc VARCHAR(32) NOT NULL,
          pde_ref_externa VARCHAR(64) NOT NULL,
          pde_token_hash CHAR(64) NOT NULL,
          pde_expires_at DATETIME NOT NULL,
          pde_used_at DATETIME NULL DEFAULT NULL,
          pde_creado_por_com_id INT NULL DEFAULT NULL,
          pde_activo TINYINT(1) NOT NULL DEFAULT 1,
          pde_creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (pde_id),
          UNIQUE KEY ux_pde_token_hash (pde_token_hash),
          KEY idx_pde_cli_tipo_ref (pde_cli_id, pde_tipo_doc, pde_ref_externa),
          CONSTRAINT fk_pde_cli FOREIGN KEY (pde_cli_id) REFERENCES clientes (cli_id) ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT fk_pde_com FOREIGN KEY (pde_creado_por_com_id) REFERENCES comerciales (com_id) ON DELETE SET NULL ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS portal_documento_comentario (
          pdc_id INT NOT NULL AUTO_INCREMENT,
          pdc_cli_id INT NOT NULL,
          pdc_tipo_doc VARCHAR(32) NOT NULL,
          pdc_ref_externa VARCHAR(64) NOT NULL,
          pdc_mensaje TEXT NOT NULL,
          pdc_es_cliente TINYINT(1) NOT NULL DEFAULT 1,
          pdc_com_id INT NULL DEFAULT NULL,
          pdc_leido_por_comercial TINYINT(1) NOT NULL DEFAULT 0,
          pdc_creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (pdc_id),
          KEY idx_pdc_doc (pdc_cli_id, pdc_tipo_doc, pdc_ref_externa),
          KEY idx_pdc_creado (pdc_creado_en),
          CONSTRAINT fk_pdc_cli FOREIGN KEY (pdc_cli_id) REFERENCES clientes (cli_id) ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT fk_pdc_com FOREIGN KEY (pdc_com_id) REFERENCES comerciales (com_id) ON DELETE SET NULL ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ];
    for (const sql of stmts) {
      try {
        await this.query(sql);
      } catch (e) {
        console.warn('⚠️ [PORTAL] DDL:', e?.message || e);
      }
    }
    this._portalSchemaEnsured = true;
  },

  async getPortalConfig() {
    await this._ensurePortalTables();
    const rows = await this.query('SELECT * FROM portal_config WHERE portcfg_id = 1 LIMIT 1');
    return rows?.[0] || null;
  },

  async updatePortalConfig(patch = {}) {
    await this._ensurePortalTables();
    const cur = (await this.getPortalConfig()) || {};
    const next = {
      portcfg_activo: patch.portcfg_activo != null ? (patch.portcfg_activo ? 1 : 0) : Number(cur.portcfg_activo ?? 0),
      portcfg_enlaces_horas: Math.max(1, Math.min(8760, Number(patch.portcfg_enlaces_horas ?? cur.portcfg_enlaces_horas ?? 48))),
      portcfg_ver_facturas: patch.portcfg_ver_facturas != null ? (patch.portcfg_ver_facturas ? 1 : 0) : Number(cur.portcfg_ver_facturas ?? 1),
      portcfg_ver_pedidos: patch.portcfg_ver_pedidos != null ? (patch.portcfg_ver_pedidos ? 1 : 0) : Number(cur.portcfg_ver_pedidos ?? 1),
      portcfg_ver_presupuestos: patch.portcfg_ver_presupuestos != null ? (patch.portcfg_ver_presupuestos ? 1 : 0) : Number(cur.portcfg_ver_presupuestos ?? 1),
      portcfg_ver_albaranes: patch.portcfg_ver_albaranes != null ? (patch.portcfg_ver_albaranes ? 1 : 0) : Number(cur.portcfg_ver_albaranes ?? 1),
      portcfg_ver_catalogo: patch.portcfg_ver_catalogo != null ? (patch.portcfg_ver_catalogo ? 1 : 0) : Number(cur.portcfg_ver_catalogo ?? 0),
      portcfg_stripe_activo: patch.portcfg_stripe_activo != null ? (patch.portcfg_stripe_activo ? 1 : 0) : Number(cur.portcfg_stripe_activo ?? 0)
    };
    await this.query(
      `UPDATE portal_config SET
        portcfg_activo = ?, portcfg_enlaces_horas = ?,
        portcfg_ver_facturas = ?, portcfg_ver_pedidos = ?, portcfg_ver_presupuestos = ?,
        portcfg_ver_albaranes = ?, portcfg_ver_catalogo = ?, portcfg_stripe_activo = ?
       WHERE portcfg_id = 1`,
      [
        next.portcfg_activo,
        next.portcfg_enlaces_horas,
        next.portcfg_ver_facturas,
        next.portcfg_ver_pedidos,
        next.portcfg_ver_presupuestos,
        next.portcfg_ver_albaranes,
        next.portcfg_ver_catalogo,
        next.portcfg_stripe_activo
      ]
    );
    return this.getPortalConfig();
  },

  async getPortalClienteOverride(cliId) {
    await this._ensurePortalTables();
    const id = Number(cliId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const rows = await this.query('SELECT * FROM portal_cliente_override WHERE pco_cli_id = ? LIMIT 1', [id]).catch(() => []);
    return rows?.[0] || null;
  },

  async upsertPortalClienteOverride(cliId, data = {}) {
    const id = Number(cliId);
    if (!Number.isFinite(id) || id <= 0) throw new Error('cli_id inválido');
    await this._ensurePortalTables();
    const existing = await this.getPortalClienteOverride(id);
    const heredar = data.pco_heredar_global != null ? (data.pco_heredar_global ? 1 : 0) : (existing?.pco_heredar_global ?? 1);
    const vf = data.pco_ver_facturas;
    const vp = data.pco_ver_pedidos;
    const vpr = data.pco_ver_presupuestos;
    const va = data.pco_ver_albaranes;
    const vc = data.pco_ver_catalogo;
    if (existing) {
      await this.query(
        `UPDATE portal_cliente_override SET
          pco_heredar_global = ?,
          pco_ver_facturas = ?, pco_ver_pedidos = ?, pco_ver_presupuestos = ?,
          pco_ver_albaranes = ?, pco_ver_catalogo = ?
         WHERE pco_cli_id = ?`,
        [
          heredar,
          vf !== undefined ? vf : existing.pco_ver_facturas,
          vp !== undefined ? vp : existing.pco_ver_pedidos,
          vpr !== undefined ? vpr : existing.pco_ver_presupuestos,
          va !== undefined ? va : existing.pco_ver_albaranes,
          vc !== undefined ? vc : existing.pco_ver_catalogo,
          id
        ]
      );
    } else {
      await this.query(
        `INSERT INTO portal_cliente_override (
          pco_cli_id, pco_heredar_global, pco_ver_facturas, pco_ver_pedidos, pco_ver_presupuestos, pco_ver_albaranes, pco_ver_catalogo
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, heredar, vf ?? null, vp ?? null, vpr ?? null, va ?? null, vc ?? null]
      );
    }
    return this.getPortalClienteOverride(id);
  },

  async getPortalAccesoByCliId(cliId) {
    await this._ensurePortalTables();
    const id = Number(cliId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const rows = await this.query(
      'SELECT pac_id, pac_cli_id, pac_email_login, pac_password_hash, pac_activo, pac_invitado_en, pac_ultimo_acceso_at FROM portal_acceso_cliente WHERE pac_cli_id = ? LIMIT 1',
      [id]
    ).catch(() => []);
    return rows?.[0] || null;
  },

  async getPortalAccesoByEmail(email) {
    await this._ensurePortalTables();
    const e = String(email || '').trim().toLowerCase();
    if (!e) return null;
    const rows = await this.query(
      'SELECT pac_id, pac_cli_id, pac_email_login, pac_password_hash, pac_activo, pac_invitado_en, pac_ultimo_acceso_at FROM portal_acceso_cliente WHERE LOWER(pac_email_login) = ? LIMIT 1',
      [e]
    ).catch(() => []);
    return rows?.[0] || null;
  },

  async createPortalAcceso(cliId, emailLogin, passwordHash, opts = {}) {
    await this._ensurePortalTables();
    const id = Number(cliId);
    if (!Number.isFinite(id) || id <= 0) throw new Error('cli_id inválido');
    const em = String(emailLogin || '').trim().toLowerCase();
    if (!em) throw new Error('email requerido');
    const act = opts.activo !== false ? 1 : 0;
    const existing = await this.getPortalAccesoByCliId(id);
    if (existing) {
      await this.query(
        `UPDATE portal_acceso_cliente SET pac_email_login = ?, pac_password_hash = ?, pac_activo = ?,
         pac_invitado_en = COALESCE(pac_invitado_en, NOW()) WHERE pac_cli_id = ?`,
        [em, passwordHash, act, id]
      );
    } else {
      await this.query(
        `INSERT INTO portal_acceso_cliente (pac_cli_id, pac_email_login, pac_password_hash, pac_activo, pac_invitado_en)
         VALUES (?, ?, ?, ?, NOW())`,
        [id, em, passwordHash, act]
      );
    }
    return this.getPortalAccesoByCliId(id);
  },

  async updatePortalPassword(cliId, passwordHash) {
    await this._ensurePortalTables();
    const id = Number(cliId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const r = await this.query('UPDATE portal_acceso_cliente SET pac_password_hash = ? WHERE pac_cli_id = ?', [passwordHash, id]);
    return (r?.affectedRows ?? 0) > 0;
  },

  async setPortalAccesoActivo(cliId, activo) {
    await this._ensurePortalTables();
    const id = Number(cliId);
    await this.query('UPDATE portal_acceso_cliente SET pac_activo = ? WHERE pac_cli_id = ?', [activo ? 1 : 0, id]);
  },

  async updatePortalUltimoAcceso(cliId) {
    const id = Number(cliId);
    await this.query('UPDATE portal_acceso_cliente SET pac_ultimo_acceso_at = NOW() WHERE pac_cli_id = ?', [id]);
  },

  async createPortalPasswordResetToken(cliId, email, rawToken, expiresInHours = 1) {
    await this._ensurePortalTables();
    const id = Number(cliId);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiresInHours);
    await this.query('UPDATE portal_password_reset_tokens SET pprt_used = 1 WHERE pprt_cli_id = ? AND pprt_used = 0', [id]);
    await this.query(
      `INSERT INTO portal_password_reset_tokens (pprt_cli_id, pprt_token, pprt_email, pprt_expires_at, pprt_used)
       VALUES (?, ?, ?, ?, 0)`,
      [id, rawToken, String(email).trim().toLowerCase(), expiresAt]
    );
    return { expiresAt };
  },

  async findPortalPasswordResetToken(token) {
    await this._ensurePortalTables();
    const rows = await this.query(
      `SELECT pprt_id, pprt_cli_id, pprt_token, pprt_email, pprt_expires_at, pprt_used, pprt_created_at
       FROM portal_password_reset_tokens WHERE pprt_token = ? AND pprt_used = 0 AND pprt_expires_at > NOW() LIMIT 1`,
      [token]
    ).catch(() => []);
    return rows?.[0] || null;
  },

  async markPortalPasswordResetTokenUsed(token) {
    await this._ensurePortalTables();
    const r = await this.query('UPDATE portal_password_reset_tokens SET pprt_used = 1 WHERE pprt_token = ?', [token]);
    return (r?.affectedRows ?? 0) > 0;
  },

  async countRecentPortalPasswordResetAttempts(email, hours = 1) {
    await this._ensurePortalTables();
    const rows = await this.query(
      `SELECT COUNT(*) as c FROM portal_password_reset_tokens WHERE pprt_email = ? AND pprt_created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)`,
      [String(email).trim().toLowerCase(), hours]
    ).catch(() => [{ c: 0 }]);
    return rows?.[0]?.c || 0;
  },

  async createPortalDocumentoEnlace(row) {
    await this._ensurePortalTables();
    const tokenHash = crypto.createHash('sha256').update(row.rawToken).digest('hex');
    const r = await this.query(
      `INSERT INTO portal_documento_enlace (
        pde_cli_id, pde_tipo_doc, pde_ref_externa, pde_token_hash, pde_expires_at, pde_creado_por_com_id, pde_activo
      ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        row.cli_id,
        String(row.tipo_doc),
        String(row.ref_externa),
        tokenHash,
        row.expires_at,
        row.creado_por_com_id != null ? Number(row.creado_por_com_id) : null
      ]
    );
    const insertId = r && typeof r.insertId !== 'undefined' ? r.insertId : null;
    return { insertId, tokenHash };
  },

  async findPortalDocumentoEnlaceByTokenHash(tokenHash) {
    await this._ensurePortalTables();
    const h = String(tokenHash || '').trim().toLowerCase();
    if (h.length !== 64) return null;
    const rows = await this.query(
      `SELECT * FROM portal_documento_enlace WHERE LOWER(pde_token_hash) = ? AND pde_activo = 1 LIMIT 1`,
      [h]
    ).catch(() => []);
    return rows?.[0] || null;
  },

  async markPortalDocumentoEnlaceUsed(id) {
    await this._ensurePortalTables();
    await this.query('UPDATE portal_documento_enlace SET pde_used_at = NOW() WHERE pde_id = ?', [id]);
  },

  async listPortalDocumentoComentarios(cliId, tipoDoc, refExterna) {
    await this._ensurePortalTables();
    return this.query(
      `SELECT * FROM portal_documento_comentario
       WHERE pdc_cli_id = ? AND pdc_tipo_doc = ? AND pdc_ref_externa = ?
       ORDER BY pdc_creado_en ASC`,
      [cliId, String(tipoDoc), String(refExterna)]
    ).catch(() => []);
  },

  async addPortalDocumentoComentario(row) {
    await this._ensurePortalTables();
    const r = await this.query(
      `INSERT INTO portal_documento_comentario (
        pdc_cli_id, pdc_tipo_doc, pdc_ref_externa, pdc_mensaje, pdc_es_cliente, pdc_com_id, pdc_leido_por_comercial
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row.cli_id,
        String(row.tipo_doc),
        String(row.ref_externa),
        String(row.mensaje || '').slice(0, 8000),
        row.es_cliente ? 1 : 0,
        row.com_id != null ? Number(row.com_id) : null,
        row.es_cliente ? 0 : 1
      ]
    );
    return r?.insertId;
  }
};
