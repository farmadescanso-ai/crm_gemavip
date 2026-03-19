/**
 * Tests unitarios para lib/app-helpers.js
 * Funciones puras sin dependencias externas.
 */
const { _n, pickCI, pickNonZero, pickStr } = require('../../lib/app-helpers');

// ---------------------------------------------------------------------------
// _n  (coalesce: devuelve el primer valor "truthy" o el fallback)
// ---------------------------------------------------------------------------
describe('_n', () => {
  test('devuelve primer argumento si es truthy', () => {
    expect(_n('hola', 'fallback')).toBe('hola');
    expect(_n(42, 0)).toBe(42);
  });

  test('devuelve segundo argumento si el primero es null/undefined', () => {
    expect(_n(null, 'fb')).toBe('fb');
    expect(_n(undefined, 'fb')).toBe('fb');
  });

  test('string vacío NO es null — devuelve el string vacío', () => {
    expect(_n('', 'fb')).toBe('');
  });

  test('devuelve 0 si es valor explícito (no null/undefined)', () => {
    expect(_n(0, 99)).toBe(0);
  });

  test('devuelve null/undefined si ambos son falsy', () => {
    expect(_n(null, null)).toBe(null);
    expect(_n(undefined, undefined)).toBe(undefined);
  });
});

// ---------------------------------------------------------------------------
// pickCI  (case-insensitive pick de valor desde un objeto)
// ---------------------------------------------------------------------------
describe('pickCI', () => {
  const row = { Nombre: 'Ana', cli_email: 'ana@test.com', Edad: 30 };

  test('encuentra key exacta', () => {
    expect(pickCI(row, ['Nombre'])).toBe('Ana');
  });

  test('encuentra key case-insensitive', () => {
    expect(pickCI(row, ['nombre'])).toBe('Ana');
    expect(pickCI(row, ['CLI_EMAIL'])).toBe('ana@test.com');
  });

  test('devuelve primera coincidencia con valor', () => {
    expect(pickCI(row, ['no_existe', 'nombre'])).toBe('Ana');
  });

  test('devuelve undefined si ninguna key coincide', () => {
    expect(pickCI(row, ['foo', 'bar'])).toBeUndefined();
  });

  test('salta valores null y vacíos', () => {
    const obj = { a: null, b: '', c: 'ok' };
    expect(pickCI(obj, ['a', 'b', 'c'])).toBe('ok');
  });

  test('devuelve 0 (no lo trata como vacío)', () => {
    const obj = { precio: 0 };
    expect(pickCI(obj, ['precio'])).toBe(0);
  });

  test('maneja obj null/undefined', () => {
    expect(pickCI(null, ['a'])).toBeUndefined();
    expect(pickCI(undefined, ['a'])).toBeUndefined();
  });

  test('maneja keys vacías', () => {
    expect(pickCI(row, [])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// pickNonZero  (como pickCI pero busca primer valor numérico > 0)
// ---------------------------------------------------------------------------
describe('pickNonZero', () => {
  test('devuelve primer valor > 0', () => {
    const obj = { a: 0, b: 21, c: 10 };
    expect(pickNonZero(obj, ['a', 'b', 'c'])).toBe(21);
  });

  test('devuelve default si todos son 0', () => {
    const obj = { x: 0, y: 0 };
    expect(pickNonZero(obj, ['x', 'y'], 99)).toBe(0);
  });

  test('devuelve default si no hay coincidencias', () => {
    expect(pickNonZero({}, ['a', 'b'], 5)).toBe(5);
  });

  test('convierte string numérico', () => {
    const obj = { pvp: '12.50' };
    expect(pickNonZero(obj, ['pvp'])).toBe(12.5);
  });

  test('es case-insensitive', () => {
    const obj = { PVP: 15 };
    expect(pickNonZero(obj, ['pvp'])).toBe(15);
  });

  test('maneja obj null', () => {
    expect(pickNonZero(null, ['a'], 7)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// pickStr  (pick por nombre exacto, devuelve string trimmed)
// ---------------------------------------------------------------------------
describe('pickStr', () => {
  const row = { Nombre: '  Ana  ', Email: 'ana@test.com', Vacio: '', Nulo: null };

  test('devuelve valor trimmed', () => {
    expect(pickStr(row, ['Nombre'])).toBe('Ana');
  });

  test('salta vacíos y nulls', () => {
    expect(pickStr(row, ['Vacio', 'Nulo', 'Email'])).toBe('ana@test.com');
  });

  test('usa nombre EXACTO (no case-insensitive)', () => {
    expect(pickStr(row, ['nombre'])).toBe('');
    expect(pickStr(row, ['Nombre'])).toBe('Ana');
  });

  test('devuelve cadena vacía si no hay coincidencia', () => {
    expect(pickStr(row, ['foo', 'bar'])).toBe('');
  });

  test('maneja obj null', () => {
    expect(pickStr(null, ['a'])).toBe('');
  });

  test('convierte número a string', () => {
    const obj = { id: 42 };
    expect(pickStr(obj, ['id'])).toBe('42');
  });
});
