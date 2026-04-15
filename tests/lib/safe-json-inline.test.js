'use strict';

const { safeJsonInline } = require('../../lib/safe-json-inline');

describe('safeJsonInline', () => {
  test('escapa < para no cerrar script', () => {
    const s = safeJsonInline({ x: '</script><script>alert(1)</script>' });
    expect(s).not.toMatch(/<\/script/i);
    expect(s).toContain('\\u003c');
  });

  test('null y arrays', () => {
    expect(safeJsonInline(null)).toBe('null');
    expect(JSON.parse(safeJsonInline([1, 2]))).toEqual([1, 2]);
  });
});
