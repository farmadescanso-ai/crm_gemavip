const express = require('express');
const db = require('../../config/mysql-crm');
const { asyncHandler, toInt, parsePagination } = require('./_utils');

const router = express.Router();

const { isAdminUser } = require('../../lib/auth');

/**
 * @openapi
 * /api/visitas:
 *   get:
 *     tags:
 *       - Visitas
 *     summary: Listar visitas (paginado, opcionalmente filtrar por comercialId/clienteId)
 *     parameters:
 *       - in: query
 *         name: comercialId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: clienteId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *     responses:
 *       200:
 *         description: OK
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminUser(sessionUser);
    const comercialId = toInt(req.query.comercialId, null);
    const clienteId = toInt(req.query.clienteId, null);
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });

    const filters = {
      comercialId: sessionUser && !isAdmin ? sessionUser.id : comercialId,
      clienteId,
      from: req.query.from,
      to: req.query.to
    };

    // Visitas por cliente: típicamente pocas, sin paginar
    if (clienteId) {
      const items = await db.getVisitasByCliente(clienteId);
      return res.json({ ok: true, items, paging: { limit: items.length, total: items.length } });
    }

    // Listado general o por comercial: paginado
    const [items, total] = await Promise.all([
      db.getVisitasPaged(filters, { limit, offset }),
      db.countVisitas(filters)
    ]);
    return res.json({ ok: true, items, paging: { limit, page, offset, total } });
  })
);

/**
 * @openapi
 * /api/visitas/events:
 *   get:
 *     tags:
 *       - Visitas
 *     summary: Eventos de visitas para calendario (rango start/end)
 *     parameters:
 *       - in: query
 *         name: start
 *         required: true
 *         schema:
 *           type: string
 *         description: Fecha inicio (YYYY-MM-DD o ISO)
 *       - in: query
 *         name: end
 *         required: true
 *         schema:
 *           type: string
 *         description: Fecha fin (YYYY-MM-DD o ISO)
 *     responses:
 *       200:
 *         description: OK
 */
router.get(
  '/events',
  asyncHandler(async (req, res) => {
    const sessionUser = req.session?.user || null;
    const isAdmin = isAdminUser(sessionUser);
    const meta = await db._ensureVisitasMeta();
    const clientesMeta = await db._ensureClientesMeta().catch(() => null);

    const startRaw = typeof req.query.start === 'string' ? String(req.query.start) : '';
    const endRaw = typeof req.query.end === 'string' ? String(req.query.end) : '';

    const extractYmd = (raw) => {
      if (!raw) return '';
      const s = String(raw);
      const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : '';
    };
    const addDaysYmd = (ymd, days) => {
      const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return ymd;
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const d = Number(m[3]);
      const dt = new Date(Date.UTC(y, mo, d + Number(days || 0)));
      return dt.toISOString().slice(0, 10);
    };

    let start = extractYmd(startRaw);
    let end = extractYmd(endRaw);
    // Algunas vistas (día/semana) pueden venir con end dentro del mismo día; garantizamos rango no vacío.
    if (start && end && end <= start) end = addDaysYmd(start, 1);

    if (!meta?.table || !meta?.pk) return res.json({ ok: true, items: [] });
    if (!meta.colFecha || !start || !end) return res.json({ ok: true, items: [] });

    const where = [];
    const params = [];

    if (!isAdmin) {
      const uIdNum = Number(sessionUser?.id);
      if (meta.colComercial && Number.isFinite(uIdNum) && uIdNum > 0) {
        where.push(`v.\`${meta.colComercial}\` = ?`);
        params.push(uIdNum);
      } else {
        const owner = db._buildVisitasOwnerWhere(meta, sessionUser, 'v');
        if (owner.clause) {
          where.push(owner.clause);
          params.push(...owner.params);
        } else {
          return res.json({ ok: true, items: [] });
        }
      }
    }

    // Rango [start, end) para FullCalendar
    where.push(`DATE(v.\`${meta.colFecha}\`) >= ? AND DATE(v.\`${meta.colFecha}\`) < ?`);
    params.push(start, end);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const tClientes = clientesMeta?.tClientes ? `\`${clientesMeta.tClientes}\`` : '`clientes`';
    const pkClientes = clientesMeta?.pk || 'cli_id';
    const joinCliente = meta.colCliente ? `LEFT JOIN ${tClientes} c ON v.\`${meta.colCliente}\` = c.\`${pkClientes}\`` : '';
    const colClienteNombre = clientesMeta?.colNombreRazonSocial || 'cli_nombre_razon_social';
    const selectClienteNombre = meta.colCliente ? `c.\`${colClienteNombre}\` as ClienteNombre` : 'NULL as ClienteNombre';

    const sql = `
      SELECT
        v.\`${meta.pk}\` as Id,
        v.\`${meta.colFecha}\` as Fecha,
        ${meta.colHora ? `v.\`${meta.colHora}\` as Hora,` : "'' as Hora,"}
        ${meta.colHoraFinal ? `v.\`${meta.colHoraFinal}\` as HoraFinal,` : "'' as HoraFinal,"}
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
    const toYmd = (value) => {
      if (!value) return null;
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      const s = String(value);
      const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
      return null;
    };
    const toHm = (value) => {
      if (!value) return '';
      if (value instanceof Date) return value.toISOString().slice(11, 16);
      const s = String(value);
      const m = s.match(/(\d{2}:\d{2})/);
      return m ? m[1] : '';
    };
    const addMinutesHHMM = (hhmm, minutes) => {
      const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return '';
      const hh = Number(m[1]);
      const mm = Number(m[2]);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return '';
      const total = (hh * 60 + mm + Number(minutes || 0)) % (24 * 60);
      const outH = String(Math.floor((total + 24 * 60) % (24 * 60) / 60)).padStart(2, '0');
      const outM = String(((total + 24 * 60) % (24 * 60)) % 60).padStart(2, '0');
      return `${outH}:${outM}`;
    };
    const items = (rows || []).map((r) => {
      const date = toYmd(r?.Fecha);
      const hora = toHm(r?.Hora);
      const horaFinal = toHm(r?.HoraFinal) || (hora ? addMinutesHHMM(hora, 30) : '');
      const startIso = date ? (hora ? `${date}T${hora}:00` : `${date}`) : null;
      const endIso = date && hora && horaFinal ? `${date}T${horaFinal}:00` : null;

      const cliente = r?.ClienteNombre ? String(r.ClienteNombre) : r?.ClienteId ? `Cliente ${r.ClienteId}` : 'Visita';
      const tipo = r?.TipoVisita ? String(r.TipoVisita) : '';
      const estado = r?.Estado ? String(r.Estado) : '';
      const title = `${hora ? hora + ' · ' : ''}${cliente}${tipo ? ` · ${tipo}` : ''}${estado ? ` (${estado})` : ''}`;

      return {
        id: r?.Id,
        title,
        start: startIso,
        end: endIso || undefined,
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

/**
 * @openapi
 * /api/visitas/{id}:
 *   get:
 *     tags:
 *       - Visitas
 *     summary: Obtener visita por ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ID no válido
 *       404:
 *         description: No encontrado
 */

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = await db.createVisita(req.body || {});
    res.status(201).json({ ok: true, result });
  })
);

/**
 * @openapi
 * /api/visitas:
 *   post:
 *     tags:
 *       - Visitas
 *     summary: Crear visita
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Created
 */

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const result = await db.updateVisita(id, req.body || {});
    res.json({ ok: true, result });
  })
);

/**
 * @openapi
 * /api/visitas/{id}:
 *   put:
 *     tags:
 *       - Visitas
 *     summary: Actualizar visita
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ID no válido
 */

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: 'ID no válido' });
    const result = await db.deleteVisita(id);
    res.json({ ok: true, result });
  })
);

/**
 * @openapi
 * /api/visitas/{id}:
 *   delete:
 *     tags:
 *       - Visitas
 *     summary: Eliminar visita
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: ID no válido
 */

module.exports = router;

