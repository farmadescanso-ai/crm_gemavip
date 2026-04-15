/**
 * Listado /clientes con búsqueda y paginación.
 */
const { parsePagination } = require('../../lib/pagination');
const { _n } = require('../../lib/app-helpers');
const { tokenizeSmartQuery } = require('../../lib/pedido-helpers');

function registerListRoutes(router, { db, requireLogin, isAdminUser }) {
  router.get('/', requireLogin, async (req, res, next) => {
    try {
      const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 100 });
      const rawQ =
        typeof _n(req.query.q, req.query.search) === 'string'
          ? String(_n(req.query.q, req.query.search)).trim()
          : '';
      const tipoContacto = typeof req.query.tipo === 'string' ? String(req.query.tipo).trim() : '';
      const order = String(req.query.order || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
      const admin = isAdminUser(res.locals.user);
      const baseFilters = admin ? {} : { comercial: res.locals.user?.id };

      const smartQ = tokenizeSmartQuery(rawQ);
      const freeText = smartQ.terms.join(' ').trim();

      if (!admin && res.locals.user?.id && rawQ) {
        const poolId = await db.getComercialIdPool();
        if (poolId) baseFilters.comercialPoolId = poolId;
      }
      const filters = { ...baseFilters };
      if (freeText) filters.q = freeText;
      if (tipoContacto && ['Empresa', 'Persona', 'Otros'].includes(tipoContacto)) {
        filters.tipoContacto = tipoContacto;
      }

      for (const t of smartQ.tokens || []) {
        const f = t.field;
        const v = t.value;
        if (['estado', 'st'].includes(f)) {
          const vl = v.toLowerCase();
          if (['activos', 'activo', 'si', 'sí', 'true', '1'].includes(vl)) filters.estado = 'activos';
          else if (['inactivos', 'inactivo', 'no', 'false', '0'].includes(vl)) filters.estado = 'inactivos';
        } else if (['contacto', 'tipocontacto'].includes(f)) {
          const vn = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
          if (['Empresa', 'Persona', 'Otros'].includes(vn)) filters.tipoContacto = vn;
        } else if (['ventas', 'pedidos'].includes(f)) {
          const vl = v.toLowerCase();
          if (['si', 'sí', 'true', '1', 'yes'].includes(vl)) filters.conVentas = true;
          else if (['no', 'false', '0'].includes(vl)) filters.conVentas = false;
        } else if (['provincia', 'prov'].includes(f)) {
          filters.provinciaNombre = v;
        } else if (['tipo', 'tipocliente', 'tc'].includes(f)) {
          filters.tipoClienteNombre = v;
        } else if (['comercial', 'com'].includes(f) && admin) {
          filters.comercialNombre = v;
        } else if (['nombre', 'n'].includes(f)) {
          filters.nombre = v;
        } else if (['cif', 'nif', 'dni'].includes(f)) {
          filters.cif = v;
        } else if (['email', 'mail'].includes(f)) {
          filters.email = v;
        } else if (['tel', 'telefono', 'movil', 'tlf'].includes(f)) {
          filters.telefono = v;
        } else if (['cp', 'postal', 'codigopostal'].includes(f)) {
          filters.cp = v;
        } else if (['poblacion', 'pob', 'localidad', 'ciudad'].includes(f)) {
          filters.poblacion = v;
        } else if (['tags', 'tag', 'etiqueta'].includes(f)) {
          filters.tags = v;
        }
      }
      const uid = res.locals.user?.id;
      const [items, total, comerciales, solicitudPendienteIds, solicitudRechazadaIds] = await Promise.all([
        db.getClientesOptimizadoPaged(filters, { limit, offset, sortBy: 'nombre', order }),
        db.countClientesOptimizado(filters),
        db.getComerciales().catch(() => []),
        !admin && uid ? db.getClienteIdsSolicitudPendienteComercial(uid) : Promise.resolve(new Set()),
        !admin && uid ? db.getClienteIdsSolicitudRechazadaComercial(uid) : Promise.resolve(new Set())
      ]);
      const poolId = admin ? null : await db.getComercialIdPool();
      const totalPages = Math.max(1, Math.ceil((total || 0) / limit));
      const pageClamped = Math.min(page, totalPages);
      if (page > totalPages && totalPages > 0) {
        const redirectQs = new URLSearchParams({ page: String(totalPages), order });
        if (rawQ) redirectQs.set('q', rawQ);
        if (tipoContacto) redirectQs.set('tipo', tipoContacto);
        return res.redirect('/clientes?' + redirectQs.toString());
      }
      res.render('clientes', {
        items: items || [],
        comerciales: comerciales || [],
        q: rawQ,
        admin,
        tipoContacto: tipoContacto || undefined,
        orderNombre: order,
        paging: { page: pageClamped, limit, total: total || 0, totalPages },
        poolId: poolId || null,
        solicitudPendienteClienteIds: solicitudPendienteIds || new Set(),
        solicitudRechazadaClienteIds: solicitudRechazadaIds || new Set(),
        uid: uid || null
      });
    } catch (e) {
      next(e);
    }
  });
}

module.exports = { registerListRoutes };
