/**
 * Logging condicional (auditoría punto 16).
 * En producción no se emiten logs de debug para evitar exponer datos sensibles.
 */
'use strict';

const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL;
const debugEnabled = process.env.DEBUG === '1';

/** Solo en dev o con DEBUG=1 */
const debug = (isProd && !debugEnabled) ? () => {} : (...args) => console.log(...args);

/** Solo en dev (nunca en prod, ni con DEBUG) */
const devOnly = isProd ? () => {} : (...args) => console.log(...args);

/** Warnings: siempre (errores operativos) */
const warn = (...args) => console.warn(...args);

module.exports = { debug, devOnly, warn };
