/**
 * Rutas HTML de administración: descuentos, variables sistema, webhooks, configuración email.
 */

const express = require('express');
const db = require('../config/mysql-crm');
const { requireAdmin } = require('../lib/app-helpers');
const { _n } = require('../lib/app-helpers');
const { warn } = require('../lib/logger');
const {
  buildSysVarMergedList,
  loadVariablesSistemaRaw,
  SYSVAR_N8N_PEDIDOS_WEBHOOK_URL,
  SYSVAR_PEDIDOS_MAIL_TO,
  SYSVAR_SMTP_HOST,
  SYSVAR_SMTP_PORT,
  SYSVAR_SMTP_SECURE,
  SYSVAR_SMTP_USER,
  SYSVAR_SMTP_PASS,
  SYSVAR_MAIL_FROM
} = require('../lib/admin-helpers');
const { getSmtpStatus, getGraphStatus } = require('../lib/mailer');
const { runSyncHoldedPedidos, runMigrationPedIdHolded, getRelacionCodigosHoldedBd, getPreviewPedidosHolded, getRawHoldedJson } = require('../lib/sync-holded-pedidos');
const { runNormalizarTelefonosClientes } = require('../lib/normalizar-telefonos-clientes');
const { requireSystemAdmin } = require('../lib/auth');

const router = express.Router();

// ===========================
// IMPORTAR PEDIDOS HOLDED (solo administrador del sistema: info@farmadescanso.com)
// Acceso exclusivo por URL directa. Tab "Relación códigos" vía ?tab=relacion-codigos (evita 404 en Vercel)
// Comportamiento legacy: provincia Murcia, puede crear cliente CRM si no existe (no es el modo estricto del CPanel).
// Para import/export con solo clientes vinculados Holded↔CRM usar /cpanel/holded-pedidos (usuario id 1).
// ===========================
router.get('/importar-holded', requireSystemAdmin, async (req, res, next) => {
  try {
    const tab = String(req.query.tab || '').trim();
    if (tab === 'json-holded') {
      const start = String(req.query.start || '2026-01-01').trim();
      const end = String(req.query.end || '2026-12-31').trim();
      const result = await getRawHoldedJson({ start, end });
      if (req.headers['accept']?.includes('application/json')) {
        return res.json(result);
      }
      const jsonRaw = result.raw ? JSON.stringify(result.raw, null, 2) : '{}';
      return res.render('json-holded', { title: 'JSON Holded', ...result, start, end, jsonRaw });
    }
    if (tab === 'relacion-codigos') {
      const start = String(req.query.start || '2026-01-01').trim();
      const end = String(req.query.end || '2026-01-31').trim();
      const result = await getRelacionCodigosHoldedBd({ start, end });
      if (req.headers['accept']?.includes('application/json')) {
        return res.json(result);
      }
      return res.render('relacion-codigos-holded', { title: 'Relación códigos Holded ↔ BD', ...result });
    }
    if (tab === 'preview') {
      const start = String(req.query.start || '2026-01-01').trim();
      const end = String(req.query.end || '2026-12-31').trim();
      const result = await getPreviewPedidosHolded({ start, end, provincia: 'Murcia' });
      const success = typeof req.query.success === 'string' ? req.query.success : null;
      const error = typeof req.query.error === 'string' ? req.query.error : (result.error || null);
      if (req.headers['accept']?.includes('application/json')) {
        return res.json(result);
      }
      return res.render('preview-pedidos-holded', { title: 'Vista previa pedidos Holded', ...result, start, end, success, error });
    }

    const hasApiKey = !!(process.env.HOLDED_API_KEY && process.env.HOLDED_API_KEY.trim());
    const error = typeof req.query.error === 'string' ? req.query.error : null;
    const success = typeof req.query.success === 'string' ? req.query.success : null;

    let needsMigration = false;
    if (hasApiKey) {
      try {
        if (!db.connected && !db.pool) await db.connect();
        const cols = await db.query(
          "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'ped_id_holded'"
        );
        needsMigration = !cols?.length;
      } catch (e) {
        warn('[admin] descuentos migration check:', e?.message);
        needsMigration = true;
      }
    }

    return res.render('importar-holded', {
      title: 'Importar pedidos Holded',
      subtitle: 'Sincroniza pedidos de venta desde Holded al CRM. Solo se importan pedidos de clientes en la Provincia de Murcia.',
      hasApiKey,
      needsMigration,
      error,
      success
    });
  } catch (e) {
    next(e);
  }
});

router.post('/importar-holded/run-migration', requireSystemAdmin, async (req, res, next) => {
  try {
    const result = await runMigrationPedIdHolded();
    if (result.ok) {
      return res.redirect('/admin/importar-holded?success=' + encodeURIComponent('Migración ejecutada correctamente. Ya puedes importar pedidos.'));
    }
    return res.redirect('/admin/importar-holded?error=' + encodeURIComponent(result.error || 'Error al ejecutar migración'));
  } catch (e) {
    return res.redirect('/admin/importar-holded?error=' + encodeURIComponent(e?.message || 'Error'));
  }
});

router.post('/importar-holded/import-selected', requireSystemAdmin, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.importarIds) ? req.body.importarIds : (req.body.importarIds ? [req.body.importarIds] : []);
    const idsClean = ids.map(String).filter(Boolean);
    const start = String(req.body.start || '2026-01-01').trim();
    const end = String(req.body.end || '2026-12-31').trim();
    if (!idsClean.length) {
      if (req.headers['accept']?.includes('application/json')) {
        return res.status(400).json({ ok: false, error: 'Selecciona al menos un pedido' });
      }
      return res.redirect(`/admin/importar-holded?tab=preview&start=${start}&end=${end}&error=${encodeURIComponent('Selecciona al menos un pedido')}`);
    }
    const result = await runSyncHoldedPedidos({ start, end, provincia: 'Murcia', dryRun: false, idsToImport: idsClean });
    if (req.headers['accept']?.includes('application/json')) {
      return res.json(result);
    }
    if (result.ok) {
      return res.redirect(`/admin/importar-holded?tab=preview&start=${start}&end=${end}&success=${encodeURIComponent(result.inserted + ' pedidos importados')}`);
    }
    return res.redirect(`/admin/importar-holded?tab=preview&start=${start}&end=${end}&error=${encodeURIComponent(result.error || 'Error')}`);
  } catch (e) {
    if (req.headers['accept']?.includes('application/json')) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
    return res.redirect(`/admin/importar-holded?tab=preview&error=${encodeURIComponent(e?.message || 'Error')}`);
  }
});

router.post('/importar-holded/sync', requireSystemAdmin, async (req, res, next) => {
  try {
    const start = String(req.body?.start || '2026-01-01').trim();
    const end = String(req.body?.end || '2026-12-31').trim();
    const dryRun = String(req.body?.dryRun || '').trim() === '1';

    const result = await runSyncHoldedPedidos({ start, end, provincia: 'Murcia', dryRun });

    if (req.headers['accept']?.includes('application/json')) {
      return res.json(result);
    }

    if (result.ok) {
      const msg = dryRun
        ? `Simulación: ${result.inserted} pedidos se importarían. Omitidos: ${result.skippedProvincia} (otra provincia), ${result.skippedDuplicado} (duplicados), ${result.skippedSinContacto} (sin contacto).`
        : `Importados ${result.inserted} pedidos. Omitidos: ${result.skippedProvincia} (otra provincia), ${result.skippedDuplicado} (duplicados), ${result.skippedSinContacto} (sin contacto).`;
      return res.redirect(`/admin/importar-holded?success=${encodeURIComponent(msg)}`);
    }

    return res.redirect(`/admin/importar-holded?error=${encodeURIComponent(result.error || 'Error desconocido')}`);
  } catch (e) {
    if (req.headers['accept']?.includes('application/json')) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
    return res.redirect(`/admin/importar-holded?error=${encodeURIComponent(e?.message || 'Error al sincronizar')}`);
  }
});

// ===========================
// NORMALIZAR TELÉFONOS CLIENTES
// ===========================
router.get('/normalizar-telefonos-clientes', requireAdmin, async (req, res, next) => {
  try {
    const success = typeof req.query.success === 'string' ? req.query.success : null;
    const result = await runNormalizarTelefonosClientes({ dryRun: true });
    if (!result.ok) {
      return res.render('admin-normalizar-telefonos', { error: result.error || 'Error al verificar teléfonos' });
    }
    res.render('admin-normalizar-telefonos', { result: { ...result, applied: false }, success });
  } catch (e) {
    next(e);
  }
});

router.post('/normalizar-telefonos-clientes', requireAdmin, async (req, res, next) => {
  try {
    const apply = String(req.body?.apply || '').trim() === '1';
    const result = await runNormalizarTelefonosClientes({ dryRun: !apply });
    if (!result.ok) {
      return res.render('admin-normalizar-telefonos', { error: result.error || 'Error al normalizar' });
    }
    if (apply && result.updated > 0) {
      return res.redirect('/admin/normalizar-telefonos-clientes?success=' + encodeURIComponent('Normalizados ' + result.updated + ' cliente(s).'));
    }
    res.render('admin-normalizar-telefonos', { result: { ...result, applied: apply }, success: apply ? 'Normalización aplicada.' : null });
  } catch (e) {
    next(e);
  }
});

// ===========================
// DESCUENTOS PEDIDO
// ===========================
router.get('/descuentos-pedido', requireAdmin, async (_req, res, next) => {
  try {
    let diag = { database: null, count: null };
    try {
      const r = await db.query('SELECT DATABASE() AS db').catch(() => []);
      diag.database = r && r[0] ? _n(_n(_n(r[0].db, r[0].DB), r[0].database), null) : null;
    } catch (e) { warn('[admin] diag db:', e?.message); }
    try {
      const c = await db.query('SELECT COUNT(*) AS n FROM `descuentos_pedido`').catch(() => []);
      diag.count = c && c[0] ? Number(_n(_n(c[0].n, c[0].N), 0)) : null;
    } catch (e) {
      warn('[admin] diag count:', e?.message);
      diag.count = null;
    }

    const items = await db.getDescuentosPedidoAdmin().catch(() => null);
    if (items === null) {
      return res.render('descuentos-pedido', {
        title: 'Descuentos de pedido',
        items: [],
        error:
          'No se pudo leer la tabla descuentos_pedido. ¿Has ejecutado el script scripts/crear-tabla-descuentos-pedido.sql?',
        diag
      });
    }
    return res.render('descuentos-pedido', { title: 'Descuentos de pedido', items: items || [], error: null, diag });
  } catch (e) {
    next(e);
  }
});

router.get('/descuentos-pedido/new', requireAdmin, async (_req, res, next) => {
  try {
    return res.render('descuento-pedido-form', {
      title: 'Nuevo tramo de descuento',
      mode: 'create',
      item: { importe_desde: 0, importe_hasta: null, dto_pct: 0, activo: 1, orden: 10 },
      error: null
    });
  } catch (e) {
    next(e);
  }
});

router.post('/descuentos-pedido/new', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const n = (v) => {
      const s = String(_n(v, '')).trim();
      if (!s) return null;
      const x = Number(String(s).replace(',', '.'));
      return Number.isFinite(x) ? x : null;
    };
    const i = (v) => {
      const s = String(_n(v, '')).trim();
      if (!s) return 0;
      const x = parseInt(s, 10);
      return Number.isFinite(x) ? x : 0;
    };

    const payload = {
      importe_desde: n(body.importe_desde),
      importe_hasta: n(body.importe_hasta),
      dto_pct: n(body.dto_pct),
      orden: i(body.orden),
      activo: String(_n(body.activo, '1')) === '1' ? 1 : 0
    };

    const bad =
      payload.importe_desde === null ||
      payload.dto_pct === null ||
      payload.importe_desde < 0 ||
      payload.dto_pct < 0 ||
      payload.dto_pct > 100 ||
      (payload.importe_hasta !== null && payload.importe_hasta <= payload.importe_desde);
    if (bad) {
      return res.status(400).render('descuento-pedido-form', {
        title: 'Nuevo tramo de descuento',
        mode: 'create',
        item: payload,
        error:
          'Revisa los valores: "Desde" es obligatorio, "Hasta" debe ser mayor que "Desde" (o vacío), y el % debe estar entre 0 y 100.'
      });
    }

    await db.createDescuentoPedido(payload);
    return res.redirect('/admin/descuentos-pedido');
  } catch (e) {
    next(e);
  }
});

router.get('/descuentos-pedido/:id([0-9]+)/edit', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const item = await db.getDescuentoPedidoById(id);
    if (!item) return res.status(404).send('No encontrado');
    return res.render('descuento-pedido-form', { title: 'Editar tramo de descuento', mode: 'edit', item, error: null });
  } catch (e) {
    next(e);
  }
});

router.post('/descuentos-pedido/:id([0-9]+)/edit', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await db.getDescuentoPedidoById(id);
    if (!existing) return res.status(404).send('No encontrado');

    const body = req.body || {};
    const n = (v) => {
      const s = String(_n(v, '')).trim();
      if (!s) return null;
      const x = Number(String(s).replace(',', '.'));
      return Number.isFinite(x) ? x : null;
    };
    const i = (v) => {
      const s = String(_n(v, '')).trim();
      if (!s) return 0;
      const x = parseInt(s, 10);
      return Number.isFinite(x) ? x : 0;
    };

    const payload = {
      importe_desde: n(body.importe_desde),
      importe_hasta: n(body.importe_hasta),
      dto_pct: n(body.dto_pct),
      orden: i(body.orden),
      activo: String(_n(body.activo, '1')) === '1' ? 1 : 0
    };

    const bad =
      payload.importe_desde === null ||
      payload.dto_pct === null ||
      payload.importe_desde < 0 ||
      payload.dto_pct < 0 ||
      payload.dto_pct > 100 ||
      (payload.importe_hasta !== null && payload.importe_hasta <= payload.importe_desde);
    if (bad) {
      return res.status(400).render('descuento-pedido-form', {
        title: 'Editar tramo de descuento',
        mode: 'edit',
        item: { ...existing, ...payload, id },
        error:
          'Revisa los valores: "Desde" es obligatorio, "Hasta" debe ser mayor que "Desde" (o vacío), y el % debe estar entre 0 y 100.'
      });
    }

    await db.updateDescuentoPedido(id, payload);
    return res.redirect('/admin/descuentos-pedido');
  } catch (e) {
    next(e);
  }
});

router.post('/descuentos-pedido/:id([0-9]+)/toggle', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.toggleDescuentoPedidoActivo(id);
    return res.redirect('/admin/descuentos-pedido');
  } catch (e) {
    next(e);
  }
});

router.post('/descuentos-pedido/:id([0-9]+)/delete', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.deleteDescuentoPedido(id);
    return res.redirect('/admin/descuentos-pedido');
  } catch (e) {
    next(e);
  }
});

// ===========================
// VARIABLES SISTEMA / WEBHOOKS / CONFIGURACIÓN EMAIL
// ===========================
router.get('/variables-sistema', requireAdmin, async (req, res, next) => {
  try {
    const itemsRaw = await loadVariablesSistemaRaw();
    if (itemsRaw === null) {
      return res.render('variables-sistema', {
        title: 'Variables del sistema',
        subtitle: 'Configuración centralizada para que no haya que tocar código ni variables de entorno.',
        sections: [],
        error:
          'No se pudo leer/crear la tabla variables_sistema. Si tu entorno no permite CREATE TABLE, crea la tabla manualmente (ver scripts/crear-tabla-variables-sistema.sql) o usa .env como fallback.',
        success: null
      });
    }

    const knownWebhooks = [{ clave: SYSVAR_N8N_PEDIDOS_WEBHOOK_URL, descripcion: 'Webhook de N8N para envío de pedidos.' }];
    const knownEmail = [{ clave: SYSVAR_PEDIDOS_MAIL_TO, descripcion: 'Destinatario del email al pulsar ENVIAR en /pedidos.' }];

    const flag = String(req.query.saved || '').trim().toLowerCase();
    const success = flag === '1' ? 'Variable actualizada.' : null;
    const error = flag === '0' ? 'No se pudo guardar la variable.' : null;

    return res.render('variables-sistema', {
      title: 'Variables del sistema',
      subtitle: 'Vista general (agrupada por apartados).',
      sections: [
        { title: 'Webhooks', description: 'Integraciones vía URL.', items: buildSysVarMergedList(itemsRaw, knownWebhooks) },
        { title: 'Configuración Email', description: 'Envío directo por correo.', items: buildSysVarMergedList(itemsRaw, knownEmail) }
      ],
      notes: ['Para SMTP (host/usuario/contraseña) se recomienda usar variables de entorno en Vercel.'],
      updateAction: '/admin/variables-sistema/update',
      returnTo: '/admin/variables-sistema',
      error,
      success
    });
  } catch (e) {
    next(e);
  }
});

router.get('/webhooks', requireAdmin, async (req, res, next) => {
  try {
    const itemsRaw = await loadVariablesSistemaRaw();
    if (itemsRaw === null) {
      return res.render('variables-sistema', {
        title: 'Webhooks',
        subtitle: 'Configura URLs de integraciones (N8N, etc.).',
        sections: [],
        error:
          'No se pudo leer/crear la tabla variables_sistema. Si tu entorno no permite CREATE TABLE, crea la tabla manualmente (ver scripts/crear-tabla-variables-sistema.sql) o usa .env como fallback.',
        success: null,
        returnTo: '/admin/webhooks'
      });
    }
    const known = [{ clave: SYSVAR_N8N_PEDIDOS_WEBHOOK_URL, descripcion: 'Webhook de N8N para envío de pedidos.' }];
    const flag = String(req.query.saved || '').trim().toLowerCase();
    return res.render('variables-sistema', {
      title: 'Webhooks',
      subtitle: 'URLs de integración. Si está vacío en BD, se usa .env.',
      sections: [{ title: null, description: null, items: buildSysVarMergedList(itemsRaw, known) }],
      notes: ['En este momento el envío a N8N está desactivado (código preservado, no se ejecuta).'],
      updateAction: '/admin/variables-sistema/update',
      returnTo: '/admin/webhooks',
      error: flag === '0' ? 'No se pudo guardar la variable.' : null,
      success: flag === '1' ? 'Variable actualizada.' : null
    });
  } catch (e) {
    next(e);
  }
});

router.get('/configuracion-email', requireAdmin, async (req, res, next) => {
  try {
    let itemsRaw = await loadVariablesSistemaRaw();
    const tableUnavailable = itemsRaw === null;
    if (tableUnavailable) itemsRaw = [];
    const known = [
      { clave: SYSVAR_PEDIDOS_MAIL_TO, descripcion: 'Destinatario del email al pulsar ENVIAR en /pedidos.' },
      { clave: SYSVAR_SMTP_HOST, descripcion: 'Servidor SMTP (host). Ej: smtp.office365.com' },
      { clave: SYSVAR_SMTP_PORT, descripcion: 'Puerto SMTP. Ej: 587' },
      { clave: SYSVAR_SMTP_SECURE, descripcion: 'SMTP seguro (true/false). Normalmente false para 587 (STARTTLS).' },
      { clave: SYSVAR_SMTP_USER, descripcion: 'Usuario SMTP (email del remitente).' },
      { clave: SYSVAR_SMTP_PASS, descripcion: 'Contraseña SMTP / contraseña de aplicación.', secret: true, inputType: 'password' },
      { clave: SYSVAR_MAIL_FROM, descripcion: 'From visible. Si vacío, usa SMTP_USER.' }
    ];
    const flag = String(req.query.saved || '').trim().toLowerCase();
    const [smtpStatus, graphStatus] = await Promise.all([getSmtpStatus().catch(() => ({ configured: false })), getGraphStatus().catch(() => ({ configured: false }))]);
    const emailReady = smtpStatus.configured || graphStatus.configured;
    return res.render('variables-sistema', {
      title: 'Configuración Email',
      subtitle: 'Destinatarios y ajustes funcionales (no incluye credenciales SMTP).',
      tableUnavailable,
      emailStatus: { emailReady, smtpConfigured: smtpStatus.configured, graphConfigured: graphStatus.configured },
      sections: [
        { title: 'Envío de pedidos', description: 'Destino por defecto del botón ENVIAR.', items: buildSysVarMergedList(itemsRaw, known.slice(0, 1)) },
        { title: 'SMTP', description: 'Credenciales del servidor de correo (se leen desde BD o .env).', items: buildSysVarMergedList(itemsRaw, known.slice(1)) }
      ],
      notes: [
        'El envío por email requiere SMTP configurado (SMTP_HOST/SMTP_USER/SMTP_PASS).',
        tableUnavailable
          ? 'La tabla variables_sistema no está disponible. Se muestran los valores de variables de entorno (Vercel). Para guardar aquí, ejecuta scripts/crear-tabla-variables-sistema.sql en tu BD.'
          : 'Si usas variables de Vercel: los valores guardados aquí (BD) tienen prioridad. Deja vacíos SMTP_HOST/USER/PASS para usar las de Vercel.',
        'Si PEDIDOS_MAIL_TO está vacío, se usa p.lara@gemavip.com.',
        !emailReady ? '⚠️ Recuperación de contraseña: no se enviará ningún email hasta que configures SMTP.' : null
      ].filter(Boolean),
      updateAction: tableUnavailable ? null : '/admin/variables-sistema/update',
      returnTo: '/admin/configuracion-email',
      error: flag === '0' ? 'No se pudo guardar la variable.' : null,
      success: flag === '1' ? 'Variable actualizada.' : null
    });
  } catch (e) {
    next(e);
  }
});

router.post('/variables-sistema/update', requireAdmin, async (req, res, next) => {
  try {
    const clave = String(req.body?.clave || '').trim();
    const returnTo = String(req.body?.returnTo || '').trim() || '/admin/variables-sistema';
    if (!clave) return res.redirect(`${returnTo}?saved=0`);

    const rawVal = req.body?.valor;
    const val = rawVal === null || rawVal === undefined ? '' : String(rawVal);
    const trimmed = val.trim();

    const keepIfEmpty = String(req.body?.keepIfEmpty || '').trim() === '1';
    const clearSecret = String(req.body?.clear || '').trim() === '1';

    if (keepIfEmpty && !trimmed && !clearSecret) return res.redirect(`${returnTo}?saved=1`);
    const storeVal = trimmed ? trimmed : null;

    const descripcion =
      clave === SYSVAR_N8N_PEDIDOS_WEBHOOK_URL
        ? 'Webhook de N8N para envío de pedidos + Excel (multipart/form-data).'
        : clave === SYSVAR_PEDIDOS_MAIL_TO
          ? 'Destinatario del email al pulsar ENVIAR en /pedidos.'
          : clave === SYSVAR_SMTP_HOST
            ? 'Servidor SMTP (host).'
            : clave === SYSVAR_SMTP_PORT
              ? 'Puerto SMTP.'
              : clave === SYSVAR_SMTP_SECURE
                ? 'SMTP seguro (true/false).'
                : clave === SYSVAR_SMTP_USER
                  ? 'Usuario SMTP.'
                  : clave === SYSVAR_SMTP_PASS
                    ? 'Contraseña SMTP / app password.'
                    : clave === SYSVAR_MAIL_FROM
                      ? 'From visible.'
                      : null;

    const updatedBy = res.locals.user?.email || res.locals.user?.id || 'admin';
    await db.upsertVariableSistema(clave, storeVal, { descripcion, updatedBy });
    return res.redirect(`${returnTo}?saved=1`);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
