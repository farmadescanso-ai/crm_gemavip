/**
 * Añade el tipo de cliente "Otro" a la tabla tipos_clientes si no existe.
 * Ejecutar una vez: node scripts/add-tipo-cliente-otro.js
 * Requiere que la BD esté configurada (variables de entorno o config).
 */

const path = require('path');
const configPath = path.join(__dirname, '..', 'config', 'mysql-crm.js');
const db = require(configPath);

async function run() {
  try {
    const tTipos = await db._resolveTableNameCaseInsensitive('tipos_clientes');
    const cols = await db._getColumns(tTipos);
    const pk = db._pickCIFromColumns(cols, ['tipc_id', 'id', 'Id']) || 'tipc_id';
    const colTipo = db._pickCIFromColumns(cols, ['tipc_tipo', 'Tipo', 'tipo']) || 'tipc_tipo';

    const existing = await db.query(
      `SELECT \`${pk}\` FROM \`${tTipos}\` WHERE \`${colTipo}\` = ? LIMIT 1`,
      ['Otro']
    );
    if (existing && existing.length > 0) {
      console.log('El tipo de cliente "Otro" ya existe en', tTipos);
      process.exit(0);
      return;
    }

    await db.query(`INSERT INTO \`${tTipos}\` (\`${colTipo}\`) VALUES (?)`, ['Otro']);
    console.log('Tipo de cliente "Otro" añadido correctamente a', tTipos);
  } catch (e) {
    console.error('Error:', e.message || e);
    process.exit(1);
  } finally {
    if (db.pool) await db.pool.end?.().catch(() => {});
  }
}

run();
