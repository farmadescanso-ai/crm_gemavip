/**
 * Vista CPanel: aplanar contacto Holded, sugerir columna CRM y marcar si entra en hash de sync.
 */
'use strict';

/** Mismas claves que lib/holded-sync COMPARABLE_PAYLOAD_KEYS (para badge «en hash sync»). */
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

const COMP_HASH_SET = new Set(COMPARABLE_PAYLOAD_KEYS);

/** Columna CRM → clave usada en el hash (p. ej. cli_IBAN → cli_iban). */
const CRM_COL_TO_HASH_KEY = {
  cli_IBAN: 'cli_iban',
  cli_Swift: 'cli_swift',
  cli_Banco: 'cli_banco',
  cli_Web: 'Web',
  cli_NomContacto: 'NomContacto',
  cli_tipo_contacto: 'TipoContacto',
  cli_codigo_postal: 'cli_codigo_postal',
  cli_dni_cif: 'cli_dni_cif'
};

/**
 * Columnas `clientes` para el desplegable «Enlazar a» (schema-bd.json).
 * @type {string[]}
 */
const CRM_CLIENTE_COLUMN_OPTIONS = [
  'cli_id',
  'cli_com_id',
  'cli_dni_cif',
  'cli_nombre_razon_social',
  'cli_nombre_cial',
  'cli_numero_farmacia',
  'cli_direccion',
  'cli_poblacion',
  'cli_codigo_postal',
  'cli_movil',
  'cli_email',
  'cli_tipo_cliente_txt',
  'cli_tipc_id',
  'cli_esp_id',
  'cli_CodPais',
  'cli_Pais',
  'cli_Idioma',
  'cli_idiom_id',
  'cli_Moneda',
  'cli_mon_id',
  'cli_NomContacto',
  'cli_tarifa_legacy',
  'cli_formp_id',
  'cli_dto',
  'cli_CuentaContable',
  'cli_RE',
  'cli_Banco',
  'cli_Swift',
  'cli_IBAN',
  'cli_Modelo_347',
  'cli_prov_id',
  'cli_codp_id',
  'cli_telefono',
  'cli_Web',
  'cli_pais_id',
  'cli_ok_ko',
  'cli_estcli_id',
  'cli_activo',
  'cli_creado_holded',
  'cli_referencia',
  'cli_Id_Holded',
  'cli_holded_sync_hash',
  'cli_holded_sync_pendiente',
  'cli_regimen',
  'cli_ref_mandato',
  'cli_tags',
  'cli_cuenta_ventas',
  'cli_cuenta_compras',
  'cli_visibilidad_portal',
  'cli_FechaBaja',
  'cli_MotivoBaja',
  'cli_tipo_contacto',
  'cli_Id_cliente_relacionado',
  'cli_regfis_id'
];

/**
 * @param {string|null|undefined} crmCol
 * @returns {boolean}
 */
function isInComparableHash(crmCol) {
  if (!crmCol || !String(crmCol).trim()) return false;
  const c = String(crmCol).trim();
  const k = CRM_COL_TO_HASH_KEY[c] || c;
  return COMP_HASH_SET.has(k);
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function formatLeafValue(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  try {
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}

/**
 * @param {unknown} obj
 * @param {string} prefix
 * @param {Array<{ path: string, valueDisplay: string }>} rows
 */
function walkHolded(obj, prefix, rows) {
  if (obj === null || obj === undefined) {
    rows.push({ path: prefix || '(raíz)', valueDisplay: '—' });
    return;
  }
  if (typeof obj !== 'object') {
    rows.push({ path: prefix, valueDisplay: formatLeafValue(obj) });
    return;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      rows.push({ path: prefix, valueDisplay: '[]' });
      return;
    }
    const allPrimitive = obj.every(
      (x) => x === null || ['string', 'number', 'boolean'].includes(typeof x)
    );
    if (allPrimitive) {
      rows.push({
        path: prefix,
        valueDisplay: obj.map((x) => (x === null ? '' : String(x))).join(', ')
      });
      return;
    }
    obj.forEach((item, i) => {
      walkHolded(item, `${prefix}[${i}]`, rows);
    });
    return;
  }
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    rows.push({ path: prefix, valueDisplay: '{}' });
    return;
  }
  for (const k of keys) {
    const p = prefix ? `${prefix}.${k}` : k;
    walkHolded(obj[k], p, rows);
  }
}

/**
 * path exacto → [crmColumn, descripción, tier 1|2|3]
 * tier 1 = muy alineado con CRM / import actual
 */
const PATH_RULES = [
  ['id', 'cli_Id_Holded', 'ID contacto Holded (vínculo)', 1],
  ['code', 'cli_dni_cif', 'CIF/NIF (code)', 1],
  ['name', 'cli_nombre_razon_social', 'Nombre / razón social', 1],
  ['tradeName', 'cli_nombre_cial', 'Nombre comercial', 1],
  ['email', 'cli_email', 'Email', 1],
  ['mobile', 'cli_movil', 'Móvil', 1],
  ['phone', 'cli_telefono', 'Teléfono', 1],
  ['iban', 'cli_IBAN', 'IBAN', 1],
  ['swift', 'cli_Swift', 'SWIFT', 1],
  ['vatnumber', 'cli_dni_cif', 'NIF-IVA (alternativo)', 2],
  ['type', 'cli_tipo_cliente_txt', 'Tipo Holded (client/lead)', 2],
  ['billAddress.address', 'cli_direccion', 'Dirección', 1],
  ['billAddress.city', 'cli_poblacion', 'Población', 1],
  ['billAddress.postalCode', 'cli_codigo_postal', 'Código postal', 1],
  ['billAddress.province', 'cli_prov_id', 'Provincia (nombre → ID al importar)', 1],
  ['billAddress.countryCode', 'cli_CodPais', 'Código país', 1],
  ['billAddress.country', 'cli_Pais', 'País (texto)', 2],
  ['clientRecord.num', 'cli_cuenta_ventas', 'Cuenta ventas (número)', 1],
  ['clientRecord.name', '', 'Etiqueta cuenta en Holded (referencia)', 3],
  ['supplierRecord', 'cli_cuenta_compras', 'Cuenta compras', 2],
  ['socialNetworks.website', 'cli_Web', 'Web', 1],
  ['tags', 'cli_tags', 'Tags', 2],
  ['isperson', 'cli_tipo_contacto', 'Persona/empresa (Holded)', 2],
  ['groupId', '', 'Grupo Holded', 3],
  ['rate.id', '', 'ID tarifa Holded', 3],
  ['rate.name', 'cli_tarifa_legacy', 'Nombre tarifa (referencia)', 2],
  ['rate.description', '', 'Descripción tarifa', 3],
  ['defaults.salesChannel', '', 'Canal ventas (Holded)', 3],
  ['defaults.expensesAccount', '', 'Cuenta gastos por defecto', 3],
  ['defaults.dueDays', '', 'Días vencimiento', 3],
  ['defaults.paymentDay', '', 'Día de pago', 3],
  ['defaults.paymentMethod', 'cli_formp_id', 'Método pago (mapear a formas_pago)', 2],
  ['defaults.discount', 'cli_dto', 'Descuento por defecto', 2],
  ['defaults.language', 'cli_idiom_id', 'Idioma (mapear)', 2],
  ['defaults.currency', 'cli_mon_id', 'Moneda (mapear)', 2],
  ['defaults.salesTax', '', 'Impuestos venta (Holded)', 3],
  ['defaults.accumulateInForm347', 'cli_Modelo_347', 'Modelo 347 (sí/no)', 2],
  ['createdAt', '', 'Creado en Holded (unix)', 3],
  ['updatedAt', '', 'Actualizado en Holded (unix)', 3],
  ['updatedHash', '', 'Hash interno Holded', 3],
  ['customId', '', 'ID personalizado', 3],
  ['customFields', '', 'Campos personalizados', 3]
];

const PATH_RULE_MAP = new Map(PATH_RULES.map((r) => [r[0], { crm: r[1], hint: r[2], tier: r[3] }]));

/**
 * @param {string} path
 * @returns {{ crm: string, hint: string, tier: number }}
 */
function suggestForPath(path) {
  const exact = PATH_RULE_MAP.get(path);
  if (exact) return exact;
  if (path.startsWith('defaults.')) {
    return { crm: '', hint: 'Valores por defecto Holded (revisar mapeo manual)', tier: 3 };
  }
  if (path.startsWith('billAddress.')) {
    return { crm: '', hint: 'Dirección fiscal (subcampo)', tier: 2 };
  }
  if (path.startsWith('socialNetworks.')) {
    return { crm: 'cli_Web', hint: 'Red / web', tier: 2 };
  }
  return { crm: '', hint: '', tier: 3 };
}

/**
 * @param {object|null} contact
 * @returns {Array<{
 *   path: string,
 *   valueDisplay: string,
 *   suggestedCrmColumn: string,
 *   suggestedHint: string,
 *   tier: number,
 *   inComparableHash: boolean
 * }>}
 */
function buildHoldedFieldMapRows(contact) {
  if (!contact || typeof contact !== 'object') return [];
  const flat = [];
  walkHolded(contact, '', flat);
  const enriched = flat.map((row) => {
    const { crm, hint, tier } = suggestForPath(row.path);
    const suggestedCrmColumn = crm || '';
    return {
      path: row.path,
      valueDisplay: row.valueDisplay,
      suggestedCrmColumn,
      suggestedHint: hint || '',
      tier: tier || 3,
      inComparableHash: isInComparableHash(suggestedCrmColumn)
    };
  });
  enriched.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.path.localeCompare(b.path, 'es');
  });
  return enriched;
}

/**
 * Aplica mapeo global guardado en BD: prioridad saved[path] > sugerencia automática.
 * @param {Array<{ path: string, suggestedCrmColumn: string }>} rows
 * @param {Record<string, string>} savedMap holdedPath → crmColumn
 * @returns {Array<object>}
 */
function mergeFieldMapIntoRows(rows, savedMap) {
  const m = savedMap && typeof savedMap === 'object' ? savedMap : {};
  return (rows || []).map((row) => {
    const path = String(row.path || '');
    const saved = path && m[path] != null ? String(m[path]).trim() : '';
    const suggested = String(row.suggestedCrmColumn || '').trim();
    const effectiveCrmColumn = saved || suggested;
    return {
      ...row,
      effectiveCrmColumn,
      hasSavedOverride: Boolean(saved)
    };
  });
}

module.exports = {
  buildHoldedFieldMapRows,
  mergeFieldMapIntoRows,
  CRM_CLIENTE_COLUMN_OPTIONS,
  isInComparableHash,
  COMPARABLE_PAYLOAD_KEYS
};
