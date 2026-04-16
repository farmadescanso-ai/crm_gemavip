/**
 * Configuración centralizada del pool de conexiones MySQL.
 * Usada por api/index.js (pool compartido) y config/mysql-crm.js (fallback).
 * Evita duplicación y garantiza consistencia entre sesión, db y comisiones.
 */

/**
 * mysql2 solo acepta `Z`, `local` u offset `±HH:MM` / `±HHMM` (no nombres IANA como Europe/Madrid).
 * @see https://github.com/sidorares/node-mysql2/issues/1614
 */
function resolveMysql2Timezone() {
  const raw = String(process.env.DB_TIMEZONE || 'local').trim();
  if (!raw) return 'local';
  const up = raw.toUpperCase();
  if (up === 'Z' || up === 'UTC') return 'Z';
  if (up === 'LOCAL') return 'local';
  if (/^[+-]\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^[+-]\d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^[+-]\d{4}$/.test(raw)) return `${raw.slice(0, 3)}:${raw.slice(3)}`;
  if (raw.includes('/')) {
    console.warn(
      `[db] DB_TIMEZONE="${raw}" no es válido en mysql2 (use Z, local o ±HH:MM). ` +
        'Se usa "local" (zona del proceso Node). Para UTC fijo use DB_TIMEZONE=Z.'
    );
  }
  return 'local';
}

function getPoolConfig() {
  const isVercel = !!process.env.VERCEL;
  const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT) || (isVercel ? 3 : 10);
  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'crm_gemavip',
    charset: 'utf8mb4',
    timezone: resolveMysql2Timezone(),
    waitForConnections: true,
    connectionLimit,
    // En Vercel: cola limitada para fallar rápido si hay saturación (evita timeouts largos)
    queueLimit: isVercel ? 5 : 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    connectTimeout: 10000
  };
}

module.exports = { getPoolConfig };
