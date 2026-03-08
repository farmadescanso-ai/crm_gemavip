/**
 * Lógica de sincronización Holded → CRM.
 * Usado por scripts/sync-pedidos-holded.js y por la UI de admin.
 */
'use strict';

const axios = require('axios');
const db = require('../config/mysql-crm');

const HOLDED_BASE = 'https://api.holded.com/api/invoicing/v1';
const PROVINCIA_MURCIA_ID = 30;

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

async function fetchHolded(apiKey, method, path, params = {}) {
  const url = `${HOLDED_BASE}${path}`;
  const config = {
    method,
    url,
    headers: { key: apiKey },
    params: Object.keys(params).length ? params : undefined
  };
  const res = await axios(config);
  return res.data;
}

/**
 * Ejecuta la sincronización de pedidos Holded → CRM.
 * @param {Object} opts - { start, end, provincia, dryRun }
 * @returns {Promise<{ ok: boolean, inserted, skippedProvincia, skippedDuplicado, skippedSinContacto, errors, totalFetched, error?: string }>}
 */
async function runSyncHoldedPedidos(opts = {}) {
  const start = opts.start || '2026-01-01';
  const end = opts.end || '2026-12-31';
  const provincia = opts.provincia || 'Murcia';
  const dryRun = !!opts.dryRun;

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

    result.totalFetched = documents.length;

    for (const doc of documents) {
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
      const existingByRef = await db.query('SELECT cli_id FROM clientes WHERE cli_referencia = ? LIMIT 1', [contactId]);
      if (existingByRef?.length) {
        clienteId = existingByRef[0].cli_id;
      } else if (cif) {
        const existingByCif = await db.query('SELECT cli_id FROM clientes WHERE cli_dni_cif = ? LIMIT 1', [cif]);
        if (existingByCif?.length) {
          clienteId = existingByCif[0].cli_id;
          await db.query('UPDATE clientes SET cli_referencia = ? WHERE cli_id = ?', [contactId, clienteId]);
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
          cli_referencia: contactId,
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

      const [pedResult] = await db.pool.execute(
        `INSERT INTO pedidos (
          ped_com_id, ped_cli_id, ped_formp_id, ped_tipp_id, ped_Serie, ped_numero, ped_fecha, ped_estado_txt,
          ped_total, ped_base, ped_iva, ped_id_holded
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [1, clienteId, formpId, tippId, 'A', pedNumero, pedFecha, estadoTxt, doc.total ?? 0, doc.subtotal ?? 0, doc.tax ?? 0, doc.id]
      );

      const pedidoId = pedResult.insertId;
      const products = doc.products ?? [];
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        const sku = p.sku ? String(p.sku).trim() : null;
        let artId = null;
        if (sku) {
          const art = await db.query('SELECT art_id FROM articulos WHERE art_sku = ? LIMIT 1', [sku]);
          if (art?.length) artId = art[0].art_id;
        }
        const articuloTxt = p.name ? String(p.name).trim() : null;
        const cantidad = Number(p.units) || 1;
        const pvp = Number(p.price) || 0;
        await db.pool.execute(
          `INSERT INTO pedidos_articulos (pedart_ped_id, pedart_art_id, pedart_articulo_txt, pedart_numero, pedart_cantidad, pedart_pvp)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [pedidoId, artId, articuloTxt, i + 1, cantidad, pvp]
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

module.exports = { runSyncHoldedPedidos, runMigrationPedIdHolded };
