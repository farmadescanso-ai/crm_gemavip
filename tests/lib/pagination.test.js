/**
 * Tests unitarios para lib/pagination.js
 */
const { parsePagination } = require('../../lib/pagination');

describe('parsePagination', () => {
  test('usa valores por defecto sin query', () => {
    const r = parsePagination({});
    expect(r.limit).toBe(10);
    expect(r.page).toBe(1);
    expect(r.offset).toBe(0);
  });

  test('respeta limit y page de query', () => {
    const r = parsePagination({ limit: '25', page: '3' });
    expect(r.limit).toBe(25);
    expect(r.page).toBe(3);
    expect(r.offset).toBe(50);
  });

  test('aplica maxLimit', () => {
    const r = parsePagination({ limit: '999' }, { maxLimit: 100 });
    expect(r.limit).toBe(100);
  });

  test('usa defaultLimit y defaultPage de opts', () => {
    const r = parsePagination({}, { defaultLimit: 20, defaultPage: 2 });
    expect(r.limit).toBe(20);
    expect(r.page).toBe(2);
    expect(r.offset).toBe(20);
  });

  test('offset desde query cuando useOffsetFromQuery', () => {
    const r = parsePagination({ offset: '100' }, { useOffsetFromQuery: true });
    expect(r.offset).toBe(100);
  });

  test('ignora offset de query cuando useOffsetFromQuery es false', () => {
    const r = parsePagination({ page: '2', limit: '10', offset: '999' });
    expect(r.offset).toBe(10); // (2-1)*10
  });
});
