/**
 * Importación de contactos Holded → CRM (tags elegidas + CIF obligatorio + provincia ES en BD).
 */
'use strict';

const { fetchHolded, putHolded } = require('./holded-api');
const { normalizeDniCifForStorage } = require('./dni-cif-utils');

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

async function ensureColumnCliIdHolded(db) {
  try {
    if (!db.connected && !db.pool) await db.connect();
    const cols = await db.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'cli_Id_Holded'"
    );
    if (!cols?.length) {
      await db.query(
        'ALTER TABLE `clientes` ADD COLUMN `cli_Id_Holded` VARCHAR(255) DEFAULT NULL AFTER `cli_referencia`'
      );
    }
  } catch (e) {
    console.warn('[sync-holded-clientes] ensureColumnCliIdHolded:', e?.message || e);
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
      motivo = 'CIF/NIF (code) vacío en Holded';
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
      motivo: motivo || '—'
    };
    if (attachRawContact && estado === 'importable') {
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

    const list = await fetchHoldedContactsList(apiKey);
    const allTags = computeAllTagsFromList(list);
    const { rows, stats } = await buildHoldedPreviewRowsFromList(db, list, selectedLower, {
      attachRawContact: false
    });

    return {
      ok: true,
      rows,
      stats,
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
    const toImport = preview.rows.filter((r) => r.estado === 'importable');
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
    list = await fetchHoldedContactsList(apiKey);
  } catch (e) {
    return { ok: false, error: e?.message || String(e), inserted: 0, updated: 0, skipped: 0, errors: 0, dryRun };
  }

  const { rows } = await buildHoldedPreviewRowsFromList(db, list, selectedLower, { attachRawContact: true });
  const toImport = rows.filter((r) => r.estado === 'importable');

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let holdedTagErrors = 0;

  const paisId = await getPaisIdEspana(db);
  await ensureColumnCliIdHolded(db);

  let defaultComId = 1;
  try {
    const comRows = await db.query('SELECT com_id FROM comerciales ORDER BY com_id ASC LIMIT 1');
    if (comRows?.length && comRows[0].com_id != null) {
      defaultComId = Number(comRows[0].com_id) || 1;
    }
  } catch (_) {
    /* usar 1 */
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
          console.warn('[sync-holded-clientes] GET contacto', contactId, e?.message || e);
          continue;
        }
      }
      const hid = getHoldedContactId(full);
      if (!hid) {
        errors++;
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

      if (existing?.length) {
        const cliId = existing[0].cli_id;
        await db.updateCliente(cliId, payload);
        updated++;
      } else {
        await db.createCliente(payload);
        inserted++;
      }

      try {
        await ensureCrmTagOnHoldedContact(apiKey, contactId, full);
      } catch (e) {
        holdedTagErrors++;
        console.warn('[sync-holded-clientes] tag crm Holded:', contactId, e?.message || e);
      }
    } catch (e) {
      errors++;
      console.warn('[sync-holded-clientes] import fila', contactId, e?.message || e);
    }
  }

  return { ok: true, inserted, updated, skipped, errors, holdedTagErrors, dryRun: false };
}

module.exports = {
  previewHoldedClientesEs,
  importHoldedClientesEs,
  normalizeHoldedTags,
  parseSelectedTagsInput,
  selectedTagsToSet,
  contactMatchesSelectedTags,
  hasCifHolded,
  mergeTagsWithCrm,
  buildClientePayloadFromHoldedContact
};
