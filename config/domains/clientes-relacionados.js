/**
 * Dominio: Clientes Relacionados
 * Gestión de relaciones entre clientes (clientes_relacionados).
 */
'use strict';

const { getTableName } = require('../table-names');
const TIPOS_ORIGEN = [7, 10]; // tipc_id para 'Otros' y 'Otro'

module.exports = {
  async getRelacionesByClienteOrigen(cliOrigenId) {
    const t = getTableName('clientes_relacionados') || 'clientes_relacionados';
    const sql = `
      SELECT r.clirel_id, r.clirel_cli_origen_id, r.clirel_cli_relacionado_id, r.clirel_descripcion,
             c.cli_nombre_razon_social AS relacionado_nombre,
             c.cli_nombre_cial AS relacionado_nombre_cial,
             c.cli_dni_cif AS relacionado_dni_cif,
             c.cli_email AS relacionado_email,
             c.cli_numero_farmacia AS relacionado_numero_farmacia
      FROM \`${t}\` r
      LEFT JOIN clientes c ON c.cli_id = r.clirel_cli_relacionado_id
      WHERE r.clirel_cli_origen_id = ?
      ORDER BY r.clirel_id ASC
    `;
    const rows = await this.query(sql, [cliOrigenId]);
    return Array.isArray(rows) ? rows : [];
  },

  async getRelacionesByClienteRelacionado(cliRelacionadoId) {
    const t = getTableName('clientes_relacionados') || 'clientes_relacionados';
    const sql = `
      SELECT r.clirel_id, r.clirel_cli_origen_id, r.clirel_cli_relacionado_id, r.clirel_descripcion,
             c.cli_nombre_razon_social AS origen_nombre,
             c.cli_nombre_cial AS origen_nombre_cial
      FROM \`${t}\` r
      LEFT JOIN clientes c ON c.cli_id = r.clirel_cli_origen_id
      WHERE r.clirel_cli_relacionado_id = ?
      ORDER BY r.clirel_id ASC
    `;
    const rows = await this.query(sql, [cliRelacionadoId]);
    return Array.isArray(rows) ? rows : [];
  },

  async getRelacionesByCliente(cliId) {
    const comoOrigen = await this.getRelacionesByClienteOrigen(cliId);
    const comoRelacionado = await this.getRelacionesByClienteRelacionado(cliId);
    return { comoOrigen, comoRelacionado, total: comoOrigen.length + comoRelacionado.length };
  },

  async createRelacion(cliOrigenId, cliRelacionadoId, descripcion = null) {
    const t = getTableName('clientes_relacionados') || 'clientes_relacionados';
    if (cliOrigenId === cliRelacionadoId) {
      throw new Error('Un cliente no puede relacionarse consigo mismo');
    }
    const sql = `INSERT INTO \`${t}\` (clirel_cli_origen_id, clirel_cli_relacionado_id, clirel_descripcion) VALUES (?, ?, ?)`;
    const result = await this.query(sql, [cliOrigenId, cliRelacionadoId, descripcion || null]);
    const insertId = result?.insertId ?? result?.INSERT_ID;
    if (insertId) {
      const rels = await this.getRelacionesByClienteOrigen(cliOrigenId);
      const principal = rels[0]?.clirel_cli_relacionado_id ?? cliRelacionadoId;
      await this._actualizarCliRelacionadoPrincipal(cliOrigenId, principal);
    }
    return { insertId, clirel_id: insertId };
  },

  async createRelacionesBatch(cliOrigenId, items) {
    if (!Array.isArray(items) || items.length === 0) {
      return { inserted: 0, ids: [] };
    }
    const t = getTableName('clientes_relacionados') || 'clientes_relacionados';
    const ids = [];
    for (const it of items) {
      const relId = Number(it?.cliRelacionadoId ?? it?.cli_relacionado_id ?? it?.id ?? 0);
      if (!relId || relId === cliOrigenId) continue;
      const desc = it?.descripcion ?? it?.clirel_descripcion ?? null;
      try {
        const res = await this.createRelacion(cliOrigenId, relId, desc);
        if (res?.insertId) ids.push(res.insertId);
      } catch (e) {
        if (e?.code !== 'ER_DUP_ENTRY' && e?.errno !== 1062) throw e;
      }
    }
    return { inserted: ids.length, ids };
  },

  async updateRelacion(clirelId, { descripcion }) {
    const t = getTableName('clientes_relacionados') || 'clientes_relacionados';
    const sql = `UPDATE \`${t}\` SET clirel_descripcion = ? WHERE clirel_id = ?`;
    await this.query(sql, [descripcion ?? null, clirelId]);
    return { affectedRows: 1 };
  },

  async deleteRelacion(cliOrigenId, cliRelacionadoId) {
    const t = getTableName('clientes_relacionados') || 'clientes_relacionados';
    const sql = `DELETE FROM \`${t}\` WHERE clirel_cli_origen_id = ? AND clirel_cli_relacionado_id = ?`;
    await this.query(sql, [cliOrigenId, cliRelacionadoId]);
    const rels = await this.getRelacionesByClienteOrigen(cliOrigenId);
    const principal = rels[0]?.clirel_cli_relacionado_id ?? null;
    await this._actualizarCliRelacionadoPrincipal(cliOrigenId, principal);
    return { affectedRows: 1 };
  },

  async getClienteRelacionadoPrincipal(cliId) {
    const rels = await this.getRelacionesByClienteOrigen(cliId);
    if (rels.length > 0) {
      const first = rels[0];
      return {
        cli_id: first.clirel_cli_relacionado_id,
        nombre: first.relacionado_nombre || first.relacionado_nombre_cial,
        descripcion: first.clirel_descripcion
      };
    }
    const cliente = await this.getClienteById(cliId);
    const relId = cliente?.cli_Id_cliente_relacionado ?? cliente?.cli_id_cliente_relacionado ?? null;
    if (relId) {
      const rel = await this.getClienteById(relId);
      return rel ? { cli_id: relId, nombre: rel.cli_nombre_razon_social || rel.cli_nombre_cial } : null;
    }
    return null;
  },

  async _actualizarCliRelacionadoPrincipal(cliOrigenId, cliRelacionadoId) {
    const meta = await this._ensureClientesMeta().catch(() => null);
    const tClientes = meta?.tClientes || 'clientes';
    const pk = meta?.pk || 'cli_id';
    const colRel = 'cli_Id_cliente_relacionado';
    const cols = await this._getColumns(tClientes).catch(() => []);
    const hasCol = cols.some(c => String(c).toLowerCase() === colRel.toLowerCase());
    if (!hasCol) return;
    const sql = `UPDATE \`${tClientes}\` SET \`${colRel}\` = ? WHERE \`${pk}\` = ?`;
    await this.query(sql, [cliRelacionadoId, cliOrigenId]);
  },

  async tieneRelaciones(cliId) {
    const { total } = await this.getRelacionesByCliente(cliId);
    if (total > 0) return true;
    const c = await this.getClienteById(cliId);
    const relId = c?.cli_Id_cliente_relacionado ?? c?.cli_id_cliente_relacionado ?? null;
    return !!(relId && relId > 0);
  }
};
