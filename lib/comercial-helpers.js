/**
 * Helpers para rutas de comerciales (formularios, metadatos).
 */

const db = require('../config/mysql-crm');
const { _n } = require('./app-helpers');
const { normalizeRoles } = require('./auth');

async function loadComercialesTableMeta() {
  try {
    const t = await db._resolveTableNameCaseInsensitive('comerciales');
    const cols = await db._getColumns(t);
    const set = new Set((cols || []).map((c) => String(c).toLowerCase()));
    const has = (name) => set.has(String(name).toLowerCase());
    const hasActivo = await db.comercialesHasComActivoColumn().catch(() => false);
    return {
      hasMeetEmail: has('meet_email'),
      hasTeamsEmail: has('teams_email'),
      hasPlataforma: has('plataforma_reunion_preferida'),
      hasFijoMensual: has('fijo_mensual'),
      hasActivo
    };
  } catch (_) {
    return { hasMeetEmail: false, hasTeamsEmail: false, hasPlataforma: true, hasFijoMensual: true, hasActivo: false };
  }
}

function sanitizeComercialForView(row) {
  if (!row || typeof row !== 'object') return row;
  // eslint-disable-next-line no-unused-vars
  const { Password, password, ...rest } = row;
  return rest;
}

function parseMoneyLike(v, fallback = null) {
  const s = String(_n(v, '')).trim();
  if (!s) return fallback;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function parseIntLike(v, fallback = null) {
  const s = String(_n(v, '')).trim();
  if (!s) return fallback;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCp(cpRaw) {
  const s = String(_n(cpRaw, '')).trim();
  if (!s) return '';
  return s.replace(/[^0-9]/g, '').slice(0, 5);
}

function rolesFromBody(body) {
  const raw = body?.Roll;
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const roles = arr.map((x) => String(x || '').trim()).filter(Boolean);
  const unique = Array.from(new Set(roles));
  return unique.length > 0 ? unique : ['Comercial'];
}

/** Fila de comercial (o objeto con com_activo/Activo). Si no hay columna, se considera activo. */
function comercialRowIsActive(row) {
  if (!row || typeof row !== 'object') return false;
  const v = row.com_activo ?? row.Activo ?? row.activo;
  if (v === undefined || v === null) return true;
  if (typeof v === 'boolean') return v;
  const n = Number(v);
  if (Number.isFinite(n)) return n !== 0;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'sí' || s === 'si';
}

module.exports = {
  loadComercialesTableMeta,
  sanitizeComercialForView,
  parseMoneyLike,
  parseIntLike,
  normalizeCp,
  rolesFromBody,
  normalizeRoles,
  comercialRowIsActive
};
