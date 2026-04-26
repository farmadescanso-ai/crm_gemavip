/**
 * Humo: renderiza views/clientes.ejs con q y filas maliciosas y comprueba que no hay HTML crudo ejecutable.
 * No requiere BD ni servidor (solo EJS + plantillas).
 */
const path = require('path');
const ejs = require('ejs');
const { promisify } = require('util');
const { escapeHtml } = require('../../lib/utils');
const { formatTelefonoForDisplay, getTelefonoForHref } = require('../../lib/telefono-utils');

const renderFile = promisify(ejs.renderFile);

const viewsRoot = path.join(__dirname, '../../views');
const clientesPath = path.join(viewsRoot, 'clientes.ejs');

const PAYLOAD = '<script>alert(1)</script>';

function baseLocals(overrides = {}) {
  const maliciousRow = {
    id: 901,
    cli_id: 901,
    Id_Cial: 2,
    Nombre_Razon_Social: PAYLOAD,
    TipoContacto: 'Empresa',
    relaciones_count: 0,
    Telefono: '+34600111222',
    Email: 'a@b.com',
    NomContacto: PAYLOAD,
    ProvinciaNombre: PAYLOAD,
    EstadoClienteNombre: PAYLOAD
  };
  return {
    escapeHtml,
    encodeURIComponent,
    fmtTelefono: formatTelefonoForDisplay,
    getTelefonoForHref,
    q: PAYLOAD,
    orderNombre: 'asc',
    tipoContacto: '',
    paging: { page: 1, totalPages: 1, total: 1, limit: 25 },
    items: [maliciousRow],
    user: { id: 1, nombre: 'Smoke', email: 'smoke@test.local', roles: [] },
    admin: false,
    poolId: null,
    navLinks: [],
    roleNavLinks: [],
    cspNonce: 'testnonce',
    csrfToken: '',
    ...overrides
  };
}

describe('views/clientes.ejs (humo XSS)', () => {
  test('q reflejado y celdas de listado no emiten <script> crudo', async () => {
    const html = await renderFile(clientesPath, baseLocals(), {
      filename: clientesPath,
      root: viewsRoot
    });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script>alert\s*\(\s*1\s*\)/i);
  });

  test('email malicioso en href mailto no rompe el atributo', async () => {
    const evil = '"><img src=x onerror=alert(1)>@x.com';
    const html = await renderFile(
      clientesPath,
      baseLocals({
        items: [
          {
            id: 902,
            cli_id: 902,
            Id_Cial: 2,
            Nombre_Razon_Social: 'Legal',
            TipoContacto: 'Persona',
            relaciones_count: 0,
            Telefono: '',
            Email: evil,
            NomContacto: '—',
            ProvinciaNombre: '—',
            EstadoClienteNombre: 'OK'
          }
        ],
        q: ''
      }),
      { filename: clientesPath, root: viewsRoot }
    );
    expect(html).not.toMatch(/href="mailto:[^"]*">\s*<img/i);
    expect(html).toContain('mailto:%22%3E%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E%40x.com');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;@x.com');
  });
});
