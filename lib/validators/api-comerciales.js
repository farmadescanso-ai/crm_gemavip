'use strict';
const { body, param } = require('express-validator');

const comercialIdParam = [param('id').isInt({ min: 1, max: 999_999_999 })];

const comercialJsonBody = [
  body().custom((_v, { req }) => {
    const b = req.body;
    if (b == null || typeof b !== 'object' || Array.isArray(b)) {
      throw new Error('Body debe ser un objeto JSON');
    }
    return true;
  })
];

module.exports = {
  comercialIdParam,
  comercialJsonBody
};
