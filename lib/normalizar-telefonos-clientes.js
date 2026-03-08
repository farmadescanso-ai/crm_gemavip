/**
 * Normaliza teléfonos de clientes en BD.
 * Guarda: +34610721369 (sin espacios).
 * Vista muestra: +34 610 721 369
 *
 * España (+34), Portugal (+351) y otros prefijos.
 */

'use strict';

const db = require('../config/mysql-crm');
const { normalizeTelefonoForDB } = require('./telefono-utils');

/**
 * Ejecuta la normalización de teléfonos de clientes.
 * @param {Object} opts - { dryRun: boolean }
 * @returns {Promise<{ ok: boolean, updated: number, updates: Array, error?: string }>}
 */
async function runNormalizarTelefonosClientes(opts = {}) {
  const dryRun = !!opts.dryRun;
  const result = { ok: false, updated: 0, updates: [] };

  try {
    if (!db.connected && !db.pool) await db.connect();

    const meta = await db._ensureClientesMeta().catch(() => null);
    const pk = meta?.pk || 'cli_id';
    const clientesCols = await db._getColumns(meta?.tClientes || 'clientes').catch(() => []);
    const colTelefono = db._pickCIFromColumns(clientesCols, ['cli_telefono', 'Telefono', 'telefono']) || 'cli_telefono';
    const colMovil = db._pickCIFromColumns(clientesCols, ['cli_movil', 'Movil', 'movil']) || 'cli_movil';
    const tClientes = meta?.tClientes || 'clientes';

    const rows = await db.query(
      `SELECT \`${pk}\`, \`${colTelefono}\`, \`${colMovil}\` FROM \`${tClientes}\`
       WHERE (\`${colTelefono}\` IS NOT NULL AND TRIM(\`${colTelefono}\`) != '')
          OR (\`${colMovil}\` IS NOT NULL AND TRIM(\`${colMovil}\`) != '')`
    );

    const updates = [];

    for (const r of rows || []) {
      const id = r[pk] ?? r.cli_id ?? r.id ?? r.Id;
      const telRaw = r[colTelefono] ?? r.cli_telefono ?? r.Telefono ?? '';
      const movRaw = r[colMovil] ?? r.cli_movil ?? r.Movil ?? '';

      const telNorm = normalizeTelefonoForDB(telRaw);
      const movNorm = normalizeTelefonoForDB(movRaw);

      const telChanged = telNorm && String(telRaw).trim() !== telNorm;
      const movChanged = movNorm && String(movRaw).trim() !== movNorm;

      if (telChanged || movChanged) {
        const setParts = [];
        const params = [];
        if (telChanged) {
          setParts.push(`\`${colTelefono}\` = ?`);
          params.push(telNorm);
        }
        if (movChanged) {
          setParts.push(`\`${colMovil}\` = ?`);
          params.push(movNorm);
        }
        params.push(id);
        updates.push({
          id,
          sql: `UPDATE \`${tClientes}\` SET ${setParts.join(', ')} WHERE \`${pk}\` = ?`,
          params,
          telBefore: telRaw,
          telAfter: telNorm,
          movBefore: movRaw,
          movAfter: movNorm
        });
      }
    }

    result.updates = updates;

    if (!dryRun && updates.length > 0) {
      for (const u of updates) {
        await db.pool.execute(u.sql, u.params);
        result.updated++;
      }
    }

    result.ok = true;
    return result;
  } catch (e) {
    result.ok = false;
    result.error = e?.message || String(e);
    return result;
  }
}

module.exports = { runNormalizarTelefonosClientes };
