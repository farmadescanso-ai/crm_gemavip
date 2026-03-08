#!/usr/bin/env node
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function run() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'crm_gemavip',
    multipleStatements: true
  };
  const sqlPath = path.join(__dirname, 'add-column-ped-id-holded.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const conn = await mysql.createConnection(config);
  try {
    await conn.query(sql);
    console.log('Migración ped_id_holded ejecutada correctamente.');
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}
run();
