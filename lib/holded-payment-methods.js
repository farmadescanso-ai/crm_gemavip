/**
 * Formas de pago en Holded (API invoicing v1 GET /paymentmethods).
 * @see https://developers.holded.com/reference/list-payment-methods
 */
'use strict';

const { fetchHolded } = require('./holded-api');

/**
 * @param {unknown} data
 * @returns {object[]}
 */
function normalizePaymentMethodsList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const d = /** @type {Record<string, unknown>} */ (data);
  if (Array.isArray(d.paymentmethods)) return d.paymentmethods;
  const alt = d.data || d.items || d.results;
  if (Array.isArray(alt)) return alt;
  if (d.id != null || d.name != null || d.nombre != null) return [d];
  return [];
}

/**
 * @param {string} [apiKey]
 * @returns {Promise<object[]>}
 */
async function fetchHoldedPaymentMethods(apiKey) {
  const raw = await fetchHolded('/paymentmethods', {}, apiKey);
  return normalizePaymentMethodsList(raw);
}

/**
 * @param {string|undefined|null} s
 * @returns {string}
 */
function escapeSqlString(s) {
  return String(s ?? '').replace(/'/g, "''");
}

/**
 * Genera SQL de referencia: INSERT condicionales y comentarios UPDATE para mapear IDs Holded.
 * @param {object[]} holdedRows
 * @param {{ formp_id?: number, formp_nombre?: string }[]} crmRows
 * @returns {string}
 */
function buildFormasPagoSyncSql(holdedRows, crmRows) {
  const crmNames = new Set(
    (crmRows || [])
      .map((r) => String(r.formp_nombre ?? r.Formp_nombre ?? '').trim().toLowerCase())
      .filter(Boolean)
  );
  const lines = [];
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  lines.push(`-- CRM Gemavip · formas de pago Holded → formas_pago (generado ${now} UTC)`);
  lines.push('-- Tabla destino: formas_pago (formp_id AUTO_INCREMENT, formp_nombre)');
  lines.push('-- Revisar antes de ejecutar en producción.');
  lines.push('');
  lines.push('-- ========== Inventario Holded (GET /paymentmethods) ==========');
  for (const row of holdedRows || []) {
    const hid = String(row.id ?? row._id ?? '').trim() || '—';
    const name = String(row.name ?? row.nombre ?? '').trim() || '—';
    const due = row.dueDays != null && row.dueDays !== '' ? String(row.dueDays) : '—';
    const bank = row.bankId != null && row.bankId !== '' ? String(row.bankId) : '—';
    lines.push(`--   id=${hid} | nombre=${name} | dueDays=${due} | bankId=${bank}`);
  }
  if (!(holdedRows || []).length) {
    lines.push('-- (sin filas Holded)');
  }
  lines.push('');
  lines.push('-- Opcional: almacenar el ID de Holded (una sola vez si la columna no existe)');
  lines.push(
    "-- ALTER TABLE formas_pago ADD COLUMN formp_id_holded VARCHAR(64) NULL DEFAULT NULL COMMENT 'ID Holded GET /paymentmethods' AFTER formp_nombre;"
  );
  lines.push('');
  lines.push(
    '-- ========== Crear en la BD del CRM: INSERT si no existe ya ese nombre =========='
  );
  lines.push(
    '-- (comparación por LOWER(TRIM(formp_nombre)); no duplica filas si el nombre ya está)'
  );
  for (const row of holdedRows || []) {
    const name = String(row.name ?? row.nombre ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (crmNames.has(key)) continue;
    const esc = escapeSqlString(name);
    lines.push(
      `INSERT INTO formas_pago (formp_nombre) SELECT * FROM (SELECT '${esc}' AS n) AS t WHERE NOT EXISTS (SELECT 1 FROM formas_pago fp WHERE LOWER(TRIM(fp.formp_nombre)) = LOWER('${esc}'));`
    );
  }
  if (!lines.some((l) => l.startsWith('INSERT INTO'))) {
    lines.push('-- (Ningún nombre nuevo: todas las formas Holded ya tienen homónimo en formas_pago)');
  }
  lines.push('');
  lines.push('-- Si añadiste formp_id_holded, descomenta y ajusta formp_id según tu tabla:');
  for (const row of holdedRows || []) {
    const hid = String(row.id ?? row._id ?? '').trim();
    const name = String(row.name ?? '').trim();
    if (!hid || !name) continue;
    lines.push(
      `-- UPDATE formas_pago SET formp_id_holded = '${escapeSqlString(hid)}' WHERE formp_id = /* TODO */ AND LOWER(TRIM(formp_nombre)) = LOWER('${escapeSqlString(name)}');`
    );
  }
  return lines.join('\n');
}

module.exports = {
  fetchHoldedPaymentMethods,
  normalizePaymentMethodsList,
  buildFormasPagoSyncSql,
  escapeSqlString
};
