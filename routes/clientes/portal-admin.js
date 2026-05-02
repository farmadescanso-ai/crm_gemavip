/**
 * Gestión del portal del cliente (página dedicada /clientes/:id/portal): acceso, contraseña, invitación.
 */
'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sendPortalInviteEmail } = require('../../lib/send-password-reset-email');
const { parseClienteRouteId, clienteNotFoundPage, redirectIfHoldedIdInUrl } = require('./helpers');

function baseUrl(req) {
  const env = process.env.APP_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (env) return env.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function registerPortalAdminRoutes(router, { db, requireLogin, isAdminUser }) {
  async function canManagePortal(req, res, clienteId) {
    const admin = isAdminUser(res.locals.user);
    if (admin) return true;
    return db.canComercialEditCliente(clienteId, res.locals.user?.id);
  }

  router.get('/:id/portal', requireLogin, async (req, res, next) => {
    try {
      const pr = await parseClienteRouteId(req, db);
      if (!pr.ok && pr.reason === 'notfound') return clienteNotFoundPage(req, res, pr.raw);
      if (!pr.ok) return res.status(400).send('ID no válido');
      const { id, raw } = pr;
      if (redirectIfHoldedIdInUrl(req, res, id, raw)) return;
      if (!(await canManagePortal(req, res, id))) return res.status(403).send('Sin permiso');
      const item = await db.getClienteById(id);
      if (!item) return clienteNotFoundPage(req, res, id);
      const admin = isAdminUser(res.locals.user);
      const canEdit =
        admin || (await db.canComercialEditCliente(id, res.locals.user?.id));
      const [portalAccesoRow, portalOverride, portalCfg] = await Promise.all([
        db.getPortalAccesoByCliId(id).catch(() => null),
        db.getPortalClienteOverride(id).catch(() => null),
        db.getPortalConfig().catch(() => null)
      ]);
      const pq = req.query || {};
      const portalFlash = {
        ok: typeof pq.portal_ok === 'string' ? pq.portal_ok : null,
        err: typeof pq.portal_error === 'string' ? pq.portal_error : null
      };
      const loginClienteUrl = `${baseUrl(req)}/login-cliente`;
      res.render('cliente-portal-gestion', {
        title: 'Portal del cliente — gestión',
        item,
        admin,
        canEdit,
        portalAcceso: portalAccesoRow,
        portalOverride,
        portalCfg,
        portalFlash,
        loginClienteUrl
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/:id/portal/activar', requireLogin, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
      if (!(await canManagePortal(req, res, id))) return res.status(403).send('Sin permiso');

      const email = String(req.body?.email || '').trim().toLowerCase();
      const passPlain = String(req.body?.password || '').trim();
      if (!email) return res.redirect(`/clientes/${id}/portal?portal_error=email`);

      let hash;
      if (passPlain.length >= 8) {
        hash = await bcrypt.hash(passPlain, 12);
      } else {
        const temp = crypto.randomBytes(12).toString('base64url');
        hash = await bcrypt.hash(temp, 12);
      }

      await db.createPortalAcceso(id, email, hash, { activo: true });
      return res.redirect(`/clientes/${id}/portal?portal_ok=activado`);
    } catch (e) {
      next(e);
    }
  });

  router.post('/:id/portal/set-password', requireLogin, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
      if (!(await canManagePortal(req, res, id))) return res.status(403).send('Sin permiso');

      const passPlain = String(req.body?.password || '').trim();
      if (passPlain.length < 8) return res.redirect(`/clientes/${id}/portal?portal_error=pass`);
      const hash = await bcrypt.hash(passPlain, 12);
      const acc = await db.getPortalAccesoByCliId(id);
      if (!acc) return res.redirect(`/clientes/${id}/portal?portal_error=noacceso`);
      await db.updatePortalPassword(id, hash);
      return res.redirect(`/clientes/${id}/portal?portal_ok=password`);
    } catch (e) {
      next(e);
    }
  });

  router.post('/:id/portal/desactivar', requireLogin, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
      if (!(await canManagePortal(req, res, id))) return res.status(403).send('Sin permiso');
      await db.setPortalAccesoActivo(id, false);
      return res.redirect(`/clientes/${id}/portal?portal_ok=desactivado`);
    } catch (e) {
      next(e);
    }
  });

  router.post('/:id/portal/reactivar', requireLogin, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
      if (!(await canManagePortal(req, res, id))) return res.status(403).send('Sin permiso');
      await db.setPortalAccesoActivo(id, true);
      return res.redirect(`/clientes/${id}/portal?portal_ok=reactivado`);
    } catch (e) {
      next(e);
    }
  });

  router.post('/:id/portal/invitar', requireLogin, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
      if (!(await canManagePortal(req, res, id))) return res.status(403).send('Sin permiso');
      const acc = await db.getPortalAccesoByCliId(id);
      if (!acc?.pac_email_login) return res.redirect(`/clientes/${id}/portal?portal_error=noemail`);
      const cliente = await db.getClienteById(id);
      const nombre = cliente?.cli_nombre_cial || cliente?.cli_nombre_razon_social || '';
      const url = `${baseUrl(req)}/login-cliente`;
      const ok = await sendPortalInviteEmail(acc.pac_email_login, url, nombre ? String(nombre).slice(0, 80) : null);
      return res.redirect(`/clientes/${id}/portal?portal_ok=${ok ? 'mail' : 'mail_fail'}`);
    } catch (e) {
      next(e);
    }
  });

  router.post('/:id/portal/overrides', requireLogin, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID no válido');
      if (!(await canManagePortal(req, res, id))) return res.status(403).send('Sin permiso');

      const heredar = req.body?.pco_heredar_global === '1' || req.body?.pco_heredar_global === 'on';
      if (heredar) {
        await db.query('DELETE FROM portal_cliente_override WHERE pco_cli_id = ?', [id]).catch(() => {});
        return res.redirect(`/clientes/${id}/portal?portal_ok=overrides`);
      }
      const parseOpt = (name) => {
        const v = req.body?.[name];
        return v === '1' || v === 'on' || v === 'true' ? 1 : 0;
      };

      await db.upsertPortalClienteOverride(id, {
        pco_heredar_global: 0,
        pco_ver_facturas: parseOpt('pco_ver_facturas'),
        pco_ver_pedidos: parseOpt('pco_ver_pedidos'),
        pco_ver_presupuestos: parseOpt('pco_ver_presupuestos'),
        pco_ver_albaranes: parseOpt('pco_ver_albaranes'),
        pco_ver_catalogo: parseOpt('pco_ver_catalogo')
      });
      return res.redirect(`/clientes/${id}/portal?portal_ok=overrides`);
    } catch (e) {
      next(e);
    }
  });
}

module.exports = { registerPortalAdminRoutes };
