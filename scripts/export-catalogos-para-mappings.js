/**
 * Exporta tablas de catálogo a CSV para usarlos en preparar-excel-contactos.py
 * Ejecutar: node scripts/export-catalogos-para-mappings.js
 * Requiere .env con DB_HOST, DB_USER, DB_PASSWORD, DB_NAME
 */

const path = require('path');
const fs = require('fs');
const db = require(path.join(__dirname, '..', 'config', 'mysql-crm.js'));

const MAPPINGS_DIR = path.join(__dirname, 'mappings');

function escapeCsv(val) {
  if (val == null || val === '') return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function pickCol(cols, cands) {
  if (!Array.isArray(cols)) return cands[0];
  const set = new Set(cols.map((c) => String(c).toLowerCase()));
  for (const cand of cands) {
    if (set.has(String(cand).toLowerCase())) {
      const found = cols.find((c) => String(c).toLowerCase() === String(cand).toLowerCase());
      return found || cand;
    }
  }
  return cands[0];
}

async function exportTable(name, query, columns) {
  try {
    const rows = await db.query(query);
    const list = Array.isArray(rows) ? rows : [];
    const header = columns.join(',');
    const lines = [header, ...list.map((r) => columns.map((c) => escapeCsv(r[c])).join(','))];
    const file = path.join(MAPPINGS_DIR, `${name}.csv`);
    fs.mkdirSync(MAPPINGS_DIR, { recursive: true });
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    console.log(`  ${name}.csv: ${list.length} filas`);
    return list.length;
  } catch (e) {
    console.warn(`  ${name}: error -`, e.message);
    return 0;
  }
}

async function run() {
  console.log('Exportando catálogos a scripts/mappings/...\n');

  const provCols = await db._getColumns('provincias').catch(() => []);
  const provId = pickCol(provCols, ['prov_id', 'id']);
  const provNom = pickCol(provCols, ['prov_nombre', 'Nombre']);
  await exportTable('provincias', `SELECT \`${provId}\` as id, \`${provNom}\` as nombre FROM provincias ORDER BY \`${provNom}\``, ['id', 'nombre']);

  const paisCols = await db._getColumns('paises').catch(() => []);
  const paisId = pickCol(paisCols, ['pais_id', 'id']);
  const paisCod = pickCol(paisCols, ['pais_codigo', 'Id_pais']);
  const paisNom = pickCol(paisCols, ['pais_nombre', 'Nombre_pais']);
  await exportTable('paises', `SELECT \`${paisId}\` as id, \`${paisCod}\` as codigo, \`${paisNom}\` as nombre FROM paises ORDER BY \`${paisCod}\``, ['id', 'codigo', 'nombre']);

  const idiomCols = await db._getColumns('idiomas').catch(() => []);
  const idiomId = pickCol(idiomCols, ['idiom_id', 'id']);
  const idiomNom = pickCol(idiomCols, ['idiom_nombre', 'Nombre']);
  await exportTable('idiomas', `SELECT \`${idiomId}\` as id, \`${idiomNom}\` as nombre FROM idiomas ORDER BY \`${idiomNom}\``, ['id', 'nombre']);

  const monCols = await db._getColumns('monedas').catch(() => []);
  const monId = pickCol(monCols, ['mon_id', 'id']);
  const monCod = pickCol(monCols, ['mon_codigo', 'Codigo']);
  const monNom = pickCol(monCols, ['mon_nombre', 'Nombre']);
  await exportTable('monedas', `SELECT \`${monId}\` as id, \`${monCod}\` as codigo, \`${monNom}\` as nombre FROM monedas ORDER BY \`${monCod}\``, ['id', 'codigo', 'nombre']);

  const tipcCols = await db._getColumns('tipos_clientes').catch(() => []);
  const tipcId = pickCol(tipcCols, ['tipc_id', 'id']);
  const tipcTipo = pickCol(tipcCols, ['tipc_tipo', 'Tipo']);
  await exportTable('tipos_clientes', `SELECT \`${tipcId}\` as id, \`${tipcTipo}\` as tipo FROM tipos_clientes ORDER BY \`${tipcTipo}\``, ['id', 'tipo']);

  const formpCols = await db._getColumns('formas_pago').catch(() => []);
  const formpId = pickCol(formpCols, ['formp_id', 'id']);
  const formpNom = pickCol(formpCols, ['formp_nombre', 'FormaPago']);
  await exportTable('formas_pago', `SELECT \`${formpId}\` as id, \`${formpNom}\` as nombre FROM formas_pago ORDER BY \`${formpNom}\``, ['id', 'nombre']);

  console.log('\nListo. Ejecuta: python scripts/preparar-excel-contactos.py');
}

run().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
