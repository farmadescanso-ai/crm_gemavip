/**
 * res.locals para vistas EJS: usuario, navegación, notificaciones, formatos, teléfonos.
 */
const { formatTelefonoForDisplay, normalizeTelefonoForDB, getTelefonoForHref } = require('../../lib/telefono-utils');
const { safeJsonInline } = require('../../lib/safe-json-inline');
const { toNum, round2, escapeHtml } = require('../../lib/utils');

function createEjsLocalsMiddleware(deps) {
  const {
    db,
    getCommonNavLinksForRoles,
    getRoleNavLinksForRoles,
    isAdminUser
  } = deps;

  let notifCache = { value: 0, ts: 0 };
  const NOTIF_CACHE_TTL_MS = 30000;

  async function cachedNotifCount() {
    const now = Date.now();
    if (now - notifCache.ts < NOTIF_CACHE_TTL_MS) return notifCache.value;
    const count = await db.getNotificacionesPendientesCount();
    notifCache = { value: count, ts: now };
    return count;
  }

  return async function ejsLocalsMiddleware(req, res, next) {
    res.locals.user = req.user || null;
    const roles = res.locals.user?.roles || [];
    res.locals.navLinks = res.locals.user ? getCommonNavLinksForRoles(roles) : [];
    res.locals.roleNavLinks = res.locals.user ? getRoleNavLinksForRoles(roles, res.locals.user) : [];
    if (res.locals.user && isAdminUser(res.locals.user)) {
      try {
        res.locals.notificacionesPendientes = await cachedNotifCount();
      } catch (_) {
        res.locals.notificacionesPendientes = 0;
      }
    } else {
      res.locals.notificacionesPendientes = 0;
    }

    res.locals.fmtDateES = (val) => {
      if (!val) return '';
      try {
        const s = String(val);
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;

        const d = val instanceof Date ? val : new Date(val);
        if (!Number.isFinite(d.getTime())) return s;
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = String(d.getFullYear());
        return `${dd}/${mm}/${yy}`;
      } catch (_) {
        return String(val);
      }
    };
    res.locals.fmtDateISO = (val) => {
      if (!val) return '';
      try {
        const s = String(val);
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;

        const d = val instanceof Date ? val : new Date(val);
        if (!Number.isFinite(d.getTime())) return '';
        const yy = String(d.getFullYear());
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yy}-${mm}-${dd}`;
      } catch (_) {
        return '';
      }
    };
    res.locals.fmtTimeHM = (val) => {
      if (!val) return '';
      try {
        if (val instanceof Date) return val.toISOString().slice(11, 16);
        const s = String(val);
        const m = s.match(/(\d{2}):(\d{2})/);
        if (m) return `${m[1]}:${m[2]}`;
        return s.slice(0, 5);
      } catch (_) {
        return String(val).slice(0, 5);
      }
    };

    res.locals.fmtNumES = (value, decimals = 2) => {
      const x = Number(value);
      if (!Number.isFinite(x)) return '';
      const d = Math.max(0, Math.min(6, Number(decimals) || 0));
      const sign = x < 0 ? '-' : '';
      const abs = Math.abs(x);
      const factor = Math.pow(10, d);
      const rounded = Math.round((abs + Number.EPSILON) * factor) / factor;
      const parts = rounded.toFixed(d).split('.');
      const intPart = String(parts[0] || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      const decPart = d ? ',' + String(parts[1] || '').padEnd(d, '0') : '';
      return sign + intPart + decPart;
    };
    res.locals.fmtEurES = (value) => {
      const x = Number(value);
      if (!Number.isFinite(x)) return '';
      return `${res.locals.fmtNumES(x, 2)}€`;
    };

    res.locals.fmtTelefono = formatTelefonoForDisplay;
    res.locals.normalizeTelefono = normalizeTelefonoForDB;
    res.locals.getTelefonoForHref = getTelefonoForHref;
    res.locals.safeJsonInline = safeJsonInline;
    res.locals.toNum = toNum;
    res.locals.round2 = round2;
    res.locals.escapeHtml = escapeHtml;

    next();
  };
}

module.exports = { createEjsLocalsMiddleware };
