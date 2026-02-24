/**
 * Helpers para rutas de pedidos (líneas, Excel, Hefame, búsqueda).
 */

const fs = require('fs').promises;
const path = require('path');
const ExcelJS = require('exceljs');
const { _n } = require('./app-helpers');
const { toNum: toNumUtil } = require('./utils');
const { escapeHtml: escapeHtmlUtil } = require('./utils');

function tokenizeSmartQuery(input, _nFn = _n) {
  const q = String(input || '').trim();
  if (!q) return { tokens: [], terms: [] };

  const tokens = [];
  const re = /(^|\s)(-?)([a-zA-Z_ñÑáéíóúüÁÉÍÓÚÜ]+)\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;
  let rest = q;
  let m;
  while ((m = re.exec(q)) !== null) {
    const neg = m[2] === '-';
    const fieldRaw = String(m[3] || '').trim();
    const field = fieldRaw.toLowerCase();
    const value = String(_nFn(_nFn(_nFn(m[4], m[5]), m[6]), '')).trim();
    if (field && value) tokens.push({ field, value, neg });
    rest = rest.replace(m[0], ' ');
  }

  const terms = [];
  const s = rest.trim();
  if (s) {
    const tRe = /"([^"]+)"|'([^']+)'|([^\s]+)/g;
    let tm;
    while ((tm = tRe.exec(s)) !== null) {
      const v = String(_nFn(_nFn(_nFn(tm[1], tm[2]), tm[3]), '')).trim();
      if (v) terms.push(v);
    }
  }

  return { tokens, terms };
}

function parseLineasFromBody(body) {
  const raw = _n(_n(body && body.lineas, body && body.Lineas), []);
  const arr = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
  const lineas = [];
  for (const l of (arr || [])) {
    const item = l && typeof l === 'object' ? l : {};
    const idArt = Number(_n(_n(_n(item.Id_Articulo, item.id_articulo), item.ArticuloId), 0)) || 0;
    const cantidad = Number(String(_n(_n(item.Cantidad, item.Unidades), 0)).replace(',', '.')) || 0;
    let dto = undefined;
    if (item.Dto !== undefined) {
      const s = String(_n(item.Dto, '')).trim();
      if (s !== '') {
        const n = Number(String(s).replace(',', '.'));
        if (Number.isFinite(n)) dto = n;
      }
    }
    let precioUnit = undefined;
    if (item.PrecioUnitario !== undefined || item.Precio !== undefined) {
      const s = String(_n(_n(item.PrecioUnitario, item.Precio), '')).trim();
      if (s !== '') {
        const n = Number(String(s).replace(',', '.'));
        if (Number.isFinite(n)) precioUnit = n;
      }
    }
    if (!idArt || cantidad <= 0) continue;
    const clean = { Id_Articulo: idArt, Cantidad: cantidad };
    if (dto !== undefined) clean.Dto = dto;
    if (precioUnit !== undefined) clean.PrecioUnitario = precioUnit;
    lineas.push(clean);
  }
  return lineas;
}

async function canShowHefameForPedido(db, item) {
  const idFormaPago = Number(_n(_n(item && item.Id_FormaPago, item && item.id_forma_pago), 0));
  const idTipoPedido = Number(_n(_n(item && item.Id_TipoPedido, item && item.id_tipo_pedido), 0));
  const [formaPago, tipos] = await Promise.all([
    idFormaPago ? db.getFormaPagoById(idFormaPago).catch(() => null) : null,
    db.getTiposPedido().catch(() => [])
  ]);
  const tipo = _n((tipos || []).find((t) => Number(_n(t.id, t.Id)) === idTipoPedido), null);
  const formaPagoNombre = String(_n(_n(_n(formaPago && formaPago.FormaPago, formaPago && formaPago.Nombre), formaPago && formaPago.nombre), '')).trim();
  const tipoNombre = String(_n(_n(_n(tipo && tipo.Tipo, tipo && tipo.Nombre), tipo && tipo.nombre), '')).trim();
  return /transfer/i.test(formaPagoNombre) && /hefame/i.test(tipoNombre);
}

async function isTransferPedido(db, item) {
  const idFormaPago = Number(_n(_n(item && item.Id_FormaPago, item && item.id_forma_pago), 0));
  if (!idFormaPago) return false;
  const formaPago = await db.getFormaPagoById(idFormaPago).catch(() => null);
  const formaPagoNombre = String(_n(_n(_n(formaPago && formaPago.FormaPago, formaPago && formaPago.Nombre), formaPago && formaPago.nombre), '')).trim();
  return /transfer/i.test(formaPagoNombre);
}

function renderHefameInfoPage(ok, details, pedidoId) {
  const color = ok ? '#2563eb' : '#dc2626';
  const downloadLink = pedidoId
    ? `<p style="margin-top:20px;"><a href="/pedidos/${pedidoId}/hefame.xlsx" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Descargar plantilla Excel Hefame</a></p>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Export Hefame · CRM Gemavip</title></head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;background:#f3f4f6;">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:24px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <h2 style="margin:0 0 12px;font-size:18px;color:${color};">Export Hefame</h2>
    <div style="white-space:pre-wrap;word-break:break-word;color:#374151;margin:8px 0;line-height:1.5;">${escapeHtmlUtil(details)}</div>
    ${downloadLink}
  </div>
</body></html>`;
}

async function buildStandardPedidoXlsxBuffer({ item, id, lineas, cliente, direccionEnvio, fmtDateES }) {
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const dtoPedidoPct = Math.max(0, Math.min(100, toNumUtil(_n(_n(item.Dto, item.Descuento), 0), 0)));

  const numPedido = String(_n(_n(_n(item && item.NumPedido, item && item.Num_Pedido), item && item.Numero_Pedido), '')).trim();
  const safeNum = (numPedido || `pedido_${id}`).replace(/[^a-zA-Z0-9_-]+/g, '_');

  const wbNew = new ExcelJS.Workbook();
  wbNew.creator = 'CRM Gemavip';
  wbNew.created = new Date();

  const ws = wbNew.addWorksheet('Pedido', {
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.31, right: 0.31, top: 0.35, bottom: 0.35, header: 0.2, footer: 0.2 }
    }
  });

  ws.columns = [
    { key: 'codigo', width: 12 },
    { key: 'concepto', width: 42 },
    { key: 'pvl', width: 11 },
    { key: 'unds', width: 9 },
    { key: 'dto', width: 9 },
    { key: 'subtotal', width: 13 },
    { key: 'iva', width: 9 },
    { key: 'total', width: 13 }
  ];

  const thin = { style: 'thin', color: { argb: 'FFD1D5DB' } };
  const boxBorder = { top: thin, left: thin, bottom: thin, right: thin };
  const titleFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

  ws.mergeCells('A1:D5');
  ws.mergeCells('E1:H5');
  const cLeft = ws.getCell('A1');
  cLeft.value = 'GEMAVIP ESPAÑA SL.\nB19427004\nCALLE DE LA SEÑA 2\nCARTAGENA (30201), Murcia, España\npedidosespana@gemavip.com · +34 686 48 36 84';
  cLeft.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  cLeft.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF0F172A' } };

  const cRight = ws.getCell('E1');
  const fecha = fmtDateES ? fmtDateES(_n(_n(item.FechaPedido, item.Fecha), '')) : '';
  const entrega = item?.FechaEntrega && fmtDateES ? fmtDateES(item.FechaEntrega) : '';
  const numPedidoCliente = String(_n(_n(item && item.NumPedidoCliente, item && item.Num_Pedido_Cliente), '')).trim();
  cRight.value =
    `PEDIDO #${numPedido || id}\n` +
    `Fecha: ${fecha || ''}\n` +
    (entrega ? `Entrega: ${entrega}\n` : '') +
    (numPedidoCliente ? `Nº Pedido Cliente: ${numPedidoCliente}\n` : '');
  cRight.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  cRight.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FF0F172A' } };

  ws.getRow(6).height = 6;

  ws.mergeCells('A7:D12');
  ws.mergeCells('E7:H12');
  const clienteNombre = cliente?.Nombre_Razon_Social || cliente?.Nombre || '';
  const clienteCif = cliente?.DNI_CIF || cliente?.DniCif || '';
  const clienteDir = cliente?.Direccion || '';
  const clientePob = cliente?.Poblacion || '';
  const clienteCp = cliente?.CodigoPostal || '';
  const clienteEmail = cliente?.Email || '';
  const clienteTel = cliente?.Telefono || cliente?.Movil || '';

  const a1 = ws.getCell('A7');
  a1.value =
    `CLIENTE\n` +
    `${clienteNombre || item?.Id_Cliente || ''}\n` +
    (clienteCif ? `${clienteCif}\n` : '') +
    (clienteDir ? `${clienteDir}\n` : '') +
    ([clienteCp, clientePob].filter(Boolean).join(' ') ? `${[clienteCp, clientePob].filter(Boolean).join(' ')}\n` : '') +
    ([clienteEmail, clienteTel].filter(Boolean).join(' · ') ? `${[clienteEmail, clienteTel].filter(Boolean).join(' · ')}` : '');
  a1.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  a1.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F172A' } };

  const b1 = ws.getCell('E7');
  const dir = direccionEnvio || null;
  const envioTitle = 'DIRECCIÓN DE ENVÍO';
  b1.value =
    `${envioTitle}\n` +
    (dir
      ? [
          dir.Alias || dir.Nombre_Destinatario || clienteNombre || '—',
          dir.Nombre_Destinatario && dir.Alias ? dir.Nombre_Destinatario : '',
          dir.Direccion || '',
          dir.Direccion2 || '',
          [dir.CodigoPostal, dir.Poblacion].filter(Boolean).join(' '),
          dir.Pais || '',
          [dir.Email, dir.Telefono, dir.Movil].filter(Boolean).join(' · '),
          dir.Observaciones || ''
        ]
          .filter(Boolean)
          .join('\n')
      : `${clienteNombre || '—'}\n(Sin dirección de envío)`);
  b1.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  b1.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F172A' } };

  for (const addr of ['A7', 'E7']) {
    ws.getCell(addr).border = boxBorder;
    ws.getCell(addr).fill = titleFill;
  }
  const boxRanges = [
    { r1: 7, c1: 1, r2: 12, c2: 4 },
    { r1: 7, c1: 5, r2: 12, c2: 8 }
  ];
  for (const rg of boxRanges) {
    for (let r = rg.r1; r <= rg.r2; r++) {
      for (let c = rg.c1; c <= rg.c2; c++) {
        const cell = ws.getCell(r, c);
        const b = {};
        if (r === rg.r1) b.top = thin;
        if (r === rg.r2) b.bottom = thin;
        if (c === rg.c1) b.left = thin;
        if (c === rg.c2) b.right = thin;
        cell.border = { ...(cell.border || {}), ...b };
      }
    }
  }

  ws.getRow(13).height = 6;

  const headerRowNum = 14;
  const header = ws.getRow(headerRowNum);
  header.values = ['CÓDIGO', 'CONCEPTO', 'PVL', 'UNDS', 'DTO', 'SUBTOTAL', 'IVA', 'TOTAL'];
  header.height = 18;
  header.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F172A' } };
    cell.fill = titleFill;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = boxBorder;
  });
  header.getCell(3).alignment = { vertical: 'middle', horizontal: 'right' };
  header.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' };
  header.getCell(5).alignment = { vertical: 'middle', horizontal: 'right' };
  header.getCell(6).alignment = { vertical: 'middle', horizontal: 'right' };
  header.getCell(7).alignment = { vertical: 'middle', horizontal: 'right' };
  header.getCell(8).alignment = { vertical: 'middle', horizontal: 'right' };

  let rowNum = headerRowNum + 1;
  let sumBase = 0;
  let sumIva = 0;
  let sumTotal = 0;

  const moneyFmt = '#,##0.00"€"';
  const pctFmt = '0.00"%"';

  (Array.isArray(lineas) ? lineas : []).forEach((l) => {
    const codigo = String(_n(_n(_n(_n(l.SKU, l.Codigo), l.Id_Articulo), l.id_articulo), '')).trim();
    const concepto = String(_n(_n(_n(_n(l.Nombre, l.Descripcion), l.Articulo), l.nombre), '')).trim();
    const qty = Math.max(0, toNumUtil(_n(_n(l.Cantidad, l.Unidades), 0), 0));
    const pvl = Math.max(0, toNumUtil(_n(_n(_n(_n(_n(_n(_n(l.Linea_PVP, l.PVP), l.pvp), l.PrecioUnitario), l.PVL), l.Precio), l.pvl), 0), 0));
    const dto = Math.max(0, Math.min(100, toNumUtil(_n(_n(_n(_n(_n(_n(l.Linea_Dto, l.DtoLinea), l.dto_linea), l.Dto), l.dto), l.Descuento), 0), 0)));
    let ivaPct = toNumUtil(_n(_n(_n(_n(_n(l.Linea_IVA, l.IVA), l.PorcIVA), l.PorcentajeIVA), l.TipoIVA), 0), 0);
    if (ivaPct > 100) ivaPct = 0;

    const baseCalc = round2(qty * pvl * (1 - dto / 100) * (1 - dtoPedidoPct / 100));
    const ivaCalc = round2(baseCalc * ivaPct / 100);
    const totalCalc = round2(baseCalc + ivaCalc);

    sumBase += baseCalc;
    sumIva += ivaCalc;
    sumTotal += totalCalc;

    const r = ws.getRow(rowNum++);
    r.getCell(1).value = codigo || '';
    r.getCell(2).value = concepto || '';
    r.getCell(3).value = pvl || null;
    r.getCell(4).value = qty || null;
    r.getCell(5).value = dto || null;
    r.getCell(6).value = baseCalc || null;
    r.getCell(7).value = ivaPct || null;
    r.getCell(8).value = totalCalc || null;

    r.getCell(2).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    for (const c of [1, 3, 4, 5, 6, 7, 8]) {
      r.getCell(c).alignment = { vertical: 'top', horizontal: c === 1 ? 'left' : 'right', wrapText: false };
    }
    r.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF111827' } };
      cell.border = boxBorder;
    });
    r.getCell(3).numFmt = moneyFmt;
    r.getCell(6).numFmt = moneyFmt;
    r.getCell(8).numFmt = moneyFmt;
    r.getCell(5).numFmt = pctFmt;
    r.getCell(7).numFmt = pctFmt;
  });

  const totalsStart = rowNum + 1;
  ws.getRow(totalsStart).height = 6;
  const tRow1 = ws.getRow(totalsStart + 1);
  tRow1.getCell(6).value = 'BASE IMPONIBLE';
  tRow1.getCell(8).value = round2(sumBase);
  tRow1.getCell(8).numFmt = moneyFmt;
  const tRow2 = ws.getRow(totalsStart + 2);
  tRow2.getCell(6).value = 'IVA';
  tRow2.getCell(8).value = round2(sumIva);
  tRow2.getCell(8).numFmt = moneyFmt;
  const tRow3 = ws.getRow(totalsStart + 3);
  tRow3.getCell(6).value = 'TOTAL';
  tRow3.getCell(8).value = round2(sumTotal);
  tRow3.getCell(8).numFmt = moneyFmt;

  const styleTotals = (r) => {
    [6, 7, 8].forEach((c) => {
      const cell = r.getCell(c);
      cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF0F172A' } };
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    });
    r.getCell(6).alignment = { vertical: 'middle', horizontal: 'right' };
    r.getCell(8).font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FF0F172A' } };
  };
  styleTotals(tRow1);
  styleTotals(tRow2);
  styleTotals(tRow3);

  if (dtoPedidoPct) {
    const tRow0 = ws.getRow(totalsStart);
    tRow0.getCell(6).value = 'DTO PEDIDO';
    tRow0.getCell(8).value = dtoPedidoPct;
    tRow0.getCell(8).numFmt = pctFmt;
    styleTotals(tRow0);
    tRow0.getCell(8).font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF0F172A' } };
  }

  const endRow = totalsStart + 3;
  ws.pageSetup.printArea = `A1:H${endRow}`;

  const buf = await wbNew.xlsx.writeBuffer();
  return { buf: Buffer.from(buf), filename: `PEDIDO_${safeNum}.xlsx` };
}

async function buildHefameXlsxBuffer({ item, id, lineas, cliente }) {
  const numPedido = String(_n(_n(_n(item && item.NumPedido, item && item.Num_Pedido), item && item.Numero_Pedido), '')).trim();

  const hefameTemplatePath =
    process.env.HEFAME_EXCEL_TEMPLATE_PATH ||
    path.join(__dirname, '..', 'templates', 'PLANTILLA TRANSFER DIRECTO CRM.xlsx');

  let wb;
  try {
    await fs.access(hefameTemplatePath);
    wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(hefameTemplatePath);
  } catch (e) {
    console.warn('Plantilla Hefame no encontrada:', hefameTemplatePath, e?.message);
    return { ok: false, status: 404, error: 'Plantilla Excel Hefame no encontrada. Coloca PLANTILLA TRANSFER DIRECTO CRM.xlsx en templates/.' };
  }

  if (!wb || !wb.worksheets || wb.worksheets.length === 0) {
    return { ok: false, status: 500, error: 'Plantilla Hefame sin hojas.' };
  }

  const ws = wb.worksheets[0];

  const todayDDMMYYYY = () => {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  };

  const valorF5 = numPedido || todayDDMMYYYY();
  const nombre = cliente?.Nombre_Razon_Social || cliente?.Nombre || item?.Id_Cliente || '';
  const codigoHefame = String(_n(_n(item && item.NumAsociadoHefame, item && item.num_asociado_hefame), '')).trim();
  const telefono = cliente?.Telefono || cliente?.Movil || cliente?.Teléfono || '';
  const cp = String(_n(cliente && cliente.CodigoPostal, '')).trim();
  const poblacion = String(_n(cliente && cliente.Poblacion, '')).trim();
  const poblacionConCP = [cp, poblacion].filter(Boolean).join(' ');

  try {
    ws.getCell('F5').value = valorF5;
    ws.getCell('C13').value = nombre;
    ws.getCell('C14').value = codigoHefame;
    ws.getCell('C15').value = telefono;
    ws.getCell('C16').value = poblacionConCP;
  } catch (e) {
    console.warn('Hefame Excel: error escribiendo cabecera', e?.message);
  }

  const lineasArr = Array.isArray(lineas) ? lineas : [];
  const firstDataRow = 21;
  lineasArr.forEach((l, idx) => {
    const row = firstDataRow + idx;
    const cantidad = Math.max(0, toNumUtil(_n(_n(l.Cantidad, l.Unidades), 0), 0));
    const cn = String(_n(_n(_n(_n(l.SKU, l.Codigo), l.Id_Articulo), l.id_articulo), '')).trim();
    const descripcion = String(_n(_n(_n(_n(l.Nombre, l.Descripcion), l.Articulo), l.nombre), '')).trim();
    const descuentoPct = Math.max(0, Math.min(100, toNumUtil(_n(_n(_n(_n(_n(l.Linea_Dto, l.DtoLinea), l.Dto), l.dto), l.Descuento), 0), 0)));
    const descuentoExcel = descuentoPct / 100;

    try {
      ws.getRow(row).getCell(2).value = cantidad;
      ws.getRow(row).getCell(3).value = cn;
      ws.getRow(row).getCell(4).value = descripcion;
      ws.getRow(row).getCell(5).value = descuentoExcel;
    } catch (e) {
      console.warn('Hefame Excel: error escribiendo línea', row, e?.message);
    }
  });

  const buf = await wb.xlsx.writeBuffer();

  const today = new Date();
  const yyyymmdd =
    today.getFullYear() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  const nombreClienteRaw = cliente?.Nombre_Razon_Social || cliente?.Nombre || '';
  const nombreClienteSafe = String(nombreClienteRaw)
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s/g, '_')
    .slice(0, 80) || 'cliente';
  const pedidoNum = numPedido || `pedido_${id}`;
  const attachmentFileName = `${yyyymmdd}_${nombreClienteSafe}-${pedidoNum}.xlsx`;

  return { ok: true, buf: Buffer.from(buf), filename: attachmentFileName };
}

module.exports = {
  tokenizeSmartQuery,
  parseLineasFromBody,
  canShowHefameForPedido,
  isTransferPedido,
  renderHefameInfoPage,
  buildStandardPedidoXlsxBuffer,
  buildHefameXlsxBuffer
};
