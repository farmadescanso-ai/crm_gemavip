/**
 * Lectura/escritura por ruta tipo "billAddress.city" o "shippingAddresses[0].city".
 */
'use strict';

/**
 * @param {unknown} obj
 * @param {string} path
 * @returns {unknown}
 */
function getByPath(obj, path) {
  if (obj == null || path == null || path === '') return undefined;
  const parts = String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    const k = /^\d+$/.test(p) ? Number(p) : p;
    cur = /** @type {Record<string, unknown>} */ (cur)[k];
  }
  return cur;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string} path
 * @param {unknown} value
 */
function setByPath(obj, path, value) {
  if (!obj || path == null || path === '') return;
  const parts = String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  if (parts.length === 0) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const k = /^\d+$/.test(p) ? Number(p) : p;
    const next = parts[i + 1];
    const nextIsIndex = /^\d+$/.test(next);
    if (cur[k] == null || typeof cur[k] !== 'object') {
      cur[k] = nextIsIndex ? [] : {};
    }
    cur = /** @type {Record<string, unknown>} */ (cur[k]);
  }
  const last = parts[parts.length - 1];
  const lk = /^\d+$/.test(last) ? Number(last) : last;
  cur[lk] = value;
}

module.exports = { getByPath, setByPath };
