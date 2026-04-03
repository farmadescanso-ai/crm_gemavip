/**
 * Mapeo global Holded (ruta JSON) → columna CRM `clientes`, persistido en MySQL.
 * Una sola fila id=1; usado en import/export y en la ficha comparar.
 */
'use strict';

const TABLE = 'crm_holded_field_map';

/** Columnas que no deben escribirse desde mapeo manual */
const CRM_COLUMN_DENY = new Set([
  'cli_id',
  'cli_holded_sync_hash',
  'cli_holded_sync_pendiente',
  'cli_Id_Holded',
  'cli_referencia'
]);

/**
 * @param {import('../config/mysql-crm')} db
 */
async function ensureCrmHoldedFieldMapTable(db) {
  try {
    if (!db.connected && !db.pool) await db.connect();
  } catch (_) {
    return;
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
      id INT NOT NULL PRIMARY KEY,
      mapping_json LONGTEXT NOT NULL,
      updated_at DATETIME NOT NULL,
      updated_by VARCHAR(255) NULL DEFAULT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `).catch(() => {});
}

/**
 * @param {import('../config/mysql-crm')} db
 * @returns {Promise<Record<string, string>>}
 */
async function loadGlobalHoldedFieldMap(db) {
  await ensureCrmHoldedFieldMapTable(db);
  try {
    const rows = await db.query(
      `SELECT mapping_json FROM \`${TABLE}\` WHERE id = 1 LIMIT 1`
    );
    const raw = rows?.[0]?.mapping_json ?? rows?.[0]?.MAPPING_JSON;
    if (!raw || typeof raw !== 'string') return {};
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return {};
    /** @type {Record<string, string>} */
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof k === 'string' && k.trim() && typeof v === 'string' && v.trim()) {
        out[k.trim()] = v.trim();
      }
    }
    return out;
  } catch (_) {
    return {};
  }
}

/**
 * @param {import('../config/mysql-crm')} db
 * @param {Record<string, string>} map
 * @param {string} [updatedBy]
 */
async function saveGlobalHoldedFieldMap(db, map, updatedBy) {
  await ensureCrmHoldedFieldMapTable(db);
  const clean = {};
  if (map && typeof map === 'object') {
    for (const [k, v] of Object.entries(map)) {
      if (typeof k === 'string' && k.trim() && typeof v === 'string' && v.trim()) {
        if (CRM_COLUMN_DENY.has(v.trim())) continue;
        clean[k.trim()] = v.trim();
      }
    }
  }
  const json = JSON.stringify(clean);
  const when = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const by = updatedBy && String(updatedBy).trim() ? String(updatedBy).trim().slice(0, 255) : null;
  await db.query(
    `INSERT INTO \`${TABLE}\` (id, mapping_json, updated_at, updated_by) VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE mapping_json = VALUES(mapping_json), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)`,
    [json, when, by]
  );
}

/**
 * @param {import('../config/mysql-crm')} db
 * @returns {Promise<{ updatedAt: string | null, updatedBy: string | null }>}
 */
async function getGlobalHoldedFieldMapMeta(db) {
  await ensureCrmHoldedFieldMapTable(db);
  try {
    const rows = await db.query(
      `SELECT updated_at, updated_by FROM \`${TABLE}\` WHERE id = 1 LIMIT 1`
    );
    const r = rows?.[0];
    if (!r) return { updatedAt: null, updatedBy: null };
    const updatedAt = r.updated_at ?? r.UPDATED_AT;
    const updatedBy = r.updated_by ?? r.UPDATED_BY;
    return {
      updatedAt: updatedAt != null ? String(updatedAt) : null,
      updatedBy: updatedBy != null ? String(updatedBy) : null
    };
  } catch (_) {
    return { updatedAt: null, updatedBy: null };
  }
}

/**
 * @param {Record<string, string>} pathToCrm
 * @returns {Record<string, string>} crmCol -> holdedPath (última ruta gana)
 */
function invertPathToCrmMap(pathToCrm) {
  /** @type {Record<string, string>} */
  const rev = {};
  for (const [path, col] of Object.entries(pathToCrm || {})) {
    if (col && path) rev[col] = path;
  }
  return rev;
}

module.exports = {
  ensureCrmHoldedFieldMapTable,
  loadGlobalHoldedFieldMap,
  saveGlobalHoldedFieldMap,
  getGlobalHoldedFieldMapMeta,
  invertPathToCrmMap,
  CRM_COLUMN_DENY
};
