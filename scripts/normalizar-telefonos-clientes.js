#!/usr/bin/env node
/**
 * Normaliza todos los teléfonos de clientes en la BD.
 * Guarda en formato: +34610721369 (sin espacios).
 * Vista muestra: +34 610 721 369
 *
 * España (+34), Portugal (+351) y otros prefijos de 3 dígitos.
 *
 * Uso: node scripts/normalizar-telefonos-clientes.js [--dry-run] [--apply]
 *   --dry-run: solo muestra qué se cambiaría
 *   --apply: ejecuta las actualizaciones
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runNormalizarTelefonosClientes } = require('../lib/normalizar-telefonos-clientes');

const DRY_RUN = process.argv.includes('--dry-run');
const APPLY = process.argv.includes('--apply');

async function main() {
  if (!APPLY && !DRY_RUN) {
    console.log('Uso: node scripts/normalizar-telefonos-clientes.js [--dry-run] [--apply]');
    console.log('  --dry-run  Solo muestra qué se cambiaría');
    console.log('  --apply    Ejecuta las actualizaciones en BD');
    process.exit(1);
  }

  try {
    const result = await runNormalizarTelefonosClientes({ dryRun: !APPLY });

    if (!result.ok) {
      console.error('Error:', result.error || 'Error desconocido');
      process.exit(1);
    }

    if (result.updates.length === 0 && (!result.failed || result.failed.length === 0)) {
      console.log('✓ No hay teléfonos que normalizar.');
      process.exit(0);
    }

    if (result.updates.length > 0) {
      console.log(`Encontrados ${result.updates.length} cliente(s) con teléfonos a normalizar.\n`);
      for (const u of result.updates) {
        console.log(`  cli_id ${u.id}:`);
        if (u.telBefore !== u.telAfter) {
          console.log(`    Teléfono: "${u.telBefore}" → "${u.telAfter}"`);
        }
        if (u.movBefore !== u.movAfter) {
          console.log(`    Móvil:    "${u.movBefore}" → "${u.movAfter}"`);
        }
      }
      if (APPLY) {
        console.log(`\n✓ Actualizados ${result.updated} cliente(s).`);
      } else {
        console.log('\nModo --dry-run: no se aplicaron cambios. Usa --apply para ejecutar.');
      }
    }

    if (result.failed && result.failed.length > 0) {
      console.log('\n--- INFORME: Registros no normalizables ---');
      console.log('ID\tNombre\tTeléfono\tMóvil');
      for (const f of result.failed) {
        console.log(`${f.id}\t${(f.nombre || '').replace(/\t/g, ' ')}\t${f.telefono || ''}\t${f.movil || ''}`);
      }
      console.log(`\nTotal: ${result.failed.length} registro(s) con teléfonos que no se pudieron normalizar.`);
    }

    process.exit(0);
  } catch (e) {
    console.error('Error:', e?.message || e);
    process.exit(1);
  }
}

main();
