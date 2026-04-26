/**
 * Humo EJS: views/articulos.ejs con búsqueda, marcas y filas maliciosas.
 * No requiere BD ni servidor.
 */
const path = require('path');
const ejs = require('ejs');
const { promisify } = require('util');
const { escapeHtml } = require('../../lib/utils');

const renderFile = promisify(ejs.renderFile);
const viewsRoot = path.join(__dirname, '../../views');
const articulosPath = path.join(viewsRoot, 'articulos.ejs');

const PAYLOAD = '<script>alert(1)</script>';

function articulosLocals(overrides = {}) {
  const malicious = {
    Id: 8001,
    art_id: 8001,
    SKU: PAYLOAD,
    art_sku: PAYLOAD,
    Nombre: PAYLOAD,
    art_nombre: PAYLOAD,
    Unidades_Caja: '12',
    art_unidades_caja: '12',
    PVL: '1.50',
    art_pvl: '1.50',
    IVA: '21',
    art_iva: '21',
    Activo: 1,
    art_activo: 1
  };
  return {
    escapeHtml,
    encodeURIComponent,
    articuloMsg: '',
    loadError: '',
    filtroMarcaFijo: false,
    marcas: [{ id: 1, mar_id: 1, nombre: PAYLOAD, mar_nombre: PAYLOAD }],
    selectedMarcaId: null,
    searchQuery: PAYLOAD,
    total: 1,
    page: 1,
    limit: 25,
    totalPages: 1,
    items: [malicious],
    admin: false,
    user: { id: 1, nombre: 'Smoke', email: 'smoke@test.local', roles: [] },
    navLinks: [],
    roleNavLinks: [],
    cspNonce: 'testnonce',
    csrfToken: '',
    ...overrides
  };
}

describe('views/articulos.ejs (humo XSS)', () => {
  test('q, opción marca y celdas de catálogo no emiten <script> crudo', async () => {
    const html = await renderFile(articulosPath, articulosLocals(), {
      filename: articulosPath,
      root: viewsRoot
    });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script>alert\s*\(\s*1\s*\)/i);
  });

  test('loadError reflejado queda escapado', async () => {
    const html = await renderFile(
      articulosPath,
      articulosLocals({
        loadError: PAYLOAD,
        searchQuery: '',
        items: []
      }),
      { filename: articulosPath, root: viewsRoot }
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script>alert\s*\(\s*1\s*\)/i);
  });
});
