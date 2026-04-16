'use strict';
const { body, param } = require('express-validator');

const visitaIdParam = [param('id').isInt({ min: 1, max: 999_999_999 }).withMessage('ID no válido')];

function bodyIsObject() {
  return body().custom((_v, { req }) => {
    const b = req.body;
    if (b == null || typeof b !== 'object' || Array.isArray(b)) {
      throw new Error('Body no válido');
    }
    return true;
  });
}

function limitBodyStringSizes({ maxLen = 4000, maxFields = 80 } = {}) {
  return body().custom((_v, { req }) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return true;
    const entries = Object.entries(b);
    if (entries.length > maxFields) throw new Error('Demasiados campos en el formulario');
    for (const [_k, v] of entries) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        if (v.length > 30) throw new Error('Demasiados valores en un campo');
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

const ymdRequired = (field) =>
  body(field)
    .isString()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage(`${field} obligatorio (YYYY-MM-DD)`);

const hmOptional = (field) =>
  body(field)
    .optional({ checkFalsy: true })
    .isString()
    .matches(/^\d{2}:\d{2}$/)
    .withMessage(`${field} no válido (HH:MM)`);

const visitasCreateValidators = [
  bodyIsObject(),
  limitBodyStringSizes({ maxLen: 4000, maxFields: 80 }),
  ymdRequired('Fecha'),
  hmOptional('Hora'),
  hmOptional('Hora_Final'),
  body('TipoVisita').optional({ checkFalsy: true }).isString().isLength({ max: 80 }).trim(),
  body('Estado').optional({ checkFalsy: true }).isString().isLength({ max: 40 }).trim(),
  body('ClienteId').optional({ checkFalsy: true }).isInt({ min: 1, max: 999_999_999 }),
  body('ComercialId').optional({ checkFalsy: true }).isInt({ min: 1, max: 999_999_999 }),
  body('Notas').optional().isString().isLength({ max: 1000 }).trim()
];

const visitasEditValidators = [
  bodyIsObject(),
  limitBodyStringSizes({ maxLen: 4000, maxFields: 80 }),
  ymdRequired('Fecha'),
  hmOptional('Hora'),
  hmOptional('Hora_Final'),
  body('TipoVisita').optional({ checkFalsy: true }).isString().isLength({ max: 80 }).trim(),
  body('Estado').optional({ checkFalsy: true }).isString().isLength({ max: 40 }).trim(),
  body('ClienteId').optional({ checkFalsy: true }).isInt({ min: 1, max: 999_999_999 }),
  body('ComercialId').optional({ checkFalsy: true }).isInt({ min: 1, max: 999_999_999 }),
  body('Notas').optional().isString().isLength({ max: 1000 }).trim()
];

module.exports = {
  visitaIdParam,
  visitasCreateValidators,
  visitasEditValidators
};

