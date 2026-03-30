/**
 * Importación de contactos Holded → CRM (solo España por provincia en BD + tag crm).
 */
'use strict';

const { fetchHolded } = require('./holded-api');

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

function hasCrmTag(tags) {
  return (tags || []).some((t) => String(t).toLowerCase() === 'crm');
}

function tagsToStoreString(tags) {
  return (tags || []).join(', ');
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
 */
async function previewHoldedClientesEs(db) {
  const apiKey = (process.env.HOLDED_API_KEY || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      error: 'Falta HOLDED_API_KEY en variables de entorno',
      rows: [],
      stats: {},
      tagTop: [],
      crmEnHolded: { existe: false, contactosConCrm: 0 }
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
    let conCrm = 0;

    for (const c of list) {
      const tags = normalizeHoldedTags(c);
      if (hasCrmTag(tags)) conCrm++;
      for (const t of tags) {
        const k = String(t).toLowerCase();
        tagFreq.set(k, (tagFreq.get(k) || 0) + 1);
      }
    }

    const tagTop = [...tagFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([tag, count]) => ({ tag, count }));

    const crmCount = tagFreq.get('crm') || 0;
    const paisId = await getPaisIdEspana(db);

    const rows = [];
    let importables = 0;
    let omitSinCrm = 0;
    let omitSinProvinciaEs = 0;

    for (const c of list) {
      const tags = normalizeHoldedTags(c);
      const crm = hasCrmTag(tags);
      const provStr = getProvinceFromContact(c);
      const provRow = crm ? await findProvinciaEspana(db, provStr) : null;

      let estado = 'omitido';
      let motivo = '';

      if (!crm) {
        omitSinCrm++;
        motivo = 'Sin tag crm en Holded';
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
        tieneCrm: crm,
        estado,
        motivo: motivo || '—'
      });
    }

    return {
      ok: true,
      rows,
      stats: {
        totalHolded: list.length,
        conTagCrm: conCrm,
        importables,
        omitSinCrm,
        omitSinProvinciaEs
      },
      tagTop,
      crmEnHolded: { existe: crmCount > 0, contactosConCrm: crmCount }
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      rows: [],
      stats: {},
      tagTop: [],
      crmEnHolded: { existe: false, contactosConCrm: 0 }
    };
  }
}

/**
 * Importa contactos importables (tag crm + provincia ES).
 * @param {import('../config/mysql-crm')} db
 * @param {{ dryRun?: boolean }} opts
 */
async function importHoldedClientesEs(db, opts = {}) {
  const dryRun = !!opts.dryRun;
  const preview = await previewHoldedClientesEs(db);
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
  hasCrmTag
};
