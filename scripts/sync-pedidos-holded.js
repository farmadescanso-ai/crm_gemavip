#!/usr/bin/env node
/**
 * Sincroniza pedidos de Holded a la BD del CRM.
 * Solo procesa pedidos de clientes en la Provincia de Murcia.
 *
 * Uso:
 *   node scripts/sync-pedidos-holded.js [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--provincia=Murcia] [--dry-run]
 *
 * Requiere: HOLDED_API_KEY en .env
 * Requiere: migración scripts/add-column-ped-id-holded.sql ejecutada
 */
'use strict';

require('dotenv').config();
const axios = require('axios');
const path = require('path');

// Cargar db desde la raíz del proyecto
const projectRoot = path.resolve(__dirname, '..');
const db = require(path.join(projectRoot, 'config', 'mysql-crm'));

const HOLDED_BASE = 'https://api.holded.com/api/invoicing/v1';
const PROVINCIA_MURCIA_ID = 30; // prov_id de Murcia en provincias

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    start: null,
    end: null,
    provincia: 'Murcia',
    dryRun: false
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a.startsWith('--start=')) opts.start = a.slice(8);
    else if (a.startsWith('--end=')) opts.end = a.slice(6);
    else if (a.startsWith('--provincia=')) opts.provincia = a.slice(11);
    else if (a === '--start' && args[i + 1]) opts.start = args[++i];
    else if (a === '--end' && args[i + 1]) opts.end = args[++i];
  }
  if (!opts.start) opts.start = '2026-01-01';
  if (!opts.end) opts.end = '2026-12-31';
  return opts;
}

function dateToUnix(dateStr) {
  const d = new Date(dateStr);
  return Math.floor(d.getTime() / 1000);
}

function isProvinciaMurcia(provinceStr) {
  if (!provinceStr || typeof provinceStr !== 'string') return false;
  return String(provinceStr).trim().toLowerCase().includes('murcia');
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

async function main() {
  const opts = parseArgs();
  const apiKey = process.env.HOLDED_API_KEY;

  if (!apiKey || !apiKey.trim()) {
    console.error('❌ Falta HOLDED_API_KEY en .env');
    process.exit(1);
  }

  const startTs = dateToUnix(opts.start);
  const endTs = dateToUnix(opts.end);

  console.log('📥 Sincronización Holded → CRM');
  console.log(`   Rango: ${opts.start} a ${opts.end}`);
  console.log(`   Provincia: ${opts.provincia}`);
  if (opts.dryRun) console.log('   [DRY-RUN] No se escribirá en BD');
  console.log('');

  let inserted = 0;
  let skippedProvincia = 0;
  let skippedDuplicado = 0;
  let skippedSinContacto = 0;
  let errors = 0;

  try {
    await db.connect();

    // Verificar que existe la columna ped_id_holded (ejecutar scripts/add-column-ped-id-holded.sql)
    const cols = await db.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'ped_id_holded'"
    );
    if (!cols?.length) {
      console.error('❌ Ejecuta primero: mysql ... < scripts/add-column-ped-id-holded.sql');
      process.exit(1);
    }

    // Obtener prov_id de Murcia y pais_id España
    const provincias = await db.query('SELECT prov_id, prov_nombre, prov_codigo_pais FROM provincias WHERE prov_nombre LIKE ?', [`%${opts.provincia}%`]);
    const provMurciaId = provincias?.[0]?.prov_id ?? PROVINCIA_MURCIA_ID;
    const codPais = provincias?.[0]?.prov_codigo_pais || 'ES';
    const paisRows = await db.query('SELECT pais_id FROM paises WHERE pais_codigo = ? LIMIT 1', [codPais]);
    const paisId = paisRows?.[0]?.pais_id ?? 1;

    const formpRows = await db.query('SELECT formp_id FROM formas_pago ORDER BY formp_id ASC LIMIT 1');
    const formpId = formpRows?.[0]?.formp_id ?? 1;

    const tippRows = await db.query('SELECT tipp_id FROM tipos_pedidos ORDER BY tipp_id ASC LIMIT 1');
    const tippId = tippRows?.[0]?.tipp_id ?? 1;

    const artDefaultRows = await db.query('SELECT art_id FROM articulos ORDER BY art_id ASC LIMIT 1');
    const artIdDefaultRaw = artDefaultRows?.[0]?.art_id;
    const artIdDefault = (artIdDefaultRaw != null && Number(artIdDefaultRaw) > 0) ? Number(artIdDefaultRaw) : 1;

    // Fetch pedidos Holded
    const documents = await fetchHolded(apiKey, 'GET', '/documents/salesorder', {
      starttmp: startTs,
      endtmp: endTs,
      sort: 'created-desc'
    });

    if (!Array.isArray(documents)) {
      console.error('❌ La API de Holded no devolvió un array');
      process.exit(1);
    }

    console.log(`📋 ${documents.length} pedidos obtenidos de Holded`);

    for (const doc of documents) {
      const contactId = doc.contact;
      if (!contactId) {
        skippedSinContacto++;
        continue;
      }

      // Obtener contacto para CIF y provincia
      let contact;
      try {
        contact = await fetchHolded(apiKey, 'GET', `/contacts/${contactId}`);
      } catch (e) {
        console.warn(`⚠️ No se pudo obtener contacto ${contactId}:`, e?.response?.status || e.message);
        skippedSinContacto++;
        continue;
      }

      const province = contact?.billAddress?.province ?? contact?.shippingAddresses?.[0]?.province ?? '';
      if (!isProvinciaMurcia(province)) {
        skippedProvincia++;
        continue;
      }

      const cif = String(contact?.code ?? '').trim() || null;
      const nombre = String(contact?.name ?? contact?.tradeName ?? 'Cliente Holded').trim();

      // Buscar o crear cliente
      let clienteId = null;
      const existingByRef = await db.query(
        'SELECT cli_id FROM clientes WHERE cli_referencia = ? LIMIT 1',
        [contactId]
      );
      if (existingByRef?.length) {
        clienteId = existingByRef[0].cli_id;
      } else if (cif) {
        const existingByCif = await db.query(
          'SELECT cli_id FROM clientes WHERE cli_dni_cif = ? LIMIT 1',
          [cif]
        );
        if (existingByCif?.length) {
          clienteId = existingByCif[0].cli_id;
          // Actualizar cli_referencia para futuras sincronizaciones
          await db.query('UPDATE clientes SET cli_referencia = ? WHERE cli_id = ?', [contactId, clienteId]);
        }
      }

      if (!clienteId) {
        // Crear cliente básico
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
          console.error(`❌ Error creando cliente para ${contactId}:`, e.message);
          errors++;
          continue;
        }
        if (opts.dryRun) console.log(`   [DRY] Cliente creado: ${nombre} (${cif || 'sin CIF'})`);
      }

      // Comprobar si el pedido ya existe
      const existingPed = await db.query(
        'SELECT ped_id FROM pedidos WHERE ped_id_holded = ? LIMIT 1',
        [doc.id]
      );
      if (existingPed?.length) {
        skippedDuplicado++;
        continue;
      }

      if (opts.dryRun) {
        console.log(`   [DRY] Pedido ${doc.docNumber} → cliente ${clienteId}`);
        inserted++;
        continue;
      }

      // Insertar pedido
      const pedFecha = doc.date ? new Date(doc.date * 1000) : new Date();
      const pedNumero = doc.docNumber || await db.getNextNumeroPedido();
      const estadoTxt = mapHoldedStatus(doc.status);

      const [pedResult] = await db.pool.execute(
        `INSERT INTO pedidos (
          ped_com_id, ped_cli_id, ped_formp_id, ped_tipp_id, ped_Serie, ped_numero, ped_fecha, ped_estado_txt,
          ped_total, ped_base, ped_iva, ped_id_holded
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          1,
          clienteId,
          formpId,
          tippId,
          'A',
          pedNumero,
          pedFecha,
          estadoTxt,
          doc.total ?? 0,
          doc.subtotal ?? 0,
          doc.tax ?? 0,
          doc.id
        ]
      );

      const pedidoId = pedResult.insertId;

      // Insertar líneas (pedidos_articulos)
      const products = doc.products ?? [];
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
        const artIdFinal = Math.max(1, Number(artId) || artIdDefault);
        const articuloTxt = p.name ? String(p.name).trim() : (p.sku ? String(p.sku) : 'Producto Holded');
        const cantidad = Number(p.units) || 1;
        const pvp = Number(p.price) || 0;

        await db.pool.execute(
          `INSERT INTO pedidos_articulos (pedart_ped_id, pedart_art_id, pedart_articulo_txt, pedart_numero, pedart_cantidad, pedart_pvp)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [pedidoId, artIdFinal, articuloTxt || 'Producto', i + 1, cantidad, pvp]
        );
      }

      inserted++;
      console.log(`   ✅ ${doc.docNumber} → ped_id ${pedidoId}`);
    }

    console.log('');
    console.log('📊 Resumen:');
    console.log(`   Insertados: ${inserted}`);
    console.log(`   Omitidos (otra provincia): ${skippedProvincia}`);
    console.log(`   Omitidos (duplicado): ${skippedDuplicado}`);
    console.log(`   Omitidos (sin contacto): ${skippedSinContacto}`);
    if (errors) console.log(`   Errores: ${errors}`);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  } finally {
    try {
      if (db.pool) await db.pool.end?.();
    } catch (_) {}
  }
}

function mapHoldedStatus(status) {
  const s = Number(status);
  if (s === 0) return 'Pendiente';
  if (s === 1) return 'Enviado';
  if (s === 2) return 'Pagado';
  return 'Pendiente';
}

main();
