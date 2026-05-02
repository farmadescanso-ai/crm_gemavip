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

/** API key opcional (no lanza): útil para degradar el portal si no hay clave. */
function getHoldedApiKeyOptional() {
  return (process.env.HOLDED_API_KEY || '').trim() || null;
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

/**
 * PUT a Holded (actualizar contacto u otro recurso).
 * @param {string} path - Ruta relativa (ej. '/contacts/abc123')
 * @param {Object} body - Payload JSON
 * @param {string} [apiKey]
 */
async function putHolded(path, body, apiKey) {
  const key = apiKey || _getApiKey();
  const res = await axios({
    method: 'PUT',
    url: `${HOLDED_BASE}${path}`,
    headers: { key, 'Content-Type': 'application/json' },
    data: body,
    timeout: 25000,
    validateStatus: () => true
  });
  if (res.status >= 400) {
    const msg = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    throw new Error(`Holded ${res.status}: ${msg}`);
  }
  return res.data;
}

/**
 * Descarga PDF de un documento Holded (invoicing v1).
 * Ruta típica: GET /documents/{docType}/{docId}/pdf
 * @returns {{ buffer: Buffer, contentType: string }}
 */
async function fetchHoldedDocumentPdf(docType, docId, apiKey) {
  const key = apiKey || _getApiKey();
  const path = `/documents/${String(docType).replace(/^\//, '')}/${encodeURIComponent(String(docId))}/pdf`;
  const res = await axios({
    method: 'GET',
    url: `${HOLDED_BASE}${path}`,
    headers: { key },
    responseType: 'arraybuffer',
    timeout: 60000,
    validateStatus: () => true
  });
  if (res.status >= 400) {
    const msg = res.data && Buffer.isBuffer(res.data) ? res.data.toString('utf8').slice(0, 200) : String(res.data || '');
    throw new Error(`Holded PDF ${res.status}: ${msg}`);
  }
  const ct = res.headers['content-type'] || 'application/pdf';
  return { buffer: Buffer.from(res.data), contentType: ct };
}

module.exports = { HOLDED_BASE, fetchHolded, postHolded, putHolded, fetchHoldedDocumentPdf, getHoldedApiKeyOptional };
