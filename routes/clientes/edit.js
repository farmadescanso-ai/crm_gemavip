/**
 * Edición GET/POST /clientes/:id/edit
 */
const { loadClienteFormCatalogs, buildClienteFormModel, coerceClienteValue } = require('../../lib/cliente-helpers');
const {
  clienteNotFoundPage,
  normalizePayloadTelefonos,
  normalizeRelacionRow,
  parseClienteRouteId,
  redirectIfHoldedIdInUrl,
  stripClienteAvanzadoFieldsFromPayload,
  stripClienteEtiquetasForNonAdmin,
  stripHoldedSyncSuperOnlyFieldsFromPayload,
  triggerHoldedSyncEvalOnViewIfPending
} = require('./helpers');

function registerEditClienteRoutes(router, { db, requireLogin, isAdminUser }) {
  router.get('/:id/edit', requireLogin, async (req, res, next) => {
    try {
      const pr = await parseClienteRouteId(req, db);
      if (!pr.ok && pr.reason === 'notfound') return clienteNotFoundPage(req, res, pr.raw);
      if (!pr.ok) return res.status(400).send('ID no válido');
      const { id, raw } = pr;
      if (redirectIfHoldedIdInUrl(req, res, id, raw)) return;
      const admin = isAdminUser(res.locals.user);
      if (!admin && !(await db.canComercialEditCliente(id, res.locals.user?.id))) {
        return res.status(403).send('No tiene permiso para editar este contacto.');
      }
      const isSuperAdmin = Number(res.locals.user?.id) === 1;
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
      const [relacionesData, cooperativasCliente] = await Promise.all([
        db.getRelacionesByCliente(id).catch(() => ({ comoOrigen: [], comoRelacionado: [] })),
        db.getCooperativasByClienteId(id).catch(() => [])
      ]);
      const relaciones = [
        ...(relacionesData.comoOrigen || []).map(normalizeRelacionRow),
        ...(relacionesData.comoRelacionado || []).map(normalizeRelacionRow)
      ];
      const model = buildClienteFormModel({
        mode: 'edit',
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
        canChangeComercial: admin,
        isAdmin: !!admin,
        isSuperAdmin
      });
      res.render('cliente-form', {
        ...model,
        error: null,
        admin,
        canChangeComercial: admin,
        puedeSolicitarAsignacion,
        clienteId: id,
        contactoId: id,
        agendaContactos: [],
        agendaIncludeHistorico: false,
        relaciones: relaciones || [],
        cooperativasCliente: Array.isArray(cooperativasCliente) ? cooperativasCliente : []
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/:id/edit', requireLogin, async (req, res, next) => {
    try {
      const pr = await parseClienteRouteId(req, db);
      if (!pr.ok && pr.reason === 'notfound') return clienteNotFoundPage(req, res, pr.raw);
      if (!pr.ok) return res.status(400).send('ID no válido');
      const { id } = pr;
      const admin = isAdminUser(res.locals.user);
      const isSuperAdmin = Number(res.locals.user?.id) === 1;
      if (!admin && !(await db.canComercialEditCliente(id, res.locals.user?.id))) {
        return res.status(403).send('No tiene permiso para editar este contacto.');
      }
      const [item, catalogs, cooperativasCliente] = await Promise.all([
        db.getClienteById(id),
        loadClienteFormCatalogs(db),
        db.getCooperativasByClienteId(id).catch(() => [])
      ]);
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
      const body = req.body || {};
      const canChangeComercial = admin;

      const cols = Array.isArray(meta?.cols) ? meta.cols : [];
      const pk = meta?.pk || 'Id';
      const colsLower = new Map(cols.map((c) => [String(c).toLowerCase(), c]));
      const payload = {};
      for (const [k, v] of Object.entries(body)) {
        const real = colsLower.get(String(k).toLowerCase());
        if (!real) continue;
        if (String(real).toLowerCase() === String(pk).toLowerCase()) continue;
        if (!canChangeComercial && meta?.colComercial && String(real).toLowerCase() === String(meta.colComercial).toLowerCase()) {
          continue;
        }
        payload[real] = coerceClienteValue(real, v);
      }
      if (admin && 'cli_com_id' in body) {
        payload.cli_com_id = coerceClienteValue('cli_com_id', body.cli_com_id);
      }
      if ('cli_prov_id' in body || 'Id_Provincia' in body) {
        payload.cli_prov_id = coerceClienteValue('cli_prov_id', body.cli_prov_id ?? body.Id_Provincia);
      }
      if ('cli_mon_id' in body || 'Id_Moneda' in body) {
        payload.cli_mon_id = coerceClienteValue('cli_mon_id', body.cli_mon_id ?? body.Id_Moneda);
      }
      if ('cli_idiom_id' in body || 'Id_Idioma' in body) {
        payload.cli_idiom_id = coerceClienteValue('cli_idiom_id', body.cli_idiom_id ?? body.Id_Idioma);
      }
      if ('cli_RE' in body || 'cli_re' in body) {
        payload.cli_RE = coerceClienteValue('cli_RE', body.cli_RE ?? body.cli_re);
      }

      const colNombre = meta?.colNombreRazonSocial || 'cli_nombre_razon_social';
      const aliasNombre = body.Nombre_Razon_Social ?? body.nombre_razon_social;
      if (
        colNombre &&
        aliasNombre !== undefined &&
        aliasNombre !== null &&
        (payload[colNombre] === undefined ||
          payload[colNombre] === null ||
          String(payload[colNombre] || '').trim() === '')
      ) {
        payload[colNombre] = coerceClienteValue(colNombre, aliasNombre);
      }

      normalizePayloadTelefonos(payload);

      const missingFields = [];
      let nombreVal = payload[colNombre] ?? payload.Nombre_Razon_Social ?? payload.cli_nombre_razon_social;
      if (nombreVal === undefined || nombreVal === null) {
        nombreVal = item[colNombre] ?? item.Nombre_Razon_Social ?? item.cli_nombre_razon_social;
      }
      if (!nombreVal || !String(nombreVal || '').trim()) {
        missingFields.push(colNombre);
        if (colNombre !== 'Nombre_Razon_Social') missingFields.push('Nombre_Razon_Social');
      }
      if (missingFields.length > 0) {
        const puedeSolicitar = !admin && res.locals.user?.id && (await db.isContactoAsignadoAPoolOSinAsignar(id));
        const model = buildClienteFormModel({
          mode: 'edit',
          meta,
          item: { ...item, ...payload },
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
          canChangeComercial: !!admin,
          missingFields,
          isAdmin: !!admin,
          isSuperAdmin
        });
        return res.status(400).render('cliente-form', {
          ...model,
          error: 'Completa los campos obligatorios marcados.',
          admin,
          canChangeComercial: admin,
          puedeSolicitarAsignacion: puedeSolicitar,
          clienteId: id,
          contactoId: id,
          agendaContactos: [],
          agendaIncludeHistorico: false,
          cooperativasCliente: Array.isArray(cooperativasCliente) ? cooperativasCliente : []
        });
      }

      if (
        (payload[colNombre] === undefined || payload[colNombre] === null) &&
        nombreVal != null &&
        String(nombreVal).trim()
      ) {
        payload[colNombre] = coerceClienteValue(colNombre, nombreVal);
      }

      if (!admin) {
        stripClienteAvanzadoFieldsFromPayload(payload, meta);
        stripClienteEtiquetasForNonAdmin(payload);
      } else if (!isSuperAdmin) {
        stripHoldedSyncSuperOnlyFieldsFromPayload(payload);
      }

      const dniRaw = payload.cli_dni_cif ?? payload.DNI_CIF;
      const dniEfectivo =
        dniRaw !== undefined && dniRaw !== null && String(dniRaw).trim() !== ''
          ? dniRaw
          : item.cli_dni_cif ?? item.DNI_CIF;
      const pendLow = String(dniEfectivo || '').trim().toLowerCase();
      const dniParaCheck = !pendLow || pendLow === 'pendiente' ? null : dniEfectivo;
      if (dniParaCheck) {
        if (typeof db._isValidDniCif === 'function' && !db._isValidDniCif(String(dniParaCheck).trim())) {
          const puedeSolicitarInv = !admin && res.locals.user?.id && (await db.isContactoAsignadoAPoolOSinAsignar(id));
          const modelInv = buildClienteFormModel({
            mode: 'edit',
            meta,
            item: { ...item, ...payload },
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
            canChangeComercial: !!admin,
            isAdmin: !!admin,
            isSuperAdmin
          });
          const relacionesDataInv = await db.getRelacionesByCliente(id).catch(() => ({ comoOrigen: [], comoRelacionado: [] }));
          const relacionesInv = [
            ...(relacionesDataInv.comoOrigen || []).map(normalizeRelacionRow),
            ...(relacionesDataInv.comoRelacionado || []).map(normalizeRelacionRow)
          ];
          return res.status(400).render('cliente-form', {
            ...modelInv,
            error: 'El DNI/CIF no tiene un formato válido (NIF, NIE o CIF español). Corrígelo antes de guardar.',
            admin,
            canChangeComercial: admin,
            puedeSolicitarAsignacion: puedeSolicitarInv,
            clienteId: id,
            contactoId: id,
            agendaContactos: [],
            agendaIncludeHistorico: false,
            relaciones: relacionesInv,
            cooperativasCliente: Array.isArray(cooperativasCliente) ? cooperativasCliente : []
          });
        }
        const dniChkEdit = await db.findConflictoDniCifCliente({ dniCif: dniParaCheck, excludeClienteId: id });
        if (dniChkEdit.conflict) {
          const relacionesData = await db.getRelacionesByCliente(id).catch(() => ({ comoOrigen: [], comoRelacionado: [] }));
          const relacionesEditErr = [
            ...(relacionesData.comoOrigen || []).map(normalizeRelacionRow),
            ...(relacionesData.comoRelacionado || []).map(normalizeRelacionRow)
          ];
          const puedeSolicitar = !admin && res.locals.user?.id && (await db.isContactoAsignadoAPoolOSinAsignar(id));
          const model = buildClienteFormModel({
            mode: 'edit',
            meta,
            item: { ...item, ...payload },
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
            canChangeComercial: !!admin,
            isAdmin: !!admin,
            isSuperAdmin
          });
          return res.status(400).render('cliente-form', {
            ...model,
            error:
              'Este DNI/CIF ya está registrado en otro contacto. No se puede guardar mientras coincida con otro cliente.',
            dupDniMatches: dniChkEdit.matches || [],
            admin,
            canChangeComercial: admin,
            puedeSolicitarAsignacion: puedeSolicitar,
            clienteId: id,
            contactoId: id,
            agendaContactos: [],
            agendaIncludeHistorico: false,
            relaciones: relacionesEditErr,
            cooperativasCliente: Array.isArray(cooperativasCliente) ? cooperativasCliente : []
          });
        }
      }

      await db.updateCliente(id, payload);
      try {
        if (Object.keys(payload).length > 0) {
          const { sendClienteModificadoEmail } = require('../../lib/mailer');
          const nombreNotify =
            payload[colNombre] != null && String(payload[colNombre]).trim() !== ''
              ? String(payload[colNombre]).trim()
              : String(item[colNombre] ?? item.Nombre_Razon_Social ?? item.cli_nombre_razon_social ?? '').trim();
          await sendClienteModificadoEmail({
            accion: 'edicion',
            clienteId: id,
            clienteNombre: nombreNotify,
            editorEmail: res.locals.user?.email,
            editorNombre: res.locals.user?.nombre || res.locals.user?.name
          });
        }
      } catch (e) {
        console.warn('[clientes] Notificación email cliente modificado:', e?.message || e);
      }
      let holdedSyncQs = '';
      try {
        const { evaluateCliHoldedSyncPendienteAfterCrmSave } = require('../../lib/holded-sync');
        const ev = await evaluateCliHoldedSyncPendienteAfterCrmSave(db, id);
        if (ev && ev.approvalEmailQueued) {
          holdedSyncQs = 'holded_sync=approval_sent';
        } else if (ev && isAdminUser(res.locals.user)) {
          if (ev.reason === 'no_holded_api_key') holdedSyncQs = 'holded_sync=no_api_key';
          else if (ev.evaluated && ev.pend === 1 && ev.approvalEmailQueued === false) {
            holdedSyncQs = 'holded_sync=approval_email_failed';
          }
        }
      } catch (e) {
        console.warn('[clientes] Holded sync pendiente post-guardado:', e?.message || e);
      }
      return res.redirect(`/clientes/${id}${holdedSyncQs ? `?${holdedSyncQs}` : ''}`);
    } catch (e) {
      next(e);
    }
  });
}

module.exports = { registerEditClienteRoutes };
