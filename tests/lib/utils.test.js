/**
 * Tests unitarios para lib/utils.js
 */
const { toNum, round2, escapeHtml } = require('../../lib/utils');

describe('toNum', () => {
  test('devuelve valor por defecto para null/undefined', () => {
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
    expect(toNum(null, 42)).toBe(42);
    expect(toNum(undefined, -1)).toBe(-1);
  });

  test('convierte string numérico', () => {
    expect(toNum('123')).toBe(123);
    expect(toNum(' 45 ')).toBe(45);
    expect(toNum('3,14')).toBe(3.14);
  });

  test('devuelve default para string vacío o no numérico', () => {
    expect(toNum('')).toBe(0);
    expect(toNum('   ')).toBe(0);
    expect(toNum('abc')).toBe(0);
    expect(toNum('abc', 99)).toBe(99);
  });

  test('acepta número directo', () => {
    expect(toNum(100)).toBe(100);
    expect(toNum(3.14)).toBe(3.14);
  });
});

describe('round2', () => {
  test('redondea a dos decimales', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(10.126)).toBe(10.13);
    expect(round2(0)).toBe(0);
  });
});

describe('escapeHtml', () => {
  test('devuelve cadena vacía para null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  test('escapa caracteres peligrosos', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('"hola"')).toBe('&quot;hola&quot;');
    expect(escapeHtml("a'b")).toBe('a&#39;b');
  });

  test('mantiene texto seguro', () => {
    expect(escapeHtml('Hola mundo')).toBe('Hola mundo');
  });
});
