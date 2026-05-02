/**
 * Listados y metadatos de documentos Holded filtrados por contacto (cli_Id_Holded).
 */
'use strict';

const { fetchHolded, fetchHoldedDocumentPdf, getHoldedApiKeyOptional } = require('./holded-api');

const DOC_TYPES = {
  facturas: 'invoice',
  presupuestos: 'estimate',
  albaranes: 'waybill',
  pedidos_holded: 'salesorder'
};

function _nowUnix() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Lista documentos de un tipo; filtra por contact Holded en memoria.
 * @param {string} docType - ej. invoice, estimate, salesorder
 * @param {string} holdedContactId
 * @param {string|null} [apiKey]
 * @returns {Promise<Array<object>>}
 */
async function listDocumentsForContact(docType, holdedContactId, apiKey) {
  const key = apiKey || getHoldedApiKeyOptional();
  if (!key || !holdedContactId) return [];
  const end = _nowUnix();
  const start = end - 86400 * 365 * 8;
  let raw;
  try {
    raw = await fetchHolded(
      `/documents/${docType}`,
      { starttmp: start, endtmp: end, sort: 'created-desc' },
      key
    );
  } catch (e) {
    console.warn('[portal-holded]', docType, e?.message || e);
    return [];
  }
  const list = Array.isArray(raw) ? raw : [];
  const cid = String(holdedContactId).trim();
  return list.filter((d) => d && String(d.contact || d.contactId || '').trim() === cid);
}

async function fetchDocumentPdf(docType, docId, apiKey) {
  return fetchHoldedDocumentPdf(docType, docId, apiKey || getHoldedApiKeyOptional());
}

module.exports = {
  DOC_TYPES,
  listDocumentsForContact,
  fetchDocumentPdf
};
