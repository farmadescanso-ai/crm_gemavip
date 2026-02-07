const express = require('express');

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/', (_req, res) => {
  res
    .status(200)
    .type('text/plain; charset=utf-8')
    .send('CRM Gemavip: servicio activo');
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'crm_gemavip',
    timestamp: new Date().toISOString()
  });
});

// En Vercel (runtime @vercel/node) se exporta la app como handler.
module.exports = app;

