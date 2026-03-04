/**
 * Caché en memoria para catálogos (provincias, países, formas de pago, etc.).
 * TTL por defecto: 5 minutos. Reduce consultas repetitivas a BD.
 * Auditoría punto 5.
 */
'use strict';

const CACHE_TTL_MS = Number(process.env.CATALOG_CACHE_TTL_MS) || 5 * 60 * 1000; // 5 min
const catalogCache = new Map();

function getCacheKey(prefix, suffix = '') {
  return `${prefix}:${suffix}`.trim();
}

/**
 * Obtiene datos de catálogo con caché.
 * @param {string} key - Clave del catálogo (ej: 'provincias', 'paises')
 * @param {string|number|null} [suffix] - Sufijo opcional (ej: filtroPais para provincias)
 * @param {() => Promise<any>} fetchFn - Función que obtiene los datos desde BD
 * @param {number} [ttlMs] - TTL en ms (opcional)
 * @returns {Promise<any>}
 */
async function getCatalogCached(key, suffix, fetchFn, ttlMs = CACHE_TTL_MS) {
  if (typeof suffix === 'function') {
    ttlMs = fetchFn || CACHE_TTL_MS;
    fetchFn = suffix;
    suffix = '';
  }
  const suffixStr = suffix != null ? String(suffix) : '';
  const cacheKey = getCacheKey(key, suffixStr);
  const cached = catalogCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ttlMs) return cached.data;
  const data = await fetchFn();
  // No cachear arrays vacíos: si la primera petición falló (timeout, etc.), no perpetuar []
  if (!(Array.isArray(data) && data.length === 0)) {
    catalogCache.set(cacheKey, { data, ts: Date.now() });
  }
  return data;
}

/**
 * Invalida la caché de un catálogo (útil tras crear/actualizar/eliminar).
 * @param {string} [key] - Si se omite, limpia toda la caché
 */
function invalidateCatalogCache(key) {
  if (!key) {
    catalogCache.clear();
    return;
  }
  for (const k of catalogCache.keys()) {
    if (k.startsWith(`${key}:`)) catalogCache.delete(k);
  }
}

module.exports = { getCatalogCached, invalidateCatalogCache };
