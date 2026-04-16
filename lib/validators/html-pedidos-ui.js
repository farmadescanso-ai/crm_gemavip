'use strict';
const { body, param } = require('express-validator');

const pedidoIdParam = [param('id').isInt({ min: 1, max: 999_999_999 }).withMessage('ID no válido')];

function bodyIsObject() {
  return body().custom((_v, { req }) => {
    const b = req.body;
    if (b == null || typeof b !== 'object' || Array.isArray(b)) {
      throw new Error('Body no válido');
    }
    return true;
  });
}

function limitBodyStringSizes({ maxLen = 8000, maxFields = 800 } = {}) {
  return body().custom((_v, { req }) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return true;
    const entries = Object.entries(b);
    if (entries.length > maxFields) throw new Error('Demasiados campos en el formulario');
    for (const [_k, v] of entries) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        if (v.length > 200) throw new Error('Demasiados valores en un campo');
        for (const it of v) {
          if (typeof it === 'string' && it.length > maxLen) throw new Error('Campo demasiado largo');
        }
        continue;
      }
      if (typeof v === 'string' && v.length > maxLen) throw new Error('Campo demasiado largo');
    }
    return true;
  });
}

const ymd = (field) =>
  body(field)
    .optional({ checkFalsy: true })
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage(`${field} no es una fecha válida (YYYY-MM-DD)`);

const pedidoCreateValidators = [
  bodyIsObject(),
  limitBodyStringSizes({ maxLen: 12000, maxFields: 1200 }),
  body('Id_Cliente').isInt({ min: 1, max: 999_999_999 }).withMessage('Id_Cliente no válido'),
  body('Id_Cial').optional({ checkFalsy: true }).isInt({ min: 1, max: 999_999_999 }),
  body('Id_Tarifa').optional({ checkFalsy: true }).isInt({ min: 0, max: 999_999_999 }),
  body('Id_FormaPago').optional({ checkFalsy: true }).isInt({ min: 0, max: 999_999_999 }),
  body('Id_TipoPedido').optional({ checkFalsy: true }).isInt({ min: 0, max: 999_999_999 }),
  body('Id_EstadoPedido').optional({ checkFalsy: true }).isInt({ min: 0, max: 999_999_999 }),
  body('NumPedidoCliente').optional().isString().isLength({ max: 60 }).trim(),
  body('NumAsociadoHefame').optional().isString().isLength({ max: 80 }).trim(),
  ymd('FechaPedido'),
  ymd('FechaEntrega'),
  body('EstadoPedido').optional().isString().isLength({ max: 40 }).trim(),
  body('Observaciones').optional().isString().isLength({ max: 5000 }).trim(),
  body('EsEspecial').optional().isIn(['0', '1', 0, 1, true, false, 'on', 'off', '']).withMessage('EsEspecial no válido'),
  body('Dto').optional({ checkFalsy: true }).matches(/^-?\d+(?:[.,]\d+)?$/).withMessage('Dto no válido'),
  body('lineas').optional(),
  body('Lineas').optional()
];

const pedidoEditValidators = [
  bodyIsObject(),
  limitBodyStringSizes({ maxLen: 12000, maxFields: 1400 }),
  // mismos campos que create; en edit algunos pueden omitirse pero UI los suele mandar
  body('Id_Cliente').optional({ checkFalsy: true }).isInt({ min: 1, max: 999_999_999 }),
  body('Id_Cial').optional({ checkFalsy: true }).isInt({ min: 1, max: 999_999_999 }),
  body('Id_Tarifa').optional({ checkFalsy: true }).isInt({ min: 0, max: 999_999_999 }),
  body('Id_FormaPago').optional({ checkFalsy: true }).isInt({ min: 0, max: 999_999_999 }),
  body('Id_TipoPedido').optional({ checkFalsy: true }).isInt({ min: 0, max: 999_999_999 }),
  body('Id_EstadoPedido').optional({ checkFalsy: true }).isInt({ min: 0, max: 999_999_999 }),
  body('NumPedidoCliente').optional().isString().isLength({ max: 60 }).trim(),
  body('NumAsociadoHefame').optional().isString().isLength({ max: 80 }).trim(),
  ymd('FechaPedido'),
  ymd('FechaEntrega'),
  body('EstadoPedido').optional().isString().isLength({ max: 40 }).trim(),
  body('Observaciones').optional().isString().isLength({ max: 5000 }).trim(),
  body('EsEspecial').optional().isIn(['0', '1', 0, 1, true, false, 'on', 'off', '']).withMessage('EsEspecial no válido'),
  body('Dto').optional({ checkFalsy: true }).matches(/^-?\d+(?:[.,]\d+)?$/).withMessage('Dto no válido'),
  body('lineas').optional(),
  body('Lineas').optional()
];

const pedidoEstadoValidators = [
  bodyIsObject(),
  limitBodyStringSizes({ maxLen: 2000, maxFields: 50 }),
  body('estadoId').isInt({ min: 0, max: 999_999_999 }).withMessage('estadoId no válido'),
  body('estado').optional().isString().isLength({ max: 40 }).trim()
];

module.exports = {
  pedidoIdParam,
  pedidoCreateValidators,
  pedidoEditValidators,
  pedidoEstadoValidators
};

