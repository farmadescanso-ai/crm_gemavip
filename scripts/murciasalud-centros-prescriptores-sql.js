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
 * Ejemplo urls.txt:
 *   https://www.murciasalud.es/caps.php?op=mostrar_centro&id_centro=16&idsec=6
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { parseMurciaCentroHtml, buildInsertCentroPrescriptor } = require('../lib/murciasalud-centro-parse');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

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

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9',
        },
        timeout: 30000,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
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
      'Indica al menos una URL, --file urls.txt o --html fichero.html.\n' +
        'Si MurciaSalud devuelve CAPTCHA, abre la URL en el navegador, guarda la página (HTML) y usa --html.'
    );
    process.exit(1);
  }

  const chunks = [];
  for (let i = 0; i < list.length; i++) {
    const url = list[i];
    process.stderr.write(`-- GET ${url}\n`);
    let body;
    try {
      const res = await fetchUrl(url);
      if (res.status && res.status >= 400) {
        throw new Error(`HTTP ${res.status}`);
      }
      body = res.body;
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
