/**
 * Validación de query params en GET /api/clientes (sin cambiar contratos de respuesta).
 */
const { query } = require('express-validator');

const listClientesQuery = [
  query('q').optional().isString().isLength({ max: 500 }).trim(),
  query('search').optional().isString().isLength({ max: 500 }).trim(),
  query('limit').optional().isInt({ min: 1, max: 500 }),
  query('page').optional().isInt({ min: 1, max: 1_000_000 }),
  query('offset').optional().isInt({ min: 0, max: 10_000_000 })
];

const suggestQuery = [
  query('q').optional().isString().isLength({ max: 300 }).trim(),
  query('search').optional().isString().isLength({ max: 300 }).trim(),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('force').optional().isIn(['0', '1', '']),
  query('scope').optional().isString().isLength({ max: 32 }).trim()
];

const buscarQuery = [
  query('q').optional().isString().isLength({ max: 300 }).trim(),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('exclude').optional().isInt({ min: 0, max: 999_999_999 }),
  query('scope').optional().isString().isLength({ max: 32 }).trim()
];

module.exports = {
  listClientesQuery,
  suggestQuery,
  buscarQuery
};
