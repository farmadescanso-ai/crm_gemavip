/**
 * Humo EJS: views/pedidos.ejs con q y fila maliciosa.
 * No requiere BD ni servidor.
 */
const path = require('path');
const ejs = require('ejs');
const { promisify } = require('util');
const { escapeHtml, toNum, round2 } = require('../../lib/utils');
const { safeJsonInline } = require('../../lib/safe-json-inline');

const renderFile = promisify(ejs.renderFile);
const viewsRoot = path.join(__dirname, '../../views');
const pedidosPath = path.join(viewsRoot, 'pedidos.ejs');

const PAYLOAD = '<script>alert(1)</script>';

const fmtDateES = (val) => {
  if (!val) return '';
  const s = String(val);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s.slice(0, 10);
};
const fmtEurES = (v) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return '0,00€';
  return `${x.toFixed(2)}€`;
};

function pedidosLocals(overrides = {}) {
  const maliciousPed = {
    Id: 7001,
    ped_id: 7001,
    Id_Cial: 99,
    ped_com_id: 99,
    FechaPedido: '2024-06-01',
    TotalPedido: 10,
    ClienteNombre: PAYLOAD,
    EstadoPedidoNombre: 'Pendiente revisión',
    EstadoColor: 'danger"><img src=x onerror=alert(1)>',
    NumPedido: 'N-99',
    TipoClienteNombre: PAYLOAD,
    ProvinciaNombre: PAYLOAD,
    ComercialNombre: PAYLOAD,
    NumPedidoCliente: 'REF"><x',
    NombreMayorista: PAYLOAD,
    NumAsociadoMayorista: 'A1'
  };
  return {
    escapeHtml,
    encodeURIComponent,
    safeJsonInline,
    toNum,
    round2,
    fmtDateES,
    fmtEurES,
    items: [maliciousPed],
    paging: { total: 0, page: 1, limit: 10 },
    q: PAYLOAD,
    marcas: [{ id: 1, nombre: PAYLOAD, Nombre: PAYLOAD }],
    estadosPedido: [],
    comercialesList: [],
    admin: false,
    userId: 1,
    user: { id: 1, nombre: 'Smoke', email: 'smoke@test.local', roles: [] },
    selectedMarcaId: null,
    selectedPeriodo: '',
    selectedDesde: '',
    selectedHasta: '',
    selectedEstadoId: undefined,
    selectedComercialId: undefined,
    selectedYear: new Date().getFullYear(),
    navLinks: [],
    roleNavLinks: [],
    cspNonce: 'testnonce',
    csrfToken: '',
    ...overrides
  };
}

describe('views/pedidos.ejs (humo XSS)', () => {
  test('q y celdas de listado no emiten <script>alert crudo; opción marca escapada', async () => {
    const html = await renderFile(pedidosPath, pedidosLocals(), {
      filename: pedidosPath,
      root: viewsRoot
    });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script>alert\s*\(\s*1\s*\)/i);
    expect(html).not.toMatch(/class="[^"]*<script/i);
    expect(html).not.toContain('src=x onerror=alert');
  });
});
