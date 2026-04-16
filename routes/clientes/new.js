/**
 * Alta de cliente GET/POST /clientes/new
 */
const { _n } = require('../../lib/app-helpers');
const {
  loadClienteFormCatalogs,
  applySpainDefaultsIfEmpty,
  buildClienteFormModel,
  coerceClienteValue
} = require('../../lib/cliente-helpers');
const {
  normalizePayloadTelefonos,
  stripClienteAvanzadoFieldsFromPayload,
  stripClienteEtiquetasForNonAdmin,
  stripHoldedSyncSuperOnlyFieldsFromPayload
} = require('./helpers');
const { rejectIfValidationFailsHtml } = require('../../lib/validation-handlers');
const { clienteCreateValidators } = require('../../lib/validators/html-clientes-ui');

function registerNewClienteRoutes(router, { db, requireLogin, isAdminUser }) {
  async function buildCreateFormLocals(req, res, payload) {
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
    } = await loadClienteFormCatalogs(db);
    const isAdmin = isAdminUser(res.locals.user);
    const isSuperAdmin = Number(res.locals.user?.id) === 1;
    const model = buildClienteFormModel({
      mode: 'create',
      meta,
      item: payload,
      comerciales: Array.isArray(comerciales) ? comerciales : [],
      tarifas: Array.isArray(tarifas) ? tarifas : [],
      provincias: Array.isArray(provincias) ? provincias : [],
      paises: Array.isArray(paises) ? paises : [],
      formasPago: Array.isArray(formasPago) ? formasPago : [],
      tiposClientes: Array.isArray(tiposClientes) ? tiposClientes : [],
      especialidades: especialidades || [],
      idiomas: Array.isArray(idiomas) ? idiomas : [],
      monedas: Array.isArray(monedas) ? monedas : [],
      estadosCliente: Array.isArray(estadosCliente) ? estadosCliente : [],
      cooperativas: Array.isArray(cooperativas) ? cooperativas : [],
      gruposCompras: Array.isArray(gruposCompras) ? gruposCompras : [],
      canChangeComercial: !!isAdmin,
      missingFields: [],
      isAdmin: !!isAdmin,
      isSuperAdmin
    });
    return { ...model, admin: isAdmin, canChangeComercial: !!isAdmin };
  }

  router.get('/new', requireLogin, async (_req, res, next) => {
    try {
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
      } = await loadClienteFormCatalogs(db);
      const isAdmin = isAdminUser(res.locals.user);
      const isSuperAdmin = Number(res.locals.user?.id) === 1;
      const baseItem = applySpainDefaultsIfEmpty({ OK_KO: 1, Tarifa: 0, Dto: 0 }, { meta, paises, idiomas, monedas });
      if (!isAdmin && res.locals.user?.id) {
        const comId = Number(res.locals.user.id);
        const colCom = meta?.colComercial || 'cli_com_id';
        baseItem[colCom] = baseItem.cli_com_id = baseItem.Id_Cial = comId;
      }
      const model = buildClienteFormModel({
        mode: 'create',
        meta,
        item: baseItem,
        comerciales: Array.isArray(comerciales) ? comerciales : [],
        tarifas: Array.isArray(tarifas) ? tarifas : [],
        provincias: Array.isArray(provincias) ? provincias : [],
        paises: Array.isArray(paises) ? paises : [],
        formasPago: Array.isArray(formasPago) ? formasPago : [],
        tiposClientes: Array.isArray(tiposClientes) ? tiposClientes : [],
        especialidades: Array.isArray(especialidades) ? especialidades : [],
        idiomas: Array.isArray(idiomas) ? idiomas : [],
        monedas: Array.isArray(monedas) ? monedas : [],
        estadosCliente: Array.isArray(estadosCliente) ? estadosCliente : [],
        cooperativas: Array.isArray(cooperativas) ? cooperativas : [],
        gruposCompras: Array.isArray(gruposCompras) ? gruposCompras : [],
        canChangeComercial: !!isAdmin,
        isAdmin: !!isAdmin,
        isSuperAdmin
      });
      res.render('cliente-form', { ...model, error: null, admin: isAdmin, canChangeComercial: !!isAdmin });
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/new',
    requireLogin,
    ...clienteCreateValidators,
    rejectIfValidationFailsHtml('cliente-form', async (req, res) => {
      const payload = req.body && typeof req.body === 'object' ? req.body : {};
      return await buildCreateFormLocals(req, res, payload);
    }),
    async (req, res, next) => {
    try {
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
      } = await loadClienteFormCatalogs(db);
      const isAdmin = isAdminUser(res.locals.user);
      const isSuperAdmin = Number(res.locals.user?.id) === 1;
      const body = req.body || {};
      const dupConfirmed = String(body.dup_confirmed || '').trim() === '1';
      const cols = Array.isArray(meta?.cols) ? meta.cols : [];
      const pk = meta?.pk || 'Id';
      const colsLower = new Map(cols.map((c) => [String(c).toLowerCase(), c]));
      const payload = {};
      for (const [k, v] of Object.entries(body)) {
        const real = colsLower.get(String(k).toLowerCase());
        if (!real) continue;
        if (String(real).toLowerCase() === String(pk).toLowerCase()) continue;
        if (!isAdmin && meta?.colComercial && String(real).toLowerCase() === String(meta.colComercial).toLowerCase()) {
          continue;
        }
        payload[real] = coerceClienteValue(real, v);
      }

      const colNombre = meta?.colNombreRazonSocial || 'cli_nombre_razon_social';
      const aliasVal = body.Nombre_Razon_Social ?? body.nombre_razon_social;
      if (
        colNombre &&
        aliasVal !== undefined &&
        aliasVal !== null &&
        (payload[colNombre] === undefined ||
          payload[colNombre] === null ||
          String(payload[colNombre] || '').trim() === '')
      ) {
        payload[colNombre] = coerceClienteValue(colNombre, aliasVal);
      }

      if (meta?.colComercial && res.locals.user?.id) {
        const comVal = payload[meta.colComercial];
        if (!isAdmin || comVal === undefined || comVal === null || String(comVal || '').trim() === '') {
          payload[meta.colComercial] = Number(res.locals.user.id);
        }
      }

      if (payload.OK_KO === null || payload.OK_KO === undefined) payload.OK_KO = 1;
      if (payload.Tarifa === null || payload.Tarifa === undefined) payload.Tarifa = 0;
      applySpainDefaultsIfEmpty(payload, { meta, paises, idiomas, monedas });
      normalizePayloadTelefonos(payload);

      const dniRawNew = payload.DNI_CIF ?? payload.cli_dni_cif;
      const dniPendNew = String(dniRawNew || '').trim().toLowerCase();
      if (dniRawNew != null && String(dniRawNew).trim() !== '' && dniPendNew !== 'pendiente') {
        if (typeof db._isValidDniCif === 'function' && !db._isValidDniCif(String(dniRawNew).trim())) {
          const modelInvalid = buildClienteFormModel({
            mode: 'create',
            meta,
            item: payload,
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
            canChangeComercial: !!isAdmin,
            missingFields: [],
            isAdmin: !!isAdmin,
            isSuperAdmin
          });
          return res.status(400).render('cliente-form', {
            ...modelInvalid,
            error: 'El DNI/CIF no tiene un formato válido (NIF, NIE o CIF español). Corrígelo antes de guardar.',
            admin: isAdmin,
            canChangeComercial: !!isAdmin
          });
        }
      }

      const dniChkNew = await db.findConflictoDniCifCliente({ dniCif: payload.DNI_CIF ?? payload.cli_dni_cif });
      if (dniChkNew.conflict) {
        const model = buildClienteFormModel({
          mode: 'create',
          meta,
          item: payload,
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
          canChangeComercial: !!isAdmin,
          missingFields: [],
          isAdmin: !!isAdmin,
          isSuperAdmin
        });
        return res.status(400).render('cliente-form', {
          ...model,
          error:
            'Este DNI/CIF ya está registrado en otro contacto. No se puede crear un duplicado: cada cliente debe tener un identificador fiscal único.',
          dupDniMatches: dniChkNew.matches || [],
          admin: isAdmin,
          canChangeComercial: !!isAdmin
        });
      }

      const dup = await db.findPosiblesDuplicadosClientes(
        {
          dniCif: payload.DNI_CIF ?? payload.cli_dni_cif,
          nombre: payload[colNombre] ?? payload.Nombre_Razon_Social ?? payload.cli_nombre_razon_social,
          nombreCial: payload.Nombre_Cial ?? payload.cli_nombre_cial
        },
        { limit: 6, userId: _n(res.locals.user && res.locals.user.id, null), isAdmin }
      );
      const hasDup =
        (dup && Array.isArray(dup.matches) && dup.matches.length > 0) || (dup && Number(dup.otherCount || 0) > 0);
      if (hasDup && !dupConfirmed) {
        const model = buildClienteFormModel({
          mode: 'create',
          meta,
          item: payload,
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
          canChangeComercial: !!isAdmin,
          missingFields: [],
          isAdmin: !!isAdmin,
          isSuperAdmin
        });
        return res.status(409).render('cliente-form', {
          ...model,
          error: 'Este contacto puede estar ya dado de alta. Revisa coincidencias y confirma si quieres continuar.',
          dupMatches: dup.matches || [],
          dupOtherCount: Number(dup.otherCount || 0) || 0,
          admin: isAdmin,
          canChangeComercial: !!isAdmin
        });
      }

      const missingFieldsNew = [];
      const nombreVal = payload[colNombre] ?? payload.Nombre_Razon_Social ?? payload.cli_nombre_razon_social;
      if (!nombreVal || !String(nombreVal || '').trim()) {
        missingFieldsNew.push(colNombre);
        if (colNombre !== 'Nombre_Razon_Social') missingFieldsNew.push('Nombre_Razon_Social');
      }
      if (missingFieldsNew.length > 0) {
        const model = buildClienteFormModel({
          mode: 'create',
          meta,
          item: payload,
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
          canChangeComercial: !!isAdmin,
          missingFields: missingFieldsNew,
          isAdmin: !!isAdmin,
          isSuperAdmin
        });
        return res.status(400).render('cliente-form', {
          ...model,
          error: 'Completa los campos obligatorios marcados.',
          admin: isAdmin,
          canChangeComercial: !!isAdmin
        });
      }

      if (!isAdmin) {
        stripClienteAvanzadoFieldsFromPayload(payload, meta);
        stripClienteEtiquetasForNonAdmin(payload);
      } else if (!isSuperAdmin) {
        stripHoldedSyncSuperOnlyFieldsFromPayload(payload);
      }

      const created = await db.createCliente(payload);
      try {
        const newId = Number(created?.insertId ?? created?.Id ?? created?.id);
        if (Number.isFinite(newId) && newId > 0 && Object.keys(payload).length > 0) {
          const { sendClienteModificadoEmail } = require('../../lib/mailer');
          const nombreNotify =
            payload[colNombre] != null && String(payload[colNombre]).trim() !== ''
              ? String(payload[colNombre]).trim()
              : String(payload.Nombre_Razon_Social ?? payload.cli_nombre_razon_social ?? '').trim();
          await sendClienteModificadoEmail({
            accion: 'alta',
            clienteId: newId,
            clienteNombre: nombreNotify,
            editorEmail: res.locals.user?.email,
            editorNombre: res.locals.user?.nombre || res.locals.user?.name
          });
        }
      } catch (e) {
        console.warn('[clientes] Notificación email cliente creado:', e?.message || e);
      }
      try {
        const newId = Number(created?.insertId ?? created?.Id ?? created?.id);
        if (Number.isFinite(newId) && newId > 0) {
          const { evaluateCliHoldedSyncPendienteAfterCrmSave } = require('../../lib/holded-sync');
          await evaluateCliHoldedSyncPendienteAfterCrmSave(db, newId);
        }
      } catch (e) {
        console.warn('[clientes] Holded sync pendiente post-alta:', e?.message || e);
      }
      return res.redirect('/clientes');
    } catch (e) {
      next(e);
    }
    }
  );
}

module.exports = { registerNewClienteRoutes };
