/**
 * Listado y filtrado de productos Holded (API invoicing v1) para importar a `articulos`.
 * @see https://developers.holded.com/reference/list-products-1
 */
'use strict';

const { fetchHolded } = require('./holded-api');

/**
 * @param {unknown} raw
 * @returns {object[]}
 */
function normalizeProductsResponse(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.products)) return raw.products;
  if (raw && typeof raw === 'object' && Array.isArray(raw.data)) return raw.data;
  return [];
}

/**
 * @param {object} p
 * @returns {string[]}
 */
function productTagsArray(p) {
  const t = p?.tags;
  if (Array.isArray(t)) return t.map((x) => String(x).trim()).filter(Boolean);
  if (typeof t === 'string' && t.trim()) {
    return t
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * @param {object} p
 * @returns {{ id: string, name: string, sku: string, code: string, barcode: string, price: number, tax: number, forSale: boolean|null, forPurchase: boolean|null, kind: string, tags: string[], raw: object }}
 */
function normalizeProduct(p) {
  if (!p || typeof p !== 'object') return null;
  const id = p.id != null ? String(p.id).trim() : '';
  if (!id) return null;
  const sku = String(p.sku ?? p.SKU ?? '').trim();
  const code = String(p.code ?? p.factoryCode ?? p.factory_code ?? '').trim();
  const name = String(p.name ?? p.desc ?? '').trim() || '(sin nombre)';
  const barcode = p.barcode != null ? String(p.barcode).trim() : '';
  const price = Number(p.price ?? p.salePrice ?? 0) || 0;
  const tax = Number(p.tax ?? 0) || 0;
  let forSale = null;
  if (p.forSale === true || p.forSale === 1 || p.forSale === '1') forSale = true;
  else if (p.forSale === false || p.forSale === 0 || p.forSale === '0') forSale = false;
  let forPurchase = null;
  if (p.forPurchase === true || p.forPurchase === 1) forPurchase = true;
  else if (p.forPurchase === false || p.forPurchase === 0) forPurchase = false;
  const kind = String(p.kind ?? '').trim();
  const tags = productTagsArray(p);
  return {
    id,
    name,
    sku,
    code,
    barcode,
    price,
    tax,
    forSale,
    forPurchase,
    kind,
    tags,
    raw: p
  };
}

/**
 * Filtra productos orientados a venta y (opcional) por etiquetas Holded.
 * @param {ReturnType<normalizeProduct>[]} items
 * @param {{ onlyForSale?: boolean, requireTagsAny?: string[], excludePurchaseOnly?: boolean }} opts
 */
function filterProductsForSalesSync(items, opts = {}) {
  const onlyForSale = opts.onlyForSale !== false;
  const excludePurchaseOnly = opts.excludePurchaseOnly !== false;
  const requireTagsAny = Array.isArray(opts.requireTagsAny)
    ? opts.requireTagsAny.map((t) => String(t).toLowerCase().trim()).filter(Boolean)
    : [];

  return items.filter((row) => {
    if (!row) return false;
    if (onlyForSale && row.forSale === false) return false;
    if (excludePurchaseOnly && row.forPurchase === true && row.forSale === false) return false;
    if (requireTagsAny.length) {
      const set = new Set(row.tags.map((t) => t.toLowerCase()));
      const ok = requireTagsAny.some((req) => set.has(req));
      if (!ok) return false;
    }
    return true;
  });
}

/**
 * @param {string} [apiKey]
 */
async function fetchHoldedProductsList(apiKey) {
  const raw = await fetchHolded('/products', {}, apiKey);
  const arr = normalizeProductsResponse(raw);
  return arr.map(normalizeProduct).filter(Boolean);
}

/**
 * Carga mapas art_id_holded y sku → art_id para cruce en pantalla.
 * @param {import('../config/mysql-crm')} db
 */
async function loadCrmArticuloMaps(db) {
  const tArt = await db._resolveTableNameCaseInsensitive('articulos').catch(() => null);
  if (!tArt) return { byHolded: new Map(), bySku: new Map(), table: null };
  const aCols = await db._getColumns(tArt).catch(() => []);
  const lower = (c) => String(c).toLowerCase();
  const colsLower = new Set((aCols || []).map(lower));
  const pick = (cands) => (cands || []).find((c) => colsLower.has(String(c).toLowerCase()));
  const pk = pick(['art_id', 'id', 'Id']) || 'art_id';
  const cHolded = pick(['art_id_holded', 'art_Id_Holded']);
  const cSku = pick(['art_sku', 'SKU', 'sku']);

  const fields = [`\`${pk}\` AS art_id`];
  if (cHolded) fields.push(`\`${cHolded}\` AS art_id_holded`);
  if (cSku) fields.push(`\`${cSku}\` AS art_sku`);

  const rows = await db.query(`SELECT ${fields.join(', ')} FROM \`${tArt}\``).catch(() => []);
  const byHolded = new Map();
  const bySku = new Map();
  for (const r of rows || []) {
    const aid = r.art_id;
    const hid = r.art_id_holded != null ? String(r.art_id_holded).trim() : '';
    const sku = r.art_sku != null ? String(r.art_sku).trim() : '';
    if (hid) byHolded.set(hid, aid);
    if (sku) bySku.set(sku.toLowerCase(), aid);
  }
  return { byHolded, bySku, table: tArt, pk, cHolded, cSku };
}

/**
 * INSERT o UPDATE fila en articulos desde producto Holded.
 * Requiere columnas art_id_holded (y recomendado art_holded_sync_at).
 * @param {import('../config/mysql-crm')} db
 * @param {ReturnType<normalizeProduct>} p
 */
async function upsertArticuloFromHoldedProduct(db, p) {
  const tArt = await db._resolveTableNameCaseInsensitive('articulos');
  const cols = await db._getColumns(tArt).catch(() => []);
  const colSet = new Set((cols || []).map((c) => String(c).toLowerCase()));
  const has = (n) => colSet.has(String(n).toLowerCase());
  if (!has('art_id_holded')) {
    const err = new Error(
      'Falta la columna art_id_holded en articulos. Ejecuta scripts/alter-articulos-holded-sync.sql en MySQL.'
    );
    err.code = 'MISSING_ART_ID_HOLDED';
    throw err;
  }

  const pick = (names) => names.find((n) => has(n));
  const pk = pick(['art_id', 'id', 'Id']) || 'art_id';
  const cHolded = pick(['art_id_holded']);
  const cSku = pick(['art_sku', 'SKU', 'sku']);
  const cCod = pick(['art_codigo_interno', 'Codigo_Interno', 'codigo_interno']);
  const cNom = pick(['art_nombre', 'Nombre', 'nombre']);
  const cEan = pick(['art_ean13', 'EAN13', 'ean13']);
  const cPvl = pick(['art_pvl', 'PVL', 'pvl']);
  const cIva = pick(['art_iva', 'IVA', 'iva']);
  const cAct = pick(['art_activo', 'Activo', 'activo']);
  const cSync = pick(['art_holded_sync_at']);

  const sku = p.sku || '';
  const codigo = p.code || sku;
  const eanRaw = p.barcode.replace(/\D/g, '');
  const eanNum = eanRaw.length >= 8 ? eanRaw : null;
  const activo = p.forSale === false ? 0 : 1;

  const existing = await db.query(
    `SELECT \`${pk}\` FROM \`${tArt}\` WHERE \`${cHolded}\` = ? LIMIT 1`,
    [p.id]
  );
  let artId = existing?.[0]?.[pk] ?? existing?.[0]?.art_id;

  if (!artId && cSku && sku) {
    const bySku = await db.query(
      `SELECT \`${pk}\` FROM \`${tArt}\` WHERE (\`${cHolded}\` IS NULL OR TRIM(\`${cHolded}\`) = '') AND TRIM(CAST(\`${cSku}\` AS CHAR)) = ? LIMIT 1`,
      [sku]
    );
    artId = bySku?.[0]?.[pk] ?? bySku?.[0]?.art_id;
  }
  if (!artId && cCod && codigo) {
    const byCod = await db.query(
      `SELECT \`${pk}\` FROM \`${tArt}\` WHERE (\`${cHolded}\` IS NULL OR TRIM(\`${cHolded}\`) = '') AND TRIM(CAST(\`${cCod}\` AS CHAR)) = ? LIMIT 1`,
      [codigo]
    );
    artId = byCod?.[0]?.[pk] ?? byCod?.[0]?.art_id;
  }

  const now = new Date();
  const syncSql = cSync ? ', `' + cSync + '` = ?' : '';

  if (artId) {
    const sets = [`\`${cHolded}\` = ?`];
    const vals = [p.id];
    if (cSku) {
      sets.push(`\`${cSku}\` = ?`);
      vals.push(sku);
    }
    if (cCod) {
      sets.push(`\`${cCod}\` = ?`);
      vals.push(codigo);
    }
    if (cNom) {
      sets.push(`\`${cNom}\` = ?`);
      vals.push(p.name.slice(0, 500));
    }
    if (cPvl) {
      sets.push(`\`${cPvl}\` = ?`);
      vals.push(p.price);
    }
    if (cIva) {
      sets.push(`\`${cIva}\` = ?`);
      vals.push(p.tax);
    }
    if (cAct) {
      sets.push(`\`${cAct}\` = ?`);
      vals.push(activo);
    }
    if (cEan && eanNum) {
      sets.push(`\`${cEan}\` = ?`);
      vals.push(eanNum);
    }
    if (syncSql) {
      vals.push(now);
    }
    vals.push(artId);
    await db.query(
      `UPDATE \`${tArt}\` SET ${sets.join(', ')}${syncSql} WHERE \`${pk}\` = ?`,
      vals
    );
    return { action: 'updated', artId, holdedId: p.id };
  }

  const insertCols = [];
  const insertVals = [];
  const push = (col, val) => {
    insertCols.push(`\`${col}\``);
    insertVals.push(val);
  };
  push(cHolded, p.id);
  if (cSku) push(cSku, sku);
  if (cCod) push(cCod, codigo);
  if (cNom) push(cNom, p.name.slice(0, 500));
  if (cPvl) push(cPvl, p.price);
  if (cIva) push(cIva, p.tax);
  if (cAct) push(cAct, activo);
  if (cEan && eanNum) push(cEan, eanNum);
  if (cSync) push(cSync, now);

  const placeholders = insertCols.map(() => '?').join(', ');
  const sql = `INSERT INTO \`${tArt}\` (${insertCols.join(', ')}) VALUES (${placeholders})`;
  const result = await db.query(sql, insertVals);
  const insertId = result && result.insertId != null ? result.insertId : null;
  return { action: 'inserted', artId: insertId, holdedId: p.id };
}

/**
 * @param {import('../config/mysql-crm')} db
 * @param {ReturnType<normalizeProduct>[]} allProducts
 * @param {string[]} holdedIds
 */
async function importSelectedHoldedProducts(db, allProducts, holdedIds) {
  const set = new Set((holdedIds || []).map((x) => String(x).trim()).filter(Boolean));
  const byId = new Map(allProducts.map((p) => [p.id, p]));
  const results = [];
  for (const hid of set) {
    const p = byId.get(hid);
    if (!p) {
      results.push({ holdedId: hid, error: 'Producto no encontrado en la lista cargada' });
      continue;
    }
    try {
      results.push(await upsertArticuloFromHoldedProduct(db, p));
    } catch (e) {
      results.push({ holdedId: hid, error: e?.message || String(e) });
    }
  }
  return results;
}

module.exports = {
  normalizeProductsResponse,
  productTagsArray,
  normalizeProduct,
  filterProductsForSalesSync,
  fetchHoldedProductsList,
  loadCrmArticuloMaps,
  upsertArticuloFromHoldedProduct,
  importSelectedHoldedProducts
};
