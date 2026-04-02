/**
 * Lógica de sincronización Holded → CRM.
 * Usado por scripts/sync-pedidos-holded.js y por la UI de admin.
 */
'use strict';

const db = require('../config/mysql-crm');
const { fetchHolded: _fetchShared } = require('./holded-api');
const { getClienteRegimenId, REGIMEN_IVA } = require('./tax-helpers');

const PROVINCIA_MURCIA_ID = 30;

/** Wrapper de compatibilidad: adapta la firma (apiKey, path, params) al helper compartido. */
function fetchHolded(apiKey, _method, path, params = {}) {
  return _fetchShared(path, params, apiKey);
}

function dateToUnix(dateStr) {
  const d = new Date(dateStr);
  return Math.floor(d.getTime() / 1000);
}

function isProvinciaMurcia(provinceStr) {
  if (!provinceStr || typeof provinceStr !== 'string') return false;
  return String(provinceStr).trim().toLowerCase().includes('murcia');
}

function mapHoldedStatus(status) {
  const s = Number(status);
  if (s === 0) return 'Pendiente';
  if (s === 1) return 'Enviado';
  if (s === 2) return 'Pagado';
  return 'Pendiente';
}

/**
 * Ejecuta la sincronización de pedidos Holded → CRM.
 * @param {Object} opts - { start, end, provincia, dryRun, idsToImport } idsToImport: array de doc.id a importar (si se pasa, solo esos)
 * @returns {Promise<{ ok: boolean, inserted, skippedProvincia, skippedDuplicado, skippedSinContacto, errors, totalFetched, error?: string }>}
 */
async function runSyncHoldedPedidos(opts = {}) {
  const start = opts.start || '2026-01-01';
  const end = opts.end || '2026-12-31';
  const provincia = opts.provincia || 'Murcia';
  const dryRun = !!opts.dryRun;
  const idsToImport = Array.isArray(opts.idsToImport) ? opts.idsToImport.map(String) : null;

  const apiKey = process.env.HOLDED_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: 'Falta HOLDED_API_KEY en variables de entorno', inserted: 0, skippedProvincia: 0, skippedDuplicado: 0, skippedSinContacto: 0, errors: 0, totalFetched: 0 };
  }

  const result = { inserted: 0, skippedProvincia: 0, skippedDuplicado: 0, skippedSinContacto: 0, errors: 0, totalFetched: 0 };

  try {
    if (!db.connected && !db.pool) await db.connect();

    const cols = await db.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'ped_id_holded'"
    );
    if (!cols?.length) {
      return { ...result, ok: false, error: 'Ejecuta primero la migración: scripts/add-column-ped-id-holded.sql' };
    }

    const provincias = await db.query('SELECT prov_id, prov_nombre, prov_codigo_pais FROM provincias WHERE prov_nombre LIKE ?', [`%${provincia}%`]);
    const provMurciaId = provincias?.[0]?.prov_id ?? PROVINCIA_MURCIA_ID;
    const codPais = provincias?.[0]?.prov_codigo_pais || 'ES';
    const paisRows = await db.query('SELECT pais_id FROM paises WHERE pais_codigo = ? LIMIT 1', [codPais]);
    const paisId = paisRows?.[0]?.pais_id ?? 1;

    const formpRows = await db.query('SELECT formp_id FROM formas_pago ORDER BY formp_id ASC LIMIT 1');
    const formpId = formpRows?.[0]?.formp_id ?? 1;

    const tippRows = await db.query('SELECT tipp_id FROM tipos_pedidos ORDER BY tipp_id ASC LIMIT 1');
    const tippId = tippRows?.[0]?.tipp_id ?? 1;

    const artDefaultRows = await db.query('SELECT art_id FROM articulos ORDER BY art_id ASC LIMIT 1');
    const artIdDefaultRaw = (artDefaultRows?.length && artDefaultRows[0].art_id != null)
      ? Number(artDefaultRows[0].art_id)
      : null;
    const artIdDefault = (artIdDefaultRaw > 0) ? artIdDefaultRaw : 1;

    const startTs = dateToUnix(start);
    const endTs = dateToUnix(end);

    const documents = await fetchHolded(apiKey, 'GET', '/documents/salesorder', {
      starttmp: startTs,
      endtmp: endTs,
      sort: 'created-desc'
    });

    if (!Array.isArray(documents)) {
      return { ...result, ok: false, error: 'La API de Holded no devolvió un array' };
    }

    const docsToProcess = idsToImport
      ? documents.filter((d) => idsToImport.includes(String(d.id)))
      : documents;
    result.totalFetched = documents.length;

    for (const doc of docsToProcess) {
      const contactId = doc.contact;
      if (!contactId) {
        result.skippedSinContacto++;
        continue;
      }

      let contact;
      try {
        contact = await fetchHolded(apiKey, 'GET', `/contacts/${contactId}`);
      } catch (e) {
        result.skippedSinContacto++;
        continue;
      }

      const province = contact?.billAddress?.province ?? contact?.shippingAddresses?.[0]?.province ?? '';
      if (!isProvinciaMurcia(province)) {
        result.skippedProvincia++;
        continue;
      }

      const cif = String(contact?.code ?? '').trim() || null;
      const nombre = String(contact?.name ?? contact?.tradeName ?? 'Cliente Holded').trim();

      let clienteId = null;
      let existingById = null;
      try {
        existingById = await db.query('SELECT cli_id FROM clientes WHERE cli_Id_Holded = ? LIMIT 1', [contactId]);
      } catch (_) {
        /* columna opcional */
      }
      if (existingById?.length) {
        clienteId = existingById[0].cli_id;
      } else {
        const existingByRef = await db.query('SELECT cli_id FROM clientes WHERE cli_referencia = ? LIMIT 1', [contactId]);
        if (existingByRef?.length) {
          clienteId = existingByRef[0].cli_id;
        } else if (cif) {
          const existingByCif = await db.query('SELECT cli_id FROM clientes WHERE cli_dni_cif = ? LIMIT 1', [cif]);
          if (existingByCif?.length) {
            clienteId = existingByCif[0].cli_id;
            try {
              await db.query('UPDATE clientes SET cli_Id_Holded = ? WHERE cli_id = ?', [contactId, clienteId]);
            } catch (_) {
              await db.query('UPDATE clientes SET cli_referencia = ? WHERE cli_id = ?', [contactId, clienteId]);
            }
          }
        }
      }

      if (!clienteId) {
        const billAddr = contact?.billAddress ?? {};
        const payload = {
          cli_nombre_razon_social: nombre || 'Cliente Holded',
          cli_dni_cif: cif || 'Pendiente',
          cli_email: contact?.email || null,
          cli_movil: contact?.mobile || null,
          cli_telefono: contact?.phone || null,
          cli_direccion: billAddr?.address || null,
          cli_poblacion: billAddr?.city || null,
          cli_codigo_postal: billAddr?.postalCode ? String(billAddr.postalCode).padStart(5, '0') : null,
          cli_prov_id: provMurciaId,
          cli_Id_Holded: contactId,
          cli_com_id: 1,
          cli_estcli_id: 2,
          cli_activo: 1,
          cli_pais_id: paisId
        };
        try {
          const created = await db.createCliente(payload);
          clienteId = created?.insertId ?? created?.Id ?? created?.id;
        } catch (e) {
          result.errors++;
          continue;
        }
      }

      const existingPed = await db.query('SELECT ped_id FROM pedidos WHERE ped_id_holded = ? LIMIT 1', [doc.id]);
      if (existingPed?.length) {
        result.skippedDuplicado++;
        continue;
      }

      if (dryRun) {
        result.inserted++;
        continue;
      }

      const pedFecha = doc.date ? new Date(doc.date * 1000) : new Date();
      const pedNumero = doc.docNumber || await db.getNextNumeroPedido();
      const estadoTxt = mapHoldedStatus(doc.status);
      const pedDto = Number(doc.discount) || 0;

      const pedRegfisId = clienteId ? await getClienteRegimenId(db, clienteId).catch(() => REGIMEN_IVA) : REGIMEN_IVA;

      const [pedResult] = await db.pool.execute(
        `INSERT INTO pedidos (
          ped_com_id, ped_cli_id, ped_formp_id, ped_tipp_id, ped_Serie, ped_numero, ped_fecha, ped_estado_txt,
          ped_total, ped_base, ped_iva, ped_dto, ped_id_holded, ped_regfis_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [1, clienteId, formpId, tippId, 'A', pedNumero, pedFecha, estadoTxt, doc.total ?? 0, doc.subtotal ?? 0, doc.tax ?? 0, pedDto, doc.id, pedRegfisId]
      );

      const pedidoId = pedResult.insertId;
      const products = doc.products ?? [];
      // Precios y descuentos vienen de Holded; no se usan tarifas de la BD.
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        const codigo = (p.sku ?? p.code ?? p.productId ?? '').toString().trim();
        let artId = artIdDefault;
        if (codigo) {
          const codigoNum = /^\d+$/.test(codigo) ? parseInt(codigo, 10) : null;
          const params = [codigo, codigo];
          if (codigoNum != null) params.push(codigoNum);
          const art = await db.query(
            `SELECT art_id FROM articulos WHERE art_sku = ? OR art_codigo_interno = ? ${codigoNum != null ? 'OR art_ean13 = ?' : ''} LIMIT 1`,
            params
          );
          if (art?.length && art[0].art_id != null) artId = art[0].art_id;
        }
        artId = artId ?? artIdDefault ?? 1;
        const articuloTxt = p.name ? String(p.name).trim() : (p.sku ? String(p.sku) : 'Producto Holded');
        const cantidad = Number(p.units) || 1;
        const pvp = Number(p.price) || 0;
        const dto = Number(p.discount) || 0;
        const artIdFinal = Math.max(1, Number(artId) || artIdDefault);
        await db.pool.execute(
          `INSERT INTO pedidos_articulos (pedart_ped_id, pedart_art_id, pedart_articulo_txt, pedart_numero, pedart_cantidad, pedart_pvp, pedart_dto)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [pedidoId, artIdFinal, articuloTxt || 'Producto', i + 1, cantidad, pvp, dto]
        );
      }

      result.inserted++;
    }

    return { ...result, ok: true };
  } catch (e) {
    return { ...result, ok: false, error: e?.message || String(e) };
  }
}

/**
 * Ejecuta la migración ped_id_holded (columna + índice).
 * Idempotente: puede ejecutarse varias veces.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function runMigrationPedIdHolded() {
  try {
    if (!db.connected && !db.pool) await db.connect();

    const cols = await db.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'ped_id_holded'"
    );
    if (!cols?.length) {
      await db.query('ALTER TABLE `pedidos` ADD COLUMN `ped_id_holded` VARCHAR(50) DEFAULT NULL');
    }

    const idx = await db.query(
      "SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'pedidos' AND index_name = 'idx_pedidos_id_holded'"
    );
    if (!idx?.length) {
      await db.query('CREATE UNIQUE INDEX `idx_pedidos_id_holded` ON `pedidos` (`ped_id_holded`)');
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Obtiene la relación entre códigos de productos Holded y artículos BD.
 * Útil para identificar qué ajustar (art_sku, art_codigo_interno, art_ean13).
 * @param {Object} opts - { start, end } fechas YYYY-MM-DD
 * @returns {Promise<{ ok: boolean, relacion: Array, periodo: string, error?: string }>}
 */
async function getRelacionCodigosHoldedBd(opts = {}) {
  const start = opts.start || '2026-01-01';
  const end = opts.end || '2026-01-31';
  const apiKey = process.env.HOLDED_API_KEY;

  if (!apiKey?.trim()) {
    return { ok: false, relacion: [], periodo: `${start} a ${end}`, error: 'Falta HOLDED_API_KEY' };
  }

  try {
    if (!db.connected && !db.pool) await db.connect();

    const startTs = dateToUnix(start);
    const endTs = dateToUnix(end);

    const documents = await fetchHolded(apiKey, 'GET', '/documents/salesorder', {
      starttmp: startTs,
      endtmp: endTs,
      sort: 'created-desc'
    });

    if (!Array.isArray(documents)) {
      return { ok: false, relacion: [], periodo: `${start} a ${end}`, error: 'Holded no devolvió array' };
    }

    const holdedProducts = new Map();
    for (const doc of documents) {
      const products = doc.products ?? [];
      const docNum = doc.docNumber ?? doc.id ?? '?';
      for (const p of products) {
        const sku = (p.sku ?? '').toString().trim();
        const code = (p.code ?? '').toString().trim();
        const productId = (p.productId ?? '').toString().trim();
        const codigo = sku || code || productId || '(sin código)';
        const name = (p.name ?? '').toString().trim() || '(sin nombre)';
        if (!holdedProducts.has(codigo)) {
          holdedProducts.set(codigo, { name, docNumbers: [], sku, code, productId });
        }
        const entry = holdedProducts.get(codigo);
        if (!entry.docNumbers.includes(docNum)) entry.docNumbers.push(docNum);
      }
    }

    const articulos = await db.query(
      'SELECT art_id, art_sku, art_codigo_interno, art_ean13, art_nombre FROM articulos WHERE art_activo = 1 OR art_activo IS NULL ORDER BY art_id'
    );

    const bySku = new Map();
    const byCodigoInterno = new Map();
    const byEan13 = new Map();
    for (const a of articulos || []) {
      const sku = (a.art_sku ?? '').toString().trim();
      const ci = (a.art_codigo_interno ?? '').toString().trim();
      const ean = a.art_ean13 != null ? String(a.art_ean13).trim() : '';
      if (sku) bySku.set(sku, a);
      if (ci) byCodigoInterno.set(ci, a);
      if (ean) byEan13.set(ean, a);
    }

    const relacion = [];
    for (const [codigoHolded, info] of holdedProducts) {
      const matchSku = bySku.get(codigoHolded);
      const matchCi = byCodigoInterno.get(codigoHolded);
      const codigoNum = /^\d+$/.test(codigoHolded) ? codigoHolded : null;
      const matchEan = codigoNum ? byEan13.get(codigoNum) : null;
      const match = matchSku || matchCi || matchEan;
      relacion.push({
        holded_codigo: codigoHolded,
        holded_nombre: info.name,
        holded_sku: info.sku,
        holded_code: info.code,
        holded_productId: info.productId,
        pedidos: info.docNumbers.join(', '),
        bd_art_id: match?.art_id ?? null,
        bd_art_sku: match?.art_sku ?? null,
        bd_art_codigo_interno: match?.art_codigo_interno ?? null,
        bd_art_ean13: match?.art_ean13 ?? null,
        bd_art_nombre: match?.art_nombre ?? null,
        coincide: !!match,
        campo_coincidencia: match ? (matchSku ? 'art_sku' : matchCi ? 'art_codigo_interno' : 'art_ean13') : null
      });
    }

    relacion.sort((a, b) => (a.coincide === b.coincide ? 0 : a.coincide ? 1 : -1));

    return { ok: true, relacion, periodo: `${start} a ${end}` };
  } catch (e) {
    return { ok: false, relacion: [], periodo: `${start} a ${end}`, error: e?.message || String(e) };
  }
}

/**
 * Obtiene vista previa de pedidos Holded (sin guardar en BD).
 * Solo pedidos de Provincia de Murcia. Indica cuáles ya existen en BD.
 * @param {Object} opts - { start, end, provincia }
 * @returns {Promise<{ ok: boolean, pedidos: Array, totalFetched, skippedProvincia, skippedDuplicado, skippedSinContacto, periodo, error?: string }>}
 */
async function getPreviewPedidosHolded(opts = {}) {
  const start = opts.start || '2026-01-01';
  const end = opts.end || '2026-12-31';
  const provincia = opts.provincia || 'Murcia';
  const apiKey = process.env.HOLDED_API_KEY;

  if (!apiKey?.trim()) {
    return { ok: false, pedidos: [], totalFetched: 0, skippedProvincia: 0, skippedDuplicado: 0, skippedSinContacto: 0, periodo: `${start} a ${end}`, error: 'Falta HOLDED_API_KEY' };
  }

  try {
    if (!db.connected && !db.pool) await db.connect();

    const startTs = dateToUnix(start);
    const endTs = dateToUnix(end);

    const documents = await fetchHolded(apiKey, 'GET', '/documents/salesorder', {
      starttmp: startTs,
      endtmp: endTs,
      sort: 'created-desc'
    });

    if (!Array.isArray(documents)) {
      return { ok: false, pedidos: [], totalFetched: 0, skippedProvincia: 0, skippedDuplicado: 0, skippedSinContacto: 0, periodo: `${start} a ${end}`, error: 'Holded no devolvió array' };
    }

    const pedidos = [];
    let skippedProvincia = 0;
    let skippedDuplicado = 0;
    let skippedSinContacto = 0;

    for (const doc of documents) {
      const contactId = doc.contact;
      if (!contactId) {
        skippedSinContacto++;
        continue;
      }

      let contact;
      try {
        contact = await fetchHolded(apiKey, 'GET', `/contacts/${contactId}`);
      } catch (e) {
        skippedSinContacto++;
        continue;
      }

      const province = contact?.billAddress?.province ?? contact?.shippingAddresses?.[0]?.province ?? '';
      if (!isProvinciaMurcia(province)) {
        skippedProvincia++;
        continue;
      }

      const existingPed = await db.query('SELECT ped_id FROM pedidos WHERE ped_id_holded = ? LIMIT 1', [doc.id]);
      const yaExiste = !!(existingPed?.length);
      if (yaExiste) skippedDuplicado++;

      const billAddr = contact?.billAddress ?? {};
      const shipAddr = contact?.shippingAddresses?.[0] ?? {};
      const nombre = String(contact?.name ?? contact?.tradeName ?? 'Cliente Holded').trim();
      const cif = String(contact?.code ?? '').trim() || null;
      const pedFecha = doc.date ? new Date(doc.date * 1000) : new Date();
      const productos = (doc.products ?? []).map((p, i) => ({
        nombre: (p.name ?? p.sku ?? 'Producto').toString().trim(),
        sku: (p.sku ?? p.code ?? '').toString().trim(),
        cantidad: Number(p.units) || 1,
        precio: Number(p.price) || 0,
        linea: i + 1,
        pedart_articulo_txt: (p.name ?? p.sku ?? 'Producto').toString().trim(),
        pedart_cantidad: Number(p.units) || 1,
        pedart_pvp: Number(p.price) || 0,
        art_sku: (p.sku ?? p.code ?? '').toString().trim()
      }));

      pedidos.push({
        docNumber: doc.docNumber ?? doc.id ?? '?',
        fecha: pedFecha.toISOString().slice(0, 10),
        cliente: nombre,
        cif,
        direccion: billAddr?.address ?? shipAddr?.address ?? null,
        poblacion: billAddr?.city ?? shipAddr?.city ?? null,
        codigoPostal: billAddr?.postalCode ? String(billAddr.postalCode).padStart(5, '0') : (shipAddr?.postalCode ? String(shipAddr.postalCode).padStart(5, '0') : null),
        email: contact?.email ?? null,
        telefono: contact?.phone ?? contact?.mobile ?? null,
        provincia: province,
        total: Number(doc.total) ?? 0,
        subtotal: Number(doc.subtotal) ?? 0,
        tax: Number(doc.tax) ?? 0,
        productos,
        lineas: productos,
        idHolded: doc.id,
        yaExiste,
        estado: mapHoldedStatus(doc.status)
      });
    }

    return {
      ok: true,
      pedidos,
      totalFetched: documents.length,
      skippedProvincia,
      skippedDuplicado,
      skippedSinContacto,
      periodo: `${start} a ${end}`
    };
  } catch (e) {
    return {
      ok: false,
      pedidos: [],
      totalFetched: 0,
      skippedProvincia: 0,
      skippedDuplicado: 0,
      skippedSinContacto: 0,
      periodo: `${start} a ${end}`,
      error: e?.message || String(e)
    };
  }
}

/**
 * Obtiene el JSON raw de Holded (documentos + contactos) para inspección y mapeo.
 * @param {Object} opts - { start, end }
 * @returns {Promise<{ ok: boolean, raw: Object, periodo: string, error?: string }>}
 */
async function getRawHoldedJson(opts = {}) {
  const start = opts.start || '2026-01-01';
  const end = opts.end || '2026-12-31';
  const apiKey = process.env.HOLDED_API_KEY;

  if (!apiKey?.trim()) {
    return { ok: false, raw: null, periodo: `${start} a ${end}`, error: 'Falta HOLDED_API_KEY' };
  }

  try {
    const startTs = dateToUnix(start);
    const endTs = dateToUnix(end);

    const documents = await fetchHolded(apiKey, 'GET', '/documents/salesorder', {
      starttmp: startTs,
      endtmp: endTs,
      sort: 'created-desc'
    });

    if (!Array.isArray(documents)) {
      return { ok: false, raw: null, periodo: `${start} a ${end}`, error: 'Holded no devolvió array' };
    }

    const docsWithContacts = [];
    for (const doc of documents.slice(0, 3)) {
      let contact = null;
      if (doc.contact) {
        try {
          contact = await fetchHolded(apiKey, 'GET', `/contacts/${doc.contact}`);
        } catch (_) {}
      }
      docsWithContacts.push({ document: doc, contact });
    }

    const raw = {
      _nota: 'Muestra hasta 3 documentos con sus contactos. Estructura real de la API Holded.',
      totalDocumentos: documents.length,
      muestra: docsWithContacts,
      documentoEjemplo: documents[0] || null
    };

    return { ok: true, raw, periodo: `${start} a ${end}` };
  } catch (e) {
    return { ok: false, raw: null, periodo: `${start} a ${end}`, error: e?.message || String(e) };
  }
}

module.exports = { runSyncHoldedPedidos, runMigrationPedIdHolded, getRelacionCodigosHoldedBd, getPreviewPedidosHolded, getRawHoldedJson };
