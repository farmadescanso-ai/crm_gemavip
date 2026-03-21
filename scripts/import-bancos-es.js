#!/usr/bin/env node
/**
 * Importa el catálogo bancos ES desde scripts/data/bancos-es-seed.csv
 * (origen: relación código entidad / nombre / BIC, formato CSV id,codigo,nombre,bic).
 *
 * Uso: node scripts/import-bancos-es.js
 * Requiere .env con DB_* (igual que otras migraciones).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

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

async function run() {
  const csvPath = path.join(__dirname, 'data', 'bancos-es-seed.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('No existe', csvPath);
    process.exit(1);
  }
  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const header = lines[0].toLowerCase();
  if (!header.includes('codigo') || !header.includes('bic')) {
    console.error('CSV inesperado: cabecera', lines[0]);
    process.exit(1);
  }

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

  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'crm_gemavip'
  };

  const conn = await mysql.createConnection(config);
  try {
    const sql = `
      INSERT INTO \`bancos\` (\`banco_entidad\`, \`banco_nombre\`, \`banco_swift_bic\`)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        \`banco_nombre\` = VALUES(\`banco_nombre\`),
        \`banco_swift_bic\` = VALUES(\`banco_swift_bic\`)
    `;
    let n = 0;
    for (const r of rows) {
      await conn.execute(sql, [r.banco_entidad, r.banco_nombre, r.banco_swift_bic]);
      n++;
    }
    console.log('Importación bancos ES:', n, 'filas procesadas.');
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
