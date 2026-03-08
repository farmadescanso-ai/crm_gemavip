#!/usr/bin/env node
/**
 * Genera una relación entre códigos de productos Holded (enero/2026) y artículos BD.
 * Ayuda a identificar qué ajustar para que coincidan los SKU.
 *
 * Uso: node scripts/relacion-codigos-holded-bd.js
 * Requiere: HOLDED_API_KEY en .env, BD configurada
 */
'use strict';

require('dotenv').config();
const axios = require('axios');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const db = require(path.join(projectRoot, 'config', 'mysql-crm'));

const HOLDED_BASE = 'https://api.holded.com/api/invoicing/v1';

function dateToUnix(dateStr) {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

async function fetchHolded(apiKey, method, path, params = {}) {
  const url = `${HOLDED_BASE}${path}`;
  const res = await axios({ method, url, headers: { key: apiKey }, params: Object.keys(params).length ? params : undefined });
  return res.data;
}

async function main() {
  const apiKey = process.env.HOLDED_API_KEY;
  if (!apiKey?.trim()) {
    console.error('❌ Falta HOLDED_API_KEY en .env');
    process.exit(1);
  }

  const startTs = dateToUnix('2026-01-01');
  const endTs = dateToUnix('2026-01-31');

  console.log('📥 Obteniendo pedidos Holded (enero 2026)...\n');

  let documents;
  try {
    documents = await fetchHolded(apiKey, 'GET', '/documents/salesorder', {
      starttmp: startTs,
      endtmp: endTs,
      sort: 'created-desc'
    });
  } catch (e) {
    console.error('❌ Error API Holded:', e?.response?.data || e.message);
    process.exit(1);
  }

  if (!Array.isArray(documents)) {
    console.error('❌ Holded no devolvió un array');
    process.exit(1);
  }

  // Extraer productos únicos de Holded (por código principal)
  const holdedProducts = new Map(); // codigo -> { name, docNumbers[], sku, code, productId }
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

  // Obtener artículos de la BD
  let articulos = [];
  try {
    await db.connect();
    articulos = await db.query(
      'SELECT art_id, art_sku, art_codigo_interno, art_ean13, art_nombre FROM articulos WHERE art_activo = 1 OR art_activo IS NULL ORDER BY art_id'
    );
  } catch (e) {
    console.error('❌ Error BD:', e.message);
    process.exit(1);
  }

  // Índices BD: por art_sku, art_codigo_interno, art_ean13
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

  // Relación: Holded -> BD
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

  // Ordenar: primero los que NO coinciden
  relacion.sort((a, b) => (a.coincide === b.coincide ? 0 : a.coincide ? 1 : -1));

  // Salida
  console.log('═'.repeat(120));
  console.log('RELACIÓN CÓDIGOS HOLDED ↔ BD (enero 2026)');
  console.log('═'.repeat(120));
  console.log('');

  const coinciden = relacion.filter(r => r.coincide);
  const noCoinciden = relacion.filter(r => !r.coincide);

  console.log(`📊 Resumen: ${relacion.length} productos únicos en Holded`);
  console.log(`   ✅ Coinciden con BD: ${coinciden.length}`);
  console.log(`   ❌ Sin coincidencia: ${noCoinciden.length}`);
  console.log('');

  if (noCoinciden.length > 0) {
    console.log('─'.repeat(120));
    console.log('❌ PRODUCTOS HOLDED SIN COINCIDENCIA EN BD (requieren ajuste)');
    console.log('─'.repeat(120));
    console.log('');
    for (const r of noCoinciden) {
      console.log(`  Código Holded: ${r.holded_codigo}`);
      console.log(`  Nombre:       ${r.holded_nombre}`);
      console.log(`  Pedidos:      ${r.pedidos}`);
      console.log(`  → Ajuste:     Añadir art_sku="${r.holded_codigo}" o art_codigo_interno="${r.holded_codigo}" en articulos, o corregir en Holded`);
      console.log('');
    }
  }

  console.log('─'.repeat(120));
  console.log('📋 TABLA COMPLETA (Holded | BD | Coincide)');
  console.log('─'.repeat(120));
  console.log('');

  const sep = ' | ';
  const h1 = 'Código Holded'.padEnd(24) + sep + 'Nombre Holded'.padEnd(40) + sep + 'art_sku BD'.padEnd(14) + sep + 'art_codigo_interno'.padEnd(20) + sep + 'art_nombre BD'.padEnd(35) + sep + 'OK';
  console.log(h1);
  console.log('-'.repeat(140));

  for (const r of relacion) {
    const cod = (r.holded_codigo || '').slice(0, 22).padEnd(24);
    const nom = (r.holded_nombre || '').slice(0, 38).padEnd(40);
    const sku = (r.bd_art_sku ?? '—').toString().slice(0, 12).padEnd(14);
    const ci = (r.bd_art_codigo_interno ?? '—').toString().slice(0, 18).padEnd(20);
    const nomBd = (r.bd_art_nombre ?? '—').toString().slice(0, 33).padEnd(35);
    const ok = r.coincide ? '✓' : '✗';
    console.log(cod + sep + nom + sep + sku + sep + ci + sep + nomBd + sep + ok);
  }

  console.log('');
  console.log('═'.repeat(120));

  // Exportar JSON para uso posterior
  const outPath = path.join(projectRoot, 'relacion-codigos-holded-bd-enero2026.json');
  const fs = require('fs');
  fs.writeFileSync(outPath, JSON.stringify({ fecha: new Date().toISOString(), periodo: '2026-01', relacion }, null, 2), 'utf8');
  console.log(`\n📁 JSON guardado en: ${outPath}`);

  try {
    if (db.pool) await db.pool.end?.();
  } catch (_) {}
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
