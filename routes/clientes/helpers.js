/**
 * Funciones compartidas de las rutas HTML de clientes.
 */
const { renderErrorPage } = require('../../lib/app-helpers');
const {
  clienteColumnTabId,
  isHoldedSyncSuperOnlyField
} = require('../../lib/cliente-helpers');
const { normalizeTelefonoForDB } = require('../../lib/telefono-utils');

function normalizePayloadTelefonos(payload) {
  const telCols = ['cli_telefono', 'cli_movil', 'Telefono', 'Movil', 'telefono', 'movil'];
  for (const col of telCols) {
    if (payload[col] != null && String(payload[col]).trim()) {
      const norm = normalizeTelefonoForDB(payload[col]);
      payload[col] = norm;
    }
  }
}

function normalizeRelacionRow(r) {
  if (!r || typeof r !== 'object') return r;
  const lower = {};
  for (const k of Object.keys(r)) lower[k.toLowerCase()] = r[k];
  return { ...r, ...lower };
}

function clienteNotFoundPage(req, res, id) {
  return renderErrorPage(req, res, {
    status: 404,
    title: 'Contacto no encontrado',
    heading: 'No encontramos ese contacto',
    summary: `Esta instancia del CRM está usando una base de datos MySQL donde no hay ningún registro con ID ${id} en la tabla de clientes (PK del esquema). La ruta es correcta; el fallo es que no existe esa fila en esa BD. Si ves el contacto en otro entorno (p. ej. local), seguramente apuntas a otro host, otra base o otro servidor de datos.`,
    statusLabel: 'Not Found',
    whatToDo: [
      'En el panel de despliegue (p. ej. Vercel → Settings → Environment Variables): revisa DB_HOST, DB_NAME, DB_USER y que coincidan con el MySQL donde están los datos que quieres usar.',
      'En ese mismo MySQL ejecuta un SELECT sobre clientes por cli_id (o la PK configurada) y confirma si el ID existe.',
      'Tras corregir variables, redepliega o espera a que se apliquen y vuelve a abrir el contacto.'
    ]
  });
}

function stripClienteAvanzadoFieldsFromPayload(payload, meta) {
  if (!payload || !meta) return;
  for (const k of Object.keys(payload)) {
    if (clienteColumnTabId(k, meta) === 'avanzado') delete payload[k];
  }
}

function stripClienteEtiquetasForNonAdmin(payload) {
  if (!payload || typeof payload !== 'object') return;
  for (const k of Object.keys(payload)) {
    const lc = String(k).toLowerCase();
    if (lc === 'cli_tags' || lc === 'tags') delete payload[k];
  }
}

function stripHoldedSyncSuperOnlyFieldsFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  for (const k of Object.keys(payload)) {
    if (isHoldedSyncSuperOnlyField(k)) delete payload[k];
  }
}

function triggerHoldedSyncEvalOnViewIfPending(db, cliId, item) {
  const pend =
    item &&
    (Number(item.cli_holded_sync_pendiente) === 1 || String(item.cli_holded_sync_pendiente) === '1');
  if (!pend) return;
  const { evaluateCliHoldedSyncPendienteAfterCrmSave } = require('../../lib/holded-sync');
  evaluateCliHoldedSyncPendienteAfterCrmSave(db, cliId, { fromView: true }).catch(() => {});
}

async function parseClienteRouteId(req, db) {
  const raw = String(req.params.id ?? '').trim();
  const id = await db.resolveClienteIdFromRouteParam(req.params.id);
  if (id == null || !Number.isFinite(id) || id <= 0) {
    if (raw && !/^\d+$/.test(raw)) {
      return { ok: false, reason: 'notfound', raw };
    }
    return { ok: false, reason: 'badrequest', raw };
  }
  return { ok: true, id, raw };
}

function redirectIfHoldedIdInUrl(req, res, id, raw) {
  if (!raw || /^\d+$/.test(raw)) return false;
  const p = req.path || '';
  let dest = `/clientes/${id}`;
  if (p.endsWith('/edit')) dest += '/edit';
  else if (p.includes('/direcciones/new')) dest += '/direcciones/new';
  res.redirect(302, dest);
  return true;
}

let sendPushToAdmins = () => Promise.resolve();
try {
  const wp = require('../../lib/web-push');
  if (wp && typeof wp.sendPushToAdmins === 'function') sendPushToAdmins = wp.sendPushToAdmins;
} catch (_) {}

module.exports = {
  normalizePayloadTelefonos,
  normalizeRelacionRow,
  clienteNotFoundPage,
  stripClienteAvanzadoFieldsFromPayload,
  stripClienteEtiquetasForNonAdmin,
  stripHoldedSyncSuperOnlyFieldsFromPayload,
  triggerHoldedSyncEvalOnViewIfPending,
  parseClienteRouteId,
  redirectIfHoldedIdInUrl,
  sendPushToAdmins
};
