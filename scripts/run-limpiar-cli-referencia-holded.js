#!/usr/bin/env node
/**
 * Ejecuta el UPDATE seguro de scripts/limpiar-cli-referencia-duplicada-holded.sql
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const UPDATE_SQL = `
UPDATE clientes
SET cli_referencia = NULL
WHERE cli_referencia IS NOT NULL
  AND cli_Id_Holded IS NOT NULL
  AND TRIM(cli_referencia) = TRIM(cli_Id_Holded)
`;

const COUNT_SQL = `
SELECT COUNT(*) AS n FROM clientes
WHERE cli_referencia IS NOT NULL
  AND cli_Id_Holded IS NOT NULL
  AND TRIM(cli_referencia) = TRIM(cli_Id_Holded)
`;

async function run() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'crm_gemavip'
  };
  const conn = await mysql.createConnection(config);
  try {
    const [before] = await conn.query(COUNT_SQL);
    const n = before?.[0]?.n ?? 0;
    console.log('Filas candidatas (duplicado ref = Id_Holded):', n);
    const [res] = await conn.query(UPDATE_SQL);
    const affected = res?.affectedRows ?? 0;
    console.log('UPDATE ejecutado. Filas modificadas:', affected);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
