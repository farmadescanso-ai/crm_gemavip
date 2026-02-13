#!/usr/bin/env node
/**
 * Copia la tarifa MIRAFARMA al PVL de artículos.
 * Actualiza articulos.PVL con el precio que tiene cada artículo en la tarifa MIRAFARMA
 * (tarifasClientes_precios para la tarifa cuyo nombre es MIRAFARMA).
 *
 * Uso: node tools/copy-tarifa-mirafarma-to-pvl.js
 *
 * Requiere variables de entorno de BD (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, etc.).
 */
require('dotenv').config();
const db = require('../config/mysql-crm');

async function main() {
  console.log('Copiando tarifa MIRAFARMA → PVL (articulos.PVL)...');
  try {
    await db.connect();
    const result = await db.copyTarifaMirafarmaToPvl();
    if (result.error) {
      console.error('Error:', result.error);
      process.exit(1);
    }
    console.log(`Tarifa MIRAFARMA (Id=${result.tarifaId}): ${result.updated} artículos actualizados con PVL.`);
    process.exit(0);
  } catch (e) {
    console.error(e?.message || e);
    process.exit(1);
  }
}

main();
