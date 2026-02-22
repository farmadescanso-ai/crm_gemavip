#!/usr/bin/env node
/**
 * Diagnóstico y corrección de contraseña de login.
 * Conecta a la BD y permite verificar/actualizar la contraseña de un comercial.
 *
 * Uso:
 *   node tools/fix-login-password.js pedidos@farmadescanso.com
 *   node tools/fix-login-password.js pedidos@farmadescanso.com --set-password "farma@gemavip2026"
 *
 * Requiere: .env con DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (o variables de Vercel)
 */
/* eslint-disable no-console */
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function resolveTableName(conn, base) {
  const cands = [base, base.charAt(0).toUpperCase() + base.slice(1), base.toUpperCase()];
  for (const c of cands) {
    try {
      await conn.query(`SHOW COLUMNS FROM \`${c}\``);
      return c;
    } catch (_) {}
  }
  return null;
}

async function getColumns(conn, table) {
  const [rows] = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
  return (rows || []).map((r) => r.Field || r.field || '').filter(Boolean);
}

function pickCI(cols, candidates) {
  const set = new Set((cols || []).map((c) => String(c).toLowerCase()));
  for (const cand of candidates || []) {
    const key = String(cand).toLowerCase();
    if (set.has(key)) {
      return (cols || []).find((c) => String(c).toLowerCase() === key) || cand;
    }
  }
  return null;
}

async function main() {
  const email = process.argv[2];
  const setPassword = process.argv.includes('--set-password')
    ? process.argv[process.argv.indexOf('--set-password') + 1]
    : null;

  if (!email) {
    console.log('Uso: node tools/fix-login-password.js <email> [--set-password "nueva_clave"]');
    process.exit(1);
  }

  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'crm_gemavip',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  };

  if (!config.user || !config.password) {
    console.error('❌ Configura DB_USER y DB_PASSWORD en .env (o variables de entorno)');
    process.exit(1);
  }

  console.log('Conectando a', config.host, '... BD:', config.database);

  let conn;
  try {
    conn = await mysql.createConnection(config);
  } catch (err) {
    console.error('❌ Error conectando:', err.message);
    process.exit(1);
  }

  try {
    const table = await resolveTableName(conn, 'comerciales');
    if (!table) {
      console.error('❌ No se encontró la tabla comerciales');
      process.exit(1);
    }
    console.log('✅ Tabla:', table);

    const cols = await getColumns(conn, table);
    const colEmail = pickCI(cols, ['com_email', 'Email', 'email']) || 'Email';
    const colPwd = pickCI(cols, ['com_password', 'Password', 'password']) || 'Password';
    const pk = pickCI(cols, ['com_id', 'id', 'Id']) || 'id';

    console.log('   Columna email:', colEmail);
    console.log('   Columna password:', colPwd);

    const [rows] = await conn.query(
      `SELECT * FROM \`${table}\` WHERE LOWER(TRIM(\`${colEmail}\`)) = LOWER(TRIM(?)) LIMIT 1`,
      [email]
    );

    if (!rows || rows.length === 0) {
      console.log('\n❌ No se encontró ningún comercial con email:', email);
      console.log('   Verifica que el email exista en la tabla', table);
      process.exit(1);
    }

    const row = rows[0];
    const stored = row[colPwd];
    const id = row[pk] ?? row.id ?? row.Id;

    console.log('\n✅ Usuario encontrado:');
    console.log('   ID:', id);
    console.log('   Nombre:', row.Nombre ?? row.com_nombre ?? row.nombre ?? '-');
    console.log('   Email:', row[colEmail]);
    console.log('   Contraseña almacenada:');
    console.log('     - Longitud:', stored ? stored.length : 0);
    console.log('     - Es bcrypt:', !!(stored && (stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$'))));
    console.log('     - Prefijo:', stored ? stored.substring(0, 15) + '...' : '(vacío)');

    if (setPassword) {
      const hash = await bcrypt.hash(setPassword, 12);
      await conn.query(`UPDATE \`${table}\` SET \`${colPwd}\` = ? WHERE \`${pk}\` = ?`, [hash, id]);
      console.log('\n✅ Contraseña actualizada correctamente.');
      console.log('   Prueba el login con:', email, '/', setPassword);
    } else {
      console.log('\nPara actualizar la contraseña, ejecuta:');
      console.log(`   node tools/fix-login-password.js ${email} --set-password "tu_nueva_clave"`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
