/**
 * Normalización de contactos Holded (API) para import/export y hash CRM.
 * Sin dependencias de holded-sync para evitar ciclos.
 */
'use strict';

const { normalizeDniCifForStorage } = require('./dni-cif-utils');

/**
 * Prioridad: `code`; si vacío, `vatnumber`. Un solo valor fiscal para CRM.
 * @param {object} contact
 * @returns {string} texto bruto antes de normalizar mayúsculas/DNI
 */
function mergeHoldedFiscalCodeRaw(contact) {
  if (!contact || typeof contact !== 'object') return '';
  const code = contact.code != null ? String(contact.code).trim() : '';
  if (code) return code;
  const vat = contact.vatnumber != null ? String(contact.vatnumber).trim() : '';
  return vat || '';
}

/**
 * @param {object} contact
 * @returns {string} cadena lista para almacenar (normalizada si aplica)
 */
function mergeHoldedFiscalCodeForStorage(contact) {
  const raw = mergeHoldedFiscalCodeRaw(contact);
  if (!raw) return '';
  const norm = normalizeDniCifForStorage(raw);
  return norm || raw;
}

/**
 * Web: raíz o socialNetworks.website (API Holded suele usar ambos).
 * @param {object} contact
 * @returns {string}
 */
function pickWebsiteFromHoldedContact(contact) {
  if (!contact || typeof contact !== 'object') return '';
  const top = contact.website ?? contact.web;
  if (top != null && String(top).trim() !== '') return String(top).trim();
  const sn = contact.socialNetworks;
  if (sn && typeof sn === 'object' && sn.website != null && String(sn.website).trim() !== '') {
    return String(sn.website).trim();
  }
  return '';
}

/**
 * @param {object} contact
 * @returns {'Persona'|'Empresa'|null}
 */
function tipoContactoFromHoldedIsperson(contact) {
  if (!contact || typeof contact !== 'object') return null;
  const ip = contact.isperson;
  if (typeof ip === 'boolean') return ip ? 'Persona' : 'Empresa';
  if (ip === 1 || ip === '1') return 'Persona';
  if (ip === 0 || ip === '0') return 'Empresa';
  return null;
}

/**
 * @param {object} [defaults]
 * @returns {0|1|null}
 */
function modelo347FromHoldedDefaults(defaults) {
  if (!defaults || typeof defaults !== 'object') return null;
  const v = defaults.accumulateInForm347;
  if (v == null || v === '') return null;
  const s = String(v).toLowerCase().trim();
  if (s === 'yes' || s === '1' || s === 'true' || s === 'sí' || s === 'si') return 1;
  if (s === 'no' || s === '0' || s === 'false') return 0;
  return null;
}

/**
 * Resuelve FKs desde catálogo CRM según `defaults` y `rate` del contacto Holded.
 * @param {import('../config/mysql-crm')} db
 * @param {object} contact
 * @returns {Promise<{
 *   idiomId: number|null,
 *   idiomaCodigo: string|null,
 *   monId: number|null,
 *   monCodigo: string|null,
 *   formpId: number|null,
 *   tarifaLegacy: number|null
 * }>}
 */
async function resolveHoldedClienteCatalogMaps(db, contact) {
  const out = {
    idiomId: null,
    idiomaCodigo: null,
    monId: null,
    monCodigo: null,
    formpId: null,
    tarifaLegacy: null
  };
  if (!db || !contact || typeof contact !== 'object') return out;

  const def = contact.defaults;
  if (def && typeof def === 'object') {
    if (def.language != null && String(def.language).trim() !== '') {
      const code = String(def.language).trim().toLowerCase().slice(0, 15);
      try {
        const rows = await db.query(
          `SELECT idiom_id, idiom_codigo FROM idiomas WHERE LOWER(TRIM(idiom_codigo)) = ? LIMIT 1`,
          [code]
        );
        const r0 = rows?.[0];
        if (r0 && r0.idiom_id != null) {
          out.idiomId = Number(r0.idiom_id);
          out.idiomaCodigo = r0.idiom_codigo != null ? String(r0.idiom_codigo).trim() : code;
        }
      } catch (_) {
        /* */
      }
    }

    if (def.currency != null && String(def.currency).trim() !== '') {
      const cur = String(def.currency).trim().toUpperCase().slice(0, 8);
      try {
        const rows = await db.query(
          `SELECT mon_id, mon_codigo FROM monedas WHERE UPPER(TRIM(mon_codigo)) = ? LIMIT 1`,
          [cur]
        );
        const r0 = rows?.[0];
        if (r0 && r0.mon_id != null) {
          out.monId = Number(r0.mon_id);
          out.monCodigo = r0.mon_codigo != null ? String(r0.mon_codigo).trim().toUpperCase() : cur;
        }
      } catch (_) {
        /* */
      }
    }

    const pm = def.paymentMethod;
    const pmNum = pm == null || pm === '' ? NaN : Number(pm);
    if (Number.isFinite(pmNum) && pmNum !== 0) {
      try {
        const rows = await db.query(
          `SELECT formp_id FROM formas_pago WHERE formp_id_holded = ? LIMIT 1`,
          [String(pmNum).trim()]
        );
        if (rows?.[0]?.formp_id != null) out.formpId = Number(rows[0].formp_id);
      } catch (_) {
        /* columna formp_id_holded opcional */
      }
    }
  }

  const rate = contact.rate;
  if (rate && typeof rate === 'object' && rate.name != null && String(rate.name).trim() !== '') {
    const name = String(rate.name).trim();
    try {
      const rows = await db.query(
        `SELECT tarcli_id FROM tarifasClientes WHERE UPPER(TRIM(tarcli_nombre)) = UPPER(TRIM(?)) AND (tarcli_activa IS NULL OR tarcli_activa = 1) LIMIT 1`,
        [name]
      );
      if (rows?.[0]?.tarcli_id != null) out.tarifaLegacy = Number(rows[0].tarcli_id);
    } catch (_) {
      /* */
    }
  }

  return out;
}

module.exports = {
  mergeHoldedFiscalCodeRaw,
  mergeHoldedFiscalCodeForStorage,
  pickWebsiteFromHoldedContact,
  tipoContactoFromHoldedIsperson,
  modelo347FromHoldedDefaults,
  resolveHoldedClienteCatalogMaps
};
