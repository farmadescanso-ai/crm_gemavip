const express = require('express');
const db = require('../../config/mysql-crm');

const router = express.Router();

function toYmd(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function sanitizeComercialesPublic(rows) {
  return (rows || [])
    .map((c) => ({
      id: c?.id ?? c?.Id ?? null,
      nombre: c?.Nombre ?? c?.nombre ?? c?.name ?? null
    }))
    .filter((c) => c.id && c.nombre);
}

// Landing pública
router.get('/registro-visitas', async (req, res, next) => {
  try {
    const comercialesRaw = await db.getComerciales();
    const comerciales = sanitizeComercialesPublic(comercialesRaw);

    const today = new Date().toISOString().slice(0, 10);
    const success = String(req.query.success || '') === '1';
    const error = typeof req.query.error === 'string' ? String(req.query.error) : null;
    const fecha = toYmd(req.query.fecha) || today;
    const registrosHoy = await db.getRegistroVisitasByFecha(fecha, { limit: 25 }).catch(() => []);

    res.render('public-registro-visitas', {
      comerciales,
      tiposVisita: ['Presencial', 'Online', 'Teléfono', 'Email', 'Otro'],
      motivos: ['Prospección', 'Seguimiento', 'Cierre', 'Incidencia', 'Formación', 'Otro'],
      resultados: ['Visitado', 'No localizado', 'Cierre', 'Seguimiento pendiente', 'Reprogramar', 'Otro'],
      registrosHoy,
      success,
      error,
      values: {
        fecha,
        comercialId: String(req.query.comercialId || ''),
        cliente: String(req.query.cliente || ''),
        ciudadZona: String(req.query.ciudadZona || ''),
        tipoVisita: String(req.query.tipoVisita || 'Presencial'),
        motivo: String(req.query.motivo || ''),
        resultado: String(req.query.resultado || ''),
        importe: String(req.query.importe || ''),
        proximaAccion: String(req.query.proximaAccion || ''),
        proximaFecha: toYmd(req.query.proximaFecha) || '',
        notas: String(req.query.notas || '')
      }
    });
  } catch (e) {
    next(e);
  }
});

// Guardar registro (público)
router.post('/registro-visitas', async (req, res, next) => {
  try {
    const fecha = toYmd(req.body?.fecha || req.body?.Fecha);
    const comercialId = Number(req.body?.comercialId || req.body?.ComercialId || 0) || null;
    const cliente = String(req.body?.cliente || req.body?.Cliente || '').trim().slice(0, 180);
    const ciudadZona = String(req.body?.ciudadZona || req.body?.CiudadZona || '').trim().slice(0, 120) || null;
    const tipoVisita = String(req.body?.tipoVisita || req.body?.TipoVisita || '').trim().slice(0, 40);
    const motivo = String(req.body?.motivo || req.body?.Motivo || '').trim().slice(0, 40) || null;
    const resultado = String(req.body?.resultado || req.body?.Resultado || '').trim().slice(0, 40) || null;
    const importeRaw = String(req.body?.importe ?? req.body?.Importe ?? '').trim();
    const importe = importeRaw ? Number(importeRaw.replace(',', '.')) : null;
    const proximaAccion = String(req.body?.proximaAccion || req.body?.ProximaAccion || '').trim().slice(0, 120) || null;
    const proximaFecha = toYmd(req.body?.proximaFecha || req.body?.ProximaFecha) || null;
    const notas = String(req.body?.notas || req.body?.Notas || '').trim().slice(0, 800) || null;

    const accept = String(req.headers?.accept || '');
    const wantsJson = accept.includes('application/json');

    const fail = (message) => {
      if (wantsJson) return res.status(400).json({ ok: false, error: message });
      // Redirigir preservando datos mínimos (evitar URL enorme con textarea)
      const qs = new URLSearchParams({
        error: message,
        fecha: fecha || '',
        comercialId: String(comercialId || ''),
        cliente,
        ciudadZona: ciudadZona || '',
        tipoVisita: tipoVisita || '',
        motivo: motivo || '',
        resultado: resultado || '',
        importe: importeRaw || '',
        proximaAccion: proximaAccion || '',
        proximaFecha: proximaFecha || ''
      });
      return res.redirect(`/registro-visitas?${qs.toString()}`);
    };

    if (!fecha) return fail('Fecha obligatoria');
    if (!comercialId) return fail('Comercial obligatorio');
    if (!cliente) return fail('Cliente obligatorio');
    if (!tipoVisita) return fail('Tipo de visita obligatorio');
    if (importe !== null && !Number.isFinite(importe)) return fail('Importe no válido');

    await db.ensureRegistroVisitasSchema?.();

    const result = await db.createRegistroVisita({
      fecha,
      comercial_id: comercialId,
      cliente,
      ciudad_zona: ciudadZona,
      tipo_visita: tipoVisita,
      motivo,
      resultado,
      importe_estimado: importe,
      proxima_accion: proximaAccion,
      proxima_fecha: proximaFecha,
      notas,
      ip: req.ip,
      user_agent: String(req.headers['user-agent'] || '').slice(0, 255) || null
    });

    if (wantsJson) return res.status(201).json({ ok: true, result });
    return res.redirect('/registro-visitas?success=1');
  } catch (e) {
    next(e);
  }
});

// API pública mínima (para frontends externos si lo necesitas)
router.get('/public/comerciales', async (_req, res, next) => {
  try {
    const items = await db.getComerciales();
    res.json({ ok: true, items: sanitizeComercialesPublic(items) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

