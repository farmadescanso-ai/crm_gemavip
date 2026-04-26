/**
 * Humo EJS: views/notificaciones.ejs con filas maliciosas (referencia, comercial, admin).
 * No requiere BD ni servidor.
 */
const path = require('path');
const ejs = require('ejs');
const { promisify } = require('util');
const { escapeHtml } = require('../../lib/utils');

const renderFile = promisify(ejs.renderFile);
const viewsRoot = path.join(__dirname, '../../views');
const notificacionesPath = path.join(viewsRoot, 'notificaciones.ejs');

const PAYLOAD = '<script>alert(1)</script>';

const fmtDateES = (val) => {
  if (!val) return '';
  const s = String(val);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s.slice(0, 10);
};

function notificacionesLocals(overrides = {}) {
  const pendientePedido = {
    id: 101,
    estado: 'pendiente',
    tipo: 'pedido_especial',
    id_pedido: 5001,
    id_contacto: 201,
    fecha_creacion: '2024-06-01',
    contacto_nombre: PAYLOAD,
    comercial_nombre: PAYLOAD,
    pedido_num: PAYLOAD,
    notas: '',
    id_comercial_solicitante: 9
  };
  const resuelta = {
    id: 102,
    estado: 'aprobada',
    tipo: 'asignacion_cliente',
    id_contacto: 202,
    fecha_creacion: '2024-06-02',
    fecha_resolucion: '2024-06-03',
    contacto_nombre: PAYLOAD,
    comercial_nombre: PAYLOAD,
    admin_nombre: PAYLOAD,
    id_comercial_solicitante: 10
  };
  return {
    escapeHtml,
    encodeURIComponent,
    fmtDateES,
    items: [pendientePedido, resuelta],
    paging: { total: 2, page: 1, limit: 25 },
    user: { id: 1, nombre: 'Smoke', email: 'smoke@test.local', roles: [] },
    navLinks: [],
    roleNavLinks: [],
    cspNonce: 'testnonce',
    csrfToken: '',
    notificacionesPendientes: 0,
    ...overrides
  };
}

describe('views/notificaciones.ejs (humo XSS)', () => {
  test('referencia, comercial, fechas y resuelto por no emiten <script> crudo', async () => {
    const html = await renderFile(notificacionesPath, notificacionesLocals(), {
      filename: notificacionesPath,
      root: viewsRoot
    });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script>alert\s*\(\s*1\s*\)/i);
    expect(html).not.toMatch(/class="gv-badge[^"]*<script/i);
  });

  test('borrado numérico en aviso no rompe el HTML', async () => {
    const html = await renderFile(
      notificacionesPath,
      notificacionesLocals({
        borrado: 5,
        items: []
      }),
      { filename: notificacionesPath, root: viewsRoot }
    );
    expect(html).toContain('Historial borrado:');
    expect(html).toContain('<strong>5</strong>');
  });
});
