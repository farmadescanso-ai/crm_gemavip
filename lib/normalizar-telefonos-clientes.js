/**
 * Normaliza teléfonos de clientes en BD.
 * Guarda: +34610721369 (sin espacios).
 * Vista muestra: +34 610 72 13 69
 *
 * España (+34), Portugal (+351) y otros prefijos.
 */

'use strict';

const db = require('../config/mysql-crm');
const { normalizeTelefonoForDB } = require('./telefono-utils');

/**
 * Ejecuta la normalización de teléfonos de clientes.
 * @param {Object} opts - { dryRun: boolean }
 * @returns {Promise<{ ok: boolean, updated: number, updates: Array, failed: Array, error?: string }>}
 */
async function runNormalizarTelefonosClientes(opts = {}) {
  const dryRun = !!opts.dryRun;
  const result = { ok: false, updated: 0, updates: [], failed: [] };

  try {
    if (!db.connected && !db.pool) await db.connect();

    const meta = await db._ensureClientesMeta().catch(() => null);
    const pk = meta?.pk || 'cli_id';
    const clientesCols = await db._getColumns(meta?.tClientes || 'clientes').catch(() => []);
    const colTelefono = db._pickCIFromColumns(clientesCols, ['cli_telefono', 'Telefono', 'telefono']) || 'cli_telefono';
    const colMovil = db._pickCIFromColumns(clientesCols, ['cli_movil', 'Movil', 'movil']) || 'cli_movil';
    const colNombre = db._pickCIFromColumns(clientesCols, ['cli_nombre_razon_social', 'Nombre_Razon_Social', 'Nombre']) || 'cli_nombre_razon_social';
    const tClientes = meta?.tClientes || 'clientes';

    const rows = await db.query(
      `SELECT \`${pk}\`, \`${colNombre}\`, \`${colTelefono}\`, \`${colMovil}\` FROM \`${tClientes}\`
       WHERE (\`${colTelefono}\` IS NOT NULL AND TRIM(\`${colTelefono}\`) != '')
          OR (\`${colMovil}\` IS NOT NULL AND TRIM(\`${colMovil}\`) != '')`
    );

    const updates = [];

    for (const r of rows || []) {
      const id = r[pk] ?? r.cli_id ?? r.id ?? r.Id;
      const nombre = r[colNombre] ?? r.cli_nombre_razon_social ?? r.Nombre_Razon_Social ?? r.Nombre ?? '';
      const telRaw = String(r[colTelefono] ?? r.cli_telefono ?? r.Telefono ?? '').trim();
      const movRaw = String(r[colMovil] ?? r.cli_movil ?? r.Movil ?? '').trim();

      const telNorm = normalizeTelefonoForDB(telRaw);
      const movNorm = normalizeTelefonoForDB(movRaw);

      const telFailed = telRaw && !telNorm;
      const movFailed = movRaw && !movNorm;
      if (telFailed || movFailed) {
        result.failed.push({
          id,
          nombre,
          telefono: telFailed ? telRaw : (telRaw || null),
          movil: movFailed ? movRaw : (movRaw || null)
        });
      }

      const telChanged = telNorm && telRaw !== telNorm;
      const movChanged = movNorm && movRaw !== movNorm;

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
          nombre,
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
