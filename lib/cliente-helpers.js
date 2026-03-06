/**
 * Helpers para rutas de clientes (formularios, catálogos, coerción).
 */

const { _n } = require('./app-helpers');

const TABLE_PK_MAP = {
  tipos_clientes: ['tipc_id', 'id', 'Id'],
  especialidades: ['esp_id', 'id', 'Id'],
  idiomas: ['idiom_id', 'id', 'Id'],
  monedas: ['mon_id', 'id', 'Id'],
  formas_pago: ['formp_id', 'id', 'Id'],
  provincias: ['prov_id', 'id', 'Id'],
  paises: ['pais_id', 'id', 'Id']
};
const TABLE_LABEL_MAP = {
  tipos_clientes: ['tipc_tipo', 'tipc_nombre', 'Tipo', 'Nombre', 'nombre'],
  especialidades: ['esp_nombre', 'Nombre', 'nombre', 'Especialidad', 'descripcion'],
  idiomas: ['idiom_nombre', 'Nombre', 'Idioma', 'descripcion'],
  monedas: ['mon_nombre', 'Nombre', 'Moneda', 'descripcion', 'Codigo', 'ISO'],
  formas_pago: ['formp_nombre', 'FormaPago', 'Nombre', 'nombre'],
  provincias: ['prov_nombre', 'Nombre_provincia', 'Nombre', 'nombre', 'Provincia'],
  paises: ['pais_nombre', 'Nombre_pais', 'Nombre', 'nombre', 'Pais']
};

function pickFromRowKeys(rowKeys, candidates) {
  const keysLower = new Map((rowKeys || []).map((k) => [String(k).toLowerCase(), k]));
  for (const c of (candidates || [])) {
    const k = keysLower.get(String(c).toLowerCase());
    if (k) return k;
  }
  return null;
}

async function loadSimpleCatalogForSelect(db, tableKey, { labelCandidates } = {}) {
  try {
    const t = await db._resolveTableNameCaseInsensitive(tableKey);
    const rows = await db.query(`SELECT * FROM \`${t}\` LIMIT 500`);
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const rowKeys = Object.keys(rows[0] || {});
    const pkCands = TABLE_PK_MAP[tableKey] || ['id', 'Id', 'ID'];
    const labelCands = labelCandidates || TABLE_LABEL_MAP[tableKey] || ['Nombre', 'nombre', 'Descripcion', 'Tipo', 'FormaPago'];
    const colId = pickFromRowKeys(rowKeys, pkCands) || rowKeys[0];
    const colLabel = pickFromRowKeys(rowKeys, labelCands) || rowKeys.find((k) => k !== colId) || colId;
    const colCodigo = tableKey === 'paises' ? pickFromRowKeys(rowKeys, ['pais_codigo', 'Id_pais', 'id_pais', 'Codigo', 'codigo']) : null;
    const colCodigoIdiom = tableKey === 'idiomas' ? pickFromRowKeys(rowKeys, ['idiom_codigo', 'Codigo', 'codigo', 'ISO']) : null;
    const colCodigoMon = tableKey === 'monedas' ? pickFromRowKeys(rowKeys, ['mon_codigo', 'Codigo', 'codigo', 'ISO', 'Iso']) : null;
    const sorted = [...rows].sort((a, b) => {
      if (tableKey === 'paises' && colCodigo) {
        const codA = String(a[colCodigo] ?? a.Id_pais ?? a.pais_codigo ?? '').trim().toUpperCase();
        const codB = String(b[colCodigo] ?? b.Id_pais ?? b.pais_codigo ?? '').trim().toUpperCase();
        if (codA === 'ES') return -1;
        if (codB === 'ES') return 1;
      }
      if (tableKey === 'idiomas' && colCodigoIdiom) {
        const codA = String(a[colCodigoIdiom] ?? a.Codigo ?? a.codigo ?? '').trim().toUpperCase();
        const codB = String(b[colCodigoIdiom] ?? b.Codigo ?? b.codigo ?? '').trim().toUpperCase();
        if (codA === 'ES') return -1;
        if (codB === 'ES') return 1;
      }
      if (tableKey === 'monedas' && colCodigoMon) {
        const codA = String(a[colCodigoMon] ?? a.Codigo ?? a.codigo ?? a.ISO ?? '').trim().toUpperCase();
        const codB = String(b[colCodigoMon] ?? b.Codigo ?? b.codigo ?? b.ISO ?? '').trim().toUpperCase();
        if (codA === 'EUR') return -1;
        if (codB === 'EUR') return 1;
      }
      const va = String(a[colLabel] ?? a.nombre ?? a.Nombre ?? '').toLowerCase();
      const vb = String(b[colLabel] ?? b.nombre ?? b.Nombre ?? '').toLowerCase();
      return va.localeCompare(vb);
    });
    return sorted.map((r) => {
      const idVal = r[colId] ?? r.id ?? r.Id;
      const nomVal = r[colLabel] ?? r.nombre ?? r.Nombre ?? String(idVal ?? '');
      const out = { ...r, id: idVal, nombre: nomVal, Nombre: nomVal };
      if (tableKey === 'tipos_clientes') {
        out.tipc_id = idVal;
        out.tipc_tipo = nomVal;
        out.tipc_nombre = nomVal;
      }
      if (tableKey === 'especialidades') {
        out.esp_id = idVal;
        out.esp_nombre = nomVal;
      }
      return out;
    });
  } catch (_) {
    return [];
  }
}

async function loadEstadosClienteForSelect(db) {
  try {
    const t = await db._resolveTableNameCaseInsensitive('estdoClientes');
    const rows = await db.query(`SELECT * FROM \`${t}\` LIMIT 100`);
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const rowKeys = Object.keys(rows[0] || {});
    const pkCol = pickFromRowKeys(rowKeys, ['estcli_id', 'id', 'Id']) || rowKeys[0];
    const nomCol = pickFromRowKeys(rowKeys, ['estcli_nombre', 'Nombre', 'nombre', 'Estado', 'estado']) || rowKeys.find((k) => k !== pkCol) || pkCol;
    return rows.map((r) => {
      const val = r[nomCol] ?? r.estcli_nombre ?? r.Nombre ?? '';
      const pkVal = r[pkCol] ?? r.estcli_id ?? r.id ?? r.Id;
      return {
        [pkCol]: pkVal,
        [nomCol]: val,
        estcli_id: pkVal,
        estcli_nombre: val,
        id: pkVal,
        Nombre: val,
        nombre: val,
        Estado: val,
        estado: val
      };
    });
  } catch (_) {
    return [];
  }
}

function findRowByCode(rows, codeCandidates) {
  const codes = (codeCandidates || []).map((c) => String(c).toUpperCase());
  for (const r of (rows || [])) {
    for (const v of Object.values(r || {})) {
      const sv = String(_n(v, '')).trim().toUpperCase();
      if (sv && codes.includes(sv)) return r;
    }
  }
  return null;
}

function findRowByNameContains(rows, substrCandidates) {
  const subs = (substrCandidates || []).map((s) => String(s).toLowerCase());
  for (const r of (rows || [])) {
    for (const v of Object.values(r || {})) {
      const sv = String(_n(v, '')).toLowerCase();
      if (!sv) continue;
      if (subs.some((sub) => sv.includes(sub))) return r;
    }
  }
  return null;
}

function applySpainDefaultsIfEmpty(item, { meta, paises, idiomas, monedas } = {}) {
  if (!item || typeof item !== 'object') return item;
  const cols = Array.isArray(meta?.cols) ? meta.cols : [];
  const colsLower = new Set(cols.map((c) => String(c).toLowerCase()));

  const hasCol = (name) => colsLower.has(String(name).toLowerCase());
  const isEmpty = (val) => val === undefined || val === null || String(val).trim() === '';

  if (hasCol('Id_Pais') && isEmpty(item.Id_Pais)) {
    const esp = (paises || []).find((p) => String(_n(_n(p && p.Id_pais, p && p.id_pais), '')).toUpperCase() === 'ES')
      || findRowByNameContains(paises, ['españa', 'espana']);
    const espId = Number(_n(_n(_n(esp && esp.id, esp && esp.Id), esp && esp.ID), 0)) || 0;
    if (espId) item.Id_Pais = espId;
  }

  const esPaisId = (paises || []).find((p) => String(_n(_n(p && p.Id_pais, p && p.id_pais), '')).toUpperCase() === 'ES')
    || findRowByNameContains(paises, ['españa', 'espana']);
  const esPaisIdVal = Number(_n(_n(_n(esPaisId && esPaisId.id, esPaisId && esPaisId.Id), esPaisId && esPaisId.pais_id), 0)) || 0;
  const isClienteEspana = esPaisIdVal && Number(item.Id_Pais ?? item.cli_pais_id ?? item.id_pais ?? 0) === esPaisIdVal;

  if (isClienteEspana && hasCol('Id_Idioma') && isEmpty(item.Id_Idioma)) {
    const direct =
      (idiomas || []).find((r) => String(_n(_n(r && r.Codigo, r && r.codigo), '')).trim().toLowerCase() === 'es')
      || null;
    const es =
      direct
      || findRowByCode(idiomas, ['ES'])
      || findRowByNameContains(idiomas, ['español', 'espanol', 'castellano', 'spanish']);
    const esId = Number(_n(_n(_n(es && es.id, es && es.Id), es && es.ID), 0)) || 0;
    if (esId) item.Id_Idioma = esId;
  }

  if (isClienteEspana && hasCol('Id_Moneda') && isEmpty(item.Id_Moneda)) {
    const direct =
      (monedas || []).find((r) => String(_n(_n(r && r.Codigo, r && r.codigo), '')).trim().toUpperCase() === 'EUR')
      || null;
    const eur =
      direct
      || findRowByCode(monedas, ['EUR'])
      || findRowByNameContains(monedas, ['euro', '€']);
    const eurId = Number(_n(_n(_n(eur && eur.id, eur && eur.Id), eur && eur.ID), 0)) || 0;
    if (eurId) item.Id_Moneda = eurId;
  }

  return item;
}

function buildClienteFormModel({ mode, meta, item, comerciales, tarifas, provincias, paises, formasPago, tiposClientes, especialidades, idiomas, monedas, estadosCliente, cooperativas, gruposCompras, canChangeComercial, missingFields }) {
  const cols = Array.isArray(meta?.cols) ? meta.cols : [];
  const pk = meta?.pk || 'Id';
  const hasEstadoCliente = !!meta?.colEstadoCliente;
  const colsLower = new Set((cols || []).map((c) => String(c || '').toLowerCase()));
  const hasIdTipoCliente =
    colsLower.has('id_tipocliente')
    || colsLower.has('id_tipo_cliente')
    || colsLower.has('id_tipocliente_id')
    || colsLower.has('id_tipo_cliente_id')
    || colsLower.has('cli_tipc_id');
  const ignore = new Set(
    [pk, 'created_at', 'updated_at', 'CreatedAt', 'UpdatedAt', 'FechaAlta', 'Fecha_Alta', 'FechaBaja', 'Fecha_Baja']
      .map(String)
  );
  if (hasEstadoCliente) {
    ignore.add('OK_KO');
    ignore.add('cli_ok_ko');
  }
  try {
    if ((colsLower.has('id_codigopostal') || colsLower.has('cli_codp_id')) && (colsLower.has('codigopostal') || colsLower.has('cli_codigo_postal'))) {
      ignore.add('Id_CodigoPostal');
      ignore.add('cli_codp_id');
    }
  } catch (_) {}
  if (hasIdTipoCliente && (colsLower.has('tipocliente') || colsLower.has('cli_tipo_cliente_txt'))) {
    ignore.add('TipoCliente');
    ignore.add('cli_tipo_cliente_txt');
  }
  // Evitar duplicados: columnas texto legacy cuando ya hay FK en otras pestañas
  if (colsLower.has('cli_idiom_id') || colsLower.has('id_idioma')) {
    ignore.add('Idioma');
  }
  if (colsLower.has('cli_mon_id') || colsLower.has('id_moneda')) {
    ignore.add('Moneda');
  }
  if (colsLower.has('cli_pais_id') || colsLower.has('id_pais')) {
    ignore.add('Pais');
    ignore.add('CodPais');
  }
  const titleCaseEs = (s) => {
    const parts = String(s || '')
      .trim()
      .split(/\s+/g)
      .filter(Boolean);
    const lowerWords = new Set(['de', 'del', 'la', 'el', 'y', 'o', 'a', 'en', 'por', 'para', 'con']);
    return parts
      .map((w, idx) => {
        const lw = w.toLowerCase();
        if (idx > 0 && lowerWords.has(lw)) return lw;
        return lw.length ? (lw.charAt(0).toUpperCase() + lw.slice(1)) : lw;
      })
      .join(' ');
  };

  const labelize = (name) => {
    const raw = String(name || '');
    const lower = raw.toLowerCase();
    const overrides = {
      ...(colEstado ? { [colEstado]: 'Estado' } : {}),
      id_estdocliente: 'Estado',
      id_estadocliente: 'Estado',
      cli_estcli_id: 'Estado',
      tipocontacto: 'Tipo Contacto',
      tipo_contacto: 'Tipo Contacto',
      cli_tipo_contacto: 'Tipo Contacto',
      ok_ko: 'Estado',
      cli_ok_ko: 'Estado',
      id_cial: 'Delegado',
      comercialid: 'Delegado',
      cli_com_id: 'Delegado',
      nombre_razon_social: 'Nombre / Razón social',
      cli_nombre_razon_social: 'Nombre / Razón social',
      nombre_cial: 'Nombre comercial',
      cli_nombre_cial: 'Nombre comercial',
      dni_cif: 'DNI/CIF',
      cli_dni_cif: 'DNI/CIF',
      codigopostal: 'Código postal',
      cli_codigo_postal: 'Código postal',
      id_provincia: 'Provincia',
      cli_prov_id: 'Provincia',
      id_pais: 'País',
      cli_pais_id: 'País',
      id_idioma: 'Idioma',
      cli_idiom_id: 'Idioma',
      id_moneda: 'Moneda',
      cli_mon_id: 'Moneda',
      cli_moneda: 'Moneda',
      cli_idioma: 'Idioma',
      id_formapago: 'Forma de pago',
      id_forma_pago: 'Forma de pago',
      cli_formp_id: 'Forma de pago',
      id_tipocliente: 'Tipo Cliente',
      id_tipo_cliente: 'Tipo Cliente',
      cli_tipc_id: 'Tipo Cliente',
      cli_esp_id: 'Especialidad',
      id_especialidad: 'Especialidad',
      numcontacto: 'Nombre Contacto',
      nomcontacto: 'Nombre Contacto',
      cli_nom_contacto: 'Nombre Contacto',
      cli_nomcontacto: 'Nombre Contacto',
      numeroFarmacia: 'Nº farmacia',
      cli_numero_farmacia: 'Nº farmacia',
      cuentacontable: 'Cuenta Contable',
      cuenta_contable: 'Cuenta Contable',
      cli_cuentacontable: 'Cuenta Contable',
      cli_cuenta_contable: 'Cuenta Contable',
      motivobaja: 'Motivo Baja',
      motivo_baja: 'Motivo Baja',
      cli_id: 'ID',
      cli_id_cliente_relacionado: 'Cliente relacionado',
      cli_tarcli_id: 'Tarifa',
      cli_tarifa_legacy: 'Tarifa',
      cli_dto: 'Descuento',
      cli_direccion: 'Dirección',
      cli_poblacion: 'Población',
      cli_email: 'Email',
      cli_telefono: 'Teléfono',
      cli_movil: 'Móvil',
      cli_idiom_id: 'Idioma',
      cli_nom_contacto: 'Nombre Contacto',
      cli_banco: 'Banco',
      cli_iban: 'IBAN',
      cli_activo: 'Activo',
      cli_motivo_baja: 'Motivo de baja',
      cli_mon_id: 'Moneda',
      cli_re: 'Razón social fiscal',
      cli_swift: 'SWIFT/BIC',
      cli_modelo_347: 'Modelo 347',
      cli_fecha_baja: 'Fecha Baja',
      cli_fechabaja: 'Fecha Baja',
      cli_id_cliente_relacionado: 'Cliente relacionado',
      cli_web: 'Web',
      cli_observaciones: 'Observaciones'
    };
    if (overrides[lower]) return overrides[lower];

    let cleaned = raw
      .replace(/_/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .trim();
    cleaned = cleaned.replace(/\bID\b/gi, '').replace(/\s+/g, ' ').trim();
    cleaned = cleaned.replace(/^\b(id)\b\s+/i, '').trim();
    cleaned = cleaned
      .replace(/\bDni\b/g, 'DNI')
      .replace(/\bCif\b/g, 'CIF')
      .replace(/\bCp\b/g, 'CP')
      .replace(/\bIva\b/g, 'IVA')
      .replace(/\bIban\b/g, 'IBAN')
      .replace(/\bRe\b/g, 'RE');

    return titleCaseEs(cleaned) || raw;
  };

  const colEstado = String(meta?.colEstadoCliente || '').toLowerCase();
  const toTab = (name) => {
    const n = String(name || '').toLowerCase();
    const isComercial = n === String(meta?.colComercial || '').toLowerCase() || n === 'id_cial' || n === 'comercialid' || n === 'cli_com_id';
    const isEstado = n === colEstado || ['id_estdocliente', 'id_estadocliente', 'id_estdo_cliente', 'cli_estcli_id'].includes(n);
    if (['nombre_razon_social', 'nombre_cial', 'dni_cif', 'ok_ko', 'id_estdocliente', 'id_estadocliente', 'cli_nombre_razon_social', 'cli_nombre_cial', 'cli_dni_cif', 'cli_ok_ko', 'cli_estcli_id', 'id_tipocliente', 'id_tipo_cliente', 'cli_tipc_id', 'cli_esp_id', 'tipocontacto', 'tipo_contacto', 'cli_tipo_contacto'].includes(n) || isEstado) return 'ident';
    if (canChangeComercial && isComercial) return 'ident';
    if (n.includes('direccion') || n.includes('poblacion') || n.includes('codigopostal') || n.includes('codigo_postal') || n.includes('provincia') || n.includes('prov_id') || n.includes('pais')) return 'direccion';
    if (n.includes('email') || n.includes('telefono') || n.includes('movil') || n.includes('web') || n.includes('fax')) return 'contacto';
    if (n.includes('tarifa') || n === 'dto' || n.includes('descuento') || n.includes('comercial') || n.includes('id_cial') || n.includes('com_id') || n.includes('formp_id') || n.includes('idiom_id') || n.includes('mon_id')) return 'condiciones';
    if (n.includes('observ') || n.includes('notas') || n.includes('coment')) return 'notas';
    return 'avanzado';
  };

  const fieldKind = (name) => {
    const n = String(name || '').toLowerCase();
    if (n === 'ok_ko' || n === 'cli_ok_ko') return { kind: 'select', options: 'ok_ko' };
    if (n === 'tipocontacto' || n === 'tipo_contacto' || n === 'cli_tipo_contacto') return { kind: 'select', options: 'tipo_contacto' };
    if (n === colEstado || n === 'id_estdocliente' || n === 'id_estadocliente' || n === 'id_estdo_cliente' || n === 'cli_estcli_id') return { kind: 'select', options: 'estados_cliente' };
    if (n === String(meta?.colComercial || '').toLowerCase() || n === 'id_cial' || n === 'comercialid' || n === 'cli_com_id') return { kind: 'select', options: 'comerciales' };
    if (n === 'tarifa' || n === 'id_tarifa' || n === 'cli_tarcli_id' || n === 'cli_tarifa_legacy') return { kind: 'select', options: 'tarifas' };
    if (n === 'id_pais' || n === 'cli_pais_id') return { kind: 'select', options: 'paises' };
    if (n === 'id_provincia' || n === 'cli_prov_id') return { kind: 'select', options: 'provincias' };
    if (n === 'id_formapago' || n === 'id_forma_pago' || n === 'cli_formp_id') return { kind: 'select', options: 'formas_pago' };
    if (n === 'id_tipocliente' || n === 'id_tipo_cliente' || n === 'cli_tipc_id') return { kind: 'select', options: 'tipos_clientes' };
    if (n === 'cli_esp_id' || n === 'id_especialidad' || n === 'id_esp') return { kind: 'select', options: 'especialidades' };
    if ((n === 'tipocliente' || n === 'tipo_cliente' || n === 'cli_tipo_cliente_txt') && !hasIdTipoCliente) return { kind: 'select', options: 'tipos_clientes_nombre' };
    if (n === 'id_idioma' || n === 'cli_idiom_id') return { kind: 'select', options: 'idiomas' };
    if (n === 'id_moneda' || n === 'cli_mon_id') return { kind: 'select', options: 'monedas' };
    if (n === 'id_cooperativa' || n === 'cli_coop_id') return { kind: 'select', options: 'cooperativas' };
    if (n === 'id_grupocompras' || n === 'id_grupo_compras' || n === 'cli_grupcompr_id') return { kind: 'select', options: 'grupos_compras' };
    if (n.includes('email')) return { kind: 'input', type: 'email' };
    if (n.includes('telefono') || n.includes('movil') || n.includes('fax')) return { kind: 'input', type: 'tel' };
    if (n.includes('web') || n.includes('url')) return { kind: 'input', type: 'url' };
    if (n.includes('fecha')) return { kind: 'input', type: 'date' };
    if (n === 'dto' || n.includes('descuento') || n.includes('importe') || n.includes('factur') || n.includes('saldo')) return { kind: 'input', type: 'number' };
    if (n === 'modelo_347' || n === 'cli_modelo_347') return { kind: 'checkbox' };
    if (n === 'observaciones' || n === 'notas' || n.includes('coment')) return { kind: 'textarea' };
    if (n.startsWith('es_') || n.startsWith('es') || n.includes('activo') || n.includes('activa')) return { kind: 'checkbox' };
    return { kind: 'input', type: 'text' };
  };

  const tabs = [
    { id: 'ident', label: 'Identificación', fields: [] },
    { id: 'contacto', label: 'Comunicación', fields: [] },
    { id: 'direccion', label: 'Dirección', fields: [] },
    { id: 'condiciones', label: 'Condiciones', fields: [] },
    { id: 'notas', label: 'Notas', fields: [] },
    ...(mode === 'edit' ? [{ id: 'relaciones', label: 'Contactos relacionados', fields: [{ name: '_relaciones', label: '', spec: { kind: 'relaciones' } }] }] : []),
    { id: 'avanzado', label: 'Avanzado', fields: [] }
  ];
  const byId = new Map(tabs.map((t) => [t.id, t]));

  for (const col of cols) {
    if (!col) continue;
    if (ignore.has(String(col))) continue;
    const tabId = toTab(col);
    const spec = fieldKind(col);
    const required = String(col) === 'Nombre_Razon_Social' || String(col).toLowerCase() === 'cli_nombre_razon_social';
    const field = {
      name: col,
      label: labelize(col),
      required,
      spec
    };
    byId.get(tabId)?.fields.push(field);
  }

  const readonlyFields = [];
  for (const col of cols) {
    const lc = String(col).toLowerCase();
    if (lc === String(pk).toLowerCase() || lc === 'created_at' || lc === 'updated_at') {
      readonlyFields.push({ name: col, label: labelize(col) });
    }
  }
  if (readonlyFields.length) byId.get('avanzado')?.fields.unshift(...readonlyFields.map((f) => ({ ...f, spec: { kind: 'readonly' } })));

  const promote = (arr, names) => {
    const set = new Set(names);
    const top = arr.filter((f) => set.has(f.name));
    const rest = arr.filter((f) => !set.has(f.name));
    return [...top, ...rest];
  };
  const identPromote = ['Nombre_Razon_Social', 'Nombre_Cial', 'cli_nombre_razon_social', 'cli_nombre_cial', 'Id_TipoCliente', 'cli_tipc_id', 'cli_esp_id', 'TipoContacto', 'cli_tipo_contacto', 'Id_EstdoCliente', 'cli_estcli_id', meta?.colEstadoCliente, 'DNI_CIF', 'cli_dni_cif', 'OK_KO', 'cli_ok_ko'].filter(Boolean);
  if (canChangeComercial && (meta?.colComercial || 'cli_com_id')) identPromote.push(meta?.colComercial || 'cli_com_id', 'Id_Cial', 'cli_com_id');
  byId.get('ident').fields = promote(byId.get('ident').fields, identPromote);
  byId.get('contacto').fields = promote(byId.get('contacto').fields, ['Email', 'Telefono', 'Movil', 'Web', 'cli_email', 'cli_telefono', 'cli_movil']);
  byId.get('direccion').fields = promote(byId.get('direccion').fields, ['Direccion', 'Direccion2', 'CodigoPostal', 'Poblacion', 'Id_Provincia', 'Id_Pais', 'cli_direccion', 'cli_codigo_postal', 'cli_poblacion', 'cli_prov_id', 'cli_pais_id']);
  byId.get('condiciones').fields = promote(byId.get('condiciones').fields, [meta?.colComercial || 'Id_Cial', 'cli_com_id', 'Tarifa', 'cli_tarcli_id', 'cli_tarifa_legacy', 'Dto', 'cli_dto', 'Id_FormaPago', 'cli_formp_id', 'Id_Idioma', 'cli_idiom_id', 'Id_Moneda', 'cli_mon_id']);

  const tabsFiltered = tabs.filter((t) => t.id === 'avanzado' || (t.fields && t.fields.length));

  const catalogs = {
    provincias,
    paises,
    idiomas,
    monedas,
    formasPago,
    tiposClientes,
    especialidades: especialidades || [],
    comerciales,
    estadosCliente,
    tarifas
  };

  const fieldAliases = {
    cli_tipc_id: ['Id_TipoCliente', 'id_tipo_cliente', 'Id_tipo_cliente'],
    id_tipocliente: ['cli_tipc_id', 'Id_TipoCliente'],
    id_tipo_cliente: ['cli_tipc_id', 'Id_TipoCliente'],
    cli_estcli_id: ['Id_EstdoCliente', 'id_estdocliente', 'EstadoClienteId'],
    id_estdocliente: ['cli_estcli_id', 'Id_EstdoCliente', 'EstadoClienteId'],
    id_estadocliente: ['cli_estcli_id', 'Id_EstdoCliente', 'EstadoClienteId'],
    id_estdo_cliente: ['cli_estcli_id', 'Id_EstdoCliente', 'EstadoClienteId'],
    cli_tipo_contacto: ['TipoContacto', 'tipo_contacto'],
    tipocontacto: ['cli_tipo_contacto', 'TipoContacto'],
    tipo_contacto: ['cli_tipo_contacto', 'TipoContacto'],
    cli_com_id: ['Id_Cial', 'id_cial', 'ComercialId', 'comercialId'],
    id_cial: ['cli_com_id', 'Id_Cial'],
    cli_tarcli_id: ['cli_tarifa_legacy', 'Tarifa', 'Id_Tarifa', 'id_tarifa'],
    cli_tarifa_legacy: ['cli_tarcli_id', 'Tarifa', 'Id_Tarifa'],
    cli_prov_id: ['Id_Provincia', 'id_provincia'],
    id_provincia: ['cli_prov_id', 'Id_Provincia'],
    cli_pais_id: ['Id_Pais', 'id_pais'],
    id_pais: ['cli_pais_id', 'Id_Pais'],
    cli_esp_id: ['Id_Especialidad', 'id_especialidad'],
    id_especialidad: ['cli_esp_id', 'Id_Especialidad']
  };

  const pickVal = (name) => {
    if (!item) return '';
    const keys = [name, ...(fieldAliases[String(name).toLowerCase()] || [])];
    for (const k of keys) {
      const v = item[k];
      if (v !== undefined && v !== null) return String(v);
    }
    return '';
  };

  // Enriquecer item con nombres de display cuando faltan (ej. item de consulta simple sin JOINs)
  const it = item;
  if (it && !it.EstadoClienteNombre) {
    const estId = Number(it.cli_estcli_id ?? it.Id_EstdoCliente ?? it.EstadoClienteId ?? 0) || 0;
    if (estId) {
      const e = estadosCliente?.length ? estadosCliente.find((r) => Number(r.estcli_id ?? r.id ?? r.Id ?? 0) === estId) : null;
      it.EstadoClienteNombre = e ? String(e.estcli_nombre ?? e.Nombre ?? e.nombre ?? '').trim() : ({ 1: 'Activo', 2: 'Potencial', 3: 'Inactivo', 4: 'Baja' }[estId] || '');
    }
  }
  if (it && !it.ProvinciaNombre) {
    const provId = Number(it.cli_prov_id ?? it.Id_Provincia ?? 0) || 0;
    if (provId && provincias?.length) {
      const p = provincias.find((r) => Number(r.prov_id ?? r.id ?? r.Id ?? 0) === provId);
      it.ProvinciaNombre = p ? String(p.prov_nombre ?? p.Nombre ?? p.nombre ?? '').trim() : '';
    }
  }
  if (it && !it.PaisNombre) {
    const paisId = Number(it.cli_pais_id ?? it.Id_Pais ?? 0) || 0;
    if (paisId && paises?.length) {
      const pa = paises.find((r) => Number(r.pais_id ?? r.id ?? r.Id ?? 0) === paisId);
      it.PaisNombre = pa ? String(pa.pais_nombre ?? pa.Nombre_pais ?? pa.Nombre ?? pa.nombre ?? '').trim() : '';
    }
  }
  if (it && !it.ComercialNombre) {
    const comId = Number(it.cli_com_id ?? it.Id_Cial ?? 0) || 0;
    if (comId && comerciales?.length) {
      const c = comerciales.find((r) => Number(r.com_id ?? r.id ?? r.Id ?? 0) === comId);
      it.ComercialNombre = c ? String(c.com_nombre ?? c.Nombre ?? '').trim() : '';
    }
  }
  if (it && !it.TipoClienteNombre) {
    const tipId = Number(it.cli_tipc_id ?? it.Id_TipoCliente ?? 0) || 0;
    if (tipId && tiposClientes?.length) {
      const t = tiposClientes.find((r) => Number(r.tipc_id ?? r.id ?? r.Id ?? 0) === tipId);
      it.TipoClienteNombre = t ? String(t.tipc_nombre ?? t.tipc_tipo ?? t.Tipo ?? t.Nombre ?? t.nombre ?? '').trim() : '';
    }
  }
  if (it && !it.EspecialidadNombre && (it.cli_esp_id ?? it.Id_Especialidad)) {
    const espId = Number(it.cli_esp_id ?? it.Id_Especialidad ?? 0) || 0;
    if (espId && especialidades?.length) {
      const e = especialidades.find((r) => Number(r.esp_id ?? r.id ?? r.Id ?? 0) === espId);
      it.EspecialidadNombre = e ? String(e.esp_nombre ?? e.Nombre ?? e.nombre ?? '').trim() : '';
    }
  }

  return {
    mode,
    item,
    tabs: tabsFiltered,
    comerciales,
    tarifas,
    provincias,
    paises,
    formasPago,
    tiposClientes,
    especialidades: especialidades || [],
    idiomas,
    monedas,
    estadosCliente,
    cooperativas,
    gruposCompras,
    canChangeComercial: !!canChangeComercial,
    missingFields: Array.isArray(missingFields) ? missingFields : [],
    resolveDisplayValue: (name, it = item) => resolveDisplayValue(name, it, catalogs),
    pickVal
  };
}

function coerceClienteValue(fieldName, raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    raw = raw[raw.length - 1];
  }
  const name = String(fieldName || '');
  const n = name.toLowerCase();
  const s = String(raw);
  const trimmed = s.trim();
  if (trimmed === '') return null;

  if (n === 'ok_ko' || n.endsWith('_id') || n.startsWith('id_') || n.endsWith('id')) {
    const x = parseInt(trimmed, 10);
    return Number.isFinite(x) ? x : null;
  }
  if (n === 'dto' || n.includes('descuento') || n.includes('importe') || n.includes('factur') || n.includes('saldo')) {
    const x = Number(String(trimmed).replace(',', '.'));
    return Number.isFinite(x) ? x : null;
  }
  if (n.startsWith('es_') || n.includes('activo')) {
    if (trimmed === '1' || trimmed.toLowerCase() === 'true' || trimmed.toLowerCase() === 'si') return 1;
    if (trimmed === '0' || trimmed.toLowerCase() === 'false' || trimmed.toLowerCase() === 'no') return 0;
  }
  return trimmed;
}

/**
 * Resuelve el valor de display para un campo: si es un ID de referencia,
 * devuelve el nombre/texto correspondiente; si no, devuelve el valor raw.
 * @param {string} name - Nombre del campo
 * @param {object} item - Objeto cliente con datos
 * @param {object} catalogs - Catálogos { provincias, paises, idiomas, monedas, formasPago, tiposClientes, comerciales, estadosCliente, tarifas }
 * @returns {string} Valor a mostrar
 */
const RESOLVE_FIELD_ALIASES = {
  cli_tipc_id: ['Id_TipoCliente', 'id_tipo_cliente'],
  cli_estcli_id: ['Id_EstdoCliente', 'id_estdocliente', 'EstadoClienteId'],
  cli_tipo_contacto: ['TipoContacto', 'tipo_contacto']
};

function resolveDisplayValue(name, item, catalogs = {}) {
  if (!item) return '';
  const n = String(name || '').toLowerCase();
  let raw = item[name];
  if ((raw === undefined || raw === null) && RESOLVE_FIELD_ALIASES[n]) {
    for (const k of RESOLVE_FIELD_ALIASES[n]) {
      if (item[k] !== undefined && item[k] !== null) { raw = item[k]; break; }
    }
  }
  const rawStr = (raw === null || raw === undefined) ? '' : String(raw);

  // OK_KO: mostrar Activo/Inactivo
  if (n === 'ok_ko' || n === 'cli_ok_ko') {
    const v = raw === 1 || raw === '1' || (typeof raw === 'string' && raw.toUpperCase().trim() === 'OK');
    return v ? 'Activo' : 'Inactivo';
  }
  // Modelo 347: mostrar Sí/No
  if (n === 'modelo_347' || n === 'cli_modelo_347') {
    const v = raw === 1 || raw === '1' || (typeof raw === 'string' && raw.toLowerCase().trim() === 'true');
    return v ? 'Sí' : 'No';
  }

  // Campos con nombre ya resuelto en item (getClienteById con JOINs)
  const itemDisplayMap = {
    cli_prov_id: 'ProvinciaNombre',
    id_provincia: 'ProvinciaNombre',
    cli_tipc_id: 'TipoClienteNombre',
    id_tipocliente: 'TipoClienteNombre',
    cli_esp_id: 'EspecialidadNombre',
    id_especialidad: 'EspecialidadNombre',
    cli_com_id: 'ComercialNombre',
    id_cial: 'ComercialNombre',
    cli_estcli_id: 'EstadoClienteNombre',
    id_estdocliente: 'EstadoClienteNombre',
    cli_idiom_id: 'IdiomaNombre',
    id_idioma: 'IdiomaNombre',
    cli_mon_id: 'MonedaNombre',
    id_moneda: 'MonedaNombre',
    cli_formp_id: 'FormaPagoNombre',
    id_formapago: 'FormaPagoNombre',
    cli_pais_id: 'PaisNombre',
    id_pais: 'PaisNombre',
    'cli_id_cliente_relacionado': 'ClienteRelacionadoNombre'
  };
  const displayKey = itemDisplayMap[n];
  if (displayKey && item[displayKey]) {
    return String(item[displayKey]).trim() || rawStr;
  }

  // Resolver desde catálogos cuando item no tiene el nombre
  const id = Number(raw) || 0;
  if (!id) return rawStr;

  if ((n === 'cli_prov_id' || n === 'id_provincia') && catalogs.provincias) {
    const p = (catalogs.provincias || []).find((r) => Number(r.prov_id ?? r.id ?? r.Id ?? 0) === id);
    return p ? String(p.prov_nombre ?? p.Nombre ?? p.nombre ?? '').trim() : rawStr;
  }
  if ((n === 'cli_tipc_id' || n === 'id_tipocliente') && catalogs.tiposClientes) {
    const t = (catalogs.tiposClientes || []).find((r) => Number(r.tipc_id ?? r.id ?? r.Id ?? 0) === id);
    return t ? String(t.tipc_nombre ?? t.tipc_tipo ?? t.Tipo ?? t.Nombre ?? t.nombre ?? '').trim() : rawStr;
  }
  if ((n === 'cli_esp_id' || n === 'id_especialidad') && catalogs.especialidades) {
    const e = (catalogs.especialidades || []).find((r) => Number(r.esp_id ?? r.id ?? r.Id ?? 0) === id);
    return e ? String(e.esp_nombre ?? e.Nombre ?? e.nombre ?? '').trim() : rawStr;
  }
  if ((n === 'cli_com_id' || n === 'id_cial') && catalogs.comerciales) {
    const c = (catalogs.comerciales || []).find((r) => Number(r.com_id ?? r.id ?? r.Id ?? 0) === id);
    return c ? String(c.com_nombre ?? c.Nombre ?? '').trim() : rawStr;
  }
  if ((n === 'cli_estcli_id' || n === 'id_estdocliente') && catalogs.estadosCliente) {
    const e = (catalogs.estadosCliente || []).find((r) => Number(r.estcli_id ?? r.id ?? r.Id ?? 0) === id);
    if (e) return String(e.estcli_nombre ?? e.Nombre ?? e.nombre ?? e.Estado ?? '').trim() || rawStr;
    const estadoFallback = { 1: 'Potencial', 2: 'Activo', 3: 'Inactivo', 4: 'Baja' };
    return estadoFallback[id] || rawStr;
  }
  if ((n === 'cli_idiom_id' || n === 'id_idioma') && catalogs.idiomas) {
    const i = (catalogs.idiomas || []).find((r) => Number(r.idiom_id ?? r.id ?? r.Id ?? 0) === id);
    return i ? String(i.idiom_nombre ?? i.Nombre ?? i.Idioma ?? '').trim() : rawStr;
  }
  if ((n === 'cli_mon_id' || n === 'id_moneda') && catalogs.monedas) {
    const m = (catalogs.monedas || []).find((r) => Number(r.mon_id ?? r.id ?? r.Id ?? 0) === id);
    return m ? String(m.mon_nombre ?? m.Nombre ?? m.Moneda ?? '').trim() : rawStr;
  }
  if ((n === 'cli_formp_id' || n === 'id_formapago') && catalogs.formasPago) {
    const f = (catalogs.formasPago || []).find((r) => Number(r.formp_id ?? r.id ?? r.Id ?? 0) === id);
    return f ? String(f.formp_nombre ?? f.FormaPago ?? f.Nombre ?? '').trim() : rawStr;
  }
  if ((n === 'cli_pais_id' || n === 'id_pais') && catalogs.paises) {
    const pa = (catalogs.paises || []).find((r) => Number(r.pais_id ?? r.id ?? r.Id ?? 0) === id);
    return pa ? String(pa.pais_nombre ?? pa.Nombre_pais ?? pa.Nombre ?? '').trim() : rawStr;
  }
  if ((n === 'cli_tarcli_id' || n === 'cli_tarifa_legacy') && catalogs.tarifas) {
    const tar = (catalogs.tarifas || []).find((r) => Number(r.tarcli_id ?? r.Id ?? r.id ?? 0) === id);
    return tar ? String(tar.tarcli_nombre ?? tar.NombreTarifa ?? tar.Nombre ?? '').trim() : rawStr;
  }

  return rawStr;
}

module.exports = {
  loadSimpleCatalogForSelect,
  loadEstadosClienteForSelect,
  applySpainDefaultsIfEmpty,
  buildClienteFormModel,
  coerceClienteValue,
  resolveDisplayValue
};
