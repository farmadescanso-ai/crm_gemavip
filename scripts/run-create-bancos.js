#!/usr/bin/env node
/**
 * Ejecuta scripts/create-table-bancos.sql y luego scripts/import-bancos-es.js
 * Uso: node scripts/run-create-bancos.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

async function run() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'crm_gemavip',
    multipleStatements: true
  };
  const sqlPath = path.join(__dirname, 'create-table-bancos.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const conn = await mysql.createConnection(config);
  try {
    await conn.query(sql);
    console.log('Tabla bancos creada o ya existente.');
  } catch (e) {
    console.error('Error DDL:', e.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
  const r = spawnSync(process.execPath, [path.join(__dirname, 'import-bancos-es.js')], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  process.exit(r.status ?? 1);
}

run();
