/**
 * Parser para PDFs de ventas Gemavip.
 * Estructura esperada: Material (código EAN + descripción), Provincia (código + nombre),
 * Mes/Año (MM.AAAA), Cantidad.
 *
 * Ejemplos de ficheros:
 * - VENTAS GEMAVIP 022026 TOTAL.pdf
 * - VENTAS GEMAVIP NOV ENERO 012026.pdf
 * - 20251231 VENTAS GEMAVIP 2025 TOTAL.pdf
 */

const pdfParse = require('pdf-parse');

/**
 * Extrae el texto de un buffer PDF.
 * @param {Buffer} buffer - Contenido del PDF
 * @returns {Promise<{ text: string, numPages: number }>}
 */
async function extractPdfText(buffer) {
  const data = await pdfParse(buffer);
  return { text: data.text || '', numPages: data.numpages || 1 };
}

/**
 * Detecta mes/año del nombre del fichero.
 * Patrones: VENTAS GEMAVIP 022026, VENTAS GEMAVIP NOV ENERO 012026, 20251231 VENTAS GEMAVIP 2025
 */
function parseFileNameForPeriod(filename) {
  const name = String(filename || '').toUpperCase();
  // MMAAAA o MAAAA
  const m1 = name.match(/VENTAS\s+GEMAVIP\s+(\d{5,6})/);
  if (m1) {
    const s = m1[1];
    if (s.length === 6) return { mes: parseInt(s.slice(0, 2), 10), año: parseInt(s.slice(2), 10) };
    if (s.length === 5) return { mes: parseInt(s.slice(0, 1), 10), año: parseInt(s.slice(1), 10) };
  }
  // Año completo
  const m2 = name.match(/VENTAS\s+GEMAVIP\s+(\d{4})\s+TOTAL/);
  if (m2) return { mes: null, año: parseInt(m2[1], 10) };
  const m3 = name.match(/(\d{4})\d{4}\s+VENTAS\s+GEMAVIP\s+(\d{4})/);
  if (m3) return { mes: null, año: parseInt(m3[2] || m3[1], 10) };
  return { mes: null, año: null };
}

/**
 * Parsea el texto extraído del PDF y devuelve ventas estructuradas.
 * Estructura: Material (código EAN 13 dígitos + descripción), Provincia (XX NOMBRE),
 * Mes/Año (MM.AAAA), Cantidad.
 *
 * @param {string} text - Texto plano del PDF
 * @param {string} [filename] - Nombre del fichero (para contexto)
 * @returns {Object} { ventas: [...], materiales: [...], provincias: [...], meses: [...], errores: [...] }
 */
function parseVentasText(text, filename) {
  const ventas = [];
  const materialesSet = new Set();
  const provinciasSet = new Set();
  const mesesSet = new Set();
  const errores = [];

  if (!text || typeof text !== 'string') {
    return { ventas: [], materiales: [], provincias: [], meses: [], errores: ['Texto vacío'] };
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let currentMaterial = null;
  let currentProvincia = null;

  // Código EAN: 13 dígitos al inicio de línea
  const reMaterial = /^(\d{13})\s+(.+)$/;
  // Provincia: 2 dígitos + espacio + nombre (ej: 03 ALICANTE, 08 BARCELONA)
  const reProvincia = /^(\d{2})\s+([A-ZÁÉÍÓÚÑa-záéíóúñ\s\-]+)$/;
  // Mes/Año y cantidad: 02.2026 .... 24, 02.2026    24, 02.2026 24, o 02.2026 cualquier cosa 24
  const reMesCantidad = /^(\d{1,2})\.(\d{4})\s*(?:\.{2,}|[\s\t]+)(\d+)\s*$/;
  const reMesCantidadFlex = /^(\d{1,2})\.(\d{4})\D*(\d+)\s*$/;
  // Alternativa: línea con puntos y número (.... 24)
  const rePuntosCantidad = /^\.{2,}\s*(\d+)\s*$/;
  // Solo número (cantidad en línea separada)
  const reSoloCantidad = /^(\d+)\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upper = line.toUpperCase();

    if (upper === 'TOTAL' || upper.startsWith('TOTAL ')) continue;
    if (upper === 'MATERIAL' || upper === 'PROVINCIA' || upper === 'MES/AÑO' || upper === 'CANTIDAD') continue;
    if (/^Pag\.\s*\d+$/i.test(line)) continue;
    if (/^Fecha:/i.test(line) || /^Hora:/i.test(line) || /^Mes-Año:/i.test(line)) continue;

    const mMat = line.match(reMaterial);
    if (mMat) {
      currentMaterial = { codigo: mMat[1], descripcion: mMat[2].trim() };
      currentProvincia = null;
      materialesSet.add(JSON.stringify(currentMaterial));
      continue;
    }

    const mProv = line.match(reProvincia);
    if (mProv && currentMaterial) {
      currentProvincia = { codigo: mProv[1], nombre: mProv[2].trim() };
      provinciasSet.add(JSON.stringify(currentProvincia));
      continue;
    }

    const mMes = line.match(reMesCantidad) || line.match(reMesCantidadFlex);
    if (mMes && currentMaterial && currentProvincia) {
      const mes = parseInt(mMes[1], 10);
      const año = parseInt(mMes[2], 10);
      const cantidad = parseInt(mMes[3], 10);
      const mesKey = `${String(mes).padStart(2, '0')}.${año}`;
      mesesSet.add(mesKey);
      ventas.push({
        materialCodigo: currentMaterial.codigo,
        materialDescripcion: currentMaterial.descripcion,
        provinciaCodigo: currentProvincia.codigo,
        provinciaNombre: currentProvincia.nombre,
        mes,
        año,
        mesKey,
        cantidad
      });
      continue;
    }

    // Línea con solo número o ".... N": puede ser cantidad si la línea anterior era mes/año
    // En el PDF a veces Mes/Año y Cantidad están en líneas separadas
    const prevLine = i > 0 ? lines[i - 1] : '';
    const prevMesMatch = prevLine.match(/^(\d{1,2})\.(\d{4})/);
    if (prevMesMatch && currentMaterial && currentProvincia) {
      const mCant = line.match(reSoloCantidad) || line.match(rePuntosCantidad);
      if (mCant) {
        const mes = parseInt(prevMesMatch[1], 10);
        const año = parseInt(prevMesMatch[2], 10);
        const cantidad = parseInt(mCant[1], 10);
        const mesKey = `${String(mes).padStart(2, '0')}.${año}`;
        mesesSet.add(mesKey);
        ventas.push({
          materialCodigo: currentMaterial.codigo,
          materialDescripcion: currentMaterial.descripcion,
          provinciaCodigo: currentProvincia.codigo,
          provinciaNombre: currentProvincia.nombre,
          mes,
          año,
          mesKey,
          cantidad
        });
        continue;
      }
    }

    // Formato alternativo: "02.2026" en una línea y ".... 24" en la siguiente, o "02.2026 ...." y "24"
    const mesOnly = line.match(/^(\d{1,2})\.(\d{4})\s*\.{0,}\s*$/);
    if (mesOnly && currentMaterial && currentProvincia) {
      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      const cantMatch = nextLine.match(/^\.{2,}\s*(\d+)\s*$|^(\d+)\s*$/);
      if (cantMatch) {
        const mes = parseInt(mesOnly[1], 10);
        const año = parseInt(mesOnly[2], 10);
        const cantidad = parseInt(cantMatch[1] || cantMatch[2], 10);
        const mesKey = `${String(mes).padStart(2, '0')}.${año}`;
        mesesSet.add(mesKey);
        ventas.push({
          materialCodigo: currentMaterial.codigo,
          materialDescripcion: currentMaterial.descripcion,
          provinciaCodigo: currentProvincia.codigo,
          provinciaNombre: currentProvincia.nombre,
          mes,
          año,
          mesKey,
          cantidad
        });
        i++; // consumir siguiente línea
        continue;
      }
    }
  }

  const materiales = Array.from(materialesSet).map((s) => JSON.parse(s));
  const provincias = Array.from(provinciasSet).map((s) => JSON.parse(s));
  const meses = Array.from(mesesSet).sort();

  return { ventas, materiales, provincias, meses, errores };
}

/**
 * Procesa un buffer PDF y devuelve los datos de ventas.
 * @param {Buffer} buffer - Contenido del PDF
 * @param {string} [filename] - Nombre del fichero
 */
async function parseVentasPdf(buffer, filename) {
  const { text, numPages } = await extractPdfText(buffer);
  const parsed = parseVentasText(text, filename);
  const filePeriod = parseFileNameForPeriod(filename);

  const out = {
    ...parsed,
    numPages,
    filename: filename || null,
    filePeriod
  };

  if (parsed.ventas.length === 0 && text) {
    out.rawTextSample = text.slice(0, 3000);
  }

  return out;
}

/**
 * Agrega datos de varios PDFs en un único conjunto.
 * Deduplica por (material, provincia, mes): suma cantidades en lugar de repetir.
 */
function mergeVentasResults(results) {
  const ventasMap = new Map();
  const materialesMap = new Map();
  const provinciasMap = new Map();
  const mesesSet = new Set();
  const files = [];

  for (const r of results) {
    if (r.filename) files.push(r.filename);
    for (const v of r.ventas || []) {
      const key = `${v.materialCodigo}|${v.provinciaCodigo}|${v.mesKey}`;
      const existing = ventasMap.get(key);
      if (existing) {
        existing.cantidad += v.cantidad || 0;
      } else {
        ventasMap.set(key, { ...v, cantidad: v.cantidad || 0 });
      }
      if (!materialesMap.has(v.materialCodigo)) {
        materialesMap.set(v.materialCodigo, { codigo: v.materialCodigo, descripcion: v.materialDescripcion });
      }
      if (!provinciasMap.has(v.provinciaCodigo)) {
        provinciasMap.set(v.provinciaCodigo, { codigo: v.provinciaCodigo, nombre: v.provinciaNombre });
      }
      mesesSet.add(v.mesKey);
    }
  }

  const ventas = Array.from(ventasMap.values());
  const materiales = Array.from(materialesMap.values());
  const provincias = Array.from(provinciasMap.values());
  const meses = Array.from(mesesSet).sort();

  return { ventas, materiales, provincias, meses, files };
}

module.exports = {
  extractPdfText,
  parseVentasText,
  parseVentasPdf,
  parseFileNameForPeriod,
  mergeVentasResults
};
