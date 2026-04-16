'use strict';
const { body, param } = require('express-validator');

const clienteIdParam = [param('id').isInt({ min: 1, max: 999_999_999 }).withMessage('ID no válido')];

function bodyIsObject() {
  return body().custom((_v, { req }) => {
    const b = req.body;
    if (b == null || typeof b !== 'object' || Array.isArray(b)) {
      throw new Error('Body no válido');
    }
    return true;
  });
}

function limitBodyStringSizes({ maxLen = 5000, maxFields = 400 } = {}) {
  return body().custom((_v, { req }) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return true;
    const entries = Object.entries(b);
    if (entries.length > maxFields) throw new Error('Demasiados campos en el formulario');
    for (const [_k, v] of entries) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        // Aceptar arrays pequeños (checkbox multi), pero limitar tamaño.
        if (v.length > 50) throw new Error('Demasiados valores en un campo');
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

const clienteCreateValidators = [
  bodyIsObject(),
  limitBodyStringSizes({ maxLen: 8000, maxFields: 500 }),
  body('dup_confirmed').optional().isIn(['0', '1', 0, 1, true, false]).withMessage('dup_confirmed no válido')
];

const clienteEditValidators = [
  bodyIsObject(),
  limitBodyStringSizes({ maxLen: 8000, maxFields: 700 })
];

const direccionEnvioCreateValidators = [
  bodyIsObject(),
  limitBodyStringSizes({ maxLen: 4000, maxFields: 60 }),
  body('Alias').optional().isString().isLength({ max: 120 }).trim(),
  body('Nombre_Destinatario').optional().isString().isLength({ max: 160 }).trim(),
  body('Direccion').optional().isString().isLength({ max: 200 }).trim(),
  body('Direccion2').optional().isString().isLength({ max: 200 }).trim(),
  body('Poblacion').optional().isString().isLength({ max: 120 }).trim(),
  body('CodigoPostal').optional().isString().isLength({ max: 20 }).trim(),
  body('Telefono').optional().isString().isLength({ max: 40 }).trim(),
  body('Movil').optional().isString().isLength({ max: 40 }).trim(),
  body('Email').optional().isString().isLength({ max: 320 }).trim(),
  body('Observaciones').optional().isString().isLength({ max: 2000 }).trim(),
  body('Es_Principal').optional().isIn(['0', '1', 0, 1, true, false]).withMessage('Es_Principal no válido')
];

const unificarDuplicadosValidators = [
  bodyIsObject(),
  limitBodyStringSizes({ maxLen: 4000, maxFields: 10 }),
  body('ids').custom((v) => {
    if (Array.isArray(v)) return true;
    if (typeof v === 'string') return true;
    throw new Error('ids no válido');
  })
];

module.exports = {
  clienteIdParam,
  clienteCreateValidators,
  clienteEditValidators,
  direccionEnvioCreateValidators,
  unificarDuplicadosValidators
};

