/**
 * Genera un Excel con clientes: ID BD, Holded ID, forma de pago (CRM), tipo de pedido (último pedido),
 * teléfono, móvil y tags.
 *
 * Nota: la API de contacto Holded no expone "forma de pago por defecto"; se usa la del cliente en CRM (cli_formp_id).
 *
 * Uso:
 *   node scripts/export-clientes-holded-excel.js
 *   node scripts/export-clientes-holded-excel.js --todos
 *   node scripts/export-clientes-holded-excel.js --out exports/mi-listado.xlsx
 */

'use strict';

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const db = require(path.join(__dirname, '..', 'config', 'mysql-crm.js'));

function parseArgs() {
  const a = process.argv.slice(2);
  let soloHolded = true;
  let out = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--todos') soloHolded = false;
    if (a[i] === '--out' && a[i + 1]) {
      out = a[i + 1];
      i++;
    }
  }
  return { soloHolded, out };
}

async function main() {
  const { soloHolded, out: outArg } = parseArgs();
  try {
    if (!db.connected && !db.pool) await db.connect();
  } catch (e) {
    console.error('BD:', e.message);
    process.exit(1);
  }

  const whereHolded = soloHolded
    ? "WHERE (c.cli_Id_Holded IS NOT NULL AND TRIM(c.cli_Id_Holded) <> '')"
    : '';

  const sql = `
    SELECT
      c.cli_id AS cli_id,
      NULLIF(TRIM(COALESCE(c.cli_Id_Holded, c.cli_referencia, '')), '') AS holded_id,
      fp.formp_nombre AS forma_pago_crm,
      tp.tipp_tipo AS tipo_pedido_ultimo,
      NULLIF(TRIM(COALESCE(c.cli_telefono, c.Telefono, '')), '') AS telefono,
      NULLIF(TRIM(COALESCE(c.cli_movil, c.Movil, '')), '') AS movil,
      NULLIF(TRIM(COALESCE(c.cli_tags, '')), '') AS tags
    FROM clientes c
    LEFT JOIN formas_pago fp ON fp.formp_id = c.cli_formp_id
    LEFT JOIN pedidos p_ult ON p_ult.ped_id = (
      SELECT p2.ped_id
      FROM pedidos p2
      WHERE p2.ped_cli_id = c.cli_id
      ORDER BY p2.ped_fecha DESC, p2.ped_id DESC
      LIMIT 1
    )
    LEFT JOIN tipos_pedidos tp ON tp.tipp_id = p_ult.ped_tipp_id
    ${whereHolded}
    ORDER BY c.cli_id ASC
  `;

  let rows;
  try {
    rows = await db.query(sql);
  } catch (e) {
    console.error('Query error:', e.message);
    process.exit(1);
  }

  const list = Array.isArray(rows) ? rows : [];

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const defaultOut = path.join(__dirname, '..', 'exports', `clientes-holded-${stamp}.xlsx`);
  const outPath = outArg ? path.resolve(process.cwd(), outArg) : defaultOut;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM Gemavip';
  wb.created = new Date();

  const ws = wb.addWorksheet('Clientes', {
    views: [{ state: 'frozen', ySplit: 2 }]
  });

  ws.columns = [
    { header: 'cli_id (BD)', key: 'cli_id', width: 12 },
    { header: 'holded_id', key: 'holded_id', width: 28 },
    { header: 'FormaPago_CRM', key: 'forma_pago_crm', width: 28 },
    { header: 'TipoPedido_ultimoPedido', key: 'tipo_pedido_ultimo', width: 28 },
    { header: 'Telefono', key: 'telefono', width: 18 },
    { header: 'Movil', key: 'movil', width: 18 },
    { header: 'Tags', key: 'tags', width: 40 }
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' }
  };

  for (const r of list) {
    ws.addRow({
      cli_id: r.cli_id,
      holded_id: r.holded_id ?? '',
      forma_pago_crm: r.forma_pago_crm ?? '',
      tipo_pedido_ultimo: r.tipo_pedido_ultimo ?? '',
      telefono: r.telefono ?? '',
      movil: r.movil ?? '',
      tags: r.tags ?? ''
    });
  }

  ws.insertRow(1, []);
  ws.mergeCells(1, 1, 1, 7);
  const note = ws.getCell(1, 1);
  note.value =
    'FormaPago_CRM = forma de pago del cliente en el CRM (cli_formp_id). La API de contacto Holded no incluye un campo equivalente. ' +
    'TipoPedido = tipo del último pedido (por fecha). ' +
    (soloHolded ? 'Solo clientes con cli_Id_Holded; use --todos para todos.' : 'Todos los clientes.');
  note.font = { italic: true, size: 10 };
  note.alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(1).height = 40;

  await wb.xlsx.writeFile(outPath);
  console.log(`Filas: ${list.length}`);
  console.log(`Archivo: ${outPath}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
