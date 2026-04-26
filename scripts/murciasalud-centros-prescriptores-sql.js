#!/usr/bin/env node
/**
 * Genera INSERTs para centros_prescriptores desde fichas MurciaSalud.
 *
 * Uso:
 *   node scripts/murciasalud-centros-prescriptores-sql.js URL [URL2...]
 *   node scripts/murciasalud-centros-prescriptores-sql.js --file urls.txt
 *   node scripts/murciasalud-centros-prescriptores-sql.js --html ruta/guardada.html
 *
 * Opciones:
 *   --file FICHERO     Una URL por línea (# al inicio = comentario)
 *   --html FICHERO     Parsear HTML local (útil si la web devuelve CAPTCHA al script)
 *   --out FICHERO      Añadir sentencias al fichero en lugar de stdout
 *   --id-ruta N        Valor numérico para cent_Id_Ruta en todos los INSERT
 *   --delay-ms N       Pausa entre peticiones HTTP (por defecto 1500)
 *
 * Variable de entorno (útil si & en la URL se corta al usar .bat desde PowerShell):
 *   MURCIASALUD_CENTRO_URL   URL completa; si no pasas URL en la línea de órdenes ni --file, se usa esta.
 *
 * Sin argumentos: lee la primera línea útil de scripts/murciasalud-centro-url.txt (ver .example).
 * En Windows sin PowerShell: doble clic en run-murciasalud-centro-desde-archivo.cmd
 */

const fs = require('fs');
const path = require('path');
const { fetchMurciaCentroPageHtml } = require('../lib/murciasalud-centro-fetch');
const { parseMurciaCentroHtml, buildInsertCentroPrescriptor } = require('../lib/murciasalud-centro-parse');

const DEFAULT_URL_FILE = path.join(__dirname, 'murciasalud-centro-url.txt');

function readFirstUrlLineFromFile(filePath) {
  if (!fs.existsSync(filePath)) return '';
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    return t;
  }
  return '';
}

function parseArgs(argv) {
  const urls = [];
  let file = null;
  let htmlFile = null;
  let out = null;
  let idRuta = null;
  let delayMs = 1500;
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    if (a === '--file') file = rest.shift();
    else if (a === '--html') htmlFile = rest.shift();
    else if (a === '--out') out = rest.shift();
    else if (a === '--id-ruta') idRuta = parseInt(rest.shift(), 10);
    else if (a === '--delay-ms') delayMs = parseInt(rest.shift(), 10) || 1500;
    else if (a.startsWith('-')) {
      console.error('Opción desconocida:', a);
      process.exit(1);
    } else urls.push(a);
  }
  return { urls, file, htmlFile, out, idRuta: Number.isFinite(idRuta) ? idRuta : null, delayMs };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { urls, file, htmlFile, out, idRuta, delayMs } = parseArgs(process.argv.slice(2));

  let list = [...urls];
  if (file) {
    const p = path.resolve(file);
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      list.push(t);
    }
  }

  const envUrl = String(process.env.MURCIASALUD_CENTRO_URL || '').trim();
  if (!htmlFile && list.length === 0 && envUrl) {
    list.push(envUrl);
  }

  const fileUrl = !htmlFile && list.length === 0 ? readFirstUrlLineFromFile(DEFAULT_URL_FILE) : '';
  if (fileUrl) {
    list.push(fileUrl);
  }

  if (htmlFile) {
    const abs = path.resolve(htmlFile);
    const html = fs.readFileSync(abs, 'utf8');
    let row;
    try {
      row = parseMurciaCentroHtml(html);
    } catch (e) {
      console.error(String(e.message || e));
      process.exit(1);
    }
    const sql = `-- fuente: ${abs}\n${buildInsertCentroPrescriptor(row, { cent_Id_Ruta: idRuta })}\n`;
    if (out) fs.appendFileSync(path.resolve(out), sql, 'utf8');
    else process.stdout.write(sql);
    return;
  }

  if (!list.length) {
    console.error(
      'Indica al menos una URL, --file urls.txt, --html fichero.html, MURCIASALUD_CENTRO_URL o el fichero:\n' +
        `  ${DEFAULT_URL_FILE}\n` +
        '(copia scripts/murciasalud-centro-url.example.txt a ese nombre y deja una linea con la URL).\n' +
        'Si MurciaSalud devuelve CAPTCHA al script, guarda la ficha como HTML y usa --html.\n' +
        'Sin PowerShell: doble clic en run-murciasalud-centro-desde-archivo.cmd en la raiz del CRM.'
    );
    process.exit(1);
  }

  const chunks = [];
  for (let i = 0; i < list.length; i++) {
    const url = list[i];
    process.stderr.write(`-- GET ${url}\n`);
    let body;
    try {
      body = await fetchMurciaCentroPageHtml(url);
    } catch (e) {
      console.error(`ERROR fetch: ${url}\n`, e.message || e);
      process.exitCode = 1;
      continue;
    }
    let row;
    try {
      row = parseMurciaCentroHtml(body);
    } catch (e) {
      console.error(`ERROR parse: ${url}\n`, e.message || e);
      if (e.code === 'MURCIA_BLOCKED') {
        console.error(
          'Sugerencia: guarda la página desde el navegador como HTML y ejecuta con --html ruta/al/archivo.html'
        );
      }
      process.exitCode = 1;
      continue;
    }
    const sql = `-- ${url}\n${buildInsertCentroPrescriptor(row, { cent_Id_Ruta: idRuta })}\n`;
    chunks.push(sql);
    if (i < list.length - 1) await sleep(delayMs);
  }

  const outText = chunks.join('\n');
  if (out) fs.appendFileSync(path.resolve(out), outText, 'utf8');
  else process.stdout.write(outText);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
