/**
 * Ficha de solo lectura GET /clientes/:id
 */
const { loadClienteFormCatalogs, buildClienteFormModel } = require('../../lib/cliente-helpers');
const {
  clienteNotFoundPage,
  normalizeRelacionRow,
  parseClienteRouteId,
  redirectIfHoldedIdInUrl,
  triggerHoldedSyncEvalOnViewIfPending
} = require('./helpers');

function registerViewClienteRoutes(router, { db, requireLogin, isAdminUser }) {
  router.get('/:id', requireLogin, async (req, res, next) => {
    try {
      const pr = await parseClienteRouteId(req, db);
      if (!pr.ok && pr.reason === 'notfound') return clienteNotFoundPage(req, res, pr.raw);
      if (!pr.ok) return res.status(400).send('ID no válido');
      const { id, raw } = pr;
      if (redirectIfHoldedIdInUrl(req, res, id, raw)) return;
      const admin = isAdminUser(res.locals.user);
      const isSuperAdmin = Number(res.locals.user?.id) === 1;
      const canEdit = admin || (await db.canComercialEditCliente(id, res.locals.user?.id));
      if (!admin && !canEdit) return res.status(403).send('No tiene permiso para ver este contacto.');
      const [item, catalogs] = await Promise.all([db.getClienteById(id), loadClienteFormCatalogs(db)]);
      const {
        comerciales,
        tarifas,
        provincias,
        paises,
        formasPago,
        tiposClientes,
        especialidades,
        idiomas,
        monedas,
        estadosCliente,
        cooperativas,
        gruposCompras,
        meta
      } = catalogs;
      if (!item) return clienteNotFoundPage(req, res, id);
      triggerHoldedSyncEvalOnViewIfPending(db, id, item);
      const puedeSolicitarAsignacion =
        !admin && res.locals.user?.id && (await db.isContactoAsignadoAPoolOSinAsignar(id));
      const poolId = await db.getComercialIdPool();
      const solicitud = req.query.solicitud === 'ok' ? 'ok' : undefined;
      const holdedSync = typeof req.query.holded_sync === 'string' ? String(req.query.holded_sync).trim() : '';
      const [tieneRelaciones, relacionesData, cooperativasCliente] = await Promise.all([
        db.tieneRelaciones(id).catch(() => false),
        db.getRelacionesByCliente(id).catch(() => ({ comoOrigen: [], comoRelacionado: [] })),
        db.getCooperativasByClienteId(id).catch(() => [])
      ]);
      const relaciones = [
        ...(relacionesData.comoOrigen || []).map(normalizeRelacionRow),
        ...(relacionesData.comoRelacionado || []).map(normalizeRelacionRow)
      ];
      const model = buildClienteFormModel({
        mode: 'view',
        meta,
        item,
        comerciales,
        tarifas,
        provincias,
        paises,
        formasPago,
        tiposClientes,
        especialidades: especialidades || [],
        idiomas,
        monedas,
        estadosCliente,
        cooperativas,
        gruposCompras,
        canChangeComercial: false,
        isAdmin: !!admin,
        isSuperAdmin
      });
      const portalTab = {
        id: 'portal',
        label: 'Portal cliente',
        fields: [{ name: '_portal', label: '', spec: { kind: 'portal_admin' } }]
      };
      model.tabs = [...(model.tabs || []), portalTab];

      const [portalAccesoRow, portalOverride, portalCfg] = await Promise.all([
        db.getPortalAccesoByCliId(id).catch(() => null),
        db.getPortalClienteOverride(id).catch(() => null),
        db.getPortalConfig().catch(() => null)
      ]);

      const pq = req.query || {};
      const portalFlash = {
        ok: typeof pq.portal_ok === 'string' ? pq.portal_ok : null,
        err: typeof pq.portal_error === 'string' ? pq.portal_error : null,
        link: typeof pq.portal_link === 'string' ? pq.portal_link : null
      };

      res.render('cliente-view', {
        ...model,
        admin,
        canEdit,
        puedeSolicitarAsignacion,
        poolId,
        solicitud,
        holdedSync,
        contactoId: id,
        agendaContactos: [],
        agendaRoles: [],
        agendaIncludeHistorico: false,
        agendaOk: false,
        agendaError: false,
        tieneRelaciones: !!tieneRelaciones,
        relaciones: relaciones || [],
        cooperativasCliente: Array.isArray(cooperativasCliente) ? cooperativasCliente : [],
        portalAcceso: portalAccesoRow,
        portalOverride,
        portalCfg,
        portalFlash
      });
    } catch (e) {
      next(e);
    }
  });
}

module.exports = { registerViewClienteRoutes };
