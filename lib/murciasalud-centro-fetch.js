/**
 * Descarga HTML de fichas MurciaSalud con comprobación anti-SSRF.
 * Solo https://(www.)murciasalud.es/caps.php?op=mostrar_centro&...
 */

const ALLOWED_HOSTS = new Set(['www.murciasalud.es', 'murciasalud.es']);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * @param {string} urlString
 * @returns {string} URL canónica para fetch
 */
function assertAllowedMurciaCentroCatalogUrl(urlString) {
  let u;
  try {
    u = new URL(String(urlString).trim());
  } catch {
    throw new Error('URL no válida.');
  }
  if (u.protocol !== 'https:') {
    throw new Error('Solo se permiten URLs con https://');
  }
  if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) {
    throw new Error('El dominio debe ser murciasalud.es (con o sin www).');
  }
  const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
  if (path !== '/caps.php') {
    throw new Error('La ruta debe ser /caps.php (ficha de catálogo de centros).');
  }
  const op = u.searchParams.get('op');
  if (op !== 'mostrar_centro') {
    throw new Error('La URL debe incluir op=mostrar_centro (ficha de un centro).');
  }
  return u.href;
}

/**
 * @param {string} urlString
 * @returns {Promise<string>}
 */
async function fetchMurciaCentroPageHtml(urlString) {
  const href = assertAllowedMurciaCentroCatalogUrl(urlString);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 28000);
  try {
    const res = await fetch(href, {
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`MurciaSalud respondió HTTP ${res.status}.`);
    }
    return await res.text();
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error('Tiempo de espera agotado al descargar la página.');
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  assertAllowedMurciaCentroCatalogUrl,
  fetchMurciaCentroPageHtml,
};
