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

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { toNum, escapeHtml };
