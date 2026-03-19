/**
 * Rutas HTML de visitas (CRUD).
 */

const express = require('express');
const db = require('../config/mysql-crm');
const { requireLogin } = require('../lib/auth');
const { isAdminUser } = require('../lib/auth');
const { _n } = require('../lib/app-helpers');
const { parsePagination } = require('../lib/pagination');

const router = express.Router();

router.get('/', requireLogin, async (req, res, next) => {
  try {
    const view = String(req.query.view || 'list').toLowerCase();
    const admin = isAdminUser(res.locals.user);
    const meta = await db._ensureVisitasMeta();
    const clientesMeta = await db._ensureClientesMeta().catch(() => null);
    const comercialesMeta = await db._ensureComercialesMeta().catch(() => null);

    const qDate = String(req.query.date || '').trim();
    const qMonth = String(req.query.month || '').trim();

    const where = [];
    const params = [];

    if (!admin) {
      const uIdNum = Number(res.locals.user?.id);
      if (meta.colComercial && Number.isFinite(uIdNum) && uIdNum > 0) {
        where.push(`v.\`${meta.colComercial}\` = ?`);
        params.push(uIdNum);
      } else {
        const owner = db._buildVisitasOwnerWhere(meta, res.locals.user, 'v');
        if (!owner.clause) {
          if (view === 'calendar') {
            const now = new Date();
            const month = qMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const initialDate = qDate || `${month}-01`;
            return res.render('visitas-calendar', { month, initialDate, meta, admin });
          }
          return res.render('visitas', {
            items: [],
            admin,
            selectedDate: qDate || null,
            paging: { page: 1, limit: 10, total: 0 },
            id: ''
          });
        }
        where.push(owner.clause);
        params.push(...owner.params);
      }
    }

    if (qDate && meta.colFecha) {
      where.push(`v.\`${meta.colFecha}\` >= ? AND v.\`${meta.colFecha}\` < ? + INTERVAL 1 DAY`);
      params.push(qDate, qDate);
    }

    const tClientes = clientesMeta?.tClientes ? `\`${clientesMeta.tClientes}\`` : '`clientes`';
    const pkClientes = clientesMeta?.pk || 'Id';
    const tComerciales = comercialesMeta?.table ? `\`${comercialesMeta.table}\`` : '`comerciales`';
    const pkComerciales = comercialesMeta?.pk || 'id';

    const colNombreRazon = clientesMeta?.colNombreRazonSocial || 'cli_nombre_razon_social';
    const colComercialNombre = comercialesMeta?.colNombre || 'com_nombre';
    const joinCliente = meta.colCliente ? `LEFT JOIN ${tClientes} c ON v.\`${meta.colCliente}\` = c.\`${pkClientes}\`` : '';
    const joinComercial = meta.colComercial ? `LEFT JOIN ${tComerciales} co ON v.\`${meta.colComercial}\` = co.\`${pkComerciales}\`` : '';
    const selectClienteNombre = meta.colCliente ? `c.\`${colNombreRazon}\` as ClienteNombre` : 'NULL as ClienteNombre';
    const selectClienteRazon = meta.colCliente ? `c.\`${colNombreRazon}\` as ClienteRazonSocial` : 'NULL as ClienteRazonSocial';
    const selectComercialNombre = meta.colComercial ? `co.\`${colComercialNombre}\` as ComercialNombre` : 'NULL as ComercialNombre';

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    if (view === 'calendar') {
      const now = new Date();
      const month = qMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const initialDate = qDate || `${month}-01`;
      let totalMes = 0;
      try {
        if (meta?.table && meta?.colFecha) {
          const m = String(month).match(/^(\d{4})-(\d{2})$/);
          const y = m ? Number(m[1]) : now.getFullYear();
          const mo = m ? Number(m[2]) - 1 : now.getMonth();
          const start = `${y}-${String(mo + 1).padStart(2, '0')}-01`;
          const end = new Date(Date.UTC(y, mo + 1, 1)).toISOString().slice(0, 10);

          const whereCal = [];
          const paramsCal = [];
          if (!admin) {
            const uIdNum = Number(res.locals.user?.id);
            if (meta.colComercial && Number.isFinite(uIdNum) && uIdNum > 0) {
              whereCal.push(`v.\`${meta.colComercial}\` = ?`);
              paramsCal.push(uIdNum);
            }
          }
          whereCal.push(`v.\`${meta.colFecha}\` >= ? AND v.\`${meta.colFecha}\` < ?`);
          paramsCal.push(start, end);
          const whereCalSql = whereCal.length ? `WHERE ${whereCal.join(' AND ')}` : '';
          const rows = await db.query(`SELECT COUNT(*) as total FROM \`${meta.table}\` v ${whereCalSql}`, paramsCal);
          totalMes = Number(_n(rows && rows[0] && rows[0].total, 0));
        }
      } catch (_) {
        totalMes = 0;
      }

      return res.render('visitas-calendar', { month, initialDate, meta, admin, totalMes });
    }

    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 200 });
    const idFilter = Number(req.query.id || 0) || null;
    const whereList = [...where];
    const paramsList = [...params];
    if (idFilter && meta.pk) {
      whereList.push(`v.\`${meta.pk}\` = ?`);
      paramsList.push(idFilter);
    }

    const whereListSql = whereList.length ? `WHERE ${whereList.join(' AND ')}` : '';

    const sql = `
      SELECT
        v.\`${meta.pk}\` as Id,
        ${meta.colFecha ? `v.\`${meta.colFecha}\` as Fecha,` : 'NULL as Fecha,'}
        ${meta.colHora ? `v.\`${meta.colHora}\` as Hora,` : "'' as Hora,"}
        ${meta.colHoraFinal ? `v.\`${meta.colHoraFinal}\` as HoraFinal,` : "'' as HoraFinal,"}
        ${meta.colTipo ? `v.\`${meta.colTipo}\` as TipoVisita,` : "'' as TipoVisita,"}
        ${meta.colEstado ? `v.\`${meta.colEstado}\` as Estado,` : "'' as Estado,"}
        ${meta.colCliente ? `v.\`${meta.colCliente}\` as ClienteId,` : 'NULL as ClienteId,'}
        ${meta.colComercial ? `v.\`${meta.colComercial}\` as ComercialId,` : 'NULL as ComercialId,'}
        ${selectClienteNombre},
        ${selectClienteRazon},
        ${selectComercialNombre}
      FROM \`${meta.table}\` v
      ${joinCliente}
      ${joinComercial}
      ${whereListSql}
      ORDER BY ${
        meta.colFecha
          ? `v.\`${meta.colFecha}\` DESC, v.\`${meta.pk}\` DESC`
          : 'v.`' + meta.pk + '` DESC'
      }
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countSql = `SELECT COUNT(*) as total FROM \`${meta.table}\` v ${whereListSql}`;
    const [items, countRows] = await Promise.all([db.query(sql, paramsList), db.query(countSql, paramsList)]);
    const total = Number(_n(countRows && countRows[0] && countRows[0].total, 0));
    return res.render('visitas', {
      items: items || [],
      admin,
      selectedDate: qDate || null,
      paging: { page, limit, total },
      id: idFilter || ''
    });
  } catch (e) {
    next(e);
  }
});

router.get('/new', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const meta = await db._ensureVisitasMeta();
    const tiposVisita = await db.getTiposVisita().catch(() => []);
    const estadosVisita = await db.getEstadosVisita().catch(() => []);
    const comerciales = admin ? await db.getComerciales() : [];
    const clientesMeta = await db._ensureClientesMeta().catch(() => null);
    const tClientes = clientesMeta?.tClientes || 'clientes';
    const pkClientes = clientesMeta?.pk || 'Id';
    const colNombreRazon = clientesMeta?.colNombreRazonSocial || 'cli_nombre_razon_social';
    const clientes = await db.query(`SELECT \`${pkClientes}\` AS Id, \`${colNombreRazon}\` AS Nombre_Razon_Social FROM \`${tClientes}\` ORDER BY \`${pkClientes}\` DESC LIMIT 200`).catch(() => []);

    const colTipoLower = String(meta.colTipo || '').toLowerCase();
    const tipoIsId = colTipoLower.includes('id_') || colTipoLower.endsWith('id');

    res.render('visita-form', {
      mode: 'create',
      admin,
      meta,
      tiposVisita,
      estadosVisita,
      tipoIsId,
      comerciales,
      clientes,
      item: {
        Fecha: new Date().toISOString().slice(0, 10),
        Hora: '',
        TipoVisita: '',
        Estado: '',
        ClienteId: null,
        ComercialId: res.locals.user.id,
        Notas: ''
      },
      error: null
    });
  } catch (e) {
    next(e);
  }
});

router.post('/new', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const meta = await db._ensureVisitasMeta();
    const tiposVisita = await db.getTiposVisita().catch(() => []);
    const estadosVisita = await db.getEstadosVisita().catch(() => []);
    const comerciales = admin ? await db.getComerciales() : [];
    const clientesMeta = await db._ensureClientesMeta().catch(() => null);
    const tClientes = clientesMeta?.tClientes || 'clientes';
    const pkClientes = clientesMeta?.pk || 'Id';
    const colNombreRazon = clientesMeta?.colNombreRazonSocial || 'cli_nombre_razon_social';
    const clientes = await db.query(`SELECT \`${pkClientes}\` AS Id, \`${colNombreRazon}\` AS Nombre_Razon_Social FROM \`${tClientes}\` ORDER BY \`${pkClientes}\` DESC LIMIT 200`).catch(() => []);

    const fecha = String(req.body?.Fecha || req.body?.fecha || '').slice(0, 10);
    const hora = String(req.body?.Hora || req.body?.hora || '').slice(0, 5);
    const horaFinalRaw = String(req.body?.Hora_Final || req.body?.hora_final || req.body?.HoraFinal || '').slice(0, 5);
    const tipoRaw = String(req.body?.TipoVisita || req.body?.tipo || '').trim();
    const estado = String(req.body?.Estado || req.body?.estado || '').slice(0, 40);
    const notas = String(req.body?.Notas || req.body?.notas || '').slice(0, 500);
    const clienteId = req.body?.ClienteId ? Number(req.body.ClienteId) : null;
    const comercialId = admin ? Number(req.body?.ComercialId || 0) : Number(res.locals.user.id);

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
    const horaFinal = horaFinalRaw || (hora ? addMinutesHHMM(hora, 30) : '');

    const renderError = (message) => {
      const colTipoLower = String(meta.colTipo || '').toLowerCase();
      const tipoIsId = colTipoLower.includes('id_') || colTipoLower.endsWith('id');
      return res.status(400).render('visita-form', {
        mode: 'create',
        admin,
        meta,
        tiposVisita,
        estadosVisita,
        tipoIsId,
        comerciales,
        clientes,
        item: {
          Fecha: fecha || new Date().toISOString().slice(0, 10),
          Hora: hora || '',
          TipoVisita: tipoRaw || '',
          Estado: estado || '',
          ClienteId: clienteId || null,
          ComercialId: comercialId || res.locals.user.id,
          Notas: notas || ''
        },
        error: message
      });
    };

    if (!fecha) return renderError('Fecha obligatoria');
    if (meta.colHora && !hora) return renderError('Hora obligatoria');
    if (meta.colTipo && !tipoRaw) return renderError('Tipo de visita obligatorio');
    if (meta.colEstado && !estado) return renderError('Estado obligatorio');

    const payload = {};
    if (meta.colFecha) payload[meta.colFecha] = fecha;
    if (meta.colHora) payload[meta.colHora] = hora;
    if (meta.colHoraFinal && horaFinal) payload[meta.colHoraFinal] = horaFinal;
    if (meta.colTipo) {
      const colTipoLower = String(meta.colTipo || '').toLowerCase();
      const tipoIsId = colTipoLower.includes('id_') || colTipoLower.endsWith('id');
      payload[meta.colTipo] = tipoIsId ? (Number(tipoRaw) || null) : tipoRaw.slice(0, 80);
    }
    if (meta.colEstado && estado) payload[meta.colEstado] = estado;
    if (meta.colNotas && notas) payload[meta.colNotas] = notas;
    if (meta.colCliente && clienteId) payload[meta.colCliente] = clienteId;
    if (meta.colComercial && comercialId) payload[meta.colComercial] = comercialId;

    await db.createVisita(payload);
    return res.redirect('/visitas');
  } catch (e) {
    next(e);
  }
});

router.get('/:id', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const meta = await db._ensureVisitasMeta();
    const id = Number(req.params.id);
    const row = await db.getVisitaById(id);
    if (!row) return res.status(404).send('No encontrado');

    if (!admin && meta.colComercial) {
      const owner = Number(row[meta.colComercial]);
      if (owner && owner !== Number(res.locals.user.id)) return res.status(403).send('Forbidden');
    }

    res.render('visita', { item: row, meta, admin });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/edit', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const meta = await db._ensureVisitasMeta();
    const id = Number(req.params.id);
    const row = await db.getVisitaById(id);
    if (!row) return res.status(404).send('No encontrado');

    if (!admin && meta.colComercial) {
      const owner = Number(row[meta.colComercial]);
      if (owner && owner !== Number(res.locals.user.id)) return res.status(403).send('Forbidden');
    }

    const comerciales = admin ? await db.getComerciales() : [];
    const clientesMeta = await db._ensureClientesMeta().catch(() => null);
    const tClientes = clientesMeta?.tClientes || 'clientes';
    const pkClientes = clientesMeta?.pk || 'Id';
    const colNombreRazon = clientesMeta?.colNombreRazonSocial || 'cli_nombre_razon_social';
    const clientes = await db.query(`SELECT \`${pkClientes}\` AS Id, \`${colNombreRazon}\` AS Nombre_Razon_Social FROM \`${tClientes}\` ORDER BY \`${pkClientes}\` DESC LIMIT 200`).catch(() => []);
    const tiposVisita = await db.getTiposVisita().catch(() => []);
    const estadosVisita = await db.getEstadosVisita().catch(() => []);
    const colTipoLower = String(meta.colTipo || '').toLowerCase();
    const tipoIsId = colTipoLower.includes('id_') || colTipoLower.endsWith('id');

    res.render('visita-form', {
      mode: 'edit',
      admin,
      meta,
      tiposVisita,
      estadosVisita,
      tipoIsId,
      comerciales,
      clientes,
      item: row,
      error: null
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/edit', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const meta = await db._ensureVisitasMeta();
    const id = Number(req.params.id);
    const row = await db.getVisitaById(id);
    if (!row) return res.status(404).send('No encontrado');

    if (!admin && meta.colComercial) {
      const owner = Number(row[meta.colComercial]);
      if (owner && owner !== Number(res.locals.user.id)) return res.status(403).send('Forbidden');
    }

    const fecha = String(req.body?.Fecha || req.body?.fecha || '').slice(0, 10);
    const hora = String(req.body?.Hora || req.body?.hora || '').slice(0, 5);
    const horaFinalRaw = String(req.body?.Hora_Final || req.body?.hora_final || req.body?.HoraFinal || '').slice(0, 5);
    const tipoRaw = String(req.body?.TipoVisita || req.body?.tipo || '').trim();
    const estado = String(req.body?.Estado || req.body?.estado || '').slice(0, 40);
    const notas = String(req.body?.Notas || req.body?.notas || '').slice(0, 500);
    const clienteId = req.body?.ClienteId ? Number(req.body.ClienteId) : null;
    const comercialId = admin ? Number(req.body?.ComercialId || 0) : Number(res.locals.user.id);

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
    const currentHoraFinal = meta.colHoraFinal ? String(row?.[meta.colHoraFinal] || '').slice(0, 5) : '';
    const horaFinal = horaFinalRaw || (hora ? addMinutesHHMM(hora, 30) : currentHoraFinal);

    const payload = {};
    if (meta.colFecha && fecha) payload[meta.colFecha] = fecha;
    if (meta.colHora) payload[meta.colHora] = hora || null;
    if (meta.colHoraFinal) payload[meta.colHoraFinal] = horaFinal || null;
    if (meta.colTipo) {
      const colTipoLower = String(meta.colTipo || '').toLowerCase();
      const tipoIsId = colTipoLower.includes('id_') || colTipoLower.endsWith('id');
      payload[meta.colTipo] = tipoRaw ? (tipoIsId ? (Number(tipoRaw) || null) : tipoRaw.slice(0, 80)) : null;
    }
    if (meta.colEstado) payload[meta.colEstado] = estado || null;
    if (meta.colNotas) payload[meta.colNotas] = notas || null;
    if (meta.colCliente) payload[meta.colCliente] = clienteId || null;
    if (meta.colComercial && comercialId) payload[meta.colComercial] = comercialId;

    await db.updateVisita(id, payload);
    return res.redirect('/visitas');
  } catch (e) {
    next(e);
  }
});

router.post('/:id/delete', requireLogin, async (req, res, next) => {
  try {
    const admin = isAdminUser(res.locals.user);
    const meta = await db._ensureVisitasMeta();
    const id = Number(req.params.id);
    const row = await db.getVisitaById(id);
    if (!row) return res.redirect('/visitas');

    if (!admin && meta.colComercial) {
      const owner = Number(row[meta.colComercial]);
      if (owner && owner !== Number(res.locals.user.id)) return res.status(403).send('Forbidden');
    }

    await db.deleteVisita(id);
    return res.redirect('/visitas');
  } catch (e) {
    next(e);
  }
});

module.exports = router;
