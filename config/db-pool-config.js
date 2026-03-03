/**
 * Configuración centralizada del pool de conexiones MySQL.
 * Usada por api/index.js (pool compartido) y config/mysql-crm.js (fallback).
 * Evita duplicación y garantiza consistencia entre sesión, db y comisiones.
 */
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
    timezone: 'Europe/Madrid',
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
