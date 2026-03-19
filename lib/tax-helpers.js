'use strict';

const REGIMEN_IVA  = 1;
const REGIMEN_IGIC = 2;
const REGIMEN_IPSI = 3;

const REGIMENES = {
  [REGIMEN_IVA]:  { id: REGIMEN_IVA,  codigo: 'IVA',  nombre: 'IVA',  nombreLargo: 'Impuesto sobre el Valor Añadido' },
  [REGIMEN_IGIC]: { id: REGIMEN_IGIC, codigo: 'IGIC', nombre: 'IGIC', nombreLargo: 'Impuesto General Indirecto Canario' },
  [REGIMEN_IPSI]: { id: REGIMEN_IPSI, codigo: 'IPSI', nombre: 'IPSI', nombreLargo: 'Impuesto sobre la Producción, los Servicios y la Importación' }
};

const DEFAULT_RATES = {
  [REGIMEN_IVA]:  21,
  [REGIMEN_IGIC]: 7,
  [REGIMEN_IPSI]: 4
};

/**
 * Tabla de equivalencias IVA → IGIC / IPSI.
 * Clave: porcentaje IVA peninsular → objeto con porcentaje equivalente por régimen destino.
 * Se usa como fallback rápido (sin consulta a BD).
 */
const EQUIVALENCIAS = {
  21:  { [REGIMEN_IGIC]: 7,    [REGIMEN_IPSI]: 4    },
  10:  { [REGIMEN_IGIC]: 3,    [REGIMEN_IPSI]: 2    },
  4:   { [REGIMEN_IGIC]: 0,    [REGIMEN_IPSI]: 0.5  },
  0:   { [REGIMEN_IGIC]: 0,    [REGIMEN_IPSI]: 0.5  }
};

/**
 * Determina el régimen fiscal (id) a partir de un código postal español.
 * - 35xxx / 38xxx → IGIC (Canarias)
 * - 51xxx / 52xxx → IPSI (Ceuta / Melilla)
 * - Resto         → IVA (Península + Baleares)
 */
function getRegimenByPostalCode(cp) {
  const s = String(cp || '').trim().replace(/\s/g, '');
  if (!s) return REGIMEN_IVA;
  const prefix = s.substring(0, 2);
  if (prefix === '35' || prefix === '38') return REGIMEN_IGIC;
  if (prefix === '51' || prefix === '52') return REGIMEN_IPSI;
  return REGIMEN_IVA;
}

/**
 * Dado un porcentaje de IVA peninsular y un régimen destino,
 * devuelve el porcentaje equivalente en ese régimen.
 * Si el régimen es IVA (1), devuelve el mismo porcentaje.
 */
function getEquivalentRate(ivaPct, regimenDestinoId) {
  const regId = Number(regimenDestinoId) || REGIMEN_IVA;
  if (regId === REGIMEN_IVA) return ivaPct;

  const pct = Number(ivaPct) || 0;
  const eq = EQUIVALENCIAS[pct];
  if (eq && eq[regId] !== undefined) return eq[regId];

  return DEFAULT_RATES[regId] ?? pct;
}

/**
 * Busca la equivalencia en BD (tabla equivalencias_impuesto + tipos_impuesto).
 * Fallback al mapeo estático si la consulta falla.
 * @param {object} db - Instancia con pool.execute o query
 * @param {number} ivaPct - Porcentaje IVA peninsular del artículo
 * @param {number} regimenDestinoId - regfis_id destino
 * @returns {Promise<number>} porcentaje equivalente
 */
async function getEquivalentRateFromDB(db, ivaPct, regimenDestinoId) {
  const regId = Number(regimenDestinoId) || REGIMEN_IVA;
  if (regId === REGIMEN_IVA) return ivaPct;

  try {
    const pool = db.pool || db;
    const sql = `
      SELECT td.timp_porcentaje
      FROM equivalencias_impuesto eq
      JOIN tipos_impuesto to2 ON to2.timp_id = eq.eqimp_timp_origen_id
      JOIN tipos_impuesto td  ON td.timp_id  = eq.eqimp_timp_destino_id
      WHERE to2.timp_regfis_id = 1
        AND to2.timp_porcentaje = ?
        AND td.timp_regfis_id  = ?
      LIMIT 1
    `;
    const [rows] = await pool.execute(sql, [ivaPct, regId]);
    if (rows && rows.length && rows[0].timp_porcentaje !== undefined) {
      return Number(rows[0].timp_porcentaje);
    }
  } catch (_) {
    // fallback silencioso
  }
  return getEquivalentRate(ivaPct, regId);
}

/**
 * Devuelve la etiqueta del impuesto: 'IVA', 'IGIC' o 'IPSI'.
 */
function getTaxLabel(regimenId) {
  const r = REGIMENES[Number(regimenId)];
  return r ? r.nombre : 'IVA';
}

/**
 * Devuelve el porcentaje por defecto del régimen (general).
 */
function getDefaultRate(regimenId) {
  return DEFAULT_RATES[Number(regimenId)] ?? 21;
}

/**
 * Obtiene cli_regfis_id para un cliente desde BD.
 * Fallback: calcula desde código postal si no existe la columna.
 */
async function getClienteRegimenId(db, clienteId) {
  try {
    const pool = db.pool || db;
    const [rows] = await pool.execute(
      'SELECT cli_regfis_id, cli_codigo_postal FROM clientes WHERE cli_id = ? LIMIT 1',
      [clienteId]
    );
    if (rows && rows.length) {
      const regfis = rows[0].cli_regfis_id;
      if (regfis) return Number(regfis);
      return getRegimenByPostalCode(rows[0].cli_codigo_postal);
    }
  } catch (_) {
    // tabla puede no tener aún la columna
  }
  return REGIMEN_IVA;
}

module.exports = {
  REGIMEN_IVA,
  REGIMEN_IGIC,
  REGIMEN_IPSI,
  REGIMENES,
  DEFAULT_RATES,
  EQUIVALENCIAS,
  getRegimenByPostalCode,
  getEquivalentRate,
  getEquivalentRateFromDB,
  getTaxLabel,
  getDefaultRate,
  getClienteRegimenId
};
