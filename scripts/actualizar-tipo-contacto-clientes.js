/**
 * Actualiza TipoContacto de todos los clientes según DNI_CIF:
 * - CIF (empresa) → Empresa
 * - DNI/NIE (persona) → Persona
 * - Sin DNI/CIF o no válido → Otros
 *
 * Ejecutar: node scripts/actualizar-tipo-contacto-clientes.js
 * Requiere BD configurada y columna TipoContacto existente.
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'config', 'mysql-crm.js'));

function getDniCif(row) {
  if (!row) return '';
  return String(row.DNI_CIF ?? row.DniCif ?? row.dni_cif ?? row.DNI_Cif ?? '').trim();
}

function getPk(row, pk) {
  if (!row) return null;
  const id = row[pk] ?? row.Id ?? row.id;
  return id != null ? Number(id) : null;
}

async function run() {
  try {
    const meta = await db._ensureClientesMeta();
    const { tClientes, pk, colTipoContacto } = meta;
    if (!colTipoContacto) {
      console.log('La tabla clientes no tiene columna TipoContacto. Ejecuta antes add-tipo-contacto-clientes.js o la sentencia ALTER TABLE.');
      process.exit(1);
    }

    const rows = await db.query(`SELECT \`${pk}\`, DNI_CIF FROM \`${tClientes}\``).catch(() => []);
    const list = Array.isArray(rows) ? rows : [];
    let updated = 0;
    let errors = 0;

    for (const row of list) {
      const id = getPk(row, pk);
      if (id == null) continue;
      const dniCif = getDniCif(row);
      const tipo = db._getTipoContactoFromDniCif(dniCif);
      try {
        await db.query(`UPDATE \`${tClientes}\` SET \`${colTipoContacto}\` = ? WHERE \`${pk}\` = ?`, [tipo, id]);
        updated++;
        if (updated <= 5 || updated % 500 === 0) {
          console.log(`  ${id} → ${tipo}${dniCif ? ' (' + (dniCif.length > 12 ? dniCif.slice(0, 9) + '...' : dniCif) + ')' : ''}`);
        }
      } catch (e) {
        errors++;
        console.error(`  Error id ${id}:`, e.message || e);
      }
    }

    console.log('');
    console.log('Resumen: %d clientes actualizados, %d errores.', updated, errors);
  } catch (e) {
    console.error('Error:', e.message || e);
    process.exit(1);
  } finally {
    if (db.pool) await db.pool.end?.().catch(() => {});
  }
}

run();
