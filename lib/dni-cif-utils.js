'use strict';

/**
 * Normaliza DNI / NIE / CIF para almacenamiento y comparación:
 * mayúsculas, sin espacios, guiones ni puntos (separadores de miles).
 * Ej.: 27.451.524-n → 27451524N ; B75359598 → B75359598
 */
function normalizeDniCifForStorage(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .replace(/\./g, '');
}

function isValidSpanishDniCif(value) {
  const v = normalizeDniCifForStorage(value);
  if (!v) return false;
  if (['PENDIENTE', 'NULL', 'N/A', 'NA'].includes(v)) return false;
  if (v.startsWith('SIN_DNI')) return false;
  const dni = /^[0-9]{8}[A-Z]$/;
  const nie = /^[XYZ][0-9]{7}[A-Z]$/;
  const cif = /^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/;
  return dni.test(v) || nie.test(v) || cif.test(v);
}

module.exports = {
  normalizeDniCifForStorage,
  isValidSpanishDniCif
};
