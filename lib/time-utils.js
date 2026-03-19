'use strict';

/**
 * Suma minutos a una hora en formato HH:MM. Envuelve a medianoche.
 * @param {string} hhmm - "09:30"
 * @param {number} minutes - minutos a sumar (puede ser negativo)
 * @returns {string} "10:00" o '' si el formato es inválido
 */
function addMinutesHHMM(hhmm, minutes) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return '';
  const total = (hh * 60 + mm + Number(minutes || 0)) % (24 * 60);
  const outH = String(Math.floor((total + 24 * 60) % (24 * 60) / 60)).padStart(2, '0');
  const outM = String(((total + 24 * 60) % (24 * 60)) % 60).padStart(2, '0');
  return `${outH}:${outM}`;
}

module.exports = { addMinutesHHMM };
