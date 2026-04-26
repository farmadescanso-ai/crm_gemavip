/**
 * Humo EJS: views/dashboard.ejs (vista comercial) con q y datos maliciosos.
 * No requiere BD ni servidor.
 */
const path = require('path');
const ejs = require('ejs');
const { promisify } = require('util');
const { escapeHtml } = require('../../lib/utils');
const { safeJsonInline } = require('../../lib/safe-json-inline');

const renderFile = promisify(ejs.renderFile);
const viewsRoot = path.join(__dirname, '../../views');
const dashboardPath = path.join(viewsRoot, 'dashboard.ejs');

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

function dashboardLocalsComercial(overrides = {}) {
  return {
    escapeHtml,
    encodeURIComponent,
    safeJsonInline,
    fmtDateES,
    fmtEurES,
    fmtNumES: (v) => String(v ?? ''),
    user: { id: 1, nombre: PAYLOAD, email: 'smoke@test.local', roles: ['comercial'] },
    stats: {
      ventas: 100,
      pedidos: 5,
      ticketMedio: 20,
      visitas: 2,
      clientesActivos: 3
    },
    filters: {},
    latest: {
      clientes: [
        {
          Id: 1,
          Nombre_Razon_Social: PAYLOAD,
          Poblacion: PAYLOAD,
          TotalFacturado: 10,
          NumPedidos: 1,
          TicketMedio: 10,
          UltimaVisita: '2024-01-01',
          UltimoPedido: '2024-01-02'
        }
      ],
      pedidos: [
        {
          Id: 2,
          ped_id: 2,
          ClienteNombre: PAYLOAD,
          NumPedido: 'P-2',
          FechaPedido: '2024-03-01',
          TotalPedido: 50,
          EstadoPedido: PAYLOAD
        }
      ],
      visitas: [],
      proximasVisitas: []
    },
    rankingProductos: [{ Producto: PAYLOAD, Ventas: 1, Unidades: 2 }],
    desgloseEstado: [
      {
        estado: PAYLOAD,
        color: 'danger"><script>evil()',
        pedidos: 1,
        ventas: 10
      }
    ],
    rankingComerciales: [],
    rankingZona: [],
    zonas: [],
    comercialesList: [],
    marcasList: [{ mar_id: 1, mar_nombre: PAYLOAD }],
    estadosPedido: [{ estped_id: 1, estped_nombre: PAYLOAD }],
    q: PAYLOAD,
    selectedPeriodo: '',
    selectedDesde: '',
    selectedHasta: '',
    selectedEstadoId: null,
    periodoEfectivo: '',
    cspNonce: 'testnonce',
    csrfToken: '',
    navLinks: [],
    roleNavLinks: [],
    ...overrides
  };
}

describe('views/dashboard.ejs (humo XSS)', () => {
  test('q, nombre usuario, tablas y desglose estado no emiten HTML crudo', async () => {
    const html = await renderFile(dashboardPath, dashboardLocalsComercial(), {
      filename: dashboardPath,
      root: viewsRoot
    });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script>alert\s*\(\s*1\s*\)/i);
    expect(html).not.toMatch(/class="[^"]*<script/i);
    expect(html).not.toContain('src=x onerror=alert');
    expect(html).toContain('var base =');
    expect(html).toContain('/dashboard?');
  });
});
