/**
 * Helper compartido para la API de Holded (invoicing v1).
 * Centraliza autenticación, base URL y métodos HTTP.
 */
'use strict';

const axios = require('axios');

const HOLDED_BASE = 'https://api.holded.com/api/invoicing/v1';

function _getApiKey() {
  const k = (process.env.HOLDED_API_KEY || '').trim();
  if (!k) throw new Error('Falta HOLDED_API_KEY en variables de entorno');
  return k;
}

/**
 * GET / genérico a Holded.
 * @param {string} path - Ruta relativa (ej. '/contacts/abc123')
 * @param {Object} [params] - Query params
 * @param {string} [apiKey] - Si se omite, usa process.env.HOLDED_API_KEY
 */
async function fetchHolded(path, params = {}, apiKey) {
  const key = apiKey || _getApiKey();
  const config = {
    method: 'GET',
    url: `${HOLDED_BASE}${path}`,
    headers: { key },
    params: Object.keys(params).length ? params : undefined,
    timeout: 20000
  };
  const res = await axios(config);
  return res.data;
}

/**
 * POST a Holded con body JSON.
 * @param {string} path - Ruta relativa (ej. '/documents/purchaseorder')
 * @param {Object} body - Payload JSON
 * @param {string} [apiKey] - Si se omite, usa process.env.HOLDED_API_KEY
 */
async function postHolded(path, body, apiKey) {
  const key = apiKey || _getApiKey();
  const res = await axios({
    method: 'POST',
    url: `${HOLDED_BASE}${path}`,
    headers: { key, 'Content-Type': 'application/json' },
    data: body,
    timeout: 20000,
    validateStatus: () => true
  });
  if (res.status >= 400) {
    const msg = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    throw new Error(`Holded ${res.status}: ${msg}`);
  }
  return res.data;
}

module.exports = { HOLDED_BASE, fetchHolded, postHolded };
