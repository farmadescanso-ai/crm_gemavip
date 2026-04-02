/**
 * Import Holded → CRM vía API (cron / automatización).
 * POST /api/holded-sync/import  Header: Authorization: Bearer CRON_SECRET
 */
'use strict';

const express = require('express');
const db = require('../../config/mysql-crm');
const { importHoldedClientesEs, parseSelectedTagsInput } = require('../../lib/sync-holded-clientes');

const router = express.Router();

function unauthorized(res) {
  return res.status(401).json({ ok: false, error: 'No autorizado' });
}

function parseTags(body, query) {
  const raw = body?.tags ?? query?.tags;
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  return parseSelectedTagsInput(raw);
}

router.post('/import', async (req, res, next) => {
  try {
    const secret = (process.env.CRON_SECRET || '').trim();
    if (!secret) {
      return res.status(503).json({ ok: false, error: 'CRON_SECRET no configurado' });
    }
    const auth = String(req.headers.authorization || '').trim();
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token !== secret) {
      return unauthorized(res);
    }

    const dryRun = String(req.body?.dryRun ?? req.query?.dryRun ?? '').trim() === '1';
    const selectedTags = parseTags(req.body || {}, req.query || {});
    const maxRowsRaw = req.body?.maxRows ?? req.query?.maxRows;
    const maxRows = maxRowsRaw != null && String(maxRowsRaw).trim() !== '' ? Number(maxRowsRaw) : null;

    const result = await importHoldedClientesEs(db, {
      dryRun,
      selectedTags,
      maxRows: Number.isFinite(maxRows) && maxRows > 0 ? maxRows : undefined,
      syncSource: 'api_cron'
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
