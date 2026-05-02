/**
 * Rutas públicas bajo /portal (legacy). Los enlaces mágicos a documentos externos están retirados:
 * el portal Gemavip usa datos del propio CRM.
 */
'use strict';

const express = require('express');

const router = express.Router();

router.get('/documento/:token', (req, res) => {
  res
    .status(410)
    .type('text/plain; charset=utf-8')
    .send(
      'Este tipo de enlace ya no está disponible. Los documentos del cliente se gestionan en el CRM Gemavip y en el portal sin conexión a sistemas externos.'
    );
});

module.exports = router;
