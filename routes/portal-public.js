/**
 * Rutas públicas bajo /portal (enlace mágico a documento).
 */
'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('../config/mysql-crm');
const { getHoldedApiKeyOptional } = require('../lib/holded-api');
const { fetchDocumentPdf } = require('../lib/portal-holded-documents');
const { loadPortalCliente } = require('../lib/portal-auth');
const { getEffectivePortalFlags, isPortalGloballyEnabled } = require('../lib/portal-permissions');

const router = express.Router();

router.get('/documento/:token', async (req, res, next) => {
  try {
    const raw = String(req.params.token || '').trim();
    if (!raw || raw.length < 16) return res.status(400).send('Enlace no válido');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const row = await db.findPortalDocumentoEnlaceByTokenHash(hash);
    if (!row) return res.status(404).send('Enlace no válido o caducado');

    const exp = row.pde_expires_at ? new Date(row.pde_expires_at) : null;
    if (exp && exp.getTime() < Date.now()) return res.status(410).send('Este enlace ha caducado');

    const cfg = await db.getPortalConfig().catch(() => null);
    if (!isPortalGloballyEnabled(cfg)) return res.status(503).send('Portal no disponible');

    const cliente = await loadPortalCliente(row.pde_cli_id);
    const ov = await db.getPortalClienteOverride(row.pde_cli_id).catch(() => null);
    const flags = getEffectivePortalFlags(cfg, ov);

    const tipo = String(row.pde_tipo_doc || '').toLowerCase();
    const map = {
      invoice: flags.ver_facturas,
      estimate: flags.ver_presupuestos,
      waybill: flags.ver_albaranes,
      salesorder: flags.ver_pedidos
    };
    if (!map[tipo]) return res.status(403).send('Documento no habilitado');

    const apiKey = getHoldedApiKeyOptional();
    if (!apiKey) return res.status(503).send('Servicio temporalmente no disponible');

    const docId = String(row.pde_ref_externa || '').trim();
    const { buffer, contentType } = await fetchDocumentPdf(tipo, docId, apiKey);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${tipo}-${docId}.pdf"`);
    res.send(buffer);
    try {
      await db.markPortalDocumentoEnlaceUsed(row.pde_id);
    } catch (_) {}
    return;
  } catch (e) {
    next(e);
  }
});

module.exports = router;
