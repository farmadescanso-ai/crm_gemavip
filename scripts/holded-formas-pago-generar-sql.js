#!/usr/bin/env node
/**
 * Lista las formas de pago de Holded (API) y escribe el SQL para crear filas en formas_pago
 * cuando el nombre aún no existe en el CRM.
 *
 * Uso:
 *   node scripts/holded-formas-pago-generar-sql.js
 *   node scripts/holded-formas-pago-generar-sql.js --solo-holded
 *
 * Requiere: HOLDED_API_KEY en .env
 * Con --solo-holded: no conecta a MySQL; genera INSERT para todos los nombres Holded (útil sin BD local).
 */
'use strict';

require('dotenv').config();
const path = require('path');
const projectRoot = path.resolve(__dirname, '..');
const {
  fetchHoldedPaymentMethods,
  buildFormasPagoSyncSql
} = require(path.join(projectRoot, 'lib', 'holded-payment-methods'));

async function main() {
  const soloHolded = process.argv.includes('--solo-holded');
  const apiKey = (process.env.HOLDED_API_KEY || '').trim();
  if (!apiKey) {
    console.error('❌ Falta HOLDED_API_KEY en .env');
    process.exit(1);
  }

  const holdedRows = await fetchHoldedPaymentMethods(apiKey);
  console.log(`\n📋 Holded: ${holdedRows.length} forma(s) de pago\n`);
  holdedRows.forEach((r, i) => {
    const name = r.name ?? r.nombre ?? '';
    const id = r.id ?? r._id ?? '';
    console.log(
      `  ${String(i + 1).padStart(2, '0')}. ${name || '(sin nombre)'}  [id=${id}]  dueDays=${r.dueDays ?? '—'}  bankId=${r.bankId ?? '—'}`
    );
  });

  let crmRows = [];
  if (!soloHolded) {
    const db = require(path.join(projectRoot, 'config', 'mysql-crm'));
    try {
      await db.connect();
      crmRows = await db.query('SELECT formp_id, formp_nombre FROM formas_pago ORDER BY formp_id ASC');
    } catch (e) {
      console.warn('\n⚠️  No se pudo leer formas_pago del CRM:', e.message);
      console.warn('    Usa --solo-holded o revisa DB_* en .env\n');
      process.exit(1);
    }
  }

  const sql = buildFormasPagoSyncSql(holdedRows, soloHolded ? [] : crmRows);
  console.log('\n--- SQL (copiar y ejecutar en MySQL tras revisar) ---\n');
  console.log(sql);
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
