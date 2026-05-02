/**
 * Login, logout y recuperación de contraseña del portal del cliente.
 */
'use strict';

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/mysql-crm');
const { rejectIfValidationFailsHtml } = require('../lib/validation-handlers');
const { portalLoginPost, portalForgotPasswordPost, portalResetPasswordPost } = require('../lib/validators/portal-auth');
const { portalLoginLimiter, portalPasswordResetLimiter } = require('../lib/rate-limit');
const { sendPortalPasswordResetEmail } = require('../lib/send-password-reset-email');
const { getAppUrl } = require('../lib/send-password-reset-email');
const { clearComercialSession, clientePermitePortal, loadPortalCliente } = require('../lib/portal-auth');
const { isPortalGloballyEnabled } = require('../lib/portal-permissions');

const router = express.Router();

function baseUrl(req) {
  const env = process.env.APP_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (env) return env.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

router.get('/login-cliente', (req, res) => {
  if (req.session?.portalUser?.cli_id) {
    const rt = req.query?.returnTo;
    if (rt && typeof rt === 'string' && rt.startsWith('/') && !rt.includes('//')) {
      return res.redirect(rt);
    }
    return res.redirect('/portal');
  }
  const rtQ = req.query?.returnTo;
  const quierePortal =
    typeof rtQ === 'string' && rtQ.startsWith('/') && !rtQ.includes('//') && rtQ.startsWith('/portal');
  if (req.session?.user && !quierePortal) {
    return res.redirect('/dashboard');
  }
  res.render('portal/login-cliente', {
    title: 'Portal cliente',
    error: null,
    restablecido: req.query?.restablecido === '1',
    returnTo: typeof req.query?.returnTo === 'string' ? req.query.returnTo : null,
    portalDisabled: false,
    comercialOcupandoSesion: !!(req.session?.user && quierePortal)
  });
});

router.post(
  '/login-cliente',
  portalLoginLimiter,
  ...portalLoginPost,
  rejectIfValidationFailsHtml('portal/login-cliente', (req) => ({
    title: 'Portal cliente',
    returnTo: req.body?.returnTo,
    portalDisabled: false
  })),
  async (req, res, next) => {
    try {
      const cfg = await db.getPortalConfig().catch(() => null);
      if (!isPortalGloballyEnabled(cfg)) {
        return res.status(403).render('portal/login-cliente', {
          title: 'Portal cliente',
          error: 'El portal no está activo en este momento.',
          returnTo: req.body?.returnTo,
          portalDisabled: true
        });
      }

      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const acceso = await db.getPortalAccesoByEmail(email);
      if (!acceso || !acceso.pac_activo) {
        return res.status(401).render('portal/login-cliente', {
          title: 'Portal cliente',
          error: 'Credenciales incorrectas o acceso desactivado.',
          returnTo: req.body?.returnTo
        });
      }

      const stored = acceso.pac_password_hash;
      if (!stored || !String(stored).startsWith('$2')) {
        return res.status(401).render('portal/login-cliente', {
          title: 'Portal cliente',
          error: 'Acceso no configurado correctamente. Contacta con tu comercial.',
          returnTo: req.body?.returnTo
        });
      }

      const ok = await bcrypt.compare(password, stored);
      if (!ok) {
        return res.status(401).render('portal/login-cliente', {
          title: 'Portal cliente',
          error: 'Credenciales incorrectas.',
          returnTo: req.body?.returnTo
        });
      }

      const cliente = await loadPortalCliente(acceso.pac_cli_id);
      if (!clientePermitePortal(cliente)) {
        return res.status(403).render('portal/login-cliente', {
          title: 'Portal cliente',
          error: 'Tu cuenta no está disponible. Contacta con tu comercial.',
          returnTo: req.body?.returnTo
        });
      }

      clearComercialSession(req);
      req.session.portalUser = {
        cli_id: Number(acceso.pac_cli_id),
        email: acceso.pac_email_login,
        pac_id: acceso.pac_id
      };
      await db.updatePortalUltimoAcceso(acceso.pac_cli_id);

      const returnTo = req.body?.returnTo;
      if (returnTo && typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.includes('//')) {
        return res.redirect(returnTo);
      }
      return res.redirect('/portal');
    } catch (e) {
      next(e);
    }
  }
);

router.post('/logout-portal', (req, res) => {
  delete req.session.portalUser;
  res.redirect('/login-cliente');
});

router.get('/login-cliente/olvidar-contrasena', (req, res) => {
  if (req.session?.portalUser) return res.redirect('/portal');
  res.render('portal/olvidar-contrasena', { title: 'Recuperar contraseña', error: null, success: null });
});

router.post(
  '/login-cliente/olvidar-contrasena',
  portalPasswordResetLimiter,
  ...portalForgotPasswordPost,
  rejectIfValidationFailsHtml('portal/olvidar-contrasena', () => ({ title: 'Recuperar contraseña', success: null })),
  async (req, res, next) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const MAX_EMAIL_ATTEMPTS = 3;
      const recent = await db.countRecentPortalPasswordResetAttempts(email, 1);
      if (recent >= MAX_EMAIL_ATTEMPTS) {
        return res.render('portal/olvidar-contrasena', {
          title: 'Recuperar contraseña',
          error: null,
          success:
            'Si existe una cuenta con ese correo, revisa tu bandeja o espera antes de solicitar otro enlace.'
        });
      }

      const acceso = await db.getPortalAccesoByEmail(email);
      const sameReply = () =>
        res.render('portal/olvidar-contrasena', {
          title: 'Recuperar contraseña',
          error: null,
          success: 'Si existe una cuenta con ese correo, recibirás un enlace en breve.'
        });

      if (!acceso || !acceso.pac_activo) return sameReply();

      const rawToken = crypto.randomBytes(32).toString('hex');
      await db.createPortalPasswordResetToken(acceso.pac_cli_id, email, rawToken, 1);
      const cliente = await loadPortalCliente(acceso.pac_cli_id);
      const nombre = cliente?.cli_nombre_cial || cliente?.cli_nombre_razon_social || '';
      const link = `${baseUrl(req)}/login-cliente/restablecer-contrasena?token=${rawToken}`;
      await sendPortalPasswordResetEmail(email, link, nombre ? String(nombre).slice(0, 120) : null);
      return sameReply();
    } catch (e) {
      next(e);
    }
  }
);

router.get('/login-cliente/restablecer-contrasena', (req, res) => {
  if (req.session?.portalUser) return res.redirect('/portal');
  const token = String(req.query?.token || '').trim();
  res.render('portal/restablecer-contrasena', { title: 'Nueva contraseña', token, error: null });
});

router.post(
  '/login-cliente/restablecer-contrasena',
  ...portalResetPasswordPost,
  rejectIfValidationFailsHtml('portal/restablecer-contrasena', (req) => ({
    title: 'Nueva contraseña',
    token: req.body?.token
  })),
  async (req, res, next) => {
    try {
      const token = String(req.body?.token || '').trim();
      const password = String(req.body?.password || '');
      const row = await db.findPortalPasswordResetToken(token);
      if (!row) {
        return res.status(400).render('portal/restablecer-contrasena', {
          title: 'Nueva contraseña',
          token: '',
          error: 'El enlace no es válido o ha caducado.'
        });
      }
      const hash = await bcrypt.hash(password, 12);
      await db.updatePortalPassword(row.pprt_cli_id, hash);
      await db.markPortalPasswordResetTokenUsed(token);
      res.redirect('/login-cliente?restablecido=1');
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
