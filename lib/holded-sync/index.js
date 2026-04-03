/**
 * Importación de contactos Holded → CRM (solo `type` client/lead en API + tags + CIF + provincia ES en BD).
 */
'use strict';

/** Motivo de omisión cuando `contact.code` (CIF) está vacío en Holded. */
const MOTIVO_OMITIDO_SIN_CIF_HOLDED = 'CIF/NIF (code) vacío en Holded';

const crypto = require('crypto');
const { fetchHolded, putHolded } = require('../holded-api');
const { normalizeDniCifForStorage } = require('../dni-cif-utils');

/**
 * Solo datos de contacto / fiscal comparables entre Holded y CRM.
 * No incluye: IDs de enlace (cli_referencia, cli_Id_Holded), ni tags operativos (cli_tags),
 * ni cli_id — la sincronización no debe dispararse por esos campos.
 */
const COMPARABLE_PAYLOAD_KEYS = [
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
  p.cli_codigo_postal = normalizeCodigoPostalEspanaComparable(g(['cli_codigo_postal', 'CodigoPostal', 'codigo_postal']));
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
 * Canon: `cli_Id_Holded === contact.id`. `cli_referencia` solo como compatibilidad con filas antiguas que duplicaban el ID.
 * @param {Record<string, unknown>} crm
 * @param {string} hid
 */
function isCrmLinkedToThisHolded(crm, hid) {
  if (!crm || !hid) return false;
  const h = String(hid).trim();
  const idHeld = crm.cli_Id_Holded != null ? String(crm.cli_Id_Holded).trim() : '';
  if (idHeld === h) return true;
  const ref = crm.cli_referencia != null ? String(crm.cli_referencia).trim() : '';
  return ref === h;
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

/**
 * Alcance: tag `crm` siempre en el filtro; opcional `SYNC_HOLDED_DEFAULT_TAGS` (coma-separadas).
 * Un contacto debe tener al menos una tag del conjunto (OR), incluida siempre `crm`.
 *
 * @param {string[]|undefined} selectedTags
 * @returns {{ mode: 'filter', effectiveSet: Set<string>, effectiveTagsDisplay: string[] }}
 */
function resolveEffectiveTagSelection(selectedTags) {
  const userSet = selectedTagsToSet(selectedTags || []);
  const envDefaults = selectedTagsToSet(parseSelectedTagsInput(process.env.SYNC_HOLDED_DEFAULT_TAGS || ''));
  const merged = new Set([...userSet, ...envDefaults]);
  merged.add('crm');
  return {
    mode: 'filter',
    effectiveSet: merged,
    effectiveTagsDisplay: [...merged].sort((a, b) => a.localeCompare(b, 'es'))
  };
}

/** @param {string[]} contactTags @param {{ effectiveSet: Set<string> }} scope */
function contactMatchesEffectiveScope(contactTags, scope) {
  if (!scope || !scope.effectiveSet || scope.effectiveSet.size === 0) return false;
  return contactMatchesSelectedTags(contactTags, scope.effectiveSet);
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

/** Contacto Holded con tag `crm` (sin distinguir mayúsculas). */
function contactHasCrmTag(contact) {
  const tags = normalizeHoldedTags(contact);
  return tags.some((t) => String(t).toLowerCase().trim() === 'crm');
}

/** Tras filtrar client/lead: solo los que tienen tag crm (vista previa e import por defecto). */
function filterHoldedContactsConTagCrm(list) {
  return (Array.isArray(list) ? list : []).filter(contactHasCrmTag);
}

function tagsToStoreString(tags) {
  return (tags || []).join(', ');
}

/** Texto columna Tags en CPanel: etiquetas del alcance (crm, sepa, …) que el contacto tiene en Holded (OR). */
function tagsDisplayScopeHits(contactTags, scope) {
  if (!scope || !Array.isArray(scope.effectiveTagsDisplay) || scope.effectiveTagsDisplay.length === 0) {
    return '—';
  }
  const have = new Set((contactTags || []).map((t) => String(t).toLowerCase().trim()));
  const hits = [];
  for (const label of scope.effectiveTagsDisplay) {
    const k = String(label).toLowerCase().trim();
    if (k && have.has(k)) hits.push(String(label).trim());
  }
  return hits.length ? hits.join(', ') : '—';
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
 * Código postal ES para comparación CRM↔Holded: solo dígitos, relleno a 5 (evita 3581 vs 03581).
 * @param {unknown} raw
 * @returns {string} cadena vacía si no hay dígitos útiles
 */
function normalizeCodigoPostalEspanaComparable(raw) {
  if (raw == null || raw === '') return '';
  const d = String(raw).replace(/\D/g, '');
  if (!d.length) return '';
  if (d.length <= 5) return d.padStart(5, '0');
  return d.slice(0, 5);
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
  const cpNorm = normalizeCodigoPostalEspanaComparable(cpRaw);
  const cli_codigo_postal = cpNorm || null;

  const tags = normalizeHoldedTags(contact);
  const tagsStr = tagsToStoreString(mergeTagsWithCrm(tags));

  /** @type {Record<string, unknown>} */
  const payload = {
    /** ID del contacto en API Holded (`contact.id`). No duplicar en `cli_referencia` (uso de negocio aparte). */
    cli_Id_Holded: holdedId || null,
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
  } else {
    const typ = String(contact?.type ?? contact?.contactType ?? '').trim().toLowerCase();
    if (typ === 'lead') payload.TipoContacto = 'Persona';
    else if (typ === 'client') payload.TipoContacto = 'Empresa';
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

/**
 * Cuerpo JSON para PUT /contacts/:id (volcado CRM → Holded).
 * @param {Record<string, unknown>} crm
 * @param {string} [provNombre]
 */
function buildHoldedPutBodyFromCrmRow(crm, provNombre) {
  if (!crm || typeof crm !== 'object') return {};
  const g = (keys) => {
    for (const k of keys) {
      if (crm[k] != null && String(crm[k]).trim() !== '') return String(crm[k]).trim();
    }
    return null;
  };
  const nombre = g(['cli_nombre_razon_social', 'Nombre_Razon_Social']) || 'Cliente CRM';
  const trade = g(['cli_nombre_cial', 'Nombre_Cial']);
  const cifRaw = g(['cli_dni_cif', 'DNI_CIF']);
  const cif = cifRaw ? normalizeDniCifForStorage(cifRaw) : '';
  const cp = g(['cli_codigo_postal', 'CodigoPostal', 'codigo_postal']);
  const postalStr = cp ? normalizeCodigoPostalEspanaComparable(cp) : '';
  const tagsStr = g(['cli_tags']);
  const tagParts = tagsStr
    ? tagsStr.split(/[,;]/).map((x) => x.trim()).filter(Boolean)
    : [];
  const tagsArr = mergeTagsWithCrm(tagParts);
  /** @type {Record<string, unknown>} */
  const body = {
    name: nombre,
    email: g(['cli_email', 'Email']) || undefined,
    mobile: g(['cli_movil', 'Movil']) || undefined,
    phone: g(['cli_telefono', 'Telefono']) || undefined,
    tags: tagsArr
  };
  if (trade) body.tradeName = trade;
  if (cif && cif.length >= 8 && String(cif).toUpperCase() !== 'PENDIENTE') body.code = cif;
  const addr = g(['cli_direccion', 'Direccion']);
  const city = g(['cli_poblacion', 'Poblacion']);
  body.billAddress = {
    address: addr || undefined,
    city: city || undefined,
    postalCode: postalStr || undefined,
    province: provNombre || undefined,
    countryCode: 'ES'
  };
  const tipoCont = g(['TipoContacto', 'cli_tipo_contacto']);
  if (tipoCont) {
    const tl = String(tipoCont).trim().toLowerCase();
    if (tl === 'persona') body.isperson = true;
    else if (tl === 'empresa') body.isperson = false;
  }
  const web = g(['cli_Web', 'Web']);
  if (web) {
    body.socialNetworks = { website: web };
  }
  const iban = g(['cli_IBAN', 'cli_iban', 'IBAN']);
  if (iban) body.iban = iban;
  const swift = g(['cli_Swift', 'cli_swift', 'Swift']);
  if (swift) body.swift = swift;
  return body;
}

/**
 * Envía datos del cliente CRM al contacto Holded vinculado y alinea `cli_holded_sync_hash` con un GET del contacto en Holded (fuente de verdad API).
 * @param {import('../config/mysql-crm')} db
 * @param {number} cliId
 */
async function exportCrmClienteToHolded(db, cliId) {
  const apiKey = (process.env.HOLDED_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'Falta HOLDED_API_KEY en variables de entorno' };
  }
  try {
    if (!db.connected && !db.pool) await db.connect();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
  await ensureColumnCliIdHolded(db);
  await ensureColumnCliHoldedSyncHash(db);

  const crm = await db.getClienteById(cliId).catch(() => null);
  if (!crm) return { ok: false, error: 'Cliente no encontrado' };

  const hid = String(crm.cli_Id_Holded ?? crm.cli_referencia ?? '').trim();
  if (!hid) {
    return { ok: false, error: 'Cliente sin cli_Id_Holded (ID contacto Holded)' };
  }

  const provId = crm.cli_prov_id ?? crm.Id_Provincia ?? null;
  let provNombre = '';
  if (provId != null && provId !== '') {
    try {
      const pr = await db.query('SELECT prov_nombre FROM provincias WHERE prov_id = ? LIMIT 1', [provId]);
      provNombre = pr?.[0]?.prov_nombre ? String(pr[0].prov_nombre).trim() : '';
    } catch (_) {
      /* */
    }
  }

  const body = buildHoldedPutBodyFromCrmRow(crm, provNombre);
  try {
    await putHolded(`/contacts/${encodeURIComponent(hid)}`, body, apiKey);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }

  try {
    await ensureColumnCliHoldedSyncPendiente(db);
    const fresh = await fetchHolded(`/contacts/${encodeURIComponent(hid)}`, {}, apiKey);
    const paisIdEspana = await getPaisIdEspana(db);
    const provStr = getProvinceFromContact(fresh);
    const provRow = provStr ? await findProvinciaEspana(db, provStr) : null;
    const ctx = { provId: provRow?.prov_id ?? null, paisId: paisIdEspana };
    const hSync = hashFromHoldedContact(fresh, ctx);
    const rowAfter = await db.getClienteById(cliId);
    const cHash = rowAfter ? hashFromCrmRow(rowAfter) : '';
    const pend = cHash && hSync && cHash !== hSync ? 1 : 0;
    await db.query('UPDATE clientes SET cli_holded_sync_hash = ?, cli_holded_sync_pendiente = ? WHERE cli_id = ?', [
      hSync,
      pend,
      cliId
    ]);
  } catch (eh) {
    console.warn('[sync-holded-clientes] exportCrmClienteToHolded hash:', eh?.message || eh);
  }

  return { ok: true, holdedId: hid };
}

/**
 * Trae datos de Holded al CRM para un cliente ya vinculado y alinea hash + pendiente.
 * @param {import('../config/mysql-crm')} db
 * @param {number} cliId
 */
async function importCrmClienteFromHolded(db, cliId) {
  const apiKey = (process.env.HOLDED_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'Falta HOLDED_API_KEY en variables de entorno' };
  }
  try {
    if (!db.connected && !db.pool) await db.connect();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
  await ensureColumnCliIdHolded(db);
  await ensureColumnCliHoldedSyncHash(db);
  await ensureColumnCliHoldedSyncPendiente(db);

  const crm = await db.getClienteById(cliId).catch(() => null);
  if (!crm) return { ok: false, error: 'Cliente no encontrado' };

  const hid = String(crm.cli_Id_Holded ?? crm.cli_referencia ?? '').trim();
  if (!hid) {
    return { ok: false, error: 'Cliente sin cli_Id_Holded (ID contacto Holded)' };
  }

  let full;
  try {
    full = await fetchHolded(`/contacts/${encodeURIComponent(hid)}`, {}, apiKey);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }

  const paisId = await getPaisIdEspana(db);
  const provStr = getProvinceFromContact(full);
  const provRow = provStr ? await findProvinciaEspana(db, provStr) : null;
  const tipcLeadId = await fetchTipcLeadId(db);

  const payload = buildClientePayloadFromHoldedContact(full, {
    provId: provRow?.prov_id ?? null,
    paisId
  });
  applyHoldedTipoLeadRulesToPayload(payload, full, { tipcLeadId, existingCrmRow: crm });

  try {
    await db.updateCliente(cliId, payload);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }

  try {
    const rowAfter = await db.getClienteById(cliId);
    if (rowAfter) {
      const fresh = await fetchHolded(`/contacts/${encodeURIComponent(hid)}`, {}, apiKey);
      const provStr2 = getProvinceFromContact(fresh);
      const provRow2 = provStr2 ? await findProvinciaEspana(db, provStr2) : null;
      const ctx = { provId: provRow2?.prov_id ?? null, paisId };
      const hSync = hashFromHoldedContact(fresh, ctx);
      const cHash = hashFromCrmRow(rowAfter);
      const pend = cHash && hSync && cHash !== hSync ? 1 : 0;
      await db.query('UPDATE clientes SET cli_holded_sync_hash = ?, cli_holded_sync_pendiente = ? WHERE cli_id = ?', [
        hSync,
        pend,
        cliId
      ]);
    }
  } catch (eh) {
    console.warn('[sync-holded-clientes] importCrmClienteFromHolded hash:', eh?.message || eh);
  }

  return { ok: true, holdedId: hid };
}

/** Columnas CRM cuya comparación va en sección A; se excluyen de la tabla «resto» en CPanel. */
const REST_EXCLUDE_LOWER = new Set(
  [
    'cli_nombre_razon_social',
    'nombre_razon_social',
    'cli_nombre_cial',
    'nombre_cial',
    'cli_dni_cif',
    'dni_cif',
    'cli_email',
    'email',
    'cli_movil',
    'movil',
    'cli_telefono',
    'telefono',
    'cli_direccion',
    'direccion',
    'cli_poblacion',
    'poblacion',
    'cli_codigo_postal',
    'codigopostal',
    'cli_prov_id',
    'id_provincia',
    'cli_pais_id',
    'id_pais',
    'cli_iban',
    'iban',
    'cli_swift',
    'swift',
    'cli_banco',
    'banco',
    'cli_web',
    'web',
    'observaciones',
    'cli_regimen',
    'cli_ref_mandato',
    'cli_cuenta_ventas',
    'cli_cuenta_compras',
    'cli_visibilidad_portal',
    'nomcontacto',
    'cli_nomcontacto',
    'tipocontacto',
    'cli_tipo_contacto',
    'cli_codpais',
    'codpais'
  ].map((k) => k.toLowerCase())
);

/**
 * @param {unknown} v
 * @returns {string}
 */
function formatSnapshotCellValue(v) {
  if (v == null) return '—';
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? v.toISOString() : '—';
  }
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
}

/**
 * @param {string} key
 * @param {Record<string, unknown>} pC
 * @param {Record<string, unknown>} crm
 */
function formatCrmComparableDisplay(key, pC, crm) {
  if (key === 'cli_prov_id') {
    const id = pC.cli_prov_id != null && pC.cli_prov_id !== '' ? String(pC.cli_prov_id) : '';
    const name = crm?.ProvinciaNombre != null ? String(crm.ProvinciaNombre).trim() : '';
    if (!name && !id) return '—';
    return [name, id ? `id: ${id}` : ''].filter(Boolean).join(' · ');
  }
  if (key === 'cli_pais_id') {
    const id = pC.cli_pais_id != null && pC.cli_pais_id !== '' ? String(pC.cli_pais_id) : '';
    const name = crm?.PaisNombre != null ? String(crm.PaisNombre).trim() : '';
    if (!name && !id) return '—';
    return [name, id ? `id: ${id}` : ''].filter(Boolean).join(' · ');
  }
  const norm = normComparableScalar(pC[key]);
  return norm === '' ? '—' : String(norm);
}

/**
 * @param {string} key
 * @param {Record<string, unknown>} pH
 * @param {object|null} contact
 * @param {{ provId: number|null, paisId: number|null }} ctx
 */
function formatHoldedComparableDisplay(key, pH, contact, ctx) {
  if (!contact) return '—';
  if (key === 'cli_prov_id') {
    const provStr = getProvinceFromContact(contact);
    const id = ctx?.provId != null && ctx.provId !== '' ? String(ctx.provId) : '';
    if (!provStr && !id) return '—';
    return [provStr ? `Holded: ${provStr}` : '', id ? `prov_id: ${id}` : ''].filter(Boolean).join(' · ');
  }
  if (key === 'cli_pais_id') {
    const bill = contact?.billAddress ?? {};
    const ship0 = Array.isArray(contact?.shippingAddresses) ? contact.shippingAddresses[0] : {};
    const cc = bill?.countryCode ?? bill?.country ?? ship0?.countryCode ?? '';
    const id = ctx?.paisId != null && ctx.paisId !== '' ? String(ctx.paisId) : '';
    if (!cc && !id) return '—';
    return [cc ? `código: ${String(cc).toUpperCase()}` : '', id ? `pais_id: ${id}` : ''].filter(Boolean).join(' · ');
  }
  const norm = normComparableScalar(pH[key]);
  return norm === '' ? '—' : String(norm);
}

/**
 * Detalle comparación CRM ↔ Holded por campo (misma regla de igualdad que el hash).
 * @param {import('../config/mysql-crm')} db
 * @param {number} cliId
 * @returns {Promise<{
 *   ok: boolean,
 *   error?: string,
 *   cliente: Record<string, unknown>|null,
 *   holdedId: string|null,
 *   holdedContact: object|null,
 *   holdedError: string|null,
 *   missingHoldedLink: boolean,
 *   comparableRows: Array<{ key: string, label: string, match: boolean, crmDisplay: string, holdedDisplay: string }>,
 *   restoColumnas: Array<{ key: string, value: string }>
 * }>}
 */
async function buildClienteHoldedComparisonDetail(db, cliId) {
  const numId = Number(cliId);
  if (!Number.isFinite(numId) || numId <= 0) {
    return {
      ok: false,
      error: 'cli_id inválido',
      cliente: null,
      holdedId: null,
      holdedContact: null,
      holdedError: null,
      missingHoldedLink: true,
      comparableRows: [],
      restoColumnas: []
    };
  }
  try {
    if (!db.connected && !db.pool) await db.connect();
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      cliente: null,
      holdedId: null,
      holdedContact: null,
      holdedError: null,
      missingHoldedLink: true,
      comparableRows: [],
      restoColumnas: []
    };
  }

  const crm = await db.getClienteById(numId).catch(() => null);
  if (!crm) {
    return {
      ok: false,
      error: 'Cliente no encontrado',
      cliente: null,
      holdedId: null,
      holdedContact: null,
      holdedError: null,
      missingHoldedLink: true,
      comparableRows: [],
      restoColumnas: []
    };
  }

  const hid = String(crm.cli_Id_Holded ?? crm.cli_referencia ?? '').trim();
  const missingHoldedLink = !hid;
  const apiKey = (process.env.HOLDED_API_KEY || '').trim();

  const pC = crmRowToComparablePayload(crm);
  /** @type {Array<{ key: string, label: string, match: boolean, crmDisplay: string, holdedDisplay: string }>} */
  const comparableRows = [];
  /** @type {Array<{ key: string, value: string }>} */
  const restoColumnas = [];

  const allKeys = Object.keys(crm).sort((a, b) => a.localeCompare(b, 'es'));
  for (const k of allKeys) {
    if (REST_EXCLUDE_LOWER.has(String(k).toLowerCase())) continue;
    restoColumnas.push({ key: k, value: formatSnapshotCellValue(crm[k]) });
  }

  if (missingHoldedLink || !apiKey) {
    for (const key of COMPARABLE_PAYLOAD_KEYS) {
      comparableRows.push({
        key,
        label: SYNC_CAMPO_LABELS[key] || key,
        match: false,
        crmDisplay: formatCrmComparableDisplay(key, pC, crm),
        holdedDisplay: !apiKey ? '— (sin API key)' : '— (sin vínculo Holded)'
      });
    }
    return {
      ok: true,
      cliente: crm,
      holdedId: hid || null,
      holdedContact: null,
      holdedError: !apiKey
        ? 'Falta HOLDED_API_KEY en variables de entorno'
        : missingHoldedLink
          ? 'Cliente sin cli_Id_Holded (vínculo Holded)'
          : null,
      missingHoldedLink,
      comparableRows,
      restoColumnas
    };
  }

  let full = null;
  /** @type {string|null} */
  let holdedError = null;
  try {
    full = await fetchHolded(`/contacts/${encodeURIComponent(hid)}`, {}, apiKey);
  } catch (e) {
    holdedError = e?.message || String(e);
  }

  if (!full || typeof full !== 'object') {
    for (const key of COMPARABLE_PAYLOAD_KEYS) {
      comparableRows.push({
        key,
        label: SYNC_CAMPO_LABELS[key] || key,
        match: false,
        crmDisplay: formatCrmComparableDisplay(key, pC, crm),
        holdedDisplay: holdedError || '—'
      });
    }
    return {
      ok: true,
      cliente: crm,
      holdedId: hid,
      holdedContact: null,
      holdedError,
      missingHoldedLink: false,
      comparableRows,
      restoColumnas
    };
  }

  const paisId = await getPaisIdEspana(db);
  const provStr = getProvinceFromContact(full);
  const provRow = provStr ? await findProvinciaEspana(db, provStr) : null;
  const ctx = { provId: provRow?.prov_id ?? null, paisId };
  const pH = buildClientePayloadFromHoldedContact(full, ctx);

  for (const key of COMPARABLE_PAYLOAD_KEYS) {
    const a = normComparableScalar(pH[key]);
    const b = normComparableScalar(pC[key]);
    const match = a === b;
    comparableRows.push({
      key,
      label: SYNC_CAMPO_LABELS[key] || key,
      match,
      crmDisplay: formatCrmComparableDisplay(key, pC, crm),
      holdedDisplay: formatHoldedComparableDisplay(key, pH, full, ctx)
    });
  }

  return {
    ok: true,
    cliente: crm,
    holdedId: hid,
    holdedContact: full,
    holdedError: null,
    missingHoldedLink: false,
    comparableRows,
    restoColumnas
  };
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

/**
 * Un mismo contacto Holded (`contact.id`) no puede enlazarse a dos filas CRM.
 * MySQL permite varias filas con `cli_Id_Holded` NULL; valores no nulos deben ser únicos.
 */
async function ensureUniqueIndexCliIdHolded(db) {
  try {
    if (!db.connected && !db.pool) await db.connect();
    const tClientes =
      typeof db._resolveTableNameCaseInsensitive === 'function'
        ? await db._resolveTableNameCaseInsensitive('clientes').catch(() => null)
        : null;
    const t = tClientes || 'clientes';
    const idxName = 'ux_clientes_cli_Id_Holded';
    const exists = await db.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
      [t, idxName]
    );
    if (exists?.length) return;
    await db.query(`CREATE UNIQUE INDEX \`${idxName}\` ON \`${t}\` (\`cli_Id_Holded\`)`);
  } catch (e) {
    console.warn(
      '[sync-holded-clientes] ensureUniqueIndexCliIdHolded: no se pudo crear índice único (¿duplicados en cli_Id_Holded?).',
      e?.message || e
    );
  }
}

async function ensureColumnCliIdHolded(db) {
  await ensureHoldedIdColumnsWideEnough(db);
  await ensureUniqueIndexCliIdHolded(db);
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

/** 1 = cambios en CRM pendientes de volcar a Holded (equivalente pte_exportar). */
async function ensureColumnCliHoldedSyncPendiente(db) {
  try {
    if (!db.connected && !db.pool) await db.connect();
    const cols = await db.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'cli_holded_sync_pendiente'"
    );
    if (!cols?.length) {
      await db.query(
        'ALTER TABLE `clientes` ADD COLUMN `cli_holded_sync_pendiente` TINYINT(1) NOT NULL DEFAULT 0 AFTER `cli_holded_sync_hash`'
      );
    }
  } catch (e) {
    console.warn('[sync-holded-clientes] ensureColumnCliHoldedSyncPendiente:', e?.message || e);
  }
}

let _lastHoldedSyncDigestEmailAt = 0;
const HOLDED_SYNC_DIGEST_COOLDOWN_MS = 15 * 60 * 1000;

/** Evita llamadas repetidas a la API Holded al abrir la misma ficha varias veces seguidas. */
const _lastHoldedViewEvalAt = new Map();
const HOLDED_VIEW_EVAL_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Tras guardar un cliente en el CRM: si está vinculado a Holded y hay divergencia H vs C (hash),
 * marca `cli_holded_sync_pendiente`, opcional notificación con enlaces firmados y email resumen (antispam).
 * @param {import('../config/mysql-crm')} db
 * @param {number} cliId
 * @param {{ fromView?: boolean }} [opts] - Si `fromView`, no reconsulta Holded más de una vez cada 10 min por cliente (apertura de ficha).
 * @returns {Promise<Record<string, unknown>>} p.ej. `{ approvalEmailQueued: true, notifId }` o `{ reason: 'no_holded_api_key' }`
 */
async function evaluateCliHoldedSyncPendienteAfterCrmSave(db, cliId, opts = {}) {
  const id = Number(cliId);
  if (!Number.isFinite(id) || id <= 0) return { evaluated: false, reason: 'bad_cli_id' };
  const fromView = opts && opts.fromView === true;
  if (fromView) {
    const last = _lastHoldedViewEvalAt.get(id);
    if (last != null && Date.now() - last < HOLDED_VIEW_EVAL_COOLDOWN_MS) {
      return { evaluated: false, reason: 'from_view_throttled' };
    }
  }
  const apiKey = (process.env.HOLDED_API_KEY || '').trim();
  if (!apiKey) return { evaluated: false, reason: 'no_holded_api_key' };

  try {
    if (!db.connected && !db.pool) await db.connect();
    await ensureColumnCliIdHolded(db);
    await ensureColumnCliHoldedSyncHash(db);
    await ensureColumnCliHoldedSyncPendiente(db);

    const crm = await db.getClienteById(id).catch(() => null);
    if (!crm) return { evaluated: false, reason: 'cliente_not_found' };

    const hid = String(crm.cli_Id_Holded ?? crm.cli_referencia ?? '').trim();
    if (!hid) {
      await db.query('UPDATE clientes SET cli_holded_sync_pendiente = 0 WHERE cli_id = ?', [id]).catch(() => {});
      return { evaluated: true, pend: 0, reason: 'no_holded_link' };
    }

    let contact;
    try {
      contact = await fetchHolded(`/contacts/${encodeURIComponent(hid)}`, {}, apiKey);
    } catch (e) {
      console.warn('[holded-sync] evaluateCliHoldedSyncPendiente GET Holded:', e?.message || e);
      return { evaluated: false, reason: 'fetch_holded_failed', error: String(e?.message || e) };
    }
    if (fromView) _lastHoldedViewEvalAt.set(id, Date.now());

    const paisIdEspana = await getPaisIdEspana(db);
    const provStr = getProvinceFromContact(contact);
    const provRow = provStr ? await findProvinciaEspana(db, provStr) : null;
    const ctx = {
      provId: provRow?.prov_id ?? null,
      paisId: paisIdEspana
    };
    const H = hashFromHoldedContact(contact, ctx);
    const C = hashFromCrmRow(crm);
    const S = crm.cli_holded_sync_hash != null ? String(crm.cli_holded_sync_hash).trim() : '';
    const linked = isCrmLinkedToThisHolded(crm, hid);
    const pteExportar = !!(S && C !== S && H === S && linked);
    const pteImportar = !!(S && H !== S && C === S && linked);
    const pend = H !== C ? 1 : 0;
    await db.query('UPDATE clientes SET cli_holded_sync_pendiente = ? WHERE cli_id = ?', [pend, id]);

    if (pend) {
      const mq = await maybeQueueHoldedSyncApprovalNotif(db, id, { contact, crm, ctx, pteExportar, pteImportar, hid });
      await scheduleHoldedSyncPendingDigestEmail(db);
      return {
        evaluated: true,
        pend: 1,
        approvalEmailQueued: !!(mq && mq.emailSent),
        notifId: mq?.notifId ?? null,
        mq
      };
    }
    return { evaluated: true, pend: 0, reason: 'hashes_aligned_no_divergence' };
  } catch (e) {
    console.warn('[holded-sync] evaluateCliHoldedSyncPendienteAfterCrmSave:', e?.message || e);
    return { evaluated: false, reason: 'exception', error: String(e?.message || e) };
  }
}

/**
 * Crea una notificación pendiente de decisión sync (si no hay otra) y envía email con enlaces firmados.
 * @param {import('../config/mysql-crm')} db
 * @param {number} cliId
 * @param {{ contact: object, crm: object, ctx: { provId: number|null, paisId: number|null }, pteExportar: boolean, pteImportar: boolean, hid: string }} p
 */
async function maybeQueueHoldedSyncApprovalNotif(db, cliId, p) {
  const id = Number(cliId);
  if (!Number.isFinite(id) || id <= 0) return { emailSent: false, skippedReason: 'bad_id' };
  if (typeof db.hasPendingAprobacionSyncCliente !== 'function' || typeof db.createAprobacionSyncCliente !== 'function') {
    return { emailSent: false, skippedReason: 'notif_methods_missing' };
  }
  try {
    const hasP = await db.hasPendingAprobacionSyncCliente(id);
    if (hasP) return { emailSent: false, skippedReason: 'already_pending_notif' };

    const diff = listComparableDifferences(p.contact, p.ctx, p.crm);
    let sugerencia = null;
    if (p.pteExportar) sugerencia = 'crm_to_holded';
    else if (p.pteImportar) sugerencia = 'holded_to_crm';

    const notasObj = {
      v: 1,
      cli_id: id,
      holdedId: String(p.hid || '').trim(),
      diffCampos: Array.isArray(diff) ? diff.slice(0, 40) : [],
      sugerencia,
      pteExportar: !!p.pteExportar,
      pteImportar: !!p.pteImportar
    };
    const comId = Number(p.crm.cli_com_id ?? p.crm.com_id ?? p.crm.Id_comercial ?? 1) || 1;
    const notifId = await db.createAprobacionSyncCliente(id, comId, notasObj);
    if (!notifId) return { emailSent: false, skippedReason: 'notif_insert_failed' };

    const { sendHoldedSyncApprovalRequestEmail } = require('../mailer');
    const to = String(process.env.HOLDED_SYNC_NOTIFY_EMAIL || 'p.lara@gemavip.com').trim();
    const nombre = String(p.crm.cli_nombre_razon_social ?? p.crm.Nombre_Razon_Social ?? '').trim() || `Cliente #${id}`;
    const mailRes = await sendHoldedSyncApprovalRequestEmail(to, {
      notifId,
      cliId: id,
      clienteNombre: nombre,
      diffCampos: notasObj.diffCampos,
      sugerencia,
      pteExportar: !!p.pteExportar,
      pteImportar: !!p.pteImportar
    }).catch((e) => {
      console.warn('[holded-sync] sendHoldedSyncApprovalRequestEmail:', e?.message || e);
      return { sent: false, error: e?.message };
    });
    const emailSent = !!(mailRes && mailRes.sent);
    return { emailSent, notifId, via: mailRes?.via, skippedReason: emailSent ? undefined : 'email_not_sent' };
  } catch (e) {
    console.warn('[holded-sync] maybeQueueHoldedSyncApprovalNotif:', e?.message || e);
    return { emailSent: false, skippedReason: 'exception', error: String(e?.message || e) };
  }
}

/**
 * Email con lista de clientes con cli_holded_sync_pendiente=1 (máx. 1 cada 15 min).
 * @param {import('../config/mysql-crm')} db
 */
async function scheduleHoldedSyncPendingDigestEmail(db) {
  const now = Date.now();
  if (now - _lastHoldedSyncDigestEmailAt < HOLDED_SYNC_DIGEST_COOLDOWN_MS) {
    return { skipped: true };
  }
  let rows = [];
  try {
    rows = await db.query(
      `SELECT cli_id, cli_nombre_razon_social, Nombre_Razon_Social, cli_dni_cif, DNI_CIF, cli_Id_Holded, cli_referencia
       FROM clientes WHERE cli_holded_sync_pendiente = 1 ORDER BY cli_id ASC LIMIT 500`
    );
  } catch (e) {
    console.warn('[holded-sync] scheduleHoldedSyncPendingDigestEmail query:', e?.message || e);
    return { skipped: true };
  }
  if (!rows?.length) return { skipped: true };

  const to = String(process.env.HOLDED_SYNC_NOTIFY_EMAIL || 'p.lara@gemavip.com').trim();
  try {
    const { sendHoldedSyncPendingDigestEmail } = require('../mailer');
    const r = await sendHoldedSyncPendingDigestEmail(to, rows);
    if (r && r.sent) {
      _lastHoldedSyncDigestEmailAt = now;
    }
    return r;
  } catch (e) {
    console.warn('[holded-sync] sendHoldedSyncPendingDigestEmail:', e?.message || e);
    return { sent: false };
  }
}

/**
 * Filas vista previa con estado omitido: marca si ya existe cliente CRM (ID Holded o CIF normalizado).
 * No deben listarse como «omitidos» si ya hay fila vinculada en BD.
 * @param {import('../config/mysql-crm')} db
 * @param {object[]} rows
 */
async function enrichOmitidosRowsCrmYaImportados(db, rows) {
  const omitidos = (rows || []).filter((r) => r.estadoBase === 'omitido');
  if (!omitidos.length) return;
  await ensureColumnCliIdHolded(db);

  const ids = [...new Set(omitidos.map((r) => String(r.holdedId || '').trim()).filter(Boolean))];
  const inCrm = new Set();

  if (ids.length) {
    const ph = ids.map(() => '?').join(', ');
    const sql = `SELECT cli_referencia, cli_Id_Holded FROM clientes WHERE cli_referencia IN (${ph}) OR cli_Id_Holded IN (${ph})`;
    let crmRows = [];
    try {
      crmRows = await db.query(sql, [...ids, ...ids]);
    } catch (e) {
      console.warn('[holded-sync] enrichOmitidosRowsCrmYaImportados ids:', e?.message || e);
    }
    for (const cr of crmRows || []) {
      const a = cr.cli_referencia != null ? String(cr.cli_referencia).trim() : '';
      const b = cr.cli_Id_Holded != null ? String(cr.cli_Id_Holded).trim() : '';
      if (a) inCrm.add(a);
      if (b) inCrm.add(b);
    }
  }

  /** CIF normalizado ya presente en clientes (p. ej. omitido por provincia sin ref Holded guardada). */
  const cifsNorm = [
    ...new Set(
      omitidos
        .map((r) => normalizeDniCifForStorage(r.cif))
        .filter((x) => x && x.length >= 8 && String(x).toUpperCase() !== 'PENDIENTE')
    )
  ];
  const cifEnBd = new Set();
  const chunk = 120;
  for (let i = 0; i < cifsNorm.length; i += chunk) {
    const part = cifsNorm.slice(i, i + chunk);
    if (!part.length) continue;
    const ph2 = part.map(() => '?').join(', ');
    try {
      const crCif = await db.query(
        `SELECT cli_dni_cif FROM clientes WHERE cli_dni_cif IN (${ph2}) COLLATE utf8mb4_unicode_ci`,
        part
      );
      for (const cr of crCif || []) {
        const d = cr.cli_dni_cif != null ? normalizeDniCifForStorage(String(cr.cli_dni_cif)) : '';
        if (d) cifEnBd.add(d);
      }
    } catch (e) {
      try {
        const crCif = await db.query(`SELECT cli_dni_cif FROM clientes WHERE cli_dni_cif IN (${ph2})`, part);
        for (const cr of crCif || []) {
          const d = cr.cli_dni_cif != null ? normalizeDniCifForStorage(String(cr.cli_dni_cif)) : '';
          if (d) cifEnBd.add(d);
        }
      } catch (e2) {
        console.warn('[holded-sync] enrichOmitidosRowsCrmYaImportados cif:', e2?.message || e2);
      }
    }
  }

  for (const row of rows) {
    if (row.estadoBase !== 'omitido') continue;
    let ok = false;
    const hid = row.holdedId != null ? String(row.holdedId).trim() : '';
    if (hid && inCrm.has(hid)) ok = true;
    if (!ok) {
      const cn = normalizeDniCifForStorage(row.cif);
      if (cn && cifEnBd.has(cn)) ok = true;
    }
    row.crmYaExisteEnCrm = ok;
  }
}

/**
 * KPIs de panel tras enriquecer omitidos (evita duplicar «datos distintos» vs filas sync).
 * @param {object[]} rows
 * @param {Record<string, unknown>} baseStats
 * @param {Record<string, unknown>} syncStats
 */
function computeHoldedDashboardKpis(rows, baseStats, syncStats) {
  const list = Array.isArray(rows) ? rows : [];
  let omitidosYaEnCrm = 0;
  let omitidosAccion = 0;
  let omitSinTagAccion = 0;
  let omitSinCifAccion = 0;
  let omitSinProvAccion = 0;
  for (const r of list) {
    if (r.estadoBase !== 'omitido') continue;
    if (r.crmYaExisteEnCrm) {
      omitidosYaEnCrm++;
      continue;
    }
    omitidosAccion++;
    if (!r.coincideTag) omitSinTagAccion++;
    if (r.motivo === MOTIVO_OMITIDO_SIN_CIF_HOLDED) omitSinCifAccion++;
    if (String(r.motivo || '').toLowerCase().includes('provincia no mapeada')) omitSinProvAccion++;
  }
  const syncAtencion =
    (Number(syncStats.syncPteImportar) || 0) +
    (Number(syncStats.syncPteExportar) || 0) +
    (Number(syncStats.syncDesincronizado) || 0);
  return {
    omitidosYaEnCrm,
    omitidosAccion,
    omitSinTagAccion,
    omitSinCifAccion,
    omitSinProvAccion,
    /** Una sola cifra: filas importables que requieren acción de sync (import / export / revisar). */
    syncRequierenAtencion: syncAtencion
  };
}

/** Tablas de auditoría import Holded ↔ CRM (idempotente). */
async function ensureSyncRunTables(db) {
  try {
    if (!db.connected && !db.pool) await db.connect();
    await db.query(`
CREATE TABLE IF NOT EXISTS sync_run (
  sync_run_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sync_started_at DATETIME NOT NULL,
  sync_finished_at DATETIME NULL,
  sync_source VARCHAR(64) NOT NULL,
  sync_rows_total INT NULL,
  sync_inserted INT NULL,
  sync_updated INT NULL,
  sync_skipped INT NULL,
  sync_errors INT NULL,
  sync_holded_tag_errors INT NULL,
  sync_error_first VARCHAR(512) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db.query(`
CREATE TABLE IF NOT EXISTS sync_event (
  sync_event_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sync_run_id BIGINT UNSIGNED NOT NULL,
  holded_contact_id VARCHAR(255) NULL,
  cli_id INT NULL,
  action VARCHAR(32) NOT NULL,
  result VARCHAR(32) NOT NULL,
  detail VARCHAR(512) NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_sync_run (sync_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  } catch (e) {
    console.warn('[sync-holded-clientes] ensureSyncRunTables:', e?.message || e);
  }
}

/**
 * @param {import('../config/mysql-crm')} db
 * @param {number|null} runId
 * @param {string} holdedId
 * @param {number|null} cliId
 * @param {string} action
 * @param {string} result
 * @param {string} [detail]
 */
async function insertSyncEvent(db, runId, holdedId, cliId, action, result, detail) {
  if (!runId) return;
  try {
    await db.query(
      `INSERT INTO sync_event (sync_run_id, holded_contact_id, cli_id, action, result, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [runId, holdedId || null, cliId, action, result, detail ? String(detail).slice(0, 512) : null]
    );
  } catch (e) {
    console.warn('[sync-holded-clientes] insertSyncEvent:', e?.message || e);
  }
}

/** CIF / NIF en Holded viene en `code` */
function hasCifHolded(contact) {
  const c = contact?.code;
  if (c == null) return false;
  return String(c).trim() !== '';
}

function getHoldedContactTypeLower(contact) {
  if (!contact || typeof contact !== 'object') return '';
  return String(contact.type ?? contact.contactType ?? '').trim().toLowerCase();
}

async function fetchTipcLeadId(db) {
  try {
    const tipcRows = await db.query(
      `SELECT tipc_id FROM tipos_clientes WHERE LOWER(TRIM(tipc_tipo)) = 'lead' LIMIT 1`
    );
    return tipcRows?.[0]?.tipc_id ?? null;
  } catch (_) {
    return null;
  }
}

/**
 * Opción B: Holded `lead` sin CIF → Pendiente + tipo Lead; Holded `client` → tipo Lead en CRM si aún no lo era.
 * @param {Record<string, unknown>} payload
 * @param {object} contact
 * @param {{ tipcLeadId: number|null, existingCrmRow?: Record<string, unknown>|null }} opt
 */
function applyHoldedTipoLeadRulesToPayload(payload, contact, opt) {
  if (!payload || !contact) return;
  const tipcLeadId = opt?.tipcLeadId ?? null;
  const t = getHoldedContactTypeLower(contact);
  if (t === 'lead') {
    if (tipcLeadId != null) payload.cli_tipc_id = tipcLeadId;
    if (!hasCifHolded(contact)) payload.cli_dni_cif = 'Pendiente';
    return;
  }
  if (t === 'client' && tipcLeadId != null) {
    const ex = opt?.existingCrmRow;
    if (ex) {
      const cur = ex.cli_tipc_id ?? ex.Id_tipo_cliente ?? ex.tipc_id;
      if (cur != null && Number(cur) === Number(tipcLeadId)) return;
    }
    payload.cli_tipc_id = tipcLeadId;
  }
}

function getProvinceFromContact(contact) {
  const bill = contact?.billAddress ?? {};
  const ship0 = Array.isArray(contact?.shippingAddresses) ? contact.shippingAddresses[0] : null;
  const p = bill.province ?? ship0?.province ?? '';
  return typeof p === 'string' ? p.trim() : String(p || '').trim();
}

/** Typos frecuentes en Holded u otros orígenes antes de buscar en `provincias`. */
function normalizeProvinciaHoldedTypo(provinceStr) {
  const t = String(provinceStr || '').trim();
  if (!t) return t;
  const map = { barcellona: 'Barcelona' };
  const key = t.toLowerCase();
  return map[key] !== undefined ? map[key] : t;
}

/**
 * @param {import('../config/mysql-crm')} db
 * @param {string} provinceStr
 */
async function findProvinciaEspana(db, provinceStr) {
  const trimmed = normalizeProvinciaHoldedTypo(String(provinceStr || '').trim());
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
 * UI CPanel: conteo por cada tag del alcance (crm + SYNC_HOLDED_DEFAULT_TAGS, OR).
 * @param {object[]} list
 * @param {string[]|undefined} selectedTagsRaw
 */
function computeScopeTagMetaForUi(list, selectedTagsRaw) {
  const scope = resolveEffectiveTagSelection(selectedTagsRaw);
  const labels = [...scope.effectiveTagsDisplay];
  const counts = new Map(labels.map((l) => [String(l).toLowerCase().trim(), 0]));
  for (const c of list || []) {
    const tags = normalizeHoldedTags(c);
    const have = new Set(tags.map((t) => String(t).toLowerCase().trim()));
    for (const label of labels) {
      const k = String(label).toLowerCase().trim();
      if (k && have.has(k)) counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return labels.map((label) => {
    const k = String(label).toLowerCase().trim();
    return { key: k, display: label, count: counts.get(k) ?? 0 };
  });
}

/**
 * Filas de preview + stats; opcionalmente adjunta `_holdedContact` en filas importables (evita GET /contacts/:id en import).
 * @param {import('../config/mysql-crm')} db
 * @param {object[]} list
 * @param {string[]} selectedTagsRaw - tags desde query/body; combinadas con SYNC_HOLDED_DEFAULT_TAGS
 * @param {{ attachRawContact?: boolean }} [opt]
 */
async function buildHoldedPreviewRowsFromList(db, list, selectedTagsRaw, opt = {}) {
  const attachRawContact = !!opt.attachRawContact;
  const scope = resolveEffectiveTagSelection(selectedTagsRaw);
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

  for (const c of list) {
    const tags = normalizeHoldedTags(c);
    const coincide = contactMatchesEffectiveScope(tags, scope);
    if (coincide) conTagSeleccionada++;

    const provStr = getProvinceFromContact(c);
    const provRow = coincide ? await findProvCached(provStr) : null;
    const cifOk = hasCifHolded(c);
    const isLead = getHoldedContactTypeLower(c) === 'lead';

    let estado = 'omitido';
    let motivo = '';

    if (!coincide) {
      omitSinTag++;
      motivo = 'Sin ninguna de las tags del filtro (obligatoria: crm; opcional: SYNC_HOLDED_DEFAULT_TAGS)';
    } else if (!provRow) {
      omitSinProvinciaEs++;
      motivo = 'Provincia no mapeada a España (BD)';
    } else if (!cifOk) {
      if (isLead) {
        estado = 'importable';
        importables++;
        motivo = 'Lead sin CIF: importación con CIF «Pendiente» (provincia ES OK)';
      } else {
        omitSinCif++;
        motivo = MOTIVO_OMITIDO_SIN_CIF_HOLDED;
      }
    } else {
      estado = 'importable';
      importables++;
    }

    const data = buildContactRow(c, { provRow: provRow || null, tags, paisId });

    /** @type {Record<string, unknown>} */
    const row = {
      ...data,
      tags: tagsDisplayScopeHits(tags, scope),
      /** Etiquetas Holded tal cual (export Excel / revisión). */
      tagsHoldedText: tags.length ? tags.join(', ') : '—',
      coincideTag: coincide,
      estado,
      estadoBase: estado,
      motivo: motivo || '—',
      /** Si existe fila en `clientes` vinculada (ref / cli_Id_Holded / CIF). Se rellena en enrich. */
      crmVinculado: estado === 'importable' ? false : undefined
    };
    if (
      attachRawContact &&
      coincide &&
      (estado === 'importable' || motivo === MOTIVO_OMITIDO_SIN_CIF_HOLDED || (isLead && !cifOk && provRow))
    ) {
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
      tagsSeleccionadas: scope.effectiveSet.size,
      tagScopeMode: scope.mode
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

    const provStrH = getProvinceFromContact(c);
    const provRowH = provStrH ? await findProvinciaEspana(db, provStrH) : null;
    const ctx = {
      provId: provRowH?.prov_id ?? null,
      paisId: paisIdEspana
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
      row.crmCliId = null;
      row.estado = 'importable';
      row.motivo = 'Pendiente de primera importación a CRM';
      continue;
    }

    row.crmVinculado = true;
    row.crmCliId = pickCliIdFromRow(crm);
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
  const cpNormRow = normalizeCodigoPostalEspanaComparable(cpRaw);
  const cliCodigoPostal = cpNormRow || null;

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
  const selectedTagsArr = Array.isArray(opts.selectedTags)
    ? opts.selectedTags
    : parseSelectedTagsInput(opts.selectedTags || '');
  const tagScope = resolveEffectiveTagSelection(selectedTagsArr);

  const apiKey = (process.env.HOLDED_API_KEY || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      error: 'Falta HOLDED_API_KEY en variables de entorno',
      rows: [],
      stats: {},
      allTags: [],
      selectedTags: selectedTagsArr,
      tagScope
    };
  }

  try {
    if (!db.connected && !db.pool) await db.connect();

    const listRaw = await fetchHoldedContactsList(apiKey);
    const listTipo = filterHoldedContactsClienteOLead(listRaw);
    const holdedExcluidosTipo = Math.max(0, listRaw.length - listTipo.length);
    const holdedListScope = String(opts.holdedListScope || opts.alcance || '').trim().toLowerCase();
    const useFullClienteLeadList =
      holdedListScope === 'all_cliente_lead' ||
      holdedListScope === 'completo' ||
      holdedListScope === 'todos_holded';
    const holdedExcluidosSinTagCrm = useFullClienteLeadList
      ? 0
      : Math.max(0, listTipo.filter((c) => !contactHasCrmTag(c)).length);
    const list = useFullClienteLeadList ? listTipo : filterHoldedContactsConTagCrm(listTipo);
    const allTags = computeScopeTagMetaForUi(list, selectedTagsArr);
    const paisId = await getPaisIdEspana(db);
    const { rows, stats } = await buildHoldedPreviewRowsFromList(db, list, selectedTagsArr, {
      attachRawContact: false
    });
    await enrichHoldedRowsWithSyncState(db, rows, list, paisId);
    await enrichOmitidosRowsCrmYaImportados(db, rows);
    const syncLabelStats = computeSyncLabelStats(rows);
    const kpiHolded = computeHoldedDashboardKpis(rows, stats, syncLabelStats);

    return {
      ok: true,
      rows,
      stats: {
        ...stats,
        ...syncLabelStats,
        ...kpiHolded,
        holdedExcluidosTipo,
        holdedExcluidosSinTagCrm,
        totalHoldedApi: listRaw.length
      },
      allTags,
      selectedTags: selectedTagsArr,
      tagScope,
      holdedListScope: useFullClienteLeadList ? 'all_cliente_lead' : 'crm_only'
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      rows: [],
      stats: {},
      allTags: [],
      selectedTags: selectedTagsArr,
      tagScope
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
  const selectedTagsArr = Array.isArray(opts.selectedTags)
    ? opts.selectedTags
    : parseSelectedTagsInput(opts.selectedTags || '');
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
    const preview = await previewHoldedClientesEs(db, { selectedTags: selectedTagsArr });
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
    list = filterHoldedContactsConTagCrm(filterHoldedContactsClienteOLead(await fetchHoldedContactsList(apiKey)));
  } catch (e) {
    return { ok: false, error: e?.message || String(e), inserted: 0, updated: 0, skipped: 0, errors: 0, dryRun };
  }

  const paisId = await getPaisIdEspana(db);
  const tipcLeadId = await fetchTipcLeadId(db);
  let leadEstId = 1;
  try {
    if (typeof db._getEstadoClienteIds === 'function') {
      const ids = await db._getEstadoClienteIds();
      if (ids && ids.lead != null) leadEstId = Number(ids.lead);
    }
  } catch (_) {
    /* */
  }

  const { rows } = await buildHoldedPreviewRowsFromList(db, list, selectedTagsArr, { attachRawContact: true });
  await enrichHoldedRowsWithSyncState(db, rows, list, paisId);
  let toImport = rows.filter((r) => r.estado === 'importable' || r.estado === 'pte_importar');
  const maxRows = opts.maxRows != null && Number(opts.maxRows) > 0 ? Math.floor(Number(opts.maxRows)) : null;
  if (maxRows != null && toImport.length > maxRows) {
    toImport = toImport.slice(0, maxRows);
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let holdedTagErrors = 0;
  /** @type {string|null} */
  let errorFirst = null;

  await ensureColumnCliIdHolded(db);
  await ensureColumnCliHoldedSyncHash(db);
  await ensureColumnCliHoldedSyncPendiente(db);
  await ensureSyncRunTables(db);

  const syncSource = String(opts.syncSource || 'cpanel_import').slice(0, 64);
  /** @type {number|null} */
  let syncRunId = null;
  try {
    const ins = await db.query(
      `INSERT INTO sync_run (sync_started_at, sync_source, sync_rows_total) VALUES (NOW(), ?, ?)`,
      [syncSource, toImport.length]
    );
    syncRunId = ins && ins.insertId != null ? Number(ins.insertId) : null;
  } catch (e) {
    console.warn('[sync-holded-clientes] sync_run insert:', e?.message || e);
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

  for (const row of toImport) {
    const contactId = row.holdedId;
    if (!contactId) {
      skipped++;
      await insertSyncEvent(db, syncRunId, '', null, 'skip', 'skipped', 'sin holdedId');
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
          await insertSyncEvent(db, syncRunId, contactId, null, 'fetch', 'error', em);
          continue;
        }
      }
      const hid = getHoldedContactId(full);
      if (!hid) {
        errors++;
        const detail = 'Contacto Holded sin id en respuesta';
        if (!errorFirst) errorFirst = detail;
        console.warn('[sync-holded-clientes] contacto sin id Holded', JSON.stringify(full).slice(0, 200));
        await insertSyncEvent(db, syncRunId, contactId, null, 'validate', 'error', detail);
        continue;
      }

      const payload = buildClientePayloadFromHoldedContact(full, {
        provId: row.cli_prov_id ?? null,
        paisId: row.cli_pais_id ?? paisId
      });
      if (payload.cli_com_id === 1) {
        payload.cli_com_id = defaultComId;
      }

      let existing = null;
      try {
        existing = await db.query('SELECT cli_id FROM clientes WHERE cli_Id_Holded = ? LIMIT 1', [contactId]);
      } catch (_) {
        /* columna cli_Id_Holded aún no existe */
      }
      if (!existing?.length) {
        existing = await db.query('SELECT cli_id FROM clientes WHERE cli_referencia = ? LIMIT 1', [contactId]);
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

      let existingFull = null;
      if (existing?.length) {
        const eid = pickCliIdFromRow(existing[0]);
        if (eid) {
          try {
            existingFull = await db.getClienteById(eid);
          } catch (_) {
            /* */
          }
        }
      }
      applyHoldedTipoLeadRulesToPayload(payload, full, { tipcLeadId, existingCrmRow: existingFull });
      if (getHoldedContactTypeLower(full) === 'lead' && !hasCifHolded(full)) {
        payload.cli_estcli_id = leadEstId;
        payload.Id_EstdoCliente = leadEstId;
      }

      let cliIdAfter = null;
      if (existing?.length) {
        const cliId = pickCliIdFromRow(existing[0]);
        if (!cliId) {
          errors++;
          const detail = 'Fila CRM sin cli_id válido tras búsqueda por ref/CIF';
          if (!errorFirst) errorFirst = detail;
          console.warn('[sync-holded-clientes]', contactId, detail, existing[0]);
          await insertSyncEvent(db, syncRunId, contactId, null, 'update', 'error', detail);
          continue;
        }
        await db.updateCliente(cliId, payload);
        updated++;
        cliIdAfter = cliId;
        await insertSyncEvent(db, syncRunId, contactId, cliIdAfter, 'update', 'ok', null);
      } else {
        const created = await db.createCliente(payload);
        inserted++;
        cliIdAfter = created?.insertId ?? created?.Id ?? created?.id ?? null;
        await insertSyncEvent(db, syncRunId, contactId, cliIdAfter, 'insert', 'ok', null);
      }

      if (cliIdAfter != null) {
        try {
          const rowAfter = await db.getClienteById(cliIdAfter);
          if (rowAfter) {
            const provStrI = getProvinceFromContact(full);
            const provRowI = provStrI ? await findProvinciaEspana(db, provStrI) : null;
            const ctxHash = { provId: provRowI?.prov_id ?? null, paisId };
            const hSync = hashFromHoldedContact(full, ctxHash);
            const cHash = hashFromCrmRow(rowAfter);
            const pend = cHash && hSync && cHash !== hSync ? 1 : 0;
            await db.query('UPDATE clientes SET cli_holded_sync_hash = ?, cli_holded_sync_pendiente = ? WHERE cli_id = ?', [
              hSync,
              pend,
              cliIdAfter
            ]);
          }
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
      await insertSyncEvent(db, syncRunId, contactId, null, 'import', 'error', em);
    }
  }

  if (syncRunId) {
    try {
      await db.query(
        `UPDATE sync_run SET sync_finished_at = NOW(), sync_inserted = ?, sync_updated = ?, sync_skipped = ?, sync_errors = ?, sync_holded_tag_errors = ?, sync_error_first = ? WHERE sync_run_id = ?`,
        [inserted, updated, skipped, errors, holdedTagErrors, errorFirst ? String(errorFirst).slice(0, 512) : null, syncRunId]
      );
    } catch (e) {
      console.warn('[sync-holded-clientes] sync_run update:', e?.message || e);
    }
  }

  return { ok: true, inserted, updated, skipped, errors, holdedTagErrors, errorFirst, dryRun: false, syncRunId };
}

/**
 * Crea en CRM clientes tipo Lead desde contactos Holded con tag filtrada pero sin CIF en Holded (no importables por regla normal).
 * @param {import('../config/mysql-crm')} db
 * @param {{ selectedTags?: string[] }} opts
 */
async function importHoldedSinCifComoLeads(db, opts = {}) {
  const selectedTagsArr = Array.isArray(opts.selectedTags)
    ? opts.selectedTags
    : parseSelectedTagsInput(opts.selectedTags || '');
  const apiKey = (process.env.HOLDED_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'Falta HOLDED_API_KEY en variables de entorno', inserted: 0, skipped: 0, errors: 0 };
  }
  try {
    if (!db.connected && !db.pool) await db.connect();
  } catch (e) {
    return { ok: false, error: e?.message || String(e), inserted: 0, skipped: 0, errors: 0 };
  }

  let list;
  try {
    list = filterHoldedContactsConTagCrm(filterHoldedContactsClienteOLead(await fetchHoldedContactsList(apiKey)));
  } catch (e) {
    return { ok: false, error: e?.message || String(e), inserted: 0, skipped: 0, errors: 0 };
  }

  const paisId = await getPaisIdEspana(db);
  const { rows } = await buildHoldedPreviewRowsFromList(db, list, selectedTagsArr, { attachRawContact: true });
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

      let existing = null;
      try {
        existing = await db.query('SELECT cli_id FROM clientes WHERE cli_Id_Holded = ? LIMIT 1', [contactId]);
      } catch (_) {
        /* */
      }
      if (!existing?.length) {
        existing = await db.query('SELECT cli_id FROM clientes WHERE cli_referencia = ? LIMIT 1', [contactId]);
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
          const rowAfter = await db.getClienteById(cliIdAfter);
          if (rowAfter) {
            const provStrI = getProvinceFromContact(full);
            const provRowI = provStrI ? await findProvinciaEspana(db, provStrI) : null;
            const ctxHash = { provId: provRowI?.prov_id ?? null, paisId };
            const hSync = hashFromHoldedContact(full, ctxHash);
            const cHash = hashFromCrmRow(rowAfter);
            const pend = cHash && hSync && cHash !== hSync ? 1 : 0;
            await db.query('UPDATE clientes SET cli_holded_sync_hash = ?, cli_holded_sync_pendiente = ? WHERE cli_id = ?', [
              hSync,
              pend,
              cliIdAfter
            ]);
          }
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

/**
 * Añade la tag `crm` en Holded a contactos client/lead que no cumplen el alcance de tags (ninguna tag del filtro).
 * Tras ejecutarlo, dejan de contar como «omitidos por sin tag» en la siguiente vista previa.
 * @param {import('../config/mysql-crm')} db
 * @param {{ selectedTags?: string[] }} opts
 */
async function addCrmTagHoldedToContactsSinAlcanceTags(db, opts = {}) {
  const selectedTagsArr = Array.isArray(opts.selectedTags)
    ? opts.selectedTags
    : parseSelectedTagsInput(opts.selectedTags || '');
  const apiKey = (process.env.HOLDED_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'Falta HOLDED_API_KEY en variables de entorno', tagged: 0, skipped: 0, errors: 0 };
  }
  try {
    if (!db.connected && !db.pool) await db.connect();
  } catch (e) {
    return { ok: false, error: e?.message || String(e), tagged: 0, skipped: 0, errors: 0 };
  }

  let list;
  try {
    list = filterHoldedContactsClienteOLead(await fetchHoldedContactsList(apiKey));
  } catch (e) {
    return { ok: false, error: e?.message || String(e), tagged: 0, skipped: 0, errors: 0 };
  }

  const { rows } = await buildHoldedPreviewRowsFromList(db, list, selectedTagsArr, { attachRawContact: false });
  const targets = rows.filter((r) => r.estadoBase === 'omitido' && r.holdedId && !r.coincideTag);

  let tagged = 0;
  let skipped = 0;
  let errors = 0;
  /** @type {string|null} */
  let errorFirst = null;

  for (const row of targets) {
    const hid = String(row.holdedId).trim();
    if (!hid) {
      skipped++;
      continue;
    }
    try {
      const full = await fetchHolded(`/contacts/${encodeURIComponent(hid)}`, {}, apiKey);
      await ensureCrmTagOnHoldedContact(apiKey, hid, full);
      tagged++;
    } catch (e) {
      errors++;
      const em = e?.message || String(e);
      if (!errorFirst) errorFirst = em;
      console.warn('[sync-holded-clientes] addCrmTagHolded sin alcance:', hid, em);
    }
  }

  return { ok: true, tagged, skipped, errors, errorFirst, targets: targets.length };
}

module.exports = {
  previewHoldedClientesEs,
  importHoldedClientesEs,
  importHoldedSinCifComoLeads,
  addCrmTagHoldedToContactsSinAlcanceTags,
  exportCrmClienteToHolded,
  evaluateCliHoldedSyncPendienteAfterCrmSave,
  importCrmClienteFromHolded,
  buildClienteHoldedComparisonDetail,
  MOTIVO_OMITIDO_SIN_CIF_HOLDED,
  normalizeHoldedTags,
  parseSelectedTagsInput,
  selectedTagsToSet,
  resolveEffectiveTagSelection,
  contactMatchesSelectedTags,
  hasCifHolded,
  mergeTagsWithCrm,
  buildClientePayloadFromHoldedContact,
  buildHoldedPutBodyFromCrmRow,
  isHoldedContactClienteOLead,
  filterHoldedContactsClienteOLead,
  filterHoldedContactsConTagCrm,
  contactHasCrmTag
};
