/**
 * Genera cláusula SQL de rango de fechas SIN DATE() para aprovechar índices BTREE.
 *
 * En columnas datetime, `DATE(col) BETWEEN ? AND ?` obliga a MySQL a evaluar fila
 * por fila (function-based → no index). Usar `col >= ? AND col < ? + INTERVAL 1 DAY`
 * permite range scan sobre el índice.
 *
 * @param {string} colExpr - Expresión de columna, ej: `p.\`ped_fecha\``
 * @param {string|null} from - Fecha inicio YYYY-MM-DD (inclusive)
 * @param {string|null} to   - Fecha fin YYYY-MM-DD (inclusive, se ajusta a < día siguiente)
 * @returns {{ sql: string, params: any[] }}
 */
function dateRange(colExpr, from, to) {
  if (from && to) {
    return { sql: `${colExpr} >= ? AND ${colExpr} < ? + INTERVAL 1 DAY`, params: [from, to] };
  }
  if (from) {
    return { sql: `${colExpr} >= ?`, params: [from] };
  }
  if (to) {
    return { sql: `${colExpr} < ? + INTERVAL 1 DAY`, params: [to] };
  }
  return { sql: '1=1', params: [] };
}

/**
 * Filtro por fecha exacta sobre columna datetime (un día completo).
 * @param {string} colExpr
 * @param {string} date - YYYY-MM-DD
 * @returns {{ sql: string, params: any[] }}
 */
function dateEquals(colExpr, date) {
  return { sql: `${colExpr} >= ? AND ${colExpr} < ? + INTERVAL 1 DAY`, params: [date, date] };
}

module.exports = { dateRange, dateEquals };
