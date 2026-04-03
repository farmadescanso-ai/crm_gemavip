#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Migra contraseñas inseguras de comerciales a bcrypt.
 *
 * Reglas:
 * - Solo actualiza filas donde com_password no tiene formato bcrypt ($2a$/$2b$/$2y$).
 * - Si com_password está vacío/NULL y existe com_dni, usa com_dni como contraseña base.
 * - Por defecto ejecuta en modo simulación (dry-run). Para guardar cambios, usar --apply.
 *
 * Uso:
 *   node scripts/hash-comerciales-passwords.js
 *   node scripts/hash-comerciales-passwords.js --apply
 *   node scripts/hash-comerciales-passwords.js --apply --rounds 12
 *   node scripts/hash-comerciales-passwords.js --apply --only-dni-match
 */
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

function isBcryptHash(value) {
  if (!value) return false;
  const s = String(value).trim();
  return s.startsWith('$2a$') || s.startsWith('$2b$') || s.startsWith('$2y$');
}

function getArgFlag(flag) {
  return process.argv.includes(flag);
}

function getArgValue(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function getDbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'crm_gemavip',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  };
}

async function main() {
  const apply = getArgFlag('--apply');
  const onlyDniMatch = getArgFlag('--only-dni-match');
  const roundsRaw = Number(getArgValue('--rounds', 12));
  const rounds = Number.isInteger(roundsRaw) && roundsRaw >= 8 && roundsRaw <= 15 ? roundsRaw : 12;

  const dbConfig = getDbConfig();
  if (!dbConfig.user || !dbConfig.password) {
    console.error('❌ Faltan credenciales DB_USER / DB_PASSWORD en el entorno (.env o variables).');
    process.exit(1);
  }

  console.log('🔐 Migración de contraseñas de comerciales a bcrypt');
  console.log('📦 Base de datos:', dbConfig.database);
  console.log('🧪 Modo:', apply ? 'APPLY (guarda cambios)' : 'DRY-RUN (sin cambios)');
  console.log('⚙️  Cost bcrypt:', rounds);
  console.log('🎯 Filtro:', onlyDniMatch ? 'solo com_password = com_dni' : 'todas las no-bcrypt');

  const conn = await mysql.createConnection(dbConfig);
  try {
    const [rows] = await conn.query(`
      SELECT
        com_id,
        com_nombre,
        com_email,
        com_dni,
        com_password
      FROM comerciales
      ORDER BY com_id ASC
    `);

    const candidatos = [];
    for (const row of rows || []) {
      const stored = row.com_password == null ? '' : String(row.com_password).trim();
      if (isBcryptHash(stored)) continue;
      const dni = row.com_dni == null ? '' : String(row.com_dni).trim();
      if (onlyDniMatch && (!stored || !dni || stored !== dni)) continue;

      let sourcePassword = stored;
      let source = 'com_password';
      if (!sourcePassword) {
        if (!dni) {
          sourcePassword = '';
        } else {
          sourcePassword = dni;
          source = 'com_dni';
        }
      }

      candidatos.push({
        com_id: row.com_id,
        com_nombre: row.com_nombre,
        com_email: row.com_email,
        source,
        sourcePassword
      });
    }

    if (candidatos.length === 0) {
      console.log('✅ No hay comerciales pendientes de migrar.');
      return;
    }

    console.log(`\n📋 Comerciales pendientes: ${candidatos.length}`);
    for (const c of candidatos) {
      const masked = c.sourcePassword ? `${String(c.sourcePassword).slice(0, 2)}***` : '(vacía)';
      console.log(`- [${c.com_id}] ${c.com_nombre || '(sin nombre)'} <${c.com_email || '-'}> | origen=${c.source} | valor=${masked}`);
    }

    let migrados = 0;
    let omitidos = 0;

    for (const c of candidatos) {
      if (!c.sourcePassword) {
        omitidos += 1;
        console.warn(`⚠️ Omitido com_id=${c.com_id}: com_password y com_dni vacíos.`);
        continue;
      }

      const hashed = await bcrypt.hash(String(c.sourcePassword), rounds);
      if (apply) {
        await conn.query(
          'UPDATE comerciales SET com_password = ? WHERE com_id = ? AND (com_password IS NULL OR com_password = ? OR com_password = ?)',
          [hashed, c.com_id, c.source === 'com_password' ? c.sourcePassword : '', c.sourcePassword]
        );
      }
      migrados += 1;
    }

    console.log('\n📊 Resultado:');
    console.log(`- Migrables: ${candidatos.length}`);
    console.log(`- Procesados: ${migrados}`);
    console.log(`- Omitidos: ${omitidos}`);
    console.log(`- Cambios en BD: ${apply ? 'sí' : 'no (dry-run)'}`);
    console.log('\n✅ Finalizado.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('❌ Error en migración:', err?.message || err);
  process.exit(1);
});
