'use strict';
const { body, param, query } = require('express-validator');

const pedidosListQuery = [
  query('comercialId').optional({ checkFalsy: true }).isInt({ min: 0, max: 999_999_999 }),
  query('clienteId').optional({ checkFalsy: true }).isInt({ min: 0, max: 999_999_999 }),
  query('from').optional().isString().isLength({ max: 40 }).trim(),
  query('to').optional().isString().isLength({ max: 40 }).trim(),
  query('search').optional().isString().isLength({ max: 500 }).trim(),
  query('limit').optional().isInt({ min: 1, max: 500 }),
  query('page').optional().isInt({ min: 1, max: 1_000_000 })
];

const pedidosPreciosQuery = [
  query('tarifaId').optional().isInt({ min: 0, max: 999_999_999 }),
  query('articuloIds').optional().isString().isLength({ max: 8000 }).trim(),
  query('articulos').optional().isString().isLength({ max: 8000 }).trim()
];

const pedidoIdParam = [param('id').isInt({ min: 1, max: 999_999_999 })];

const pedidoLineaIdParam = [param('id').isInt({ min: 1, max: 999_999_999 })];

const pedidoGetByIdQuery = [
  query('includeLineas').optional().isString().isLength({ max: 64 }).trim(),
  query('include_lineas').optional().isString().isLength({ max: 64 }).trim(),
  query('include').optional().isString().isLength({ max: 64 }).trim(),
  query('lineas').optional().isString().isLength({ max: 8 }).trim()
];

/** POST/PUT pedido: body flexible pero debe ser objeto (no array). */
const pedidoJsonBody = [
  body().custom((_v, { req }) => {
    const b = req.body;
    if (b == null || typeof b !== 'object' || Array.isArray(b)) {
      throw new Error('Body debe ser un objeto JSON');
    }
    return true;
  })
];

const pedidosLineaDeleteQuery = [
  query('PedidoId').optional({ checkFalsy: true }).isInt({ min: 1, max: 999_999_999 }),
  query('Id_NumPedido').optional({ checkFalsy: true }).isInt({ min: 1, max: 999_999_999 }),
  query('pedidoId').optional({ checkFalsy: true }).isInt({ min: 1, max: 999_999_999 })
];

module.exports = {
  pedidosListQuery,
  pedidosPreciosQuery,
  pedidoIdParam,
  pedidoLineaIdParam,
  pedidoGetByIdQuery,
  pedidoJsonBody,
  pedidosLineaDeleteQuery
};
