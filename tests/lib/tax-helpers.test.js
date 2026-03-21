/**
 * Tests unitarios para lib/tax-helpers.js
 */
const {
  REGIMEN_IVA,
  REGIMEN_IGIC,
  REGIMEN_IPSI,
  REGIMENES,
  DEFAULT_RATES,
  getRegimenByPostalCode,
  getEquivalentRate,
  getEquivalentRateFromDB,
  getTaxLabel,
  getDefaultRate,
  getClienteRegimenId
} = require('../../lib/tax-helpers');

describe('getRegimenByPostalCode', () => {
  test('vacío o null → IVA', () => {
    expect(getRegimenByPostalCode('')).toBe(REGIMEN_IVA);
    expect(getRegimenByPostalCode(null)).toBe(REGIMEN_IVA);
    expect(getRegimenByPostalCode(undefined)).toBe(REGIMEN_IVA);
  });

  test('35xxx / 38xxx → IGIC', () => {
    expect(getRegimenByPostalCode('35001')).toBe(REGIMEN_IGIC);
    expect(getRegimenByPostalCode('38 000')).toBe(REGIMEN_IGIC);
  });

  test('51xxx / 52xxx → IPSI', () => {
    expect(getRegimenByPostalCode('51001')).toBe(REGIMEN_IPSI);
    expect(getRegimenByPostalCode('52006')).toBe(REGIMEN_IPSI);
  });

  test('resto peninsular / Baleares → IVA', () => {
    expect(getRegimenByPostalCode('28001')).toBe(REGIMEN_IVA);
    expect(getRegimenByPostalCode('07001')).toBe(REGIMEN_IVA);
  });

  test('normaliza espacios', () => {
    expect(getRegimenByPostalCode('  35 001  ')).toBe(REGIMEN_IGIC);
  });
});

describe('getEquivalentRate', () => {
  test('régimen IVA devuelve el mismo porcentaje', () => {
    expect(getEquivalentRate(21, REGIMEN_IVA)).toBe(21);
    expect(getEquivalentRate(10, REGIMEN_IVA)).toBe(10);
  });

  test('mapeos estáticos IVA → IGIC / IPSI', () => {
    expect(getEquivalentRate(21, REGIMEN_IGIC)).toBe(7);
    expect(getEquivalentRate(21, REGIMEN_IPSI)).toBe(4);
    expect(getEquivalentRate(10, REGIMEN_IGIC)).toBe(3);
    expect(getEquivalentRate(4, REGIMEN_IPSI)).toBe(0.5);
    expect(getEquivalentRate(0, REGIMEN_IPSI)).toBe(0.5);
  });

  test('régimen destino inválido se trata como IVA', () => {
    expect(getEquivalentRate(15, NaN)).toBe(15);
    expect(getEquivalentRate(15, null)).toBe(15);
  });

  test('IVA desconocido usa DEFAULT_RATES del régimen destino', () => {
    expect(getEquivalentRate(99, REGIMEN_IGIC)).toBe(DEFAULT_RATES[REGIMEN_IGIC]);
    expect(getEquivalentRate(99, REGIMEN_IPSI)).toBe(DEFAULT_RATES[REGIMEN_IPSI]);
  });
});

describe('getTaxLabel', () => {
  test('devuelve nombre corto por id conocido', () => {
    expect(getTaxLabel(REGIMEN_IVA)).toBe('IVA');
    expect(getTaxLabel(REGIMEN_IGIC)).toBe('IGIC');
    expect(getTaxLabel(REGIMEN_IPSI)).toBe('IPSI');
  });

  test('id desconocido → IVA por defecto', () => {
    expect(getTaxLabel(999)).toBe('IVA');
    expect(getTaxLabel(null)).toBe('IVA');
  });
});

describe('getDefaultRate', () => {
  test('por régimen', () => {
    expect(getDefaultRate(REGIMEN_IVA)).toBe(21);
    expect(getDefaultRate(REGIMEN_IGIC)).toBe(7);
    expect(getDefaultRate(REGIMEN_IPSI)).toBe(4);
  });

  test('desconocido → 21', () => {
    expect(getDefaultRate(999)).toBe(21);
  });
});

describe('REGIMENES y constantes exportadas', () => {
  test('REGIMENES tiene entradas coherentes', () => {
    expect(REGIMENES[REGIMEN_IVA].codigo).toBe('IVA');
    expect(REGIMENES[REGIMEN_IGIC].nombreLargo).toContain('Canario');
    expect(DEFAULT_RATES[REGIMEN_IVA]).toBe(21);
  });
});

describe('getEquivalentRateFromDB', () => {
  test('régimen IVA no consulta BD', async () => {
    const db = { execute: jest.fn() };
    const r = await getEquivalentRateFromDB(db, 21, REGIMEN_IVA);
    expect(r).toBe(21);
    expect(db.execute).not.toHaveBeenCalled();
  });

  test('fila BD devuelve timp_porcentaje', async () => {
    const pool = {
      execute: jest.fn().mockResolvedValue([[{ timp_porcentaje: 6.5 }]])
    };
    const r = await getEquivalentRateFromDB({ pool }, 21, REGIMEN_IGIC);
    expect(r).toBe(6.5);
    expect(pool.execute).toHaveBeenCalled();
  });

  test('sin filas hace fallback a getEquivalentRate', async () => {
    const pool = { execute: jest.fn().mockResolvedValue([[]]) };
    const r = await getEquivalentRateFromDB({ pool }, 21, REGIMEN_IGIC);
    expect(r).toBe(7);
  });

  test('error en execute hace fallback silencioso', async () => {
    const pool = { execute: jest.fn().mockRejectedValue(new Error('fail')) };
    const r = await getEquivalentRateFromDB({ pool }, 10, REGIMEN_IPSI);
    expect(r).toBe(2);
  });

  test('acepta db como pool directo', async () => {
    const execute = jest.fn().mockResolvedValue([[{ timp_porcentaje: 3 }]]);
    const r = await getEquivalentRateFromDB({ execute }, 10, REGIMEN_IGIC);
    expect(r).toBe(3);
  });
});

describe('getClienteRegimenId', () => {
  test('cli_regfis_id presente', async () => {
    const pool = {
      execute: jest.fn().mockResolvedValue([[{ cli_regfis_id: 2, cli_codigo_postal: '35001' }]])
    };
    const r = await getClienteRegimenId({ pool }, 1);
    expect(r).toBe(2);
  });

  test('sin regfis usa código postal', async () => {
    const pool = {
      execute: jest.fn().mockResolvedValue([[{ cli_regfis_id: null, cli_codigo_postal: '35001' }]])
    };
    const r = await getClienteRegimenId({ pool }, 1);
    expect(r).toBe(REGIMEN_IGIC);
  });

  test('sin filas → IVA por defecto', async () => {
    const pool = { execute: jest.fn().mockResolvedValue([[]]) };
    const r = await getClienteRegimenId({ pool }, 99);
    expect(r).toBe(REGIMEN_IVA);
  });

  test('error en execute → IVA', async () => {
    const pool = { execute: jest.fn().mockRejectedValue(new Error('no column')) };
    const r = await getClienteRegimenId({ pool }, 1);
    expect(r).toBe(REGIMEN_IVA);
  });
});
