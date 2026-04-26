/**
 * Rewrites de ruta para despliegue en Vercel (__path) y UI HTML bajo prefijo /api erróneo.
 */

function parsePathFromQueryString(urlLike) {
  if (typeof urlLike !== 'string' || !urlLike) return null;
  const q = urlLike.indexOf('?');
  if (q === -1) return null;
  try {
    const params = new URLSearchParams(urlLike.slice(q + 1));
    const v = params.get('__path');
    if (v && v.trim()) return v.trim();
  } catch (_) {}
  const m = urlLike.match(/[?&]__path=([^&]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' '));
  } catch (_) {
    return m[1];
  }
}

function readVercelPathParam(req) {
  let pathParam = req.query && req.query.__path;
  if (Array.isArray(pathParam)) pathParam = pathParam[0];
  if (typeof pathParam === 'string' && pathParam.trim()) return pathParam;

  const ou = typeof req.originalUrl === 'string' ? req.originalUrl : '';
  const fromOu = parsePathFromQueryString(ou);
  if (fromOu) return fromOu;

  const u = typeof req.url === 'string' ? req.url : '';
  const fromUrl = parsePathFromQueryString(u);
  if (fromUrl) return fromUrl;

  return null;
}

function stripVercelPathFromQueryString(urlLike) {
  if (typeof urlLike !== 'string' || !urlLike) return urlLike;
  const qi = urlLike.indexOf('?');
  if (qi === -1) return urlLike;
  const pathPart = urlLike.slice(0, qi);
  try {
    const sp = new URLSearchParams(urlLike.slice(qi + 1));
    if (!sp.has('__path')) return urlLike;
    sp.delete('__path');
    const rest = sp.toString();
    return rest ? `${pathPart}?${rest}` : pathPart;
  } catch (_) {
    return urlLike;
  }
}

function pathWithoutApiPrefix(pathOnly) {
  if (typeof pathOnly !== 'string' || !pathOnly.startsWith('/api/')) return null;
  const after = pathOnly.slice(4);
  return after.startsWith('/') ? after.slice(1) : after;
}

function vercelPathRewrite(req, _res, next) {
  const raw = readVercelPathParam(req);
  if (typeof raw === 'string' && raw.trim()) {
    let p = raw.trim();
    if (!p.startsWith('/')) p = `/${p}`;
    req.url = p;
  } else if (typeof req.url === 'string' && req.url.startsWith('/api/index')) {
    const rest = req.url.slice('/api/index'.length);
    if (rest.startsWith('?')) {
      const parsed = parsePathFromQueryString(rest);
      if (parsed && parsed.trim()) {
        let p = parsed.trim();
        if (!p.startsWith('/')) p = `/${p}`;
        req.url = p;
      } else {
        req.url = '/';
      }
    } else {
      req.url = rest || '/';
    }
  }
  if (typeof req.url === 'string') {
    req.url = stripVercelPathFromQueryString(req.url);
    req.originalUrl = req.url;
  }
  next();
}

/**
 * Ficha de contacto solo numérica: /clientes/123 (no /edit).
 * Debe reescribirse desde /api/clientes/123 igual que /edit, salvo peticiones API (Accept JSON sin HTML).
 */
const RE_CLIENTES_VISTA_NUMERICA = /^clientes\/\d+\/?$/;

function acceptLooksJsonApiOnly(accept) {
  const a = String(accept || '').toLowerCase();
  if (!a.includes('application/json')) return false;
  if (a.includes('text/html')) return false;
  return true;
}

const HTML_UI_PREFIXES = [
  /^clientes\/(?:new|duplicados|unificar|[^/]+\/(?:edit|delete))(?:\/|$)/,
  /^login(?:\/|$)/,
  /^dashboard(?:\/|$)/,
  /^pedidos(?:\/|$)/,
  /^comerciales(?:\/|$)/,
  /^admin(?:\/|$)/,
  /^visitas(?:\/|$)/,
  /^articulos(?:\/|$)/,
  /^notificaciones(?:\/|$)/,
  /^mis-notificaciones(?:\/|$)/,
  /^manual(?:\/|$)/,
  /^cuenta(?:\/|$)/,
  /^ventas-gemavip(?:\/|$)/,
  /^registro-visitas(?:\/|$)/,
  /^webhook\/(?:aprobar-asignacion|aprobar-pedido)(?:\/|$)/
];

function apiHtmlUiPathRewrite(req, _res, next) {
  if (typeof req.url !== 'string') return next();
  const qIdx = req.url.indexOf('?');
  const pathOnly = qIdx === -1 ? req.url : req.url.slice(0, qIdx);
  const qs = qIdx === -1 ? '' : req.url.slice(qIdx);
  if (!pathOnly.startsWith('/api/')) return next();

  const rest = pathWithoutApiPrefix(pathOnly);
  if (rest == null) return next();

  const vistaPkSoloDigitos = RE_CLIENTES_VISTA_NUMERICA.test(rest);
  if (vistaPkSoloDigitos && acceptLooksJsonApiOnly(req.headers.accept)) {
    return next();
  }

  const hit = HTML_UI_PREFIXES.some((re) => re.test(rest)) || vistaPkSoloDigitos;
  if (!hit) return next();

  req.url = stripVercelPathFromQueryString(`/${rest}${qs}`);
  req.originalUrl = req.url;
  next();
}

module.exports = {
  vercelPathRewrite,
  apiHtmlUiPathRewrite,
  pathWithoutApiPrefix,
  stripVercelPathFromQueryString,
  readVercelPathParam,
  parsePathFromQueryString
};
