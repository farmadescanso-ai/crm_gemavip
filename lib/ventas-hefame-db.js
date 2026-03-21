/**
 * Acceso a BD para ventas Hefame (ventas_hefame).
 * Inserta/actualiza ventas extraídas de PDFs y consulta con filtros.
 */

const db = require('../config/mysql-crm');

/**
 * Convierte fila BD a formato compatible con buildDashboardData.
 */
function rowToVenta(row) {
  const mes = Number(row.venhef_mes) || 0;
  const año = Number(row.venhef_anio) || 0;
  const mesKey = mes && año ? `${String(mes).padStart(2, '0')}.${año}` : '';
  return {
    materialCodigo: row.venhef_material_codigo || '',
    materialDescripcion: row.venhef_material_descripcion || '',
    provinciaCodigo: row.venhef_provincia_codigo || '',
    provinciaNombre: row.venhef_provincia_nombre || '',
    mes,
    año,
    mesKey,
    cantidad: Number(row.venhef_cantidad) || 0
  };
}

const INSERT_VENTAS_CHUNK = 200;

const COLS_INSERT =
  'venhef_material_codigo, venhef_material_descripcion, venhef_provincia_codigo, venhef_provincia_nombre, venhef_mes, venhef_anio, venhef_cantidad, venhef_origen_archivo';

/**
 * Normaliza una venta a la tupla de 8 valores para INSERT, o null si no es válida.
 */
function normalizeVentaTuple(v, origenArchivo) {
  const materialCodigo = String(v.materialCodigo || '').trim().slice(0, 13);
  const provinciaCodigo = String(v.provinciaCodigo || '').trim().slice(0, 2);
  const mes = Number(v.mes) || 0;
  const año = Number(v.año) || 0;
  const cantidad = Number(v.cantidad) || 0;
  if (!materialCodigo || !provinciaCodigo || !mes || !año) return null;
  return [
    materialCodigo,
    (v.materialDescripcion || '').slice(0, 255),
    provinciaCodigo,
    (v.provinciaNombre || '').slice(0, 80),
    mes,
    año,
    cantidad,
    (origenArchivo || '').slice(0, 255)
  ];
}

async function insertVentasTuples(tuples) {
  if (!tuples.length) return;
  for (let i = 0; i < tuples.length; i += INSERT_VENTAS_CHUNK) {
    const chunk = tuples.slice(i, i + INSERT_VENTAS_CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    await db.query(
      `INSERT IGNORE INTO ventas_hefame (${COLS_INSERT}) VALUES ${placeholders}`,
      chunk.flat()
    );
  }
}

/**
 * Inserta ventas en ventas_hefame.
 * Las ventas de cada mes solo se guardan una vez: si ya existe (año, mes, provincia, artículo),
 * se ignora (INSERT IGNORE). No se modifican ventas ya subidas.
 * @param {Array} ventas - Array de { materialCodigo, materialDescripcion, provinciaCodigo, provinciaNombre, mes, año, cantidad }
 * @param {string} [origenArchivo] - Nombre del PDF de origen
 */
async function insertOrUpdateVentas(ventas, origenArchivo = null) {
  if (!ventas || ventas.length === 0) return;
  const o = (origenArchivo || '').slice(0, 255);
  const tuples = [];
  for (const v of ventas) {
    const row = normalizeVentaTuple(v, o);
    if (row) tuples.push(row);
  }
  await insertVentasTuples(tuples);
}

/**
 * Inserta ventas de varios PDFs en pocas consultas (INSERT multi-fila por trozos).
 * @param {Array<{ ventas: Array, origen: string }>} batches
 */
async function insertOrUpdateVentasMulti(batches) {
  if (!batches || batches.length === 0) return;
  const tuples = [];
  for (const batch of batches) {
    const ventas = batch?.ventas;
    const origen = (batch?.origen || '').slice(0, 255);
    if (!ventas?.length) continue;
    for (const v of ventas) {
      const row = normalizeVentaTuple(v, origen);
      if (row) tuples.push(row);
    }
  }
  await insertVentasTuples(tuples);
}

/**
 * Obtiene ventas filtradas desde la BD.
 * @param {Object} filtros - { anio, mes, provinciaCodigo, materialCodigo }
 * @returns {Promise<Object>} { ventas, materiales, provincias, meses, files }
 */
async function getVentasFiltradas(filtros = {}) {
  const conditions = [];
  const params = [];

  if (filtros.anio) {
    conditions.push('venhef_anio = ?');
    params.push(Number(filtros.anio));
  }
  if (filtros.mes) {
    conditions.push('venhef_mes = ?');
    params.push(Number(filtros.mes));
  }
  if (filtros.provinciaCodigo) {
    conditions.push('venhef_provincia_codigo = ?');
    params.push(String(filtros.provinciaCodigo).trim());
  }
  if (filtros.materialCodigo) {
    conditions.push('venhef_material_codigo = ?');
    params.push(String(filtros.materialCodigo).trim());
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const sql = `
    SELECT venhef_material_codigo, venhef_material_descripcion,
           venhef_provincia_codigo, venhef_provincia_nombre,
           venhef_mes, venhef_anio, venhef_cantidad, venhef_origen_archivo
    FROM ventas_hefame
    ${where}
    ORDER BY venhef_anio DESC, venhef_mes DESC
  `;

  const rows = await db.query(sql, params);
  const ventas = rows.map(rowToVenta);

  const materialesMap = new Map();
  const provinciasMap = new Map();
  const mesesSet = new Set();
  const filesSet = new Set();

  for (const v of ventas) {
    if (v.materialCodigo) {
      materialesMap.set(v.materialCodigo, { codigo: v.materialCodigo, descripcion: v.materialDescripcion });
    }
    if (v.provinciaCodigo) {
      provinciasMap.set(v.provinciaCodigo, { codigo: v.provinciaCodigo, nombre: v.provinciaNombre });
    }
    if (v.mesKey) mesesSet.add(v.mesKey);
  }

  const materiales = Array.from(materialesMap.values());
  const provincias = Array.from(provinciasMap.values());
  const meses = Array.from(mesesSet).sort((a, b) => {
    const [ma, aa] = a.split('.').map(Number);
    const [mb, ab] = b.split('.').map(Number);
    return aa !== ab ? aa - ab : ma - mb;
  });

  try {
    const fileSql = conditions.length
      ? `SELECT DISTINCT venhef_origen_archivo FROM ventas_hefame ${where} AND venhef_origen_archivo IS NOT NULL AND venhef_origen_archivo != ''`
      : `SELECT DISTINCT venhef_origen_archivo FROM ventas_hefame WHERE venhef_origen_archivo IS NOT NULL AND venhef_origen_archivo != ''`;
    const fileRows = await db.query(fileSql, params);
    for (const r of fileRows) {
      if (r.venhef_origen_archivo) filesSet.add(r.venhef_origen_archivo);
    }
  } catch (_) {
    // Ignorar si la query falla
  }
  const files = Array.from(filesSet);

  return {
    ventas,
    materiales,
    provincias,
    meses,
    files
  };
}

/**
 * Obtiene catálogos para poblar filtros: años, meses, provincias, materiales.
 */
async function getCatalogos() {
  const [añosRows, mesesRows, provinciasRows, materialesRows] = await Promise.all([
    db.query('SELECT DISTINCT venhef_anio AS val FROM ventas_hefame ORDER BY venhef_anio DESC'),
    db.query('SELECT DISTINCT venhef_mes AS val FROM ventas_hefame ORDER BY venhef_mes'),
    db.query('SELECT DISTINCT venhef_provincia_codigo AS codigo, venhef_provincia_nombre AS nombre FROM ventas_hefame ORDER BY venhef_provincia_nombre'),
    db.query('SELECT DISTINCT venhef_material_codigo AS codigo, venhef_material_descripcion AS descripcion FROM ventas_hefame ORDER BY venhef_material_descripcion')
  ]);

  return {
    años: (añosRows || []).map((r) => Number(r.val)).filter(Boolean).sort((a, b) => b - a),
    meses: (mesesRows || []).map((r) => Number(r.val)).filter(Boolean).sort((a, b) => a - b),
    provincias: (provinciasRows || []).map((r) => ({ codigo: r.codigo, nombre: r.nombre })).filter((p) => p.codigo),
    materiales: (materialesRows || []).map((r) => ({ codigo: r.codigo, descripcion: (r.descripcion || '').slice(0, 80) })).filter((m) => m.codigo)
  };
}

/**
 * Elimina todos los registros de ventas_hefame.
 */
async function clearAllVentas() {
  await db.query('DELETE FROM ventas_hefame');
}

module.exports = {
  insertOrUpdateVentas,
  insertOrUpdateVentasMulti,
  getVentasFiltradas,
  getCatalogos,
  clearAllVentas,
  rowToVenta
};
