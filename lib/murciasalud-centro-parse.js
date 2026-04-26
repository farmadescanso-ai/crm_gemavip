/**
 * Extrae campos de ficha MurciaSalud (caps.php?op=mostrar_centro) para centros_prescriptores.
 * Teléfono: solo el primer número del H1 (troncal), nunca cita previa.
 */

const cheerio = require('cheerio');

const BLOCK_PATTERNS = [
  /radware/i,
  /captcha\s*page/i,
  /we apologize for the inconvenience/i,
  /__uzdbm_/i,
  /<title>302 Found<\/title>/i,
];

/**
 * @param {string} html
 * @returns {{ blocked: boolean, reason?: string }}
 */
function detectBlocked(html) {
  if (!html || html.length < 500) {
    const small = html || '';
    if (BLOCK_PATTERNS.some((re) => re.test(small))) {
      return { blocked: true, reason: 'Respuesta corta o anti-bot (302/Captcha/Radware).' };
    }
  }
  if (BLOCK_PATTERNS.some((re) => re.test(html))) {
    return { blocked: true, reason: 'Página de bloqueo o CAPTCHA detectada.' };
  }
  return { blocked: false };
}

/**
 * @param {string} h1
 */
function parseH1(h1) {
  const raw = (h1 || '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    throw new Error('H1 vacío: no se puede extraer la ficha del centro.');
  }

  const cpMatch = raw.match(/ - (\d{5})\.\s+/);
  if (!cpMatch) {
    throw new Error('No se encontró código postal (patrón " - NNNNN. ") en el H1.');
  }
  const codPostal = cpMatch[1];
  const beforeCp = raw.slice(0, cpMatch.index).trim();
  const afterCpDot = raw.slice(cpMatch.index + cpMatch[0].length);

  const addrRe = /\s(C\/|Avda\.?\s|Av\.|Plaza |Pl\.|P\.º|Paseo |Carretera |CTRA\.|Camino |Calle |CL\.|Urbanización |Urb\.)/i;
  const addrIdx = beforeCp.search(addrRe);
  if (addrIdx < 0) {
    throw new Error('No se pudo separar nombre y dirección en el H1 (falta tipo vía conocido).');
  }
  const nombreCentro = beforeCp.slice(0, addrIdx).trim();
  const direccion = beforeCp.slice(addrIdx).trim();

  const phoneMatch = afterCpDot.match(/(\d{3}\s+\d{2}\s+\d{2}\s+\d{2})/);
  if (!phoneMatch) {
    throw new Error('No se encontró teléfono principal (patrón NNN NN NN NN) en el H1.');
  }
  const municipioEnd = afterCpDot.indexOf(phoneMatch[0]);
  const municipio = afterCpDot.slice(0, municipioEnd).trim();
  const telefonoPrincipal = phoneMatch[1].replace(/\s+/g, ' ').trim();

  return {
    cent_Nombre_Centro: nombreCentro,
    cent_Direccion: direccion,
    cent_Cod_Postal: codPostal,
    cent_Municipio: municipio,
    cent_Poblacion: municipio,
    cent_Telefono: telefonoPrincipal,
  };
}

/**
 * @param {string} html
 * @returns {Record<string, unknown>}
 */
function parseMurciaCentroHtml(html) {
  const { blocked, reason } = detectBlocked(html);
  if (blocked) {
    const err = new Error(reason || 'Descarga bloqueada.');
    err.code = 'MURCIA_BLOCKED';
    throw err;
  }

  const $ = cheerio.load(html, { decodeEntities: true });
  const h1 = $('h1').first().text();
  const base = parseH1(h1);

  let cent_codigo = null;
  let cent_Area_Salud = null;

  $('li').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    const cod = t.match(/^Código:\s*(\d+)\s*$/i) || t.match(/Código:\s*(\d+)/i);
    if (cod) cent_codigo = parseInt(cod[1], 10);
    const area = t.match(/^Área de Salud:\s*(.+)$/i);
    if (area) {
      cent_Area_Salud = area[1].trim();
      const link = $(el).find('a').first().text().trim();
      if (link) cent_Area_Salud = link;
    }
  });

  if (cent_codigo == null || Number.isNaN(cent_codigo)) {
    throw new Error('No se encontró la viñeta «Código:» con dígitos (cent_codigo obligatorio).');
  }

  let cent_Coordinador = null;
  $('table tr').each((_, tr) => {
    if (cent_Coordinador) return;
    const rowText = $(tr).text().toUpperCase();
    if (!rowText.includes('COORDINADOR')) return;
    const firstTd = $(tr).find('td').first().text().replace(/\s+/g, ' ').trim();
    if (firstTd) cent_Coordinador = firstTd;
  });

  return {
    ...base,
    cent_codigo,
    cent_Area_Salud: cent_Area_Salud || null,
    cent_Email: null,
    cent_Coordinador,
    cent_Telf_Coordinador: null,
    cent_Email_Coordinador: null,
  };
}

function sqlString(v) {
  if (v == null) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * @param {object} row parseMurciaCentroHtml
 * @param {{ cent_Id_Ruta?: number|null }} opts
 */
function buildInsertCentroPrescriptor(row, opts = {}) {
  const ruta = opts.cent_Id_Ruta == null ? 'NULL' : Number(opts.cent_Id_Ruta);
  return `INSERT INTO \`centros_prescriptores\` (
  \`cent_Id_Ruta\`,
  \`cent_Nombre_Centro\`,
  \`cent_codigo\`,
  \`cent_Direccion\`,
  \`cent_Poblacion\`,
  \`cent_Cod_Postal\`,
  \`cent_Municipio\`,
  \`cent_Telefono\`,
  \`cent_Email\`,
  \`cent_Coordinador\`,
  \`cent_Telf_Coordinador\`,
  \`cent_Email_Coordinador\`,
  \`cent_Area_Salud\`
) VALUES (
  ${ruta},
  ${sqlString(row.cent_Nombre_Centro)},
  ${row.cent_codigo},
  ${sqlString(row.cent_Direccion)},
  ${sqlString(row.cent_Poblacion)},
  ${sqlString(row.cent_Cod_Postal)},
  ${sqlString(row.cent_Municipio)},
  ${sqlString(row.cent_Telefono)},
  NULL,
  ${sqlString(row.cent_Coordinador)},
  NULL,
  NULL,
  ${sqlString(row.cent_Area_Salud)}
);`;
}

module.exports = {
  detectBlocked,
  parseH1,
  parseMurciaCentroHtml,
  buildInsertCentroPrescriptor,
};
