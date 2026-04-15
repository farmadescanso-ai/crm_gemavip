/**
 * Reglas de query GET /api/clientes — sin levantar el servidor.
 */
const { listClientesQuery, suggestQuery, buscarQuery } = require('../../lib/validators/api-clientes-query');

function mockReq(queryObj) {
  return { query: queryObj };
}

async function runChain(chain, req) {
  for (const rule of chain) {
    await rule.run(req);
  }
  const { validationResult } = require('express-validator');
  return validationResult(req);
}

describe('api-clientes-query validators', () => {
  test('listClientesQuery acepta q corto y límites válidos', async () => {
    const req = mockReq({ q: 'farmacia', limit: '50', page: '1' });
    const r = await runChain(listClientesQuery, req);
    expect(r.isEmpty()).toBe(true);
  });

  test('listClientesQuery rechaza limit fuera de rango', async () => {
    const req = mockReq({ limit: '99999' });
    const r = await runChain(listClientesQuery, req);
    expect(r.isEmpty()).toBe(false);
  });

  test('suggestQuery rechaza force inválido', async () => {
    const req = mockReq({ force: '2' });
    const r = await runChain(suggestQuery, req);
    expect(r.isEmpty()).toBe(false);
  });

  test('buscarQuery acepta exclude numérico', async () => {
    const req = mockReq({ q: 'ab', exclude: '12' });
    const r = await runChain(buscarQuery, req);
    expect(r.isEmpty()).toBe(true);
  });
});
