'use strict';
const { query } = require('express-validator');

const notificacionesListQuery = [
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('page').optional().isInt({ min: 1, max: 1_000_000 })
];

module.exports = { notificacionesListQuery };
