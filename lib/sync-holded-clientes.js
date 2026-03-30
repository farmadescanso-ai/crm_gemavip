/**
 * Importación de contactos Holded → CRM (tags elegidas + CIF obligatorio + provincia ES en BD).
 */
'use strict';

const { fetchHolded } = require('./holded-api');

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

function buildContactRow(contact, { provRow, tags, paisId }) {
  const contactId = String(contact.id ?? contact._id ?? '').trim();
  const bill = contact?.billAddress ?? {};
  const ship0 = Array.isArray(contact?.shippingAddresses) ? contact.shippingAddresses[0] : {};
  const nombre = String(contact?.name ?? contact?.tradeName ?? 'Cliente Holded').trim();
  const cif = String(contact?.code ?? '').trim() || null;
  const cpRaw = bill?.postalCode ?? ship0?.postalCode;
  let cliCodigoPostal = null;
  if (cpRaw != null && String(cpRaw).trim() !== '') {
    const pad = String(cpRaw).replace(/\D/g, '').slice(0, 5);
    cliCodigoPostal = pad.length === 5 ? pad : null;
  }

  return {
    holdedId: contactId,
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
      tagTop: [],
      allTags: [],
      selectedTags: [...selectedLower]
    };
  }

  try {
    if (!db.connected && !db.pool) await db.connect();

    const contacts = await fetchHolded('/contacts', {}, apiKey);
    let list = Array.isArray(contacts) ? contacts : [];
    if (!list.length && contacts && typeof contacts === 'object') {
      const alt = contacts.contacts || contacts.data || contacts.items || contacts.results;
      if (Array.isArray(alt)) list = alt;
    }

    const tagFreq = new Map();
    /** @type {Map<string, { key: string, display: string, count: number }>} */
    const tagMeta = new Map();

    for (const c of list) {
      const tags = normalizeHoldedTags(c);
      for (const t of tags) {
        const k = String(t).toLowerCase();
        tagFreq.set(k, (tagFreq.get(k) || 0) + 1);
        if (!tagMeta.has(k)) {
          tagMeta.set(k, { key: k, display: String(t).trim() || k, count: 0 });
        }
        tagMeta.get(k).count++;
      }
    }

    const tagTop = [...tagFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([tag, count]) => ({ tag, count }));

    const allTags = [...tagMeta.values()].sort((a, b) => b.count - a.count || a.display.localeCompare(b.display, 'es'));

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
      const provRow = coincide ? await findProvinciaEspana(db, provStr) : null;
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

      rows.push({
        ...data,
        tags: tags.join(', ') || '—',
        coincideTag: coincide,
        estado,
        motivo: motivo || '—'
      });
    }

    return {
      ok: true,
      rows,
      stats: {
        totalHolded: list.length,
        conTagSeleccionada,
        importables,
        omitSinTag,
        omitSinCif,
        omitSinProvinciaEs,
        tagsSeleccionadas: selectedLower.size
      },
      tagTop,
      allTags,
      selectedTags: [...selectedLower]
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      rows: [],
      stats: {},
      tagTop: [],
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
  const preview = await previewHoldedClientesEs(db, { selectedTags: opts.selectedTags });
  if (!preview.ok) {
    return { ok: false, error: preview.error, inserted: 0, updated: 0, skipped: 0, errors: 0, dryRun };
  }

  const toImport = preview.rows.filter((r) => r.estado === 'importable');
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  if (dryRun) {
    return {
      ok: true,
      inserted: toImport.length,
      updated: 0,
      skipped: 0,
      errors: 0,
      dryRun: true
    };
  }

  const paisId = await getPaisIdEspana(db);

  for (const row of toImport) {
    const contactId = row.holdedId;
    if (!contactId) {
      skipped++;
      continue;
    }

    try {
      const existingByRef = await db.query('SELECT cli_id FROM clientes WHERE cli_referencia = ? LIMIT 1', [contactId]);
      if (existingByRef?.length) {
        const cliId = existingByRef[0].cli_id;
        await db.updateCliente(cliId, {
          cli_nombre_razon_social: row.nombre,
          cli_dni_cif: row.cif || 'Pendiente',
          cli_email: row.email,
          cli_movil: row.movil,
          cli_telefono: row.telefono,
          cli_direccion: row.direccion,
          cli_poblacion: row.poblacion,
          cli_codigo_postal: row.cli_codigo_postal,
          cli_prov_id: row.cli_prov_id,
          cli_pais_id: row.cli_pais_id ?? paisId,
          cli_referencia: contactId,
          cli_tags: row.cli_tags
        });
        updated++;
        continue;
      }

      const cif = row.cif;
      if (cif) {
        const existingByCif = await db.query('SELECT cli_id FROM clientes WHERE cli_dni_cif = ? LIMIT 1', [cif]);
        if (existingByCif?.length) {
          const cliId = existingByCif[0].cli_id;
          await db.query('UPDATE clientes SET cli_referencia = ? WHERE cli_id = ?', [contactId, cliId]);
          await db.updateCliente(cliId, {
            cli_nombre_razon_social: row.nombre,
            cli_email: row.email,
            cli_movil: row.movil,
            cli_telefono: row.telefono,
            cli_direccion: row.direccion,
            cli_poblacion: row.poblacion,
            cli_codigo_postal: row.cli_codigo_postal,
            cli_prov_id: row.cli_prov_id,
            cli_pais_id: row.cli_pais_id ?? paisId,
            cli_tags: row.cli_tags
          });
          updated++;
          continue;
        }
      }

      await db.createCliente({
        cli_nombre_razon_social: row.nombre || 'Cliente Holded',
        cli_dni_cif: cif || 'Pendiente',
        cli_email: row.email,
        cli_movil: row.movil,
        cli_telefono: row.telefono,
        cli_direccion: row.direccion,
        cli_poblacion: row.poblacion,
        cli_codigo_postal: row.cli_codigo_postal,
        cli_prov_id: row.cli_prov_id,
        cli_referencia: contactId,
        cli_com_id: 1,
        cli_estcli_id: 2,
        cli_activo: 1,
        cli_pais_id: row.cli_pais_id ?? paisId,
        cli_tags: row.cli_tags
      });
      inserted++;
    } catch (e) {
      errors++;
    }
  }

  return { ok: true, inserted, updated, skipped, errors, dryRun: false };
}

module.exports = {
  previewHoldedClientesEs,
  importHoldedClientesEs,
  normalizeHoldedTags,
  parseSelectedTagsInput,
  selectedTagsToSet,
  contactMatchesSelectedTags,
  hasCifHolded
};
