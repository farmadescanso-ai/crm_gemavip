/**
 * Utilidades compartidas (números, escape HTML).
 */

function toNum(v, dflt = 0) {
  if (v === null || v === undefined) return dflt;
  const s = String(v).trim();
  if (!s) return dflt;
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : dflt;
}

/** Redondeo a 2 decimales (importes, IVA). */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { toNum, round2, escapeHtml };
