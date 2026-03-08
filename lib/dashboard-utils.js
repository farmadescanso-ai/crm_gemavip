/**
 * Utilidades para el dashboard CRM (Admin y Comercial).
 * Periodos, rangos de fechas y helpers de filtros.
 */

const PERIOD_OPTIONS = [
  { value: 'acumulado', label: 'Acumulado Anual' },
  { value: 'mes', label: 'Mes Actual' },
  { value: 'semana', label: 'Semana Actual' }
];

/**
 * Obtiene el rango de fechas según año y periodo.
 * @param {number|string} year - Año (o 'all' para todo)
 * @param {string} period - 'acumulado' | 'mes' | 'semana'
 * @returns {{ from: string|null, to: string|null, label: string }}
 */
function getDateRangeFromPeriod(year, period) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const y = year === 'all' || year === 'todos' ? currentYear : Number(year);
  const yearNum = Number.isFinite(y) ? y : currentYear;

  if (period === 'semana') {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return {
      from: monday.toISOString().slice(0, 10),
      to: sunday.toISOString().slice(0, 10),
      label: `Semana ${monday.getDate()}/${monday.getMonth() + 1} - ${sunday.getDate()}/${sunday.getMonth() + 1}`
    };
  }

  if (period === 'mes') {
    const month = now.getMonth();
    const from = new Date(yearNum, month, 1);
    const to = new Date(yearNum, month + 1, 0);
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      label: `Mes ${month + 1}/${yearNum}`
    };
  }

  // acumulado: 01/01 hasta hoy (o 31/12 si año pasado)
  const from = `${yearNum}-01-01`;
  const isCurrentYear = yearNum === currentYear;
  const to = isCurrentYear
    ? now.toISOString().slice(0, 10)
    : `${yearNum}-12-31`;
  return {
    from,
    to,
    label: isCurrentYear ? `Acumulado hasta hoy` : `Año ${yearNum} completo`
  };
}

/**
 * Parsea los query params del dashboard.
 * @param {object} query - req.query
 * @param {boolean} isAdmin - Si es admin (más filtros)
 */
function parseDashboardFilters(query, isAdmin) {
  const year = String(query?.year || '').trim().toLowerCase();
  const period = String(query?.period || 'acumulado').trim().toLowerCase();
  const zone = String(query?.zone || '').trim();
  const comercial = String(query?.comercial || '').trim();
  const marca = String(query?.marca || '').trim();
  const pedidoEstado = String(query?.pedidoEstado || 'todos').trim().toLowerCase();

  const filters = {
    year: year === 'all' || year === 'todos' ? 'all' : year,
    period: ['acumulado', 'mes', 'semana'].includes(period) ? period : 'acumulado',
    zone: zone || null,
    comercial: comercial || null,
    marca: marca || null,
    pedidoEstado: ['todos', 'pendiente', 'entregado', 'cancelado'].includes(pedidoEstado) ? pedidoEstado : 'todos'
  };

  if (!isAdmin) {
    filters.zone = null;
    filters.comercial = null;
  }

  return filters;
}

/**
 * Construye el objeto { from, to } para consultas SQL.
 * Si year es 'all', from/to son null (sin filtro de fecha).
 */
function getSqlDateRange(filters) {
  if (filters.year === 'all') {
    return { from: null, to: null };
  }
  const range = getDateRangeFromPeriod(filters.year, filters.period);
  return { from: range.from, to: range.to };
}

module.exports = {
  PERIOD_OPTIONS,
  getDateRangeFromPeriod,
  parseDashboardFilters,
  getSqlDateRange
};
