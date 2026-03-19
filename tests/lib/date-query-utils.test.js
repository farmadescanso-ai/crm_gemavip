/**
 * Tests unitarios para lib/date-query-utils.js
 * Genera cláusulas SQL sin DATE() para aprovechar índices BTREE.
 */
const { dateRange, dateEquals } = require('../../lib/date-query-utils');

describe('dateRange', () => {
  test('genera rango completo con from y to', () => {
    const r = dateRange('p.`ped_fecha`', '2025-01-01', '2025-12-31');
    expect(r.sql).toBe('p.`ped_fecha` >= ? AND p.`ped_fecha` < ? + INTERVAL 1 DAY');
    expect(r.params).toEqual(['2025-01-01', '2025-12-31']);
  });

  test('genera solo >= con from', () => {
    const r = dateRange('col', '2025-06-01', null);
    expect(r.sql).toBe('col >= ?');
    expect(r.params).toEqual(['2025-06-01']);
  });

  test('genera solo < con to', () => {
    const r = dateRange('col', null, '2025-12-31');
    expect(r.sql).toBe('col < ? + INTERVAL 1 DAY');
    expect(r.params).toEqual(['2025-12-31']);
  });

  test('devuelve 1=1 sin fechas', () => {
    const r = dateRange('col', null, null);
    expect(r.sql).toBe('1=1');
    expect(r.params).toEqual([]);
  });

  test('respeta expresión de columna con backticks', () => {
    const r = dateRange('p.`ped_fecha`', '2025-01-01', '2025-01-31');
    expect(r.sql).toContain('p.`ped_fecha`');
  });
});

describe('dateEquals', () => {
  test('genera rango de un día completo', () => {
    const r = dateEquals('v.`vis_fecha`', '2025-03-15');
    expect(r.sql).toBe('v.`vis_fecha` >= ? AND v.`vis_fecha` < ? + INTERVAL 1 DAY');
    expect(r.params).toEqual(['2025-03-15', '2025-03-15']);
  });

  test('parámetros son la misma fecha repetida', () => {
    const r = dateEquals('col', '2025-12-25');
    expect(r.params[0]).toBe(r.params[1]);
  });
});
