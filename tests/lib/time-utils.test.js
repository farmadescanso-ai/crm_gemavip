/**
 * Tests unitarios para lib/time-utils.js
 */
const { addMinutesHHMM } = require('../../lib/time-utils');

describe('addMinutesHHMM', () => {
  test('suma minutos correctamente', () => {
    expect(addMinutesHHMM('09:00', 30)).toBe('09:30');
    expect(addMinutesHHMM('09:30', 30)).toBe('10:00');
    expect(addMinutesHHMM('14:45', 15)).toBe('15:00');
    expect(addMinutesHHMM('08:00', 90)).toBe('09:30');
  });

  test('envuelve a medianoche', () => {
    expect(addMinutesHHMM('23:30', 60)).toBe('00:30');
    expect(addMinutesHHMM('23:59', 1)).toBe('00:00');
  });

  test('acepta hora con 1 dígito', () => {
    expect(addMinutesHHMM('9:00', 30)).toBe('09:30');
  });

  test('funciona con 0 minutos', () => {
    expect(addMinutesHHMM('10:15', 0)).toBe('10:15');
  });

  test('devuelve cadena vacía para formato inválido', () => {
    expect(addMinutesHHMM('', 30)).toBe('');
    expect(addMinutesHHMM(null, 30)).toBe('');
    expect(addMinutesHHMM(undefined, 30)).toBe('');
    expect(addMinutesHHMM('abc', 30)).toBe('');
  });

  test('hora > 23 envuelve con módulo (no valida rango)', () => {
    expect(addMinutesHHMM('25:00', 30)).toBe('01:30');
  });

  test('devuelve cadena vacía si minutos es null', () => {
    expect(addMinutesHHMM('10:00', null)).toBe('10:00');
  });

  test('formato de salida siempre 2 dígitos', () => {
    const result = addMinutesHHMM('01:05', 0);
    expect(result).toBe('01:05');
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
});
