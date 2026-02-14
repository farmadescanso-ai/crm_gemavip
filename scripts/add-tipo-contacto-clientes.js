/**
 * Añade la columna TipoContacto (Empresa | Persona) a la tabla clientes si no existe.
 * Ejecutar una vez: node scripts/add-tipo-contacto-clientes.js
 * Requiere que la BD esté configurada (variables de entorno o config).
 */

const path = require('path');
const configPath = path.join(__dirname, '..', 'config', 'mysql-crm.js');
const db = require(configPath);

async function run() {
  try {
    const tClientes = await db._resolveTableNameCaseInsensitive('clientes');
    const cols = await db.query(`SHOW COLUMNS FROM \`${tClientes}\``);
    const colNames = (cols || []).map((r) => String(r.Field || r.field || '').trim().toLowerCase());
    if (colNames.includes('tipocontacto')) {
      console.log('La columna TipoContacto ya existe en', tClientes);
      process.exit(0);
      return;
    }
    await db.query(`ALTER TABLE \`${tClientes}\` ADD COLUMN TipoContacto VARCHAR(20) DEFAULT NULL COMMENT 'Empresa | Persona'`);
    console.log('Columna TipoContacto añadida correctamente a', tClientes);
  } catch (e) {
    console.error('Error:', e.message || e);
    process.exit(1);
  } finally {
    if (db.pool) await db.pool.end?.().catch(() => {});
  }
}

run();
