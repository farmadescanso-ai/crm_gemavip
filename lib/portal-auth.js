/**
 * Middleware y helpers para sesión portal (cliente), separada de comerciales.
 */
'use strict';

const db = require('../config/mysql-crm');
const { getEffectivePortalFlags, isPortalGloballyEnabled } = require('./portal-permissions');

function requirePortalLogin(req, res, next) {
  const pu = req.session?.portalUser;
  if (pu?.cli_id) return next();
  const returnTo = encodeURIComponent(req.originalUrl || '/portal');
  return res.redirect(`/login-cliente?returnTo=${returnTo}`);
}

function requirePortalLoginJson(req, res, next) {
  if (req.session?.portalUser?.cli_id) return next();
  const accept = String(req.get('Accept') || '');
  if (accept.includes('application/json')) {
    return res.status(401).json({ ok: false, error: 'no_portal_session' });
  }
  return res.redirect('/login-cliente');
}

/** Impide acceso CRM si solo hay sesión portal (p. ej. rutas que exigen comercial). */
function requireNoPortalSession(req, res, next) {
  if (req.session?.portalUser?.cli_id && !req.session?.user) {
    return res.redirect('/portal');
  }
  return next();
}

/**
 * Al iniciar sesión portal: limpia comercial. Al iniciar comercial: limpia portal (en routes/auth).
 */
function clearPortalSession(req) {
  if (req.session) delete req.session.portalUser;
}

function clearComercialSession(req) {
  if (req.session) delete req.session.user;
}

async function loadPortalCliente(cliId) {
  const id = Number(cliId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return db.getClienteById(id);
}

function clientePermitePortal(cliente) {
  if (!cliente) return false;
  if (cliente.cli_FechaBaja != null && String(cliente.cli_FechaBaja).trim() !== '') return false;
  const ok = cliente.cli_ok_ko;
  if (ok === 0 || ok === '0' || String(ok).toUpperCase() === 'KO') return false;
  return true;
}

async function getPortalSessionContext(cliId) {
  const [cfg, ov, cliente] = await Promise.all([
    db.getPortalConfig().catch(() => null),
    db.getPortalClienteOverride(cliId).catch(() => null),
    loadPortalCliente(cliId)
  ]);
  const flags = getEffectivePortalFlags(cfg, ov);
  return { cfg, ov, cliente, flags, portalEnabled: isPortalGloballyEnabled(cfg) };
}

module.exports = {
  requirePortalLogin,
  requirePortalLoginJson,
  requireNoPortalSession,
  clearPortalSession,
  clearComercialSession,
  loadPortalCliente,
  clientePermitePortal,
  getPortalSessionContext
};
