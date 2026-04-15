'use strict';
const { body } = require('express-validator');

const webhookAsignacionClienteBody = [
  body('clienteId').isInt({ min: 1, max: 999_999_999 }).withMessage('clienteId no válido'),
  body('userEmail').isString().trim().isLength({ min: 3, max: 320 }).isEmail().withMessage('userEmail no válido'),
  body('aprobado').optional().isIn([true, false, 0, 1, '0', '1'])
];

module.exports = { webhookAsignacionClienteBody };
