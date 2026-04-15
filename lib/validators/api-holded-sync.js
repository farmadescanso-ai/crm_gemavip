'use strict';
const { body, query } = require('express-validator');

const holdedImportPost = [
  body('dryRun').optional().isIn([true, false, 0, 1, '0', '1', '']),
  body('maxRows').optional().isInt({ min: 1, max: 2_000_000 }),
  body('tags').optional(),
  query('dryRun').optional().isIn(['0', '1', '']),
  query('maxRows').optional().isInt({ min: 1, max: 2_000_000 })
];

module.exports = { holdedImportPost };
