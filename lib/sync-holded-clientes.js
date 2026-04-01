/**
 * Importación de contactos Holded → CRM (solo `type` client/lead en API + tags + CIF + provincia ES en BD).
 */
'use strict';

/** Motivo de omisión cuando `contact.code` (CIF) está vacío en Holded. */
const MOTIVO_OMITIDO_SIN_CIF_HOLDED = 'CIF/NIF (code) vacío en Holded';

const crypto = require('crypto');
const { fetchHolded, putHolded } = require('./holded-api');
const { normalizeDniCifForStorage } = require('./dni-cif-utils');

/** Campos alineados con el payload Holded→CRM usados para hash de sync (orden fijo). */
const COMPARABLE_PAYLOAD_KEYS = [
  'cli_referencia',
  'cli_Id_Holded',
  'cli_nombre_razon_social',
  'cli_nombre_cial',
  'cli_dni_cif',
  'cli_email',
  'cli_movil',
  'cli_telefono',
  'cli_direccion',
  'cli_poblacion',
  'cli_codigo_postal',
  'cli_prov_id',
  'cli_pais_id',
  'cli_tags',
  'cli_iban',
  'cli_swift',
  'cli_banco',
  'Web',
  'Observaciones',
  'cli_regimen',
  'cli_ref_mandato',
  'cli_cuenta_ventas',
  'cli_cuenta_compras',
  'cli_visibilidad_portal',
  'NomContacto',
  'TipoContacto',
  'cli_CodPais'
];

/** Etiquetas en español para diff Holded ↔ CRM (mismas claves que el hash). */
const SYNC_CAMPO_LABELS = {
  cli_referencia: 'Referencia Holded',
  cli_Id_Holded: 'ID Holded',
  cli_nombre_razon_social: 'Nombre / razón social',
  cli_nombre_cial: 'Nombre comercial',
  cli_dni_cif: 'CIF/NIF',
  cli_email: 'Email',
  cli_movil: 'Móvil',
  cli_telefono: 'Teléfono',
  cli_direccion: 'Dirección',
  cli_poblacion: 'Población',
  cli_codigo_postal: 'Código postal',
  cli_prov_id: 'Provincia',
  cli_pais_id: 'País',
  cli_tags: 'Tags',
  cli_iban: 'IBAN',
  cli_swift: 'SWIFT',
  cli_banco: 'Banco',
  Web: 'Web',
  Observaciones: 'Observaciones',
  cli_regimen: 'Régimen fiscal',
  cli_ref_mandato: 'Ref. mandato',
  cli_cuenta_ventas: 'Cuenta ventas',
  cli_cuenta_compras: 'Cuenta compras',
  cli_visibilidad_portal: 'Visibilidad portal',
  NomContacto: 'Persona de contacto',
  TipoContacto: 'Tipo de contacto',
  cli_CodPais: 'Código país'
};

/**
 * Solo contactos Holded con `type` `client` o `lead` (CRM comercial).
 * Excluye: supplier (proveedor), creditor (acreedor), debtor, etc.
 * @see https://developers.holded.com/reference/list-contacts-1
 * @param {object} contact
 */
function isHoldedContactClienteOLead(contact) {
  if (!contact || typeof contact !== 'object') return false;
  const t = String(contact.type ?? contact.contactType ?? '').trim().toLowerCase();
  return t === 'client' || t === 'lead';
}

/** Lista filtrada para preview/import (solo cliente y lead en Holded). */
function filterHoldedContactsClienteOLead(list) {
  return (Array.isArray(list) ? list : []).filter(isHoldedContactClienteOLead);
}

/** @param {unknown} raw */
function pickHoldedUpdatedAt(contact) {
  if (!contact || typeof contact !== 'object') return null;
  const v =
    contact.updatedAt ??
    contact.updated_at ??
    contact.modifiedAt ??
    contact.modified_at ??
    contact.ts ??
    contact.time ??
    null;
  return v != null && v !== '' ? v : null;
}

/** @param {Record<string, unknown>} row */
function pickCrmUpdatedAt(row) {
  if (!row || typeof row !== 'object') return null;
  const candidates = [
    row.cli_actualizado_en,
    row.cli_updated_at,
    row.FechaModificacion,
    row.fecha_modificacion,
    row.updated_at,
    row.cli_fecha_mod,
    row.fecha_modif
  ];
  for (const v of candidates) {
    if (v != null && String(v).trim() !== '') return v;
  }
  return null;
}

/** @param {unknown} raw */
function formatFechaModDisplay(raw) {
  if (raw == null || raw === '') return null;
  try {
    let d;
    if (typeof raw === 'number') {
      d = new Date(raw < 1e12 ? raw * 1000 : raw);
    } else {
      d = new Date(raw);
    }
    if (!Number.isFinite(d.getTime())) return null;
    return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  } catch (_) {
    return null;
  }
}

/**
 * Lista de nombres de campos que difieren entre payload Holded y fila CRM (misma lógica que el hash).
 * @param {object} holdedContact
 * @param {{ provId: number|null, paisId: number|null }} ctx
 * @param {Record<string, unknown>} crmRow
 * @returns {string[]}
 */
function listComparableDifferences(holdedContact, ctx, crmRow) {
  const pH = buildClientePayloadFromHoldedContact(holdedContact, ctx);
  const pC = crmRowToComparablePayload(crmRow);
  const out = [];
  for (const k of COMPARABLE_PAYLOAD_KEYS) {
    const a = normComparableScalar(pH[k]);
    const b = normComparableScalar(pC[k]);
    if (a !== b) out.push(SYNC_CAMPO_LABELS[k] || k);
  }
  return out;
}

/**
 * @param {Record<string, unknown>} row - fila clientes (cli_* o legacy)
 */
function crmRowToComparablePayload(row) {
  if (!row || typeof row !== 'object') return {};
  const g = (keys) => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
        return row[k];
      }
    }
    return row[keys[0]];
  };
  /** @type {Record<string, unknown>} */
  const p = {};
  p.cli_referencia = g(['cli_referencia']);
  p.cli_Id_Holded = g(['cli_Id_Holded', 'cli_id_holded']);
  p.cli_nombre_razon_social = g(['cli_nombre_razon_social', 'Nombre_Razon_Social']);
  p.cli_nombre_cial = g(['cli_nombre_cial', 'Nombre_Cial']);
  p.cli_dni_cif = g(['cli_dni_cif', 'DNI_CIF']);
  p.cli_email = g(['cli_email', 'Email']);
  p.cli_movil = g(['cli_movil', 'Movil']);
  p.cli_telefono = g(['cli_telefono', 'Telefono']);
  p.cli_direccion = g(['cli_direccion', 'Direccion']);
  p.cli_poblacion = g(['cli_poblacion', 'Poblacion']);
  p.cli_codigo_postal = g(['cli_codigo_postal', 'CodigoPostal', 'codigo_postal']);
  p.cli_prov_id = g(['cli_prov_id', 'Id_Provincia']);
  p.cli_pais_id = g(['cli_pais_id', 'Id_Pais']);
  p.cli_tags = g(['cli_tags']);
  p.cli_iban = g(['cli_iban', 'IBAN']);
  p.cli_swift = g(['cli_swift', 'Swift']);
  p.cli_banco = g(['cli_banco', 'Banco']);
  p.Web = g(['cli_Web', 'Web']);
  p.Observaciones = g(['Observaciones', 'observaciones']);
  p.cli_regimen = g(['cli_regimen']);
  p.cli_ref_mandato = g(['cli_ref_mandato']);
  p.cli_cuenta_ventas = g(['cli_cuenta_ventas']);
  p.cli_cuenta_compras = g(['cli_cuenta_compras']);
  p.cli_visibilidad_portal = g(['cli_visibilidad_portal']);
  p.NomContacto = g(['NomContacto', 'cli_NomContacto']);
  p.TipoContacto = g(['TipoContacto', 'cli_tipo_contacto']);
  p.cli_CodPais = g(['cli_CodPais', 'CodPais']);
  return p;
}

function normComparableScalar(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

/**
 * @param {Record<string, unknown>} payload - fragmento tipo buildClientePayloadFromHoldedContact
 */
function stableComparableString(payload) {
  /** @type {Record<string, string>} */
  const o = {};
  for (const k of COMPARABLE_PAYLOAD_KEYS) {
    if (!(k in payload)) continue;
    const v = payload[k];
    if (v === undefined) continue;
    o[k] = normComparableScalar(v);
  }
  return JSON.stringify(o);
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Hash sync desde contacto Holded (misma lógica que import).
 * @param {object} contact
 * @param {{ provId: number|null, paisId: number|null }} ctx
 */
function hashFromHoldedContact(contact, ctx) {
  const payload = buildClientePayloadFromHoldedContact(contact, ctx);
  return sha256Hex(stableComparableString(payload));
}

/**
 * Hash desde fila CRM.
 * @param {object} row
 */
function hashFromCrmRow(row) {
  const p = crmRowToComparablePayload(row);
  return sha256Hex(stableComparableString(p));
}

/** Resuelve PK cliente desde fila SELECT o objeto { cli_id } artificial. */
function pickCliIdFromRow(row) {
  if (!row || typeof row !== 'object') return null;
  const v = row.cli_id ?? row.Cli_id ?? row.Id ?? row.id ?? row.ID;
  if (v == null) return null;
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * El cliente CRM corresponde a este contacto Holded (integridad: no mezclar filas solo por CIF sin ID).
 * @param {Record<string, unknown>} crm
 * @param {string} hid
 */
function isCrmLinkedToThisHolded(crm, hid) {
  if (!crm || !hid) return false;
  const h = String(hid).trim();
  const ref = crm.cli_referencia != null ? String(crm.cli_referencia).trim() : '';
  const idHeld = crm.cli_Id_Holded != null ? String(crm.cli_Id_Holded).trim() : '';
  return ref === h || idHeld === h;
}

/** Mapa estcli_id → nombre (estdoClientes). */
async function fetchEstadosClienteNombreMap(db, crmRows) {
  const rawIds = (crmRows || []).map((r) => r.cli_estcli_id ?? r.Id_EstdoCliente ?? r.id_estcli);
  const ids = [
    ...new Set(
      rawIds
        .map((x) => (x == null || x === '' ? NaN : Number(x)))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  ];
  if (!ids.length) return new Map();
  let table = 'estdoClientes';
  try {
    if (typeof db._resolveTableNameCaseInsensitive === 'function') {
      const t = await db._resolveTableNameCaseInsensitive('estdoClientes').catch(() => null);
      if (t) table = t;
    }
  } catch (_) {
    /* */
  }
  const ph = ids.map(() => '?').join(', ');
  try {
    const rows = await db.query(
      `SELECT estcli_id, estcli_nombre FROM \`${table}\` WHERE estcli_id IN (${ph})`,
      ids
    );
    const m = new Map();
    for (const er of rows || []) {
      const id = Number(er.estcli_id);
      if (!Number.isFinite(id)) continue;
      const nom = er.estcli_nombre != null ? String(er.estcli_nombre).trim() : '';
      m.set(id, nom || null);
    }
    return m;
  } catch (e) {
    console.warn('[sync-holded-clientes] fetchEstadosClienteNombreMap:', e?.message || e);
    return new Map();
  }
}

/** ID de contacto en respuestas Holded (lista y detalle). */
function getHoldedContactId(contact) {
  if (!contact || typeof contact !== 'object') return '';
  const v = contact.id ?? contact._id ?? contact.contactId ?? contact.ContactId;
  return v != null && String(v).trim() !== '' ? String(v).trim() : '';
}

/** @param {unknown} raw */
function parseSelectedTagsInput(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  return String(raw)
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Conjunto en minúsculas para comparar con tags del contacto */
function selectedTagsToSet(selected) {
  const arr = Array.isArray(selected) ? selected : parseSelectedTagsInput(selected);
  return new Set(arr.map((t) => String(t).toLowerCase().trim()).filter(Boolean));
}

/**
 * El contacto importa si tiene al menos una de las tags seleccionadas (OR).
 * @param {string[]} contactTags - tags normalizadas del contacto (originales)
 * @param {Set<string>} selectedLower
 */
function contactMatchesSelectedTags(contactTags, selectedLower) {
  if (!selectedLower || selectedLower.size === 0) return false;
  const lowered = (contactTags || []).map((t) => String(t).toLowerCase().trim());
  for (const s of selectedLower) {
    if (lowered.includes(s)) return true;
  }
  return false;
}

function normalizeHoldedTags(contact) {
  const raw = contact.tags ?? contact.Tags ?? [];
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      const p = JSON.parse(s);
      if (Array.isArray(p)) return p.map(String).map((x) => x.trim()).filter(Boolean);
    } catch (_) {
      /* ignore */
    }
    return s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function tagsToStoreString(tags) {
  return (tags || []).join(', ');
}

/** Añade la tag `crm` si no está (comparación sin distinguir mayúsculas). */
function mergeTagsWithCrm(tags) {
  const seen = new Set();
  const out = [];
  for (const t of tags || []) {
    const k = String(t).toLowerCase().trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(t).trim());
  }
  if (!seen.has('crm')) out.push('crm');
  return out;
}

function emptyToNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Mapea contacto Holded GET → payload cliente CRM (máximo de campos soportados por create/update).
 * @param {object} contact
 * @param {{ provId: number|null, paisId: number|null }} ctx
 */
function buildClientePayloadFromHoldedContact(contact, ctx) {
  const provId = ctx.provId ?? null;
  const paisId = ctx.paisId ?? null;

  const bill = contact?.billAddress ?? {};
  const ship0 = Array.isArray(contact?.shippingAddresses) ? contact.shippingAddresses[0] : {};
  const nombre = String(contact?.name ?? contact?.tradeName ?? '').trim() || 'Cliente Holded';
  const trade = emptyToNull(contact?.tradeName);
  const cifRaw = String(contact?.code ?? '').trim();
  const cifNorm = normalizeDniCifForStorage(cifRaw);
  const cif = cifNorm || cifRaw;
  const holdedId = getHoldedContactId(contact);

  const cpRaw = bill?.postalCode ?? ship0?.postalCode;
  let cli_codigo_postal = null;
  if (cpRaw != null && String(cpRaw).trim() !== '') {
    const pad = String(cpRaw).replace(/\D/g, '').slice(0, 5);
    cli_codigo_postal = pad.length === 5 ? pad : null;
  }

  const tags = normalizeHoldedTags(contact);
  const tagsStr = tagsToStoreString(mergeTagsWithCrm(tags));

  /** @type {Record<string, unknown>} */
  const payload = {
    cli_Id_Holded: holdedId || null,
    cli_referencia: holdedId || null,
    cli_nombre_razon_social: nombre,
    cli_nombre_cial: trade,
    cli_dni_cif: cif && cif.length ? cif : 'Pendiente',
    cli_email: emptyToNull(contact?.email),
    cli_movil: emptyToNull(contact?.mobile),
    cli_telefono: emptyToNull(contact?.phone),
    cli_direccion: emptyToNull(bill?.address ?? ship0?.address),
    cli_poblacion: emptyToNull(bill?.city ?? ship0?.city),
    cli_codigo_postal,
    cli_prov_id: provId,
    cli_pais_id: paisId,
    cli_tags: tagsStr,
    cli_com_id: 1,
    cli_estcli_id: 2,
    cli_activo: 1
  };

  const iban = contact?.iban ?? contact?.IBAN;
  if (iban) payload.cli_iban = String(iban).trim();
  const swift = contact?.swift ?? contact?.SWIFT ?? contact?.bic;
  if (swift) payload.cli_swift = String(swift).trim();
  const bank = contact?.bank ?? contact?.bankName;
  if (bank) payload.cli_banco = String(bank).trim();
  const web = contact?.website ?? contact?.web;
  if (web) payload.Web = String(web).trim();

  const notes = contact?.notes ?? contact?.note;
  if (notes != null) {
    let text = '';
    if (Array.isArray(notes)) {
      text = notes
        .map((n) => (n && typeof n === 'object' ? String(n.description ?? n.name ?? '').trim() : String(n)))
        .filter(Boolean)
        .join('\n');
    } else if (typeof notes === 'string' || typeof notes === 'number') {
      text = String(notes).trim();
    }
    if (text) payload.Observaciones = text;
  }

  if (contact?.taxOperation) payload.cli_regimen = String(contact.taxOperation);
  if (contact?.sepaRef != null && String(contact.sepaRef).trim() !== '') {
    payload.cli_ref_mandato = String(contact.sepaRef).trim();
  }
  const cv = contact?.clientRecord ?? contact?.salesAccount;
  if (cv != null && String(cv).trim() !== '') payload.cli_cuenta_ventas = String(cv).trim();
  const cc = contact?.supplierRecord ?? contact?.expensesAccount;
  if (cc != null && String(cc).trim() !== '') payload.cli_cuenta_compras = String(cc).trim();
  if (contact?.portalVisibility != null && String(contact.portalVisibility).trim() !== '') {
    payload.cli_visibilidad_portal = String(contact.portalVisibility).trim();
  }

  const nomCont = contact?.contactName ?? contact?.contactPerson;
  if (nomCont) payload.NomContacto = String(nomCont).trim();

  if (typeof contact?.isperson === 'boolean') {
    payload.TipoContacto = contact.isperson ? 'Persona' : 'Empresa';
  }

  const created = contact?.createdAt ?? contact?.createdTime ?? contact?.created;
  if (created != null) {
    let d;
    if (typeof created === 'number') {
      d = new Date(created < 1e12 ? created * 1000 : created);
    } else {
      d = new Date(created);
    }
    if (Number.isFinite(d.getTime())) payload.cli_creado_holded = d;
  }

  const ccPais = bill?.countryCode ?? bill?.country ?? ship0?.countryCode;
  if (ccPais) payload.cli_CodPais = String(ccPais).trim().toUpperCase().slice(0, 3);

  return payload;
}

async function ensureCrmTagOnHoldedContact(apiKey, contactId, contactFull) {
  const tags = normalizeHoldedTags(contactFull);
  const hasCrm = tags.some((t) => String(t).toLowerCase().trim() === 'crm');
  if (hasCrm) return;
  const merged = mergeTagsWithCrm(tags);
  await putHolded(`/contacts/${encodeURIComponent(contactId)}`, { tags: merged }, apiKey);
}

/**
 * Nombre real de tabla `clientes` y ensanchamiento de columnas donde va el ID Holded (evita "Data truncated").
 * Usa el nombre resuelto por el CRM (mayúsculas/minúsculas) y MODIFY idempotente a VARCHAR(255).
 */
async function ensureHoldedIdColumnsWideEnough(db) {
  try {
    if (!db.connected && !db.pool) await db.connect();
    const tClientes =
      typeof db._resolveTableNameCaseInsensitive === 'function'
        ? await db._resolveTableNameCaseInsensitive('clientes').catch(() => null)
        : null;
    const t = tClientes || 'clientes';

    const hasCol = async (colName) => {
      const rows = await db.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [t, colName]
      );
      return Array.isArray(rows) && rows.length > 0;
    };

    const idHeld = await hasCol('cli_Id_Holded');
    if (!idHeld) {
      try {
        await db.query(
          `ALTER TABLE \`${t}\` ADD COLUMN \`cli_Id_Holded\` VARCHAR(255) DEFAULT NULL AFTER \`cli_referencia\``
        );
      } catch (e1) {
        await db.query(`ALTER TABLE \`${t}\` ADD COLUMN \`cli_Id_Holded\` VARCHAR(255) DEFAULT NULL`);
      }
    } else {
      await db.query(`ALTER TABLE \`${t}\` MODIFY COLUMN \`cli_Id_Holded\` VARCHAR(255) NULL DEFAULT NULL`);
    }

    if (await hasCol('cli_referencia')) {
      await db.query(`ALTER TABLE \`${t}\` MODIFY COLUMN \`cli_referencia\` VARCHAR(255) NULL DEFAULT NULL`);
    }
  } catch (e) {
    console.warn('[sync-holded-clientes] ensureHoldedIdColumnsWideEnough:', e?.message || e);
  }
}

async function ensureColumnCliIdHolded(db) {
  await ensureHoldedIdColumnsWideEnough(db);
}

async function ensureColumnCliHoldedSyncHash(db) {
  try {
    if (!db.connected && !db.pool) await db.connect();
    const cols = await db.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'cli_holded_sync_hash'"
    );
    if (!cols?.length) {
      await db.query(
        'ALTER TABLE `clientes` ADD COLUMN `cli_holded_sync_hash` CHAR(64) NULL DEFAULT NULL AFTER `cli_Id_Holded`'
      );
    }
  } catch (e) {
    console.warn('[sync-holded-clientes] ensureColumnCliHoldedSyncHash:', e?.message || e);
  }
}

/** CIF / NIF en Holded viene en `code` */
function hasCifHolded(contact) {
  const c = contact?.code;
  if (c == null) return false;
  return String(c).trim() !== '';
}

function getProvinceFromContact(contact) {
  const bill = contact?.billAddress ?? {};
  const ship0 = Array.isArray(contact?.shippingAddresses) ? contact.shippingAddresses[0] : null;
  const p = bill.province ?? ship0?.province ?? '';
  return typeof p === 'string' ? p.trim() : String(p || '').trim();
}

/**
 * @param {import('../config/mysql-crm')} db
 * @param {string} provinceStr
 */
async function findProvinciaEspana(db, provinceStr) {
  if (!provinceStr) return null;
  const trimmed = String(provinceStr).trim();
  if (!trimmed) return null;

  const tryLike = async (needle) => {
    const rows = await db.query(
      `SELECT prov_id, prov_nombre, prov_codigo_pais
       FROM provincias
       WHERE prov_codigo_pais = 'ES' AND prov_nombre LIKE ? COLLATE utf8mb4_unicode_ci
       LIMIT 1`,
      [`%${needle}%`]
    );
    return rows?.[0] || null;
  };

  let row = await tryLike(trimmed);
  if (row) return row;

  const firstToken = trimmed.split(/[\s,/]+/).filter(Boolean)[0];
  if (firstToken && firstToken !== trimmed) {
    row = await tryLike(firstToken);
    if (row) return row;
  }

  return null;
}

async function getPaisIdEspana(db) {
  const rows = await db.query('SELECT pais_id FROM paises WHERE pais_codigo = ? LIMIT 1', ['ES']);
  return rows?.[0]?.pais_id ?? 1;
}

/** Normaliza la respuesta GET /contacts de Holded a un array. */
function normalizeHoldedContactsResponse(contacts) {
  let list = Array.isArray(contacts) ? contacts : [];
  if (!list.length && contacts && typeof contacts === 'object') {
    const alt = contacts.contacts || contacts.data || contacts.items || contacts.results;
    if (Array.isArray(alt)) list = alt;
  }
  return list;
}

/**
 * @param {string} apiKey
 * @returns {Promise<object[]>}
 */
async function fetchHoldedContactsList(apiKey) {
  const contacts = await fetchHolded('/contacts', {}, apiKey);
  return normalizeHoldedContactsResponse(contacts);
}

/**
 * Estadísticas de tags a partir de la lista de contactos.
 * @param {object[]} list
 */
function computeAllTagsFromList(list) {
  /** @type {Map<string, { key: string, display: string, count: number }>} */
  const tagMeta = new Map();
  for (const c of list) {
    const tags = normalizeHoldedTags(c);
    for (const t of tags) {
      const k = String(t).toLowerCase();
      if (!tagMeta.has(k)) {
        tagMeta.set(k, { key: k, display: String(t).trim() || k, count: 0 });
      }
      tagMeta.get(k).count++;
    }
  }
  return [...tagMeta.values()].sort((a, b) => b.count - a.count || a.display.localeCompare(b.display, 'es'));
}

/**
 * Filas de preview + stats; opcionalmente adjunta `_holdedContact` en filas importables (evita GET /contacts/:id en import).
 * @param {import('../config/mysql-crm')} db
 * @param {object[]} list
 * @param {Set<string>} selectedLower
 * @param {{ attachRawContact?: boolean }} [opt]
 */
async function buildHoldedPreviewRowsFromList(db, list, selectedLower, opt = {}) {
  const attachRawContact = !!opt.attachRawContact;
  const provCache = new Map();
  const findProvCached = async (provinceStr) => {
    const key = String(provinceStr || '').trim().toLowerCase();
    if (!key) return null;
    if (provCache.has(key)) return provCache.get(key);
    const row = await findProvinciaEspana(db, provinceStr);
    provCache.set(key, row);
    return row;
  };

  const paisId = await getPaisIdEspana(db);
  const rows = [];
  let importables = 0;
  let conTagSeleccionada = 0;
  let omitSinTag = 0;
  let omitSinCif = 0;
  let omitSinProvinciaEs = 0;
  const tieneSeleccion = selectedLower.size > 0;

  for (const c of list) {
    const tags = normalizeHoldedTags(c);
    const coincide = tieneSeleccion && contactMatchesSelectedTags(tags, selectedLower);
    if (coincide) conTagSeleccionada++;

    const provStr = getProvinceFromContact(c);
    const provRow = coincide ? await findProvCached(provStr) : null;
    const cifOk = hasCifHolded(c);

    let estado = 'omitido';
    let motivo = '';

    if (!tieneSeleccion) {
      omitSinTag++;
      motivo = 'Selecciona al menos una tag en la lista superior';
    } else if (!coincide) {
      omitSinTag++;
      motivo = 'Sin ninguna de las tags seleccionadas';
    } else if (!cifOk) {
      omitSinCif++;
      motivo = MOTIVO_OMITIDO_SIN_CIF_HOLDED;
    } else if (!provRow) {
      omitSinProvinciaEs++;
      motivo = 'Provincia no mapeada a España (BD)';
    } else {
      estado = 'importable';
      importables++;
    }

    const data = buildContactRow(c, { provRow: provRow || null, tags, paisId });

    /** @type {Record<string, unknown>} */
    const row = {
      ...data,
      tags: tags.join(', ') || '—',
      coincideTag: coincide,
      estado,
      estadoBase: estado,
      motivo: motivo || '—',
      /** Si existe fila en `clientes` vinculada (ref / cli_Id_Holded / CIF). Se rellena en enrich. */
      crmVinculado: estado === 'importable' ? false : undefined
    };
    if (attachRawContact && coincide && (estado === 'importable' || motivo === MOTIVO_OMITIDO_SIN_CIF_HOLDED)) {
      row._holdedContact = c;
    }
    rows.push(row);
  }

  return {
    rows,
    stats: {
      totalHolded: list.length,
      conTagSeleccionada,
      importables,
      omitSinTag,
      omitSinCif,
      omitSinProvinciaEs,
      tagsSeleccionadas: selectedLower.size
    }
  };
}

/**
 * Ajusta `estado` / `motivo` en filas con reglas Holded cumplidas (estadoBase importable) según CRM vinculado y hashes.
 * @param {import('../config/mysql-crm')} db
 * @param {object[]} rows - mutado in-place
 * @param {object[]} list - contactos Holded
 * @param {number} paisIdEspana
 */
async function enrichHoldedRowsWithSyncState(db, rows, list, paisIdEspana) {
  await ensureColumnCliIdHolded(db);
  await ensureColumnCliHoldedSyncHash(db);

  const byHid = new Map();
  for (const c of list) {
    const id = getHoldedContactId(c);
    if (id) byHid.set(id, c);
  }

  const candidatos = rows.filter((r) => r.estadoBase === 'importable');
  if (!candidatos.length) return;

  const ids = [...new Set(candidatos.map((r) => r.holdedId).filter(Boolean))];
  const cifsNorm = [
    ...new Set(
      candidatos
        .map((r) => normalizeDniCifForStorage(r.cif))
        .filter((x) => x && x.length >= 8 && x.toUpperCase() !== 'PENDIENTE')
    )
  ];

  if (!ids.length) return;

  const ph = ids.map(() => '?').join(', ');
  let sql = `SELECT * FROM clientes WHERE cli_referencia IN (${ph}) OR cli_Id_Holded IN (${ph})`;
  const params = [...ids, ...ids];
  if (cifsNorm.length) {
    const phC = cifsNorm.map(() => '?').join(', ');
    sql += ` OR REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(cli_dni_cif,''))),' ',''),'-',''),'.','') IN (${phC})`;
    params.push(...cifsNorm);
  }

  let crmRows = [];
  try {
    crmRows = await db.query(sql, params);
  } catch (e) {
    console.warn('[sync-holded-clientes] enrichHoldedRowsWithSyncState query:', e?.message || e);
    return;
  }

  const estadosNombreById = await fetchEstadosClienteNombreMap(db, crmRows);

  const byRef = new Map();
  const byHold = new Map();
  const byCif = new Map();
  for (const cr of crmRows || []) {
    const ref = cr.cli_referencia != null ? String(cr.cli_referencia).trim() : '';
    const hid = cr.cli_Id_Holded != null ? String(cr.cli_Id_Holded).trim() : '';
    if (ref) byRef.set(ref, cr);
    if (hid) byHold.set(hid, cr);
    const cn = normalizeDniCifForStorage(cr.cli_dni_cif ?? cr.DNI_CIF);
    if (cn && cn.length >= 8 && cn.toUpperCase() !== 'PENDIENTE') {
      if (!byCif.has(cn)) byCif.set(cn, cr);
    }
  }

  for (const row of candidatos) {
    row.syncCamposDiferentes = null;
    row.holdedFechaModTexto = null;
    row.crmFechaModTexto = null;

    const hid = row.holdedId;
    const c = byHid.get(hid);
    if (!c) continue;

    const ctx = {
      provId: row.cli_prov_id ?? null,
      paisId: row.cli_pais_id ?? paisIdEspana
    };
    const H = hashFromHoldedContact(c, ctx);

    let crm =
      (hid && byRef.get(hid)) ||
      (hid && byHold.get(hid)) ||
      (row.cif && byCif.get(normalizeDniCifForStorage(row.cif))) ||
      null;

    if (!crm) {
      row.crmVinculado = false;
      row.crmEstadoClienteNombre = null;
      row.estado = 'importable';
      row.motivo = 'Pendiente de primera importación a CRM';
      continue;
    }

    row.crmVinculado = true;
    const eid = crm.cli_estcli_id ?? crm.Id_EstdoCliente ?? null;
    const eidNum = eid == null || eid === '' ? NaN : Number(eid);
    row.crmEstadoClienteNombre =
      Number.isFinite(eidNum) && eidNum > 0 ? estadosNombreById.get(eidNum) || null : null;

    const C = hashFromCrmRow(crm);
    const S = crm.cli_holded_sync_hash != null ? String(crm.cli_holded_sync_hash).trim() : '';

    if (H === C) {
      row.estado = 'importado';
      row.motivo = '—';
    } else if (S && H !== S && C === S) {
      if (isCrmLinkedToThisHolded(crm, hid)) {
        row.estado = 'pte_importar';
        row.motivo = 'Cambios en Holded respecto al último sync';
      } else {
        row.estado = 'desincronizado';
        row.motivo =
          'Cambios en Holded; el CRM no tiene cli_Id_Holded/referencia coherentes con este contacto — revisar vinculación';
      }
    } else if (S && C !== S && H === S) {
      if (isCrmLinkedToThisHolded(crm, hid)) {
        row.estado = 'pte_exportar';
        row.motivo = 'Datos en CRM distintos de Holded; sincronizar hacia Holded';
      } else {
        row.estado = 'desincronizado';
        row.motivo =
          'CRM vinculado por CIF pero sin cli_Id_Holded/referencia Holded coherente; corregir en BD antes de sincronizar';
      }
    } else {
      row.estado = 'desincronizado';
      row.motivo = 'Holded y CRM divergen respecto al último sync';
    }

    if (crm && H !== C) {
      row.syncCamposDiferentes = listComparableDifferences(c, ctx, crm);
      row.holdedFechaModTexto = formatFechaModDisplay(pickHoldedUpdatedAt(c));
      row.crmFechaModTexto = formatFechaModDisplay(pickCrmUpdatedAt(crm));
    }
  }
}

function computeSyncLabelStats(rows) {
  let importado = 0;
  let pteImportar = 0;
  let pteExportar = 0;
  let desincronizado = 0;
  let primeraImportacion = 0;
  /** Holded ↔ CRM con datos distintos (cualquier tipo de divergencia). */
  let syncDatosDistintos = 0;
  /** Con tag+reglas y ya hay cliente en BD (cualquier estado sync). */
  let crmEnBase = 0;
  /** Con tag+reglas y aún no hay cliente en BD (falta dar de alta). */
  let crmPendientesAlta = 0;
  for (const r of rows) {
    if (r.estadoBase !== 'importable') continue;
    if (r.crmVinculado === true) crmEnBase++;
    if (r.crmVinculado === false) crmPendientesAlta++;
    if (r.estado === 'importado') importado++;
    else if (r.estado === 'pte_importar') pteImportar++;
    else if (r.estado === 'pte_exportar') pteExportar++;
    else if (r.estado === 'desincronizado') desincronizado++;
    else if (r.estado === 'importable') primeraImportacion++;
    if (r.estado === 'pte_importar' || r.estado === 'pte_exportar' || r.estado === 'desincronizado') {
      syncDatosDistintos++;
    }
  }
  return {
    syncImportados: importado,
    syncPteImportar: pteImportar,
    syncPteExportar: pteExportar,
    syncDesincronizado: desincronizado,
    syncPrimeraImportacion: primeraImportacion,
    syncDatosDistintos,
    crmClientesEnBd: crmEnBase,
    crmClientesPendientesAlta: crmPendientesAlta
  };
}

function buildContactRow(contact, { provRow, tags, paisId }) {
  const contactId = getHoldedContactId(contact);
  const bill = contact?.billAddress ?? {};
  const ship0 = Array.isArray(contact?.shippingAddresses) ? contact.shippingAddresses[0] : {};
  const nombre = String(contact?.name ?? contact?.tradeName ?? 'Cliente Holded').trim();
  const cifRaw = String(contact?.code ?? '').trim();
  const cifNorm = normalizeDniCifForStorage(cifRaw);
  const cif = (cifNorm || cifRaw) || null;
  const cpRaw = bill?.postalCode ?? ship0?.postalCode;
  let cliCodigoPostal = null;
  if (cpRaw != null && String(cpRaw).trim() !== '') {
    const pad = String(cpRaw).replace(/\D/g, '').slice(0, 5);
    cliCodigoPostal = pad.length === 5 ? pad : null;
  }

  return {
    holdedId: contactId,
    cli_Id_Holded: contactId,
    nombre,
    cif,
    email: contact?.email || null,
    movil: contact?.mobile || null,
    telefono: contact?.phone || null,
    direccion: bill?.address || ship0?.address || null,
    poblacion: bill?.city || ship0?.city || null,
    cli_codigo_postal: cliCodigoPostal,
    cli_prov_id: provRow?.prov_id ?? null,
    cli_pais_id: paisId,
    cli_referencia: contactId || null,
    cli_tags: tagsToStoreString(tags),
    provinciaHolded: getProvinceFromContact(contact),
    provinciaCrm: provRow?.prov_nombre ?? null
  };
}

/**
 * Vista previa + estadísticas de tags.
 * @param {import('../config/mysql-crm')} db
 * @param {{ selectedTags?: string[] }} opts - tags elegidas (cualquier coincidencia, sin distinguir mayúsculas)
 */
async function previewHoldedClientesEs(db, opts = {}) {
  const selectedLower = selectedTagsToSet(opts.selectedTags || []);

  const apiKey = (process.env.HOLDED_API_KEY || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      error: 'Falta HOLDED_API_KEY en variables de entorno',
      rows: [],
      stats: {},
      allTags: [],
      selectedTags: [...selectedLower]
    };
  }

  try {
    if (!db.connected && !db.pool) await db.connect();

    const listRaw = await fetchHoldedContactsList(apiKey);
    const list = filterHoldedContactsClienteOLead(listRaw);
    const holdedExcluidosTipo = Math.max(0, listRaw.length - list.length);
    const allTags = computeAllTagsFromList(list);
    const paisId = await getPaisIdEspana(db);
    const { rows, stats } = await buildHoldedPreviewRowsFromList(db, list, selectedLower, {
      attachRawContact: false
    });
    await enrichHoldedRowsWithSyncState(db, rows, list, paisId);
    const syncLabelStats = computeSyncLabelStats(rows);

    return {
      ok: true,
      rows,
      stats: {
        ...stats,
        ...syncLabelStats,
        holdedExcluidosTipo,
        totalHoldedApi: listRaw.length
      },
      allTags,
      selectedTags: [...selectedLower]
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      rows: [],
      stats: {},
      allTags: [],
      selectedTags: [...selectedLower]
    };
  }
}

/**
 * Importa contactos importables (tags seleccionadas + provincia ES).
 * @param {import('../config/mysql-crm')} db
 * @param {{ dryRun?: boolean, selectedTags?: string[] }} opts
 */
async function importHoldedClientesEs(db, opts = {}) {
  const dryRun = !!opts.dryRun;
  const selectedLower = selectedTagsToSet(opts.selectedTags || []);
  const apiKey = (process.env.HOLDED_API_KEY || '').trim();

  if (!apiKey) {
    return { ok: false, error: 'Falta HOLDED_API_KEY en variables de entorno', inserted: 0, updated: 0, skipped: 0, errors: 0, dryRun };
  }

  try {
    if (!db.connected && !db.pool) await db.connect();
  } catch (e) {
    return { ok: false, error: e?.message || String(e), inserted: 0, updated: 0, skipped: 0, errors: 0, dryRun };
  }

  if (dryRun) {
    const preview = await previewHoldedClientesEs(db, { selectedTags: opts.selectedTags });
    if (!preview.ok) {
      return { ok: false, error: preview.error, inserted: 0, updated: 0, skipped: 0, errors: 0, dryRun };
    }
    const toImport = preview.rows.filter((r) => r.estado === 'importable' || r.estado === 'pte_importar');
    return {
      ok: true,
      inserted: toImport.length,
      updated: 0,
      skipped: 0,
      errors: 0,
      holdedTagErrors: 0,
      dryRun: true
    };
  }

  let list;
  try {
    list = filterHoldedContactsClienteOLead(await fetchHoldedContactsList(apiKey));
  } catch (e) {
    return { ok: false, error: e?.message || String(e), inserted: 0, updated: 0, skipped: 0, errors: 0, dryRun };
  }

  const paisId = await getPaisIdEspana(db);
  const { rows } = await buildHoldedPreviewRowsFromList(db, list, selectedLower, { attachRawContact: true });
  await enrichHoldedRowsWithSyncState(db, rows, list, paisId);
  const toImport = rows.filter((r) => r.estado === 'importable' || r.estado === 'pte_importar');

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let holdedTagErrors = 0;
  /** @type {string|null} */
  let errorFirst = null;

  await ensureColumnCliIdHolded(db);
  await ensureColumnCliHoldedSyncHash(db);

  let defaultComId = 1;
  try {
    const comRows = await db.query('SELECT com_id FROM comerciales ORDER BY com_id ASC LIMIT 1');
    if (comRows?.length && comRows[0].com_id != null) {
      const n = Number(comRows[0].com_id);
      if (Number.isFinite(n) && n > 0) defaultComId = n;
    }
  } catch (_) {
    /* mantener 1 */
  }

  for (const row of toImport) {
    const contactId = row.holdedId;
    if (!contactId) {
      skipped++;
      continue;
    }

    try {
      /** @type {object | undefined} */
      let full = row._holdedContact;
      if (!full || typeof full !== 'object') {
        try {
          full = await fetchHolded(`/contacts/${encodeURIComponent(contactId)}`, {}, apiKey);
        } catch (e) {
          errors++;
          const em = e?.message || String(e);
          if (!errorFirst) errorFirst = em;
          console.warn('[sync-holded-clientes] GET contacto', contactId, em);
          continue;
        }
      }
      const hid = getHoldedContactId(full);
      if (!hid) {
        errors++;
        const detail = 'Contacto Holded sin id en respuesta';
        if (!errorFirst) errorFirst = detail;
        console.warn('[sync-holded-clientes] contacto sin id Holded', JSON.stringify(full).slice(0, 200));
        continue;
      }

      const payload = buildClientePayloadFromHoldedContact(full, {
        provId: row.cli_prov_id ?? null,
        paisId: row.cli_pais_id ?? paisId
      });
      if (payload.cli_com_id === 1) {
        payload.cli_com_id = defaultComId;
      }

      let existing = await db.query('SELECT cli_id FROM clientes WHERE cli_referencia = ? LIMIT 1', [contactId]);
      if (!existing?.length) {
        try {
          existing = await db.query('SELECT cli_id FROM clientes WHERE cli_Id_Holded = ? LIMIT 1', [contactId]);
        } catch (_) {
          /* columna cli_Id_Holded aún no existe */
        }
      }
      const cif = row.cif;
      if (!existing?.length && cif) {
        const dup = await db.findConflictoDniCifCliente({ dniCif: cif });
        if (dup.conflict && dup.matches?.length) {
          const mid = dup.matches[0].Id ?? dup.matches[0].cli_id ?? dup.matches[0].id;
          if (mid != null) {
            existing = [{ cli_id: mid }];
          }
        }
      }

      let cliIdAfter = null;
      if (existing?.length) {
        const cliId = pickCliIdFromRow(existing[0]);
        if (!cliId) {
          errors++;
          const detail = 'Fila CRM sin cli_id válido tras búsqueda por ref/CIF';
          if (!errorFirst) errorFirst = detail;
          console.warn('[sync-holded-clientes]', contactId, detail, existing[0]);
          continue;
        }
        await db.updateCliente(cliId, payload);
        updated++;
        cliIdAfter = cliId;
      } else {
        const created = await db.createCliente(payload);
        inserted++;
        cliIdAfter = created?.insertId ?? created?.Id ?? created?.id ?? null;
      }

      if (cliIdAfter != null) {
        try {
          const h = hashFromHoldedContact(full, {
            provId: row.cli_prov_id ?? null,
            paisId: row.cli_pais_id ?? paisId
          });
          await db.query('UPDATE clientes SET cli_holded_sync_hash = ? WHERE cli_id = ?', [h, cliIdAfter]);
        } catch (eh) {
          console.warn('[sync-holded-clientes] cli_holded_sync_hash:', contactId, eh?.message || eh);
        }
      }

      try {
        await ensureCrmTagOnHoldedContact(apiKey, contactId, full);
      } catch (e) {
        holdedTagErrors++;
        console.warn('[sync-holded-clientes] tag crm Holded:', contactId, e?.message || e);
      }
    } catch (e) {
      errors++;
      const em = e?.message || String(e);
      if (!errorFirst) errorFirst = em;
      console.warn('[sync-holded-clientes] import fila', contactId, em);
    }
  }

  return { ok: true, inserted, updated, skipped, errors, holdedTagErrors, errorFirst, dryRun: false };
}

/**
 * Crea en CRM clientes tipo Lead desde contactos Holded con tag filtrada pero sin CIF en Holded (no importables por regla normal).
 * @param {import('../config/mysql-crm')} db
 * @param {{ selectedTags?: string[] }} opts
 */
async function importHoldedSinCifComoLeads(db, opts = {}) {
  const selectedLower = selectedTagsToSet(opts.selectedTags || []);
  const apiKey = (process.env.HOLDED_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'Falta HOLDED_API_KEY en variables de entorno', inserted: 0, skipped: 0, errors: 0 };
  }
  if (!selectedLower.size) {
    return { ok: false, error: 'Selecciona al menos una tag', inserted: 0, skipped: 0, errors: 0 };
  }
  try {
    if (!db.connected && !db.pool) await db.connect();
  } catch (e) {
    return { ok: false, error: e?.message || String(e), inserted: 0, skipped: 0, errors: 0 };
  }

  let list;
  try {
    list = filterHoldedContactsClienteOLead(await fetchHoldedContactsList(apiKey));
  } catch (e) {
    return { ok: false, error: e?.message || String(e), inserted: 0, skipped: 0, errors: 0 };
  }

  const paisId = await getPaisIdEspana(db);
  const { rows } = await buildHoldedPreviewRowsFromList(db, list, selectedLower, { attachRawContact: true });
  const targets = rows.filter((r) => r.coincideTag && r.motivo === MOTIVO_OMITIDO_SIN_CIF_HOLDED);

  let leadEstId = 1;
  try {
    if (typeof db._getEstadoClienteIds === 'function') {
      const ids = await db._getEstadoClienteIds();
      if (ids && ids.lead != null) leadEstId = Number(ids.lead);
    }
  } catch (_) {
    /* mantener 1 */
  }

  let tipcLeadId = null;
  try {
    const tipcRows = await db.query(
      `SELECT tipc_id FROM tipos_clientes WHERE LOWER(TRIM(tipc_tipo)) = 'lead' LIMIT 1`
    );
    tipcLeadId = tipcRows?.[0]?.tipc_id ?? null;
  } catch (_) {
    /* opcional */
  }

  let defaultComId = 1;
  try {
    const comRows = await db.query('SELECT com_id FROM comerciales ORDER BY com_id ASC LIMIT 1');
    if (comRows?.length && comRows[0].com_id != null) {
      const n = Number(comRows[0].com_id);
      if (Number.isFinite(n) && n > 0) defaultComId = n;
    }
  } catch (_) {
    /* mantener 1 */
  }

  await ensureColumnCliIdHolded(db);
  await ensureColumnCliHoldedSyncHash(db);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  /** @type {string|null} */
  let errorFirst = null;

  for (const row of targets) {
    const contactId = row.holdedId;
    if (!contactId) {
      skipped++;
      continue;
    }

    try {
      /** @type {object | undefined} */
      let full = row._holdedContact;
      if (!full || typeof full !== 'object') {
        try {
          full = await fetchHolded(`/contacts/${encodeURIComponent(contactId)}`, {}, apiKey);
        } catch (e) {
          errors++;
          const em = e?.message || String(e);
          if (!errorFirst) errorFirst = em;
          console.warn('[sync-holded-clientes] GET contacto lead sin CIF', contactId, em);
          continue;
        }
      }
      const hid = getHoldedContactId(full);
      if (!hid) {
        errors++;
        const detail = 'Contacto Holded sin id en respuesta';
        if (!errorFirst) errorFirst = detail;
        continue;
      }

      let existing = await db.query('SELECT cli_id FROM clientes WHERE cli_referencia = ? LIMIT 1', [contactId]);
      if (!existing?.length) {
        try {
          existing = await db.query('SELECT cli_id FROM clientes WHERE cli_Id_Holded = ? LIMIT 1', [contactId]);
        } catch (_) {
          /* */
        }
      }
      if (existing?.length) {
        skipped++;
        continue;
      }

      const payload = buildClientePayloadFromHoldedContact(full, {
        provId: row.cli_prov_id ?? null,
        paisId: row.cli_pais_id ?? paisId
      });
      if (payload.cli_com_id === 1) {
        payload.cli_com_id = defaultComId;
      }
      payload.cli_estcli_id = leadEstId;
      payload.Id_EstdoCliente = leadEstId;
      if (tipcLeadId != null) payload.cli_tipc_id = tipcLeadId;

      const noteLine = `[CPanel Holded] Alta como Lead: sin CIF en Holded (contacto Holded ${hid}).`;
      payload.Observaciones = payload.Observaciones
        ? `${String(payload.Observaciones).trim()}\n${noteLine}`
        : noteLine;

      const created = await db.createCliente(payload);
      inserted++;

      const cliIdAfter = created?.insertId ?? created?.Id ?? created?.id ?? null;
      if (cliIdAfter != null) {
        try {
          const h = hashFromHoldedContact(full, {
            provId: row.cli_prov_id ?? null,
            paisId: row.cli_pais_id ?? paisId
          });
          await db.query('UPDATE clientes SET cli_holded_sync_hash = ? WHERE cli_id = ?', [h, cliIdAfter]);
        } catch (eh) {
          console.warn('[sync-holded-clientes] cli_holded_sync_hash lead sin CIF:', eh?.message || eh);
        }
      }

      try {
        await ensureCrmTagOnHoldedContact(apiKey, hid, full);
      } catch (e) {
        console.warn('[sync-holded-clientes] tag crm Holded lead sin CIF:', hid, e?.message || e);
      }
    } catch (e) {
      errors++;
      const em = e?.message || String(e);
      if (!errorFirst) errorFirst = em;
      console.warn('[sync-holded-clientes] alta lead sin CIF fila', contactId, em);
    }
  }

  return { ok: true, inserted, skipped, errors, errorFirst };
}

module.exports = {
  previewHoldedClientesEs,
  importHoldedClientesEs,
  importHoldedSinCifComoLeads,
  MOTIVO_OMITIDO_SIN_CIF_HOLDED,
  normalizeHoldedTags,
  parseSelectedTagsInput,
  selectedTagsToSet,
  contactMatchesSelectedTags,
  hasCifHolded,
  mergeTagsWithCrm,
  buildClientePayloadFromHoldedContact,
  isHoldedContactClienteOLead,
  filterHoldedContactsClienteOLead
};
