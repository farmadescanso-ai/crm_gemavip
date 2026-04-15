/**
 * Tests para lib/cors-middleware.js
 */
const { parseAllowedOrigins } = require('../../lib/cors-middleware');

describe('parseAllowedOrigins', () => {
  const prev = process.env.CORS_ORIGINS;

  afterEach(() => {
    if (prev === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = prev;
  });

  test('sin variable devuelve lista vacía', () => {
    delete process.env.CORS_ORIGINS;
    expect(parseAllowedOrigins()).toEqual([]);
  });

  test('parsea y recorta orígenes', () => {
    process.env.CORS_ORIGINS = ' https://a.com/ , https://b.com ';
    expect(parseAllowedOrigins()).toEqual(['https://a.com', 'https://b.com']);
  });
});
