#!/usr/bin/env node
/**
 * Exporta contactos Holded tipo client/lead con tag `crm` (igual que CPanel).
 *
 * Salidas:
 *   Por defecto: Excel (.xlsx) con todos los campos aplanados.
 *   --md          : Markdown (.md) con tabla resumen + detalle JSON por contacto.
 *
 * Uso:
 *   node scripts/export-holded-contactos-crm-excel.js
 *   node scripts/export-holded-contactos-crm-excel.js --md
 *   node scripts/export-holded-contactos-crm-excel.js --md --out docs/mi-listado.md
 *
 * Requiere: HOLDED_API_KEY en .env (sin BD).
 */

'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { fetchHolded } = require('../lib/holded-api');
const {
  filterHoldedContactsClienteOLead,
  filterHoldedContactsConTagCrm,
  normalizeHoldedTags
} = require('../lib/holded-sync');

function normalizeHoldedContactsResponse(contacts) {
  let list = Array.isArray(contacts) ? contacts : [];
  if (!list.length && contacts && typeof contacts === 'object') {
    const alt = contacts.contacts || contacts.data || contacts.items || contacts.results;
    if (Array.isArray(alt)) list = alt;
  }
  return list;
}

async function fetchAllHoldedContacts(apiKey) {
  const byId = new Map();
  let page = 1;
  const maxPages = 500;
  while (page <= maxPages) {
    const data = await fetchHolded('/contacts', { page }, apiKey);
    const list = normalizeHoldedContactsResponse(data);
    if (!list.length) break;
    let newCount = 0;
    for (const c of list) {
      const id = String(c?.id ?? c?._id ?? '').trim();
      if (!id) continue;
      if (!byId.has(id)) {
        byId.set(id, c);
        newCount++;
      }
    }
    if (newCount === 0) break;
    page++;
  }
  return [...byId.values()];
}

function flattenContact(obj) {
  const flat = {};
  function walk(val, prefix) {
    if (val === null || val === undefined) {
      flat[prefix || '_'] = '';
      return;
    }
    if (val instanceof Date) {
      flat[prefix] = val.toISOString();
      return;
    }
    if (Array.isArray(val)) {
      flat[prefix] = JSON.stringify(val);
      return;
    }
    if (typeof val !== 'object') {
      flat[prefix] = val;
      return;
    }
    const keys = Object.keys(val);
    if (keys.length === 0) {
      flat[prefix] = '{}';
      return;
    }
    for (const k of keys) {
      const p = prefix ? `${prefix}.${k}` : k;
      walk(val[k], p);
    }
  }
  walk(obj, '');
  const tagsArr = normalizeHoldedTags(obj);
  flat._tags_joined = tagsArr.join(', ');
  return flat;
}

function escapeMdCell(s) {
  if (s === null || s === undefined) return '';
  let t = String(s);
  t = t.replace(/\|/g, '\\|');
  t = t.replace(/\r?\n/g, ' ');
  return t.length > 500 ? t.slice(0, 497) + '…' : t;
}

function buildMarkdown(conCrm) {
  const iso = new Date().toISOString();
  const lines = [];
  lines.push('# Listado contactos Holded (client / lead, tag `crm`)');
  lines.push('');
  lines.push(`- **Generado:** ${iso}`);
  lines.push(`- **Total registros:** ${conCrm.length}`);
  lines.push('');
  lines.push('## Tabla resumen');
  lines.push('');
  lines.push(
    '| # | id | name | type | code | email | mobile | phone | tags (Holded) |'
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  conCrm.forEach((c, i) => {
    const tags = normalizeHoldedTags(c).join(', ');
    lines.push(
      `| ${i + 1} | ${escapeMdCell(c.id ?? c._id)} | ${escapeMdCell(c.name ?? '')} | ${escapeMdCell(c.type ?? '')} | ${escapeMdCell(c.code ?? '')} | ${escapeMdCell(c.email ?? '')} | ${escapeMdCell(c.mobile ?? '')} | ${escapeMdCell(c.phone ?? '')} | ${escapeMdCell(tags)} |`
    );
  });
  lines.push('');
  lines.push('## Detalle por contacto (JSON completo API)');
  lines.push('');
  conCrm.forEach((c, i) => {
    const title = String(c.name || c.tradeName || c.id || i + 1).replace(/\r|\n/g, ' ');
    lines.push(`### ${i + 1}. ${title}`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(c, null, 2));
    lines.push('```');
    lines.push('');
  });
  lines.push(
    '*Para una vista tipo hoja de cálculo con columnas aplanadas (`billAddress.city`, etc.), usa el export Excel o pide el mismo script sin `--md`.*'
  );
  return lines.join('\n');
}

function parseArgs() {
  const a = process.argv.slice(2);
  let out = null;
  let asMd = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--md') asMd = true;
    if (a[i] === '--out' && a[i + 1]) {
      out = a[i + 1];
      i++;
    }
  }
  return { out, asMd };
}

async function main() {
  const apiKey = (process.env.HOLDED_API_KEY || '').trim();
  if (!apiKey) {
    console.error('Falta HOLDED_API_KEY en .env');
    process.exit(1);
  }

  const { out: outArg, asMd } = parseArgs();
  console.log('Descargando contactos Holded (paginado)...');
  const all = await fetchAllHoldedContacts(apiKey);
  console.log(`Total contactos API: ${all.length}`);

  const tipoOk = filterHoldedContactsClienteOLead(all);
  const conCrm = filterHoldedContactsConTagCrm(tipoOk);
  console.log(`Tras filtro client|lead: ${tipoOk.length}`);
  console.log(`Tras filtro tag crm: ${conCrm.length}`);

  const flats = conCrm.map((c) => flattenContact(c));
  const keySet = new Set();
  for (const f of flats) {
    for (const k of Object.keys(f)) keySet.add(k);
  }
  const columns = [...keySet].sort((a, b) => {
    const order = (k) => {
      if (k === 'id') return 0;
      if (k === '_tags_joined') return 1;
      return 2;
    };
    const d = order(a) - order(b);
    return d !== 0 ? d : a.localeCompare(b, 'es');
  });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  if (asMd) {
    const defaultMd = path.join(__dirname, '..', 'exports', `holded-contactos-crm-${stamp}.md`);
    let outPath = outArg ? path.resolve(process.cwd(), outArg) : defaultMd;
    if (outPath.endsWith('.xlsx')) outPath = outPath.replace(/\.xlsx$/i, '.md');
    if (!outPath.endsWith('.md')) outPath += '.md';
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const md = buildMarkdown(conCrm);
    fs.writeFileSync(outPath, md, 'utf8');
    console.log(`Markdown: ${outPath}`);
    console.log(`Registros: ${conCrm.length}`);
    return;
  }

  const defaultOut = path.join(__dirname, '..', 'exports', `holded-contactos-crm-${stamp}.xlsx`);
  const outPath = outArg ? path.resolve(process.cwd(), outArg) : defaultOut;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM Gemavip · export Holded';
  wb.created = new Date();

  const ws = wb.addWorksheet('Holded_crm', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  ws.columns = columns.map((key) => ({
    header: key.length > 255 ? key.slice(0, 252) + '...' : key,
    key,
    width: Math.min(48, Math.max(10, Math.min(key.length + 2, 60)))
  }));

  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' }
  };

  for (const f of flats) {
    const row = {};
    for (const col of columns) {
      const v = f[col];
      if (v === null || v === undefined) row[col] = '';
      else if (typeof v === 'object') row[col] = JSON.stringify(v);
      else row[col] = v;
    }
    ws.addRow(row);
  }

  await wb.xlsx.writeFile(outPath);
  console.log(`Filas escritas: ${flats.length}`);
  console.log(`Columnas: ${columns.length}`);
  console.log(`Archivo: ${outPath}`);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
