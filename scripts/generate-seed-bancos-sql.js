#!/usr/bin/env node
/**
 * Genera scripts/seed-bancos-es.sql desde scripts/data/bancos-es-seed.csv
 * para importar en phpMyAdmin sin Node en el servidor.
 */
const fs = require('fs');
const path = require('path');

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (!inQ && c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function escSql(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
}

function normalizeNombre(raw) {
  return String(raw || '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBic(b) {
  const u = String(b || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!u) return null;
  return u.length <= 11 ? u : u.slice(0, 11);
}

const csvPath = path.join(__dirname, 'data', 'bancos-es-seed.csv');
const text = fs.readFileSync(csvPath, 'utf8');
const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
const rows = [];
for (let i = 1; i < lines.length; i++) {
  const cols = parseCsvLine(lines[i]);
  if (cols.length < 4) continue;
  const codigo = String(cols[1] || '').replace(/\D/g, '');
  const nombre = normalizeNombre(cols[2]);
  const bic = normalizeBic(cols[3]);
  if (!/^\d{1,4}$/.test(codigo) || !nombre) continue;
  const entidad = codigo.padStart(4, '0');
  rows.push({ banco_entidad: entidad, banco_nombre: nombre, banco_swift_bic: bic });
}

// Un código de entidad solo una fila (el CSV repite 2080, etc.; gana la última aparición)
const byEnt = new Map();
for (const r of rows) {
  byEnt.set(r.banco_entidad, r);
}
const deduped = Array.from(byEnt.values()).sort((a, b) => a.banco_entidad.localeCompare(b.banco_entidad));

const outPath = path.join(__dirname, 'seed-bancos-es.sql');
let sql = `-- Seed catálogo bancos ES (misma lógica que scripts/import-bancos-es.js)
-- Importar en phpMyAdmin: base crm_gemavip → pestaña SQL → pegar y ejecutar.
-- Idempotente: si repites la ejecución, actualiza nombre y BIC.

INSERT INTO \`bancos\` (\`banco_entidad\`, \`banco_nombre\`, \`banco_swift_bic\`) VALUES
`;
sql += deduped
  .map((r) => {
    const bicVal = r.banco_swift_bic == null ? 'NULL' : `'${escSql(r.banco_swift_bic)}'`;
    return `  ('${escSql(r.banco_entidad)}', '${escSql(r.banco_nombre)}', ${bicVal})`;
  })
  .join(',\n');
sql += `
ON DUPLICATE KEY UPDATE
  \`banco_nombre\` = VALUES(\`banco_nombre\`),
  \`banco_swift_bic\` = VALUES(\`banco_swift_bic\`);
`;

fs.writeFileSync(outPath, sql, 'utf8');
console.log('Escrito', outPath, '(' + deduped.length + ' filas únicas, ' + rows.length + ' leídas del CSV)');
