'use strict';
const { body, param, query } = require('express-validator');

const visitasListQuery = [
  query('comercialId').optional({ checkFalsy: true }).isInt({ min: 0, max: 999_999_999 }),
  query('clienteId').optional({ checkFalsy: true }).isInt({ min: 0, max: 999_999_999 }),
  query('from').optional().isString().isLength({ max: 40 }).trim(),
  query('to').optional().isString().isLength({ max: 40 }).trim(),
  query('limit').optional().isInt({ min: 1, max: 500 }),
  query('page').optional().isInt({ min: 1, max: 1_000_000 })
];

const visitasEventsQuery = [
  query('start').optional().isString().isLength({ max: 64 }).trim(),
  query('end').optional().isString().isLength({ max: 64 }).trim()
];

const visitaIdParam = [param('id').isInt({ min: 1, max: 999_999_999 })];

const visitaJsonBody = [
  body().custom((_v, { req }) => {
    const b = req.body;
    if (b == null || typeof b !== 'object' || Array.isArray(b)) {
      throw new Error('Body debe ser un objeto JSON');
    }
    return true;
  })
];

module.exports = {
  visitasListQuery,
  visitasEventsQuery,
  visitaIdParam,
  visitaJsonBody
};
