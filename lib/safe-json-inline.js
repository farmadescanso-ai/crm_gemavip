'use strict';

/**
 * Serializa un valor para incrustarlo en <script> o en <script type="application/json">.
 * Evita que cadenas con "</" rompan el cierre del script (mitigación XSS si datos llegan corruptos).
 */
function safeJsonInline(value) {
  return JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

module.exports = { safeJsonInline };
