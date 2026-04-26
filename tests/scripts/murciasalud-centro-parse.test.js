const fs = require('fs');
const path = require('path');
const {
  parseMurciaCentroHtml,
  parseH1,
  buildInsertCentroPrescriptor,
  detectBlocked,
} = require('../../lib/murciasalud-centro-parse');

describe('murciasalud-centro-parse', () => {
  test('detectBlocked reconoce respuesta anti-bot', () => {
    expect(detectBlocked('<html><title>302 Found</title></html>').blocked).toBe(true);
    expect(detectBlocked('<div>Captcha Page</div>').blocked).toBe(true);
  });

  test('parseH1 extrae municipio y primer teléfono del H1', () => {
    const h1 =
      'Centro de Salud Caravaca de la Cruz C/ Junquico S/N - 30400. CARAVACA DE LA CRUZ 968 70 30 11 / 968 70 30 16 / ATENCION URGENTE';
    const r = parseH1(h1);
    expect(r.cent_Nombre_Centro).toBe('Centro de Salud Caravaca de la Cruz');
    expect(r.cent_Direccion).toBe('C/ Junquico S/N');
    expect(r.cent_Cod_Postal).toBe('30400');
    expect(r.cent_Municipio).toBe('CARAVACA DE LA CRUZ');
    expect(r.cent_Telefono).toBe('968 70 30 11');
  });

  test('parseMurciaCentroHtml con fixture centro 16', () => {
    const html = fs.readFileSync(path.join(__dirname, '../fixtures/murciasalud-centro-16.html'), 'utf8');
    const row = parseMurciaCentroHtml(html);
    expect(row.cent_codigo).toBe(8011710);
    expect(row.cent_Telefono).toBe('968 70 30 11');
    expect(row.cent_Coordinador).toBe('Pascual Santos Villalba');
    expect(row.cent_Area_Salud).toContain('Noroeste');
    const sql = buildInsertCentroPrescriptor(row, { cent_Id_Ruta: null });
    expect(sql).toContain('8011710');
    expect(sql).toContain("'968 70 30 11'");
    expect(sql).not.toMatch(/968 70 24 12/);
  });
});
