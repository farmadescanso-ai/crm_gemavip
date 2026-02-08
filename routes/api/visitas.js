const express = require('express');
const db = require('../../config/mysql-crm');
const { asyncHandler, toInt } = require('./_utils');

const router = express.Router();

function isAdminSessionUser(user) {
  const roles = user?.roles || [];
  return (roles || []).some((r) => String(r).toLowerCase().includes('admin'));
}

/**
 * @openapi
 * /api/visitas:
 *   get:
 *     summary: Listar visitas (opcionalmente filtrar por comercialId/clienteId)
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const comercialId = toInt(req.query.comercialId, null);
    const clienteId = toInt(req.query.clienteId, null);

    if (clienteId) {
      const items = await db.getVisitasByCliente(clienteId);
      return res.json({ ok: true, items });
    }
    if (comercialId) {
      const items = await db.getVisitasByComercial(comercialId);
      return res.json({ ok: true, items });
    }

    const items = await db.getVisitas(null);
    return res.json({ ok: true, items });
  })
);

/**
 * @openapi
 * /api/visitas/events:
 *   get:
 *     summary: Eventos de visitas para calendario (rango start/end)
 */
router.get(
  '/events',
  asyncHandler(async (req, res) => {
    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminSessionUser(sessionUser);
    const meta = await db._ensureVisitasMeta();

    const startRaw = typeof req.query.start === 'string' ? String(req.query.start) : '';
    const endRaw = typeof req.query.end === 'string' ? String(req.query.end) : '';
    const start = startRaw.slice(0, 10);
    const end = endRaw.slice(0, 10);

    if (!meta?.table || !meta?.pk) return res.json({ ok: true, items: [] });
    if (!meta.colFecha || !start || !end) return res.json({ ok: true, items: [] });

    const where = [];
    const params = [];

    if (!isAdmin) {
      const owner = db._buildVisitasOwnerWhere(meta, sessionUser, 'v');
      if (owner.clause) {
        where.push(owner.clause);
        params.push(...owner.params);
      } else {
        return res.json({ ok: true, items: [] });
      }
    }

    // Rango [start, end) para FullCalendar
    where.push(`DATE(v.\`${meta.colFecha}\`) >= ? AND DATE(v.\`${meta.colFecha}\`) < ?`);
    params.push(start, end);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const joinCliente = meta.colCliente ? 'LEFT JOIN clientes c ON v.`' + meta.colCliente + '` = c.Id' : '';
    const selectClienteNombre = meta.colCliente ? 'c.Nombre_Razon_Social as ClienteNombre' : 'NULL as ClienteNombre';

    const sql = `
      SELECT
        v.\`${meta.pk}\` as Id,
        v.\`${meta.colFecha}\` as Fecha,
        ${meta.colHora ? `v.\`${meta.colHora}\` as Hora,` : "'' as Hora,"}
        ${meta.colTipo ? `v.\`${meta.colTipo}\` as TipoVisita,` : "'' as TipoVisita,"}
        ${meta.colEstado ? `v.\`${meta.colEstado}\` as Estado,` : "'' as Estado,"}
        ${meta.colCliente ? `v.\`${meta.colCliente}\` as ClienteId,` : 'NULL as ClienteId,'}
        ${selectClienteNombre}
      FROM \`${meta.table}\` v
      ${joinCliente}
      ${whereSql}
      ORDER BY v.\`${meta.colFecha}\` ASC, v.\`${meta.pk}\` ASC
      LIMIT 5000
    `;

    const rows = await db.query(sql, params);
    const items = (rows || []).map((r) => {
      const date = r?.Fecha ? String(r.Fecha).slice(0, 10) : null;
      const hora = r?.Hora ? String(r.Hora).slice(0, 5) : '';
      const startIso = date ? (hora ? `${date}T${hora}:00` : `${date}`) : null;

      const cliente = r?.ClienteNombre ? String(r.ClienteNombre) : r?.ClienteId ? `Cliente ${r.ClienteId}` : 'Visita';
      const tipo = r?.TipoVisita ? String(r.TipoVisita) : '';
      const estado = r?.Estado ? String(r.Estado) : '';
      const title = `${hora ? hora + ' · ' : ''}${cliente}${tipo ? ` · ${tipo}` : ''}${estado ? ` (${estado})` : ''}`;

      return {
        id: r?.Id,
        title,
        start: startIso,
        allDay: !hora,
        url: r?.Id ? `/visitas/${r.Id}` : undefined
      };
    }).filter((e) => e.start);

    res.json({ ok: true, items });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const item = await db.getVisitaById(id);
    if (!item) return res.status(404).json({ ok: false, error: 'No encontrado' });
    res.json({ ok: true, item });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = await db.createVisita(req.body || {});
    res.status(201).json({ ok: true, result });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const result = await db.updateVisita(id, req.body || {});
    res.json({ ok: true, result });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const result = await db.deleteVisita(id);
    res.json({ ok: true, result });
  })
);

module.exports = router;

