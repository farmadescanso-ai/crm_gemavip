/**
 * Helper de paginación centralizado.
 * Extrae limit, page y offset de req.query con valores por defecto y límites.
 *
 * @param {object} query - req.query (o objeto con limit, page, offset)
 * @param {object} opts - Opciones
 * @param {number} [opts.defaultLimit=20] - Límite por defecto
 * @param {number} [opts.maxLimit=200] - Límite máximo permitido
 * @param {number} [opts.defaultPage=1] - Página por defecto
 * @param {boolean} [opts.useOffsetFromQuery=false] - Si true, usa offset de query cuando se pasa explícitamente
 * @returns {{ limit: number, page: number, offset: number }}
 */
function parsePagination(query, opts = {}) {
  const defaultLimit = opts.defaultLimit ?? 20;
  const maxLimit = opts.maxLimit ?? 200;
  const defaultPage = opts.defaultPage ?? 1;
  const useOffsetFromQuery = opts.useOffsetFromQuery ?? false;

  const limit = Math.max(1, Math.min(maxLimit, Number(query?.limit) || defaultLimit));
  const page = Math.max(1, Number(query?.page) || defaultPage);

  let offset;
  if (useOffsetFromQuery && (query?.offset !== undefined && query?.offset !== '')) {
    offset = Math.max(0, Number(query.offset));
  } else {
    offset = (page - 1) * limit;
  }

  return { limit, page, offset };
}

module.exports = { parsePagination };
