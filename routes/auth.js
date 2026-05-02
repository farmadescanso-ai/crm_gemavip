/**
 * Rutas de autenticación: login, logout, recuperar/cambiar contraseña.
 */

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/mysql-crm');
const { normalizeRoles } = require('../lib/auth');
const { clearPortalSession } = require('../lib/portal-auth');
const { comercialRowIsActive } = require('../lib/comercial-helpers');
const { requireLogin } = require('../lib/auth');
const { sendPasswordResetEmail, APP_BASE_URL } = require('../lib/mailer');
const { _n, getStoredPasswordFromRow } = require('../lib/app-helpers');
const { loginLimiter, passwordResetLimiter } = require('../lib/rate-limit');
const { rejectIfValidationFailsHtml } = require('../lib/validation-handlers');
const {
  loginPost,
  forgotPasswordPost,
  resetPasswordPost,
  changePasswordPost
} = require('../lib/validators/auth');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session?.user) {
    const returnTo = req.query?.returnTo;
    if (returnTo && typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.includes('//')) {
      return res.redirect(returnTo);
    }
    return res.redirect('/dashboard');
  }
  const restablecido = req.query?.restablecido === '1';
  const returnTo = req.query?.returnTo;
  let error = null;
  if (req.query?.cuenta === 'inactiva') {
    error =
      'Tu cuenta está desactivada o la sesión se cerró por seguridad. Si necesitas acceso, contacta con administración.';
  }
  res.render('login', { title: 'Login', error, restablecido, returnTo });
});

router.post(
  '/login',
  loginLimiter,
  ...loginPost,
  rejectIfValidationFailsHtml('login', (req) => ({ title: 'Login', returnTo: req.body?.returnTo })),
  async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '').trim();

    const comercial = await db.getComercialByEmail(email);
    if (!comercial) {
      return res.status(401).render('login', { title: 'Login', error: 'Credenciales incorrectas' });
    }

    const stored = getStoredPasswordFromRow(comercial);
    if (!stored && process.env.DEBUG_LOGIN === '1') {
      console.warn('[DEBUG_LOGIN] Comercial encontrado pero sin columna de contraseña. Keys:', Object.keys(comercial));
    }
    if (!stored || !stored.startsWith('$2')) {
      return res.status(401).render('login', {
        title: 'Login',
        error: 'Contraseña no válida. Usa "¿Olvidaste tu contraseña?" para restablecerla.'
      });
    }
    const ok = await bcrypt.compare(password, stored);
    if (!ok) {
      if (process.env.DEBUG_LOGIN === '1') {
        console.warn('[DEBUG_LOGIN] Usuario encontrado pero contraseña no coincide.', {
          email,
          roll: _n(comercial.com_roll, comercial.Roll || comercial.roll),
          columnasPass: Object.keys(comercial).filter((k) => /pass|password|clave|contrase/i.test(k)),
          storedLen: stored.length,
          storedPrefix: stored ? stored.substring(0, 7) : '(vacío)'
        });
      }
      return res.status(401).render('login', { title: 'Login', error: 'Credenciales incorrectas' });
    }

    const comId = Number(_n(comercial.com_id, comercial.id, comercial.Id)) || 0;
    const poolId = await db.getComercialIdPool();
    if (poolId != null && comId === Number(poolId)) {
      return res.status(403).render('login', {
        title: 'Login',
        error: 'Esta cuenta es de uso interno (pool). No se puede iniciar sesión.'
      });
    }

    if (!comercialRowIsActive(comercial)) {
      return res.status(403).render('login', {
        title: 'Login',
        error: 'Esta cuenta está desactivada. Contacta con administración si necesitas acceso.'
      });
    }

    clearPortalSession(req);
    req.session.user = {
      id: comId,
      nombre: _n(comercial.com_nombre, comercial.Nombre || null),
      email: _n(_n(comercial.com_email, comercial.Email), comercial.email || email),
      roles: normalizeRoles(_n(comercial.com_roll, comercial.Roll || comercial.roll || comercial.Rol))
    };

    const returnTo = req.body?.returnTo;
    if (returnTo && typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.includes('//')) {
      return res.redirect(returnTo);
    }
    return res.redirect('/dashboard');
  } catch (e) {
    next(e);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

router.get('/login/olvidar-contrasena', (req, res) => {
  if (req.session?.user) return res.redirect('/dashboard');
  res.render('login-olvidar-contrasena', { title: 'Recuperar contraseña', error: null, success: null });
});

router.post(
  '/login/olvidar-contrasena',
  passwordResetLimiter,
  ...forgotPasswordPost,
  rejectIfValidationFailsHtml('login-olvidar-contrasena', () => ({
    title: 'Recuperar contraseña',
    success: null
  })),
  async (req, res, next) => {
  try {
    if (req.session?.user) return res.redirect('/dashboard');
    const email = String(req.body?.email || '').trim().toLowerCase();
    const MAX_EMAIL_ATTEMPTS = 3;
    try {
      if (typeof db.countRecentPasswordResetAttempts === 'function') {
        const recentByEmail = await db.countRecentPasswordResetAttempts(email, 1);
        if (recentByEmail >= MAX_EMAIL_ATTEMPTS) {
          return res.render('login-olvidar-contrasena', {
            title: 'Recuperar contraseña',
            error: null,
            success:
              'Si existe una cuenta con ese correo, ya has recibido un enlace recientemente. Revisa tu bandeja o espera 1 hora para solicitar otro.'
          });
        }
      }
    } catch (_) { /* ignorar si no disponible */ }
    const comercial = await db.getComercialByEmail(email);
    if (comercial) {
      const token = crypto.randomBytes(32).toString('hex');
      const comercialId = _n(_n(comercial.com_id, comercial.id), comercial.Id);
      await db.createPasswordResetToken(comercialId, email, token, 1);
      const resetLink = `${APP_BASE_URL.replace(/\/$/, '')}/login/restablecer-contrasena?token=${encodeURIComponent(token)}`;
      const sendResult = await sendPasswordResetEmail(email, resetLink, _n(comercial.com_nombre, comercial.Nombre || ''));
      if (!sendResult.sent) {
        console.warn('[AUTH] Recuperación: email NO enviado a', email, '| Motivo:', sendResult.error || 'SMTP/Graph no configurado. Configura SMTP_HOST, SMTP_USER, SMTP_PASS en Admin → Configuración Email o en variables de entorno.');
      }
    }
    res.render('login-olvidar-contrasena', {
      title: 'Recuperar contraseña',
      error: null,
      success:
        'Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña en unos minutos. Revisa la carpeta de spam.'
    });
  } catch (e) {
    next(e);
  }
});

router.get('/login/restablecer-contrasena', (req, res) => {
  if (req.session?.user) return res.redirect('/dashboard');
  const token = String(req.query?.token || '').trim();
  if (!token) {
    return res.redirect('/login/olvidar-contrasena');
  }
  res.render('login-restablecer-contrasena', { title: 'Nueva contraseña', token, error: null });
});

router.post(
  '/login/restablecer-contrasena',
  ...resetPasswordPost,
  rejectIfValidationFailsHtml('login-restablecer-contrasena', (req) => ({
    title: 'Nueva contraseña',
    token: String(req.body?.token || '').trim()
  })),
  async (req, res, next) => {
  try {
    if (req.session?.user) return res.redirect('/dashboard');
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    const row = await db.findPasswordResetToken(token);
    if (!row) {
      return res.status(400).render('login-restablecer-contrasena', {
        title: 'Nueva contraseña',
        token: '',
        error: 'El enlace ha caducado o ya se ha usado. Solicita uno nuevo desde "¿Olvidaste tu contraseña?".'
      });
    }
    const hashed = await bcrypt.hash(password, 12);
    const comercialId = row.comercial_id ?? row.pwdres_com_id ?? row.Id_Comercial;
    await db.updateComercialPassword(comercialId, hashed);
    await db.markPasswordResetTokenAsUsed(token);
    res.redirect('/login?restablecido=1');
  } catch (e) {
    next(e);
  }
});

router.get('/cuenta/cambiar-contrasena', requireLogin, (req, res) => {
  res.render('cuenta-cambiar-contrasena', { title: 'Cambiar contraseña', error: null, success: null });
});

router.post(
  '/cuenta/cambiar-contrasena',
  requireLogin,
  ...changePasswordPost,
  rejectIfValidationFailsHtml('cuenta-cambiar-contrasena', () => ({
    title: 'Cambiar contraseña',
    success: null
  })),
  async (req, res, next) => {
  try {
    const userId = Number(res.locals.user?.id);
    if (!userId) return res.redirect('/login');
    const current = String(req.body?.current_password || '');
    const newPass = String(req.body?.password || '');
    const comercial = await db.getComercialById(userId);
    if (!comercial) return res.redirect('/login');
    const stored = getStoredPasswordFromRow(comercial);
    if (!stored || !stored.startsWith('$2')) {
      return res.status(400).render('cuenta-cambiar-contrasena', {
        title: 'Cambiar contraseña',
        error: 'Tu contraseña no está en formato seguro. Usa "¿Olvidaste tu contraseña?" para restablecerla.',
        success: null
      });
    }
    const ok = await bcrypt.compare(current, stored);
    if (!ok) {
      return res.status(400).render('cuenta-cambiar-contrasena', {
        title: 'Cambiar contraseña',
        error: 'La contraseña actual no es correcta.',
        success: null
      });
    }
    const hashed = await bcrypt.hash(newPass, 12);
    await db.updateComercialPassword(userId, hashed);
    res.render('cuenta-cambiar-contrasena', {
      title: 'Cambiar contraseña',
      error: null,
      success: 'Contraseña actualizada correctamente.'
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
