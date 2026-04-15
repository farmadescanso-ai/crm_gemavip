/**
 * Cadenas express-validator para rutas de autenticación (HTML).
 */
const { body } = require('express-validator');

/** POST /login */
const loginPost = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Introduce tu email.')
    .isEmail()
    .withMessage('Email no válido.')
    .isLength({ max: 254 })
    .withMessage('Email demasiado largo.'),
  body('password')
    .isString()
    .isLength({ min: 1, max: 512 })
    .withMessage('Introduce tu contraseña.'),
  body('returnTo')
    .optional({ values: 'falsy' })
    .trim()
    .custom((v) => {
      if (v == null || v === '') return true;
      if (typeof v !== 'string') throw new Error('Enlace de retorno no válido.');
      if (!v.startsWith('/') || v.includes('//') || v.length > 2048) {
        throw new Error('Enlace de retorno no válido.');
      }
      return true;
    })
];

/** POST /login/olvidar-contrasena */
const forgotPasswordPost = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Introduce tu email.')
    .isEmail()
    .withMessage('Email no válido.')
    .isLength({ max: 254 })
    .withMessage('Email demasiado largo.')
];

/** POST /login/restablecer-contrasena */
const resetPasswordPost = [
  body('token')
    .trim()
    .notEmpty()
    .withMessage('Token ausente.')
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

/** POST /cuenta/cambiar-contrasena */
const changePasswordPost = [
  body('current_password')
    .isString()
    .isLength({ min: 1, max: 512 })
    .withMessage('Introduce tu contraseña actual.'),
  body('password')
    .isString()
    .isLength({ min: 8, max: 128 })
    .withMessage('La contraseña nueva debe tener entre 8 y 128 caracteres.'),
  body('password_confirm')
    .isString()
    .custom((v, { req }) => v === req.body.password)
    .withMessage('Las contraseñas no coinciden.')
];

module.exports = {
  loginPost,
  forgotPasswordPost,
  resetPasswordPost,
  changePasswordPost
};
