const { apiHtmlUiPathRewrite } = require('../../api/middleware/vercel-path');

describe('apiHtmlUiPathRewrite', () => {
  function run(url, accept) {
    const req = { url, originalUrl: url, headers: { accept: accept || '' } };
    apiHtmlUiPathRewrite(req, {}, () => {});
    return req;
  }

  test('reescribe /api/clientes/508 a /clientes/508 (navegador)', () => {
    const req = run(
      '/api/clientes/508',
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    );
    expect(req.url).toBe('/clientes/508');
  });

  test('no reescribe /api/clientes/508 si Accept es solo JSON (API)', () => {
    const req = run('/api/clientes/508', 'application/json');
    expect(req.url).toBe('/api/clientes/508');
  });

  test('sigue reescribiendo /api/clientes/508/edit', () => {
    const req = run('/api/clientes/508/edit', 'text/html,*/*');
    expect(req.url).toBe('/clientes/508/edit');
  });
});
