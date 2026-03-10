#!/usr/bin/env node
/**
 * Ejecuta fix-notif-fk-cliente.sql para corregir la FK notif_ag_id → clientes.
 * Requiere: .env con DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (o variables de Vercel)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function run() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'crm_gemavip',
    multipleStatements: true
  };
  if (!config.host || !config.user) {
    console.error('❌ Configura DB_HOST y DB_USER en .env');
    process.exit(1);
  }
  const conn = await mysql.createConnection(config);
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      await conn.query('ALTER TABLE `notificaciones` DROP FOREIGN KEY `fk_notif_ag`');
      console.log('✅ FK fk_notif_ag eliminada');
    } catch (e) {
      if (e.code === 'ER_CANT_DROP_FIELD_OR_KEY' || e.message?.includes('check that it exists')) {
        console.log('⚠️ fk_notif_ag no existe (quizá ya se corrigió)');
      } else throw e;
    }
    try {
      await conn.query(`ALTER TABLE \`notificaciones\` ADD CONSTRAINT \`fk_notif_cli\`
        FOREIGN KEY (\`notif_ag_id\`) REFERENCES \`clientes\`(\`cli_id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
      console.log('✅ FK fk_notif_cli añadida (notif_ag_id → clientes.cli_id)');
    } catch (e) {
      if (e.code === 'ER_DUP_KEYNAME' || e.message?.includes('Duplicate')) {
        console.log('⚠️ fk_notif_cli ya existe');
      } else throw e;
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('✅ Fix completado.');
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}
run();
