/**
 * Almacenamiento persistente de PDFs de ventas Gemavip.
 * Guarda PDFs en disco y mantiene una caché de resultados parseados.
 * En Vercel/serverless: usa /tmp (efímero). Para persistencia real usar BD o S3.
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const BASE_DIR = process.env.VENTAS_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'ventas-gemavip');
const PDF_DIR = path.join(BASE_DIR, 'pdf');
const CACHE_FILE = path.join(BASE_DIR, 'cache.json');

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

function fileHash(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex').slice(0, 12);
}

/**
 * Guarda un PDF en disco y devuelve la ruta.
 * @param {Buffer} buffer
 * @param {string} originalName
 * @returns {Promise<{ savedAs: string, path: string }>}
 */
async function savePdf(buffer, originalName) {
  await ensureDir(PDF_DIR);
  const ext = path.extname(originalName) || '.pdf';
  const base = path.basename(originalName, ext).replace(/[^\w\-\.]/g, '_').slice(0, 80);
  const hash = fileHash(buffer);
  const savedAs = `${base}_${hash}${ext}`;
  const fullPath = path.join(PDF_DIR, savedAs);
  await fs.writeFile(fullPath, buffer);
  return { savedAs, path: fullPath };
}

/**
 * Lee la caché de ventas procesadas.
 * @returns {Promise<{ files: Array, parsed: Object, lastUpdated: string }|null>}
 */
async function getCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * Guarda la caché.
 * @param {Object} data - { files, parsed, lastUpdated }
 */
async function saveCache(data) {
  await ensureDir(BASE_DIR);
  await fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 0), 'utf8');
}

/**
 * Lista los PDFs guardados (solo nombres para mostrar).
 */
async function listSavedPdfs() {
  try {
    await ensureDir(PDF_DIR);
    const entries = await fs.readdir(PDF_DIR, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.pdf'));
    return files.map((f) => ({ name: f.name }));
  } catch (e) {
    return [];
  }
}

/**
 * Lee un PDF guardado por nombre.
 */
async function readSavedPdf(savedAs) {
  const fullPath = path.join(PDF_DIR, savedAs);
  return fs.readFile(fullPath);
}

/**
 * Elimina un PDF guardado.
 */
async function removePdf(savedAs) {
  const fullPath = path.join(PDF_DIR, savedAs);
  await fs.unlink(fullPath);
}

module.exports = {
  savePdf,
  getCache,
  saveCache,
  listSavedPdfs,
  readSavedPdf,
  removePdf,
  BASE_DIR,
  CACHE_FILE
};
