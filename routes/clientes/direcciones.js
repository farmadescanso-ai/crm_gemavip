/**
 * Direcciones de envío /clientes/:id/direcciones/new
 */
const { loadSimpleCatalogForSelect } = require('../../lib/cliente-helpers');
const { rejectIfValidationFailsHtml } = require('../../lib/validation-handlers');
const { clienteIdParam, direccionEnvioCreateValidators } = require('../../lib/validators/html-clientes-ui');
const {
  clienteNotFoundPage,
  normalizePayloadTelefonos,
  parseClienteRouteId,
  redirectIfHoldedIdInUrl
} = require('./helpers');

function registerDireccionesRoutes(router, { db, requireLogin, isAdminUser }) {
  router.get('/:id/direcciones/new', requireLogin, async (req, res, next) => {
    try {
      const pr = await parseClienteRouteId(req, db);
      if (!pr.ok && pr.reason === 'notfound') return clienteNotFoundPage(req, res, pr.raw);
      if (!pr.ok) return res.status(400).send('ID no válido');
      const { id, raw } = pr;
      if (redirectIfHoldedIdInUrl(req, res, id, raw)) return;
      const admin = isAdminUser(res.locals.user);
      const canEdit = admin || (await db.canComercialEditCliente(id, res.locals.user?.id));
      if (!canEdit) return res.status(403).send('No tiene permiso para editar este contacto.');
      const [cliente, provincias, paises] = await Promise.all([
        db.getClienteById(id),
        loadSimpleCatalogForSelect(db, 'provincias'),
        loadSimpleCatalogForSelect(db, 'paises')
      ]);
      if (!cliente) return res.status(404).send('Cliente no encontrado');
      const clienteNombre =
        cliente.cli_nombre_razon_social ?? cliente.Nombre_Razon_Social ?? cliente.Nombre ?? cliente.nombre ?? '';
      res.render('direccion-envio-form', {
        clienteId: id,
        clienteNombre,
        item: {},
        provincias: provincias || [],
        paises: paises || [],
        error: null
      });
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/:id/direcciones/new',
    requireLogin,
    ...clienteIdParam,
    ...direccionEnvioCreateValidators,
    rejectIfValidationFailsHtml('direccion-envio-form', async (req, res) => {
      const pr = await parseClienteRouteId(req, db);
      if (!pr.ok) return {};
      const { id } = pr;
      const [cliente, provincias, paises] = await Promise.all([
        db.getClienteById(id),
        loadSimpleCatalogForSelect(db, 'provincias'),
        loadSimpleCatalogForSelect(db, 'paises')
      ]);
      const clienteNombre =
        cliente?.cli_nombre_razon_social ?? cliente?.Nombre_Razon_Social ?? cliente?.Nombre ?? cliente?.nombre ?? '';
      return {
        clienteId: id,
        clienteNombre,
        item: req.body && typeof req.body === 'object' ? req.body : {},
        provincias: provincias || [],
        paises: paises || []
      };
    }),
    async (req, res, next) => {
    try {
      const pr = await parseClienteRouteId(req, db);
      if (!pr.ok && pr.reason === 'notfound') return clienteNotFoundPage(req, res, pr.raw);
      if (!pr.ok) return res.status(400).send('ID no válido');
      const { id } = pr;
      const admin = isAdminUser(res.locals.user);
      const canEdit = admin || (await db.canComercialEditCliente(id, res.locals.user?.id));
      if (!canEdit) return res.status(403).send('No tiene permiso para editar este contacto.');
      const cliente = await db.getClienteById(id);
      if (!cliente) return res.status(404).send('Cliente no encontrado');
      const body = req.body || {};
      const payload = {
        Id_Cliente: id,
        Alias: body.Alias ? String(body.Alias).trim() : null,
        Nombre_Destinatario: body.Nombre_Destinatario ? String(body.Nombre_Destinatario).trim() : null,
        Direccion: body.Direccion ? String(body.Direccion).trim() : null,
        Direccion2: body.Direccion2 ? String(body.Direccion2).trim() : null,
        Poblacion: body.Poblacion ? String(body.Poblacion).trim() : null,
        CodigoPostal: body.CodigoPostal ? String(body.CodigoPostal).trim() : null,
        Id_Provincia: body.Id_Provincia ? Number(body.Id_Provincia) || null : null,
        Id_Pais: body.Id_Pais ? Number(body.Id_Pais) || null : null,
        Pais: body.Pais ? String(body.Pais).trim() : null,
        Telefono: body.Telefono ? String(body.Telefono).trim() : null,
        Movil: body.Movil ? String(body.Movil).trim() : null,
        Email: body.Email ? String(body.Email).trim() : null,
        Observaciones: body.Observaciones ? String(body.Observaciones).trim() : null,
        Es_Principal: body.Es_Principal === '1' ? 1 : 0,
        Activa: 1
      };
      normalizePayloadTelefonos(payload);
      await db.createDireccionEnvio(payload);
      return res.redirect('/clientes/' + id + '/edit#tab_direccion');
    } catch (e) {
      next(e);
    }
    }
  );
}

module.exports = { registerDireccionesRoutes };
