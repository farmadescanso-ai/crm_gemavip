const rateLimit = require('express-rate-limit');

const isVercel = !!process.env.VERCEL;

/**
 * Login: 5 intentos por ventana de 15 minutos por IP.
 * Tras agotar intentos devuelve 429 con mensaje amigable.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login. Inténtalo de nuevo en 15 minutos.' },
  handler(req, res, _next, options) {
    const wantsJson = /application\/json/i.test(req.headers.accept || '');
    if (wantsJson) {
      return res.status(429).json(options.message);
    }
    return res.status(429).render('login', {
      title: 'Login',
      error: options.message.error
    });
  },
  keyGenerator: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
  skip: () => !isVercel && process.env.NODE_ENV !== 'production'
});

/**
 * API general: 100 peticiones por minuto.
 * Se identifica al usuario por session ID si existe, o por IP.
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Inténtalo de nuevo en un minuto.' },
  keyGenerator: (req) => req.session?.user?.id || req.ip || 'unknown'
});

/**
 * Recuperar contraseña: 3 intentos por ventana de 15 min por IP.
 * Complementa el rate limit por BD que ya existe en mysql-crm-login.js.
 */
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de recuperación. Inténtalo más tarde.' },
  keyGenerator: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
  skip: () => !isVercel && process.env.NODE_ENV !== 'production'
});

module.exports = { loginLimiter, apiLimiter, passwordResetLimiter };
