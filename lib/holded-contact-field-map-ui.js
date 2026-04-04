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
  'cli_CodPais',
  'cli_idiom_id',
  'cli_mon_id',
  'cli_dto',
  'cli_tarifa_legacy',
  'cli_Modelo_347'
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

/** Etiqueta corta en español para columnas `clientes` (UI mapeo / auditoría). */
const CRM_COLUMN_LABELS_ES = {
  cli_id: 'ID cliente (clave)',
  cli_com_id: 'Comercial asignado',
  cli_dni_cif: 'CIF / NIF',
  cli_nombre_razon_social: 'Nombre o razón social',
  cli_nombre_cial: 'Nombre comercial',
  cli_numero_farmacia: 'Número de farmacia',
  cli_direccion: 'Dirección',
  cli_poblacion: 'Población',
  cli_codigo_postal: 'Código postal',
  cli_movil: 'Móvil',
  cli_email: 'Correo electrónico',
  cli_tipo_cliente_txt: 'Tipo de cliente (texto)',
  cli_tipc_id: 'Tipo de cliente (catálogo)',
  cli_esp_id: 'Especialidad',
  cli_CodPais: 'Código de país',
  cli_Pais: 'País (texto)',
  cli_Idioma: 'Idioma (texto)',
  cli_idiom_id: 'Idioma',
  cli_Moneda: 'Moneda (texto)',
  cli_mon_id: 'Moneda',
  cli_NomContacto: 'Persona de contacto',
  cli_tarifa_legacy: 'Tarifa',
  cli_formp_id: 'Forma de pago',
  cli_dto: 'Descuento (%)',
  cli_CuentaContable: 'Cuenta contable',
  cli_RE: 'Recargo de equivalencia',
  cli_Banco: 'Banco',
  cli_Swift: 'Código SWIFT / BIC',
  cli_IBAN: 'IBAN',
  cli_Modelo_347: 'Modelo 347',
  cli_prov_id: 'Provincia',
  cli_codp_id: 'Código postal (catálogo)',
  cli_telefono: 'Teléfono',
  cli_Web: 'Sitio web',
  cli_pais_id: 'País',
  cli_ok_ko: 'Estado OK / KO',
  cli_estcli_id: 'Estado del cliente',
  cli_activo: 'Activo',
  cli_creado_holded: 'Fecha creación en Holded',
  cli_referencia: 'Referencia (legacy)',
  cli_Id_Holded: 'ID contacto Holded',
  cli_holded_sync_hash: 'Hash de sincronización',
  cli_holded_sync_pendiente: 'Sincronización pendiente',
  cli_regimen: 'Régimen fiscal (texto)',
  cli_ref_mandato: 'Referencia mandato SEPA',
  cli_tags: 'Etiquetas',
  cli_cuenta_ventas: 'Cuenta contable ventas',
  cli_cuenta_compras: 'Cuenta contable compras',
  cli_visibilidad_portal: 'Visibilidad en portal',
  cli_FechaBaja: 'Fecha de baja',
  cli_MotivoBaja: 'Motivo de baja',
  cli_tipo_contacto: 'Tipo de contacto (persona / empresa)',
  cli_Id_cliente_relacionado: 'Cliente relacionado',
  cli_regfis_id: 'Régimen fiscal',
  Web: 'Sitio web',
  Observaciones: 'Observaciones',
  NomContacto: 'Persona de contacto',
  TipoContacto: 'Tipo de contacto'
};

/**
 * @param {string} col
 * @returns {string}
 */
function getCrmColumnLabelEs(col) {
  if (!col || !String(col).trim()) return '—';
  const c = String(col).trim();
  return CRM_COLUMN_LABELS_ES[c] || c;
}

/** Segmentos de ruta Holded → español (fallback). */
const HOLDED_PATH_SEGMENT_ES = {
  id: 'Identificador',
  code: 'CIF / código',
  vatnumber: 'NIF-IVA',
  name: 'Nombre',
  tradeName: 'Nombre comercial',
  email: 'Correo',
  mobile: 'Móvil',
  phone: 'Teléfono',
  iban: 'IBAN',
  swift: 'SWIFT',
  type: 'Tipo de contacto',
  tags: 'Etiquetas',
  notes: 'Notas',
  rate: 'Tarifa',
  defaults: 'Valores por defecto',
  billAddress: 'Dirección fiscal',
  socialNetworks: 'Redes sociales',
  website: 'Web',
  clientRecord: 'Cuenta de ventas',
  supplierRecord: 'Cuenta de compras',
  shippingAddresses: 'Direcciones de envío',
  contactPersons: 'Personas de contacto',
  groupId: 'Grupo',
  customFields: 'Campos personalizados',
  customId: 'ID personalizado',
  createdAt: 'Creado',
  updatedAt: 'Actualizado',
  updatedHash: 'Hash de versión',
  isperson: 'Persona física / jurídica',
  purchaseTax: 'Impuesto en compras',
  salesTax: 'Impuesto en ventas',
  salesChannel: 'Canal de ventas',
  expensesAccount: 'Cuenta de gastos',
  dueDays: 'Días de vencimiento',
  paymentDay: 'Día de pago',
  paymentMethod: 'Forma de pago',
  discount: 'Descuento',
  language: 'Idioma',
  currency: 'Moneda',
  accumulateInForm347: 'Incluir en modelo 347',
  description: 'Descripción',
  num: 'Número',
  country: 'País',
  countryCode: 'Código de país',
  address: 'Dirección',
  city: 'Población',
  postalCode: 'Código postal',
  province: 'Provincia'
};

/**
 * @param {string} path
 * @returns {string}
 */
function humanizeHoldedPathEs(path) {
  const s = String(path || '').trim();
  if (!s) return '—';
  return s
    .split('.')
    .map((seg) => {
      const m = seg.match(/^([^[\]]+)(\[(\d+)\])?$/);
      if (!m) return seg;
      const base = m[1];
      const idx = m[3] != null ? m[3] : '';
      const label =
        HOLDED_PATH_SEGMENT_ES[base] ||
        base.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
      return idx !== '' ? `${label} [${idx}]` : label;
    })
    .join(' › ');
}

/**
 * Etiqueta en español para una ruta JSON Holded (API).
 * @param {string} path
 * @returns {string}
 */
function pathLabelEsForHolded(path) {
  const p = String(path || '').trim();
  if (!p) return '—';
  const sug = suggestForPath(p);
  if (sug.hint && String(sug.hint).trim()) return String(sug.hint).trim();
  return humanizeHoldedPathEs(p);
}

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
  ['id', 'cli_Id_Holded', 'Identificador del contacto en Holded (vínculo)', 1],
  ['code', 'cli_dni_cif', 'CIF / NIF (campo code)', 1],
  ['name', 'cli_nombre_razon_social', 'Nombre o razón social', 1],
  ['tradeName', 'cli_nombre_cial', 'Nombre comercial', 1],
  ['email', 'cli_email', 'Correo electrónico', 1],
  ['mobile', 'cli_movil', 'Móvil', 1],
  ['phone', 'cli_telefono', 'Teléfono', 1],
  ['iban', 'cli_IBAN', 'IBAN', 1],
  ['swift', 'cli_Swift', 'Código SWIFT', 1],
  ['vatnumber', 'cli_dni_cif', 'NIF intracomunitario (vatnumber)', 2],
  ['type', 'cli_tipo_cliente_txt', 'Tipo en Holded (cliente / lead)', 2],
  ['billAddress.address', 'cli_direccion', 'Dirección fiscal', 1],
  ['billAddress.city', 'cli_poblacion', 'Población', 1],
  ['billAddress.postalCode', 'cli_codigo_postal', 'Código postal', 1],
  ['billAddress.province', 'cli_prov_id', 'Provincia (se resuelve a ID al importar)', 1],
  ['billAddress.countryCode', 'cli_CodPais', 'Código de país', 1],
  ['billAddress.country', 'cli_Pais', 'País (texto)', 2],
  ['clientRecord.num', 'cli_cuenta_ventas', 'Cuenta contable de ventas (número)', 1],
  ['clientRecord.name', '', 'Etiqueta de cuenta en Holded (referencia)', 3],
  ['supplierRecord', 'cli_cuenta_compras', 'Cuenta contable de compras', 2],
  ['socialNetworks.website', 'cli_Web', 'Sitio web', 1],
  ['tags', 'cli_tags', 'Etiquetas', 2],
  ['isperson', 'cli_tipo_contacto', 'Persona física o empresa (Holded)', 2],
  ['groupId', '', 'Grupo en Holded', 3],
  ['rate.id', '', 'Identificador de tarifa en Holded', 3],
  ['rate.name', 'cli_tarifa_legacy', 'Nombre de tarifa', 2],
  ['rate.description', '', 'Descripción de la tarifa', 3],
  ['defaults.salesChannel', '', 'Canal de ventas', 3],
  ['defaults.expensesAccount', '', 'Cuenta de gastos por defecto', 3],
  ['defaults.dueDays', '', 'Días de vencimiento', 3],
  ['defaults.paymentDay', '', 'Día de pago', 3],
  ['defaults.paymentMethod', 'cli_formp_id', 'Forma de pago (mapear a formas_pago)', 2],
  ['defaults.discount', 'cli_dto', 'Descuento por defecto (%)', 2],
  ['defaults.language', 'cli_idiom_id', 'Idioma por defecto', 2],
  ['defaults.currency', 'cli_mon_id', 'Moneda por defecto', 2],
  ['defaults.salesTax', '', 'Impuesto de venta (Holded)', 3],
  ['defaults.purchaseTax', '', 'Impuesto de compra (Holded)', 3],
  ['defaults.accumulateInForm347', 'cli_Modelo_347', 'Incluir en modelo 347', 2],
  ['notes', '', 'Notas', 3],
  ['contactPersons', '', 'Personas de contacto', 3],
  ['shippingAddresses', '', 'Direcciones de envío', 3],
  ['createdAt', '', 'Fecha de creación en Holded (Unix)', 3],
  ['updatedAt', '', 'Última actualización en Holded (Unix)', 3],
  ['updatedHash', '', 'Hash de versión interno (Holded)', 3],
  ['customId', '', 'Identificador personalizado', 3],
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
    const sub = path.slice('defaults.'.length);
    const subLabel = HOLDED_PATH_SEGMENT_ES[sub] || sub.replace(/([A-Z])/g, ' $1').trim();
    return { crm: '', hint: `Valores por defecto › ${subLabel}`, tier: 3 };
  }
  if (path.startsWith('billAddress.')) {
    return { crm: '', hint: 'Dirección fiscal (subcampo)', tier: 2 };
  }
  if (path.startsWith('socialNetworks.')) {
    return { crm: 'cli_Web', hint: 'Red social / web', tier: 2 };
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
 *   inComparableHash: boolean,
 *   pathLabelEs: string
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
      inComparableHash: isInComparableHash(suggestedCrmColumn),
      pathLabelEs: pathLabelEsForHolded(row.path)
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
  CRM_COLUMN_LABELS_ES,
  getCrmColumnLabelEs,
  pathLabelEsForHolded,
  isInComparableHash,
  COMPARABLE_PAYLOAD_KEYS
};
