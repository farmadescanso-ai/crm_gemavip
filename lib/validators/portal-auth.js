/**
 * Validación express-validator para login y recuperación del portal cliente.
 */
const { body } = require('express-validator');

const portalLoginPost = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Introduce tu email.')
    .isEmail()
    .withMessage('Email no válido.')
    .isLength({ max: 254 }),
  body('password')
    .isString()
    .isLength({ min: 1, max: 512 })
    .withMessage('Introduce tu contraseña.'),
  body('returnTo')
    .optional({ values: 'falsy' })
    .trim()
    .custom((v) => {
      if (v == null || v === '') return true;
      if (typeof v !== 'string' || !v.startsWith('/') || v.includes('//')) throw new Error('Enlace no válido.');
      return true;
    })
];

const portalForgotPasswordPost = [
  body('email')
    .trim()
    .notEmpty()
    .isEmail()
    .isLength({ max: 254 })
];

const portalResetPasswordPost = [
  body('token')
    .trim()
    .notEmpty()
    .matches(/^[a-f0-9]{64}$/i)
    .withMessage('Token no válido.'),
  body('password')
    .isString()
    .isLength({ min: 8, max: 128 })
    .withMessage('La contraseña debe tener entre 8 y 128 caracteres.'),
  body('password_confirm')
    .isString()
    .custom((v, { req }) => v === req.body.password)
    .withMessage('Las contraseñas no coinciden.')
];

module.exports = { portalLoginPost, portalForgotPasswordPost, portalResetPasswordPost };
