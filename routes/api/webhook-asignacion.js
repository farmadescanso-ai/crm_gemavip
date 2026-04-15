/**
 * Webhook para asignación de cliente desde n8n.
 * POST /api/webhook/asignacion-cliente
 * Requiere: X-API-Key (API_KEY configurada en .env)
 * Body: { clienteId, userEmail, aprobado }
 */
const express = require('express');
const db = require('../../config/mysql-crm');
const { rejectIfValidationFailsJson } = require('../../lib/validation-handlers');
const { webhookAsignacionClienteBody } = require('../../lib/validators/api-webhook');
const { asyncHandler, toInt, toBool } = require('./_utils');

const router = express.Router();

router.post(
  '/asignacion-cliente',
  ...webhookAsignacionClienteBody,
  rejectIfValidationFailsJson(),
  asyncHandler(async (req, res) => {
    const { clienteId, userEmail, aprobado } = req.body || {};

    const id = toInt(clienteId, 0);
    if (!id) {
      return res.status(400).json({ ok: false, error: 'clienteId no válido' });
    }

    const email = typeof userEmail === 'string' ? userEmail.trim() : '';
    if (!email) {
      return res.status(400).json({ ok: false, error: 'userEmail requerido' });
    }

    const esAprobado = toBool(aprobado, false);

    if (!esAprobado) {
      return res.json({ ok: true, aprobado: false, mensaje: 'No se requiere actualización' });
    }

    const comercial = await db.getComercialByEmail(email);
    if (!comercial) {
      return res.status(404).json({
        ok: false,
        error: `Comercial no encontrado con email: ${email}`
      });
    }

    const comId = toInt(comercial.com_id ?? comercial.id ?? comercial.Id, 0);
    if (!comId) {
      return res.status(500).json({
        ok: false,
        error: 'Comercial sin ID válido'
      });
    }

    const cliente = await db.getClienteById(id);
    if (!cliente) {
      return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
    }

    await db.updateCliente(id, { cli_com_id: comId, Id_Cial: comId });

    return res.json({
      ok: true,
      aprobado: true,
      com_id: comId,
      clienteId: id,
      mensaje: 'Cliente asignado correctamente'
    });
  })
);

module.exports = router;
