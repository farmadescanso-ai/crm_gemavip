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
 * @param {object} r
 * @returns {{ id: number, nombre: string, dias: number | null }}
 */
function parseCrmFormaRow(r) {
  const id = Number(r.formp_id ?? r.Formp_id ?? 0);
  const nombre = String(r.formp_nombre ?? r.Formp_nombre ?? '').trim();
  const rawD = r.formp_dias ?? r.Formp_dias;
  let dias = null;
  if (rawD != null && rawD !== '') {
    const n = Number(rawD);
    if (Number.isFinite(n)) dias = n;
  }
  return { id: Number.isFinite(id) && id > 0 ? id : 0, nombre, dias };
}

/**
 * @param {object} row
 * @returns {string | null}
 */
function holdedIdOf(row) {
  const hid = row.id ?? row._id;
  if (hid == null || hid === '') return null;
  return String(hid).trim();
}

/**
 * @param {object} row
 * @returns {string}
 */
function holdedNameOf(row) {
  return String(row.name ?? row.nombre ?? '').trim();
}

/**
 * @param {object} row
 * @returns {number | null}
 */
function holdedDueDays(row) {
  const d = row.dueDays;
  if (d == null || d === '') return null;
  const n = Number(d);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sugiere qué fila de `formas_pago` corresponde a una forma Holded (nombre + dueDays).
 * Catálogo típico Gemavip: Contado/Transfer (días 0), SEPA 30/60 (días 30/60).
 *
 * @param {object} holdedRow
 * @param {object[]} crmRows
 * @returns {{ formp_id: number, reason: string } | null}
 */
function suggestCrmFormpForHolded(holdedRow, crmRows) {
  const crm = (crmRows || []).map(parseCrmFormaRow).filter((x) => x.id > 0);
  if (!crm.length) return null;

  const hName = holdedNameOf(holdedRow).toLowerCase();
  const due = holdedDueDays(holdedRow);

  for (const c of crm) {
    if (c.nombre && hName && c.nombre.toLowerCase() === hName) {
      return { formp_id: c.id, reason: 'mismo nombre en CRM' };
    }
  }

  if (due != null) {
    const byDias = crm.filter((c) => c.dias === due);
    if (byDias.length === 1) {
      return { formp_id: byDias[0].id, reason: `formp_dias=${due} (único en CRM)` };
    }
    if (byDias.length > 1) {
      const raw = holdedNameOf(holdedRow);
      if (/(transfer|transferencia|wire|domic)/i.test(raw)) {
        const t = byDias.find((c) => /transfer/i.test(c.nombre));
        if (t) return { formp_id: t.id, reason: `formp_dias=${due} + nombre tipo Transfer` };
      }
      if (/(contado|cash|efectivo|pronto|inmediat)/i.test(raw)) {
        const t = byDias.find((c) => /contado/i.test(c.nombre));
        if (t) return { formp_id: t.id, reason: `formp_dias=${due} + nombre tipo Contado` };
      }
      if (/(sepa|giro|remesa|recibo)/i.test(raw)) {
        const t = byDias.find((c) => /sepa|giro/i.test(c.nombre));
        if (t) return { formp_id: t.id, reason: `formp_dias=${due} + SEPA/giro` };
      }
      if (due === 30 || due === 60) {
        const t = byDias.find((c) => String(c.nombre).includes(String(due)));
        if (t) return { formp_id: t.id, reason: `formp_dias=${due} + dígitos en nombre` };
      }
    }
  }

  if (due === 0 || due == null) {
    const with0 = crm.filter((c) => c.dias === 0 || c.dias === null);
    if (/(transfer|transferencia|wire)/i.test(hName)) {
      const t = with0.find((c) => /transfer/i.test(c.nombre));
      if (t) return { formp_id: t.id, reason: 'palabras clave → Transfer (días 0)' };
    }
    if (/(contado|cash|pronto|efectivo|inmediat|tarjeta)/i.test(hName)) {
      const t = with0.find((c) => /contado/i.test(c.nombre));
      if (t) return { formp_id: t.id, reason: 'palabras clave → Contado (días 0)' };
    }
  }

  for (const c of crm) {
    if (!c.nombre || !hName) continue;
    const cn = c.nombre.toLowerCase();
    if (hName.length >= 4 && (hName.includes(cn) || cn.includes(hName))) {
      return { formp_id: c.id, reason: 'coincidencia parcial de nombre' };
    }
  }

  return null;
}

/**
 * @param {object[]} holdedRows
 * @param {object[]} crmRows
 * @returns {Array<{
 *   holdedId: string | null,
 *   holdedName: string,
 *   dueDays: number | null,
 *   suggestedFormpId: number | null,
 *   suggestedNombre: string | null,
 *   suggestedDias: number | null,
 *   reason: string | null
 * }>}
 */
function buildHoldedFormasPagoMapping(holdedRows, crmRows) {
  const crmParsed = (crmRows || []).map(parseCrmFormaRow).filter((x) => x.id > 0);
  const byId = new Map(crmParsed.map((c) => [c.id, c]));

  const out = [];
  for (const row of holdedRows || []) {
    const hid = holdedIdOf(row);
    const holdedName = holdedNameOf(row);
    const dueDays = holdedDueDays(row);
    const sug = suggestCrmFormpForHolded(row, crmRows);
    const c = sug ? byId.get(sug.formp_id) : null;
    out.push({
      holdedId: hid,
      holdedName,
      dueDays,
      suggestedFormpId: sug ? sug.formp_id : null,
      suggestedNombre: c ? c.nombre : null,
      suggestedDias: c ? c.dias : null,
      reason: sug ? sug.reason : null
    });
  }
  return out;
}

/**
 * Genera SQL de referencia: ALTER opcional, UPDATE formp_id_holded por mapeo, INSERT solo si falta nombre.
 * @param {object[]} holdedRows
 * @param {{ formp_id?: number, formp_nombre?: string, formp_dias?: number }[]} crmRows
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
  lines.push('-- Catálogo CRM de referencia (ejemplo): formp_id 1 Contado 0, 2 SEPA 30d, 4 SEPA 60d, 5 Transfer 0');
  lines.push('-- Tabla: formas_pago (formp_id, formp_nombre, formp_dias); vincular Holded con formp_id_holded');
  lines.push('-- Revisar antes de ejecutar en producción.');
  lines.push('');
  lines.push('-- ========== Inventario Holded (GET /paymentmethods) ==========');
  for (const row of holdedRows || []) {
    const hid = holdedIdOf(row) || '—';
    const name = holdedNameOf(row) || '—';
    const due = holdedDueDays(row);
    const dueStr = due != null ? String(due) : '—';
    const bank = row.bankId != null && row.bankId !== '' ? String(row.bankId) : '—';
    lines.push(`--   id=${hid} | nombre=${name} | dueDays=${dueStr} | bankId=${bank}`);
  }
  if (!(holdedRows || []).length) {
    lines.push('-- (sin filas Holded)');
  }
  lines.push('');
  lines.push('-- Opcional: almacenar el ID de Holded (una sola vez si la columna no existe)');
  lines.push(
    "-- ALTER TABLE formas_pago ADD COLUMN formp_id_holded VARCHAR(64) NULL DEFAULT NULL COMMENT 'ID Holded GET /paymentmethods' AFTER formp_dias;"
  );
  lines.push('');
  lines.push('-- ========== Mapeo sugerido: un ID Holded por fila formas_pago ==========');
  const mapping = buildHoldedFormasPagoMapping(holdedRows || [], crmRows || []);
  /** @type {Map<number, typeof mapping[0]>} */
  const firstByFormp = new Map();
  for (const m of mapping) {
    if (m.suggestedFormpId == null || !m.holdedId) {
      lines.push(
        `-- (sin mapeo automático) Holded id=${m.holdedId ?? '—'} "${escapeSqlString(m.holdedName)}" dueDays=${m.dueDays ?? '—'}`
      );
      continue;
    }
    const fid = m.suggestedFormpId;
    if (!firstByFormp.has(fid)) {
      firstByFormp.set(fid, m);
      lines.push(
        `UPDATE formas_pago SET formp_id_holded = '${escapeSqlString(m.holdedId)}' WHERE formp_id = ${fid} AND (formp_id_holded IS NULL OR formp_id_holded = '' OR formp_id_holded = '${escapeSqlString(m.holdedId)}');`
      );
      lines.push(
        `  -- ${escapeSqlString(m.holdedName)} (dueDays ${m.dueDays ?? '—'}) → ${escapeSqlString(m.suggestedNombre || '')} · ${m.reason || ''}`
      );
    } else if (firstByFormp.get(fid).holdedId !== m.holdedId) {
      const first = firstByFormp.get(fid);
      lines.push(
        `-- ⚠️ Misma forma CRM (formp_id=${fid}): ya enlazada a Holded ${first?.holdedId} ("${escapeSqlString(first?.holdedName || '')}"); esta fila Holded "${escapeSqlString(m.holdedName)}" (${m.holdedId}) no se aplica — unificar nombres en Holded o revisar mapeo.`
      );
    }
  }
  lines.push('');
  lines.push(
    '-- ========== Solo si falta el nombre en CRM: INSERT (evitar duplicar catálogo cerrado) =========='
  );
  lines.push('-- (comparación por LOWER(TRIM(formp_nombre)))');
  for (const row of holdedRows || []) {
    const name = holdedNameOf(row);
    if (!name) continue;
    const key = name.toLowerCase();
    if (crmNames.has(key)) continue;
    const esc = escapeSqlString(name);
    lines.push(
      `INSERT INTO formas_pago (formp_nombre, formp_dias) SELECT * FROM (SELECT '${esc}' AS n, ${holdedDueDays(row) != null ? holdedDueDays(row) : 0} AS d) AS t WHERE NOT EXISTS (SELECT 1 FROM formas_pago fp WHERE LOWER(TRIM(fp.formp_nombre)) = LOWER('${esc}'));`
    );
  }
  if (!lines.some((l) => l.startsWith('INSERT INTO'))) {
    lines.push('-- (Ningún nombre nuevo: todas las formas Holded tienen homónimo por nombre en formas_pago)');
  }
  lines.push('');
  lines.push('-- Plantillas alternativas (ajuste manual por formp_id):');
  for (const row of holdedRows || []) {
    const hid = holdedIdOf(row);
    const name = holdedNameOf(row);
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
  buildHoldedFormasPagoMapping,
  suggestCrmFormpForHolded,
  escapeSqlString
};
