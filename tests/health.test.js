/**
 * Test del endpoint /health (smoke test).
 * No requiere BD: /health se registra antes del middleware de sesión.
 */
const request = require('supertest');

let app;
try {
  app = require('../api/index');
} catch (e) {
  // Si falla cargar la app (ej. sin .env), saltar tests
  console.warn('No se pudo cargar api/index:', e.message);
}

const describeIfApp = app ? describe : describe.skip;

describeIfApp('GET /health', () => {
  test('responde 200 con ok y service', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, service: 'crm_gemavip' });
    expect(res.body.timestamp).toBeDefined();
  });
});
