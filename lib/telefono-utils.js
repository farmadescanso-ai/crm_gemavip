/**
 * Utilidades para formato unificado de teléfonos (fijos y móviles, cualquier país).
 *
 * Vista: "Prefijo País" + número con espacios. Ej: "+34 630 87 47 81"
 * BD: Todo junto sin espacios. Ej: "+34630874781"
 */

/**
 * Normaliza un teléfono para guardar en BD: prefijo + dígitos sin espacios.
 * Ej: "630 87 47 81" -> "+34630874781"
 * Ej: "+34 630 87 47 81" -> "+34630874781"
 * @param {string} raw - Valor crudo del input
 * @returns {string|null} Valor normalizado o null si vacío
 */
function normalizeTelefonoForDB(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Quitar espacios, guiones, puntos, paréntesis
  s = s.replace(/[\s\-\.\(\)]/g, '');
  // Mantener solo + y dígitos
  const hasPlus = s.startsWith('+');
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;

  // Si ya tiene +, reconstruir
  if (hasPlus) {
    return '+' + digits;
  }

  // Sin +: intentar inferir prefijo para España
  // 9 dígitos empezando por 6,7,8,9 -> España
  if (/^[6789]\d{8}$/.test(digits)) {
    return '+34' + digits;
  }
  // 11 dígitos empezando por 34 -> España
  if (/^34[6789]\d{8}$/.test(digits)) {
    return '+' + digits;
  }
  // 10 dígitos empezando por 0 (formato 0XXXXXXXXX) -> quitar 0 y asumir España si 9XX
  if (digits.startsWith('0') && digits.length === 10 && /^0[6789]\d{8}$/.test(digits)) {
    return '+34' + digits.slice(1);
  }

  // Otros países: si son solo dígitos sin +, devolver con + para indicar internacional
  // Si tiene 10-15 dígitos, asumir que es número completo (el usuario debe poner prefijo)
  if (digits.length >= 9 && digits.length <= 15) {
    return '+' + digits;
  }

  return '+' + digits;
}

/** Prefijos internacionales conocidos (orden: más largos primero) */
const PREFIJOS = ['351', '352', '353', '354', '355', '356', '357', '358', '359', '30', '31', '32', '33', '34', '36', '39', '43', '44', '45', '46', '47', '48', '49', '1', '7', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '81', '82', '86', '90', '91', '92', '93'];

/**
 * Formatea un teléfono para mostrar en vista: "Prefijo País" + número con espacios.
 * Ej: "+34630874781" -> "+34 630 87 47 81"
 * @param {string} raw - Valor de BD o crudo
 * @returns {string} Valor formateado para vista, o '' si vacío
 */
function formatTelefonoForDisplay(raw) {
  if (raw == null || typeof raw !== 'string') return '';
  let s = String(raw).trim();
  if (!s) return '';

  s = s.replace(/\s/g, '');
  const hasPlus = s.startsWith('+');
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';

  const full = hasPlus ? '+' + digits : digits;
  const afterPlus = full.startsWith('+') ? full.slice(1) : full;

  if (afterPlus.length <= 3) return full;

  // Detectar prefijo: probar de más largo a más corto
  let prefix = '';
  let rest = afterPlus;
  for (const p of PREFIJOS) {
    if (afterPlus.startsWith(p) && afterPlus.length > p.length + 4) {
      prefix = p;
      rest = afterPlus.slice(p.length);
      break;
    }
  }
  if (!prefix) {
    // Heurística: 1 dígito (USA) o 2 dígitos (Europa)
    if (afterPlus.startsWith('1') && afterPlus.length >= 11) {
      prefix = '1';
      rest = afterPlus.slice(1);
    } else if (/^[3-4]\d/.test(afterPlus) && afterPlus.length >= 10) {
      prefix = afterPlus.slice(0, 2);
      rest = afterPlus.slice(2);
    } else {
      return full;
    }
  }

  // Formatear: XXX XX XX XX (primer grupo 3, luego de 2)
  const parts = [];
  if (rest.length > 3) {
    parts.push(rest.slice(0, 3));
    let idx = 3;
    while (idx < rest.length) {
      parts.push(rest.slice(idx, idx + 2));
      idx += 2;
    }
  } else {
    parts.push(rest);
  }
  return '+' + prefix + ' ' + parts.join(' ');
}

/**
 * Obtiene el número limpio (solo dígitos con +) para usar en tel: y wa.me
 * @param {string} raw - Valor de BD o crudo
 * @returns {string} Número para href (ej: +34630874781)
 */
function getTelefonoForHref(raw) {
  const normalized = normalizeTelefonoForDB(raw);
  return normalized || '';
}

module.exports = {
  normalizeTelefonoForDB,
  formatTelefonoForDisplay,
  getTelefonoForHref
};
