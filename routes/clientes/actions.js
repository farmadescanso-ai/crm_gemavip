/**
 * Solicitud de asignación y papelera (POST).
 */
const crypto = require('crypto');
const {
  clienteNotFoundPage,
  parseClienteRouteId,
  sendPushToAdmins
} = require('./helpers');

function registerClienteActionRoutes(router, { db, requireLogin, requireAdmin, isAdminUser }) {
  router.post('/:id/solicitar-asignacion', requireLogin, async (req, res, next) => {
    try {
      const pr = await parseClienteRouteId(req, db);
      if (!pr.ok && pr.reason === 'notfound') return clienteNotFoundPage(req, res, pr.raw);
      if (!pr.ok) return res.status(400).send('ID no válido');
      const { id } = pr;
      const userId = Number(res.locals.user?.id);
      if (!userId || isAdminUser(res.locals.user)) {
        return res.status(403).send('Solo un comercial puede solicitar que se le asigne un contacto.');
      }
      const item = await db.getClienteById(id);
      if (!item) return clienteNotFoundPage(req, res, id);
      if (!(await db.isContactoAsignadoAPoolOSinAsignar(id))) {
        return res.status(400).send('Este contacto ya está asignado a otro comercial.');
      }

      const notifId = await db.createSolicitudAsignacion(id, userId);
      const clienteNombre =
        item?.cli_nombre_razon_social ?? item?.Nombre_Razon_Social ?? item?.Nombre ?? 'Cliente ' + id;
      const userName = res.locals.user?.nombre || 'Comercial';
      const userEmail = res.locals.user?.email;

      const APP_BASE_URL =
        process.env.APP_BASE_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
      const APROBACION_SECRET = (process.env.APROBACION_SECRET || process.env.API_KEY || 'crm-gemavip-aprobacion').trim();

      const sign = (n, a) =>
        crypto.createHmac('sha256', APROBACION_SECRET).update(`notifId=${n}&approved=${a}`).digest('hex');
      const approvalUrlApprove = notifId
        ? `${APP_BASE_URL}/webhook/aprobar-asignacion?notifId=${notifId}&approved=1&sig=${sign(notifId, true)}`
        : null;
      const approvalUrlDecline = notifId
        ? `${APP_BASE_URL}/webhook/aprobar-asignacion?notifId=${notifId}&approved=0&sig=${sign(notifId, false)}`
        : null;

      const toEmail = (process.env.NOTIF_EMAIL_DESTINO || process.env.SYSTEM_ADMIN_EMAILS || 'info@farmadescanso.com')
        .split(',')[0]
        .trim();
      const notifBody = `${userName} solicita: ${clienteNombre}`;
      const webhookPayload = {
        title: 'Nueva solicitud de asignación',
        body: notifBody,
        url: '/notificaciones',
        tipo: 'solicitud_asignacion',
        clienteId: id,
        clienteNombre,
        userId,
        userName,
        userEmail,
        approvalUrlApprove,
        approvalUrlDecline,
        body: {
          title: 'Nueva solicitud de asignación',
          body: notifBody,
          toEmail,
          url: '/notificaciones',
          tipo: 'solicitud_asignacion',
          clienteId: id,
          clienteNombre,
          cli_id: id,
          cli_dni_cif: item?.cli_dni_cif ?? item?.DNI_CIF ?? null,
          cli_nombre_razon_social: item?.cli_nombre_razon_social ?? item?.Nombre_Razon_Social ?? null,
          cli_numero_farmacia: item?.cli_numero_farmacia ?? null,
          cli_direccion: item?.cli_direccion ?? item?.Direccion ?? null,
          cli_poblacion: item?.cli_poblacion ?? item?.Poblacion ?? null,
          cli_codigo_postal: item?.cli_codigo_postal ?? item?.CodigoPostal ?? null,
          cli_movil: item?.cli_movil ?? item?.Movil ?? null,
          cli_email: item?.cli_email ?? item?.Email ?? null,
          cli_tipo_cliente_txt: item?.cli_tipo_cliente_txt ?? item?.TipoCliente ?? null,
          cli_tipc_id: item?.cli_tipc_id ?? item?.Id_TipoCliente ?? null,
          cli_tipc_id_nombre: item?.TipoClienteNombre ?? null,
          cli_prov_id: item?.cli_prov_id ?? item?.Id_Provincia ?? null,
          cli_prov_id_nombre: item?.ProvinciaNombre ?? null,
          cli_telefono: item?.cli_telefono ?? item?.Telefono ?? null,
          cli_pais_id: item?.cli_pais_id ?? item?.Id_Pais ?? null,
          cli_pais_id_nombre: item?.PaisNombre ?? null,
          cli_ok_ko: item?.cli_ok_ko ?? item?.OK_KO ?? null,
          cli_estcli_id: item?.cli_estcli_id ?? item?.Id_EstdoCliente ?? null,
          cli_estcli_id_nombre: item?.EstadoClienteNombre ?? null,
          cli_activo: item?.cli_activo ?? item?.Activo ?? null,
          userId,
          userName,
          userEmail,
          approvalUrlApprove,
          approvalUrlDecline
        }
      };
      await sendPushToAdmins(webhookPayload).catch(() => {});

      return res.redirect('/mis-notificaciones?solicitud=ok');
    } catch (e) {
      next(e);
    }
  });

  router.post('/:id/delete', requireAdmin, async (req, res, next) => {
    try {
      const pr = await parseClienteRouteId(req, db);
      if (!pr.ok && pr.reason === 'notfound') return clienteNotFoundPage(req, res, pr.raw);
      if (!pr.ok) return res.status(400).send('ID no válido');
      const { id } = pr;
      await db.moverClienteAPapelera(id, res.locals.user?.email || res.locals.user?.id || 'admin');
      return res.redirect('/clientes');
    } catch (e) {
      next(e);
    }
  });
}

module.exports = { registerClienteActionRoutes };
