/**
 * Helpers para rutas de administración (variables sistema, descuentos).
 */

const db = require('../config/mysql-crm');
const { _n } = require('./app-helpers');

const SYSVAR_N8N_PEDIDOS_WEBHOOK_URL = 'N8N_PEDIDOS_WEBHOOK_URL';
const SYSVAR_PEDIDOS_MAIL_TO = 'PEDIDOS_MAIL_TO';
const SYSVAR_SMTP_HOST = 'SMTP_HOST';
const SYSVAR_SMTP_PORT = 'SMTP_PORT';
const SYSVAR_SMTP_SECURE = 'SMTP_SECURE';
const SYSVAR_SMTP_USER = 'SMTP_USER';
const SYSVAR_SMTP_PASS = 'SMTP_PASS';
const SYSVAR_MAIL_FROM = 'MAIL_FROM';

function buildSysVarMergedList(itemsRaw, knownKeys) {
  const byKey = new Map((itemsRaw || []).map((r) => [String(r?.clave || '').trim(), r]));
  return (knownKeys || []).map((k) => {
    const row = byKey.get(k.clave) || {};
    const dbVal = row.valor === null || row.valor === undefined ? '' : String(row.valor);
    const envVal = String(process.env[k.clave] || '').trim();
    const effectiveValue = (dbVal || '').trim() || envVal || '';
    return {
      id: _n(row.id, null),
      clave: k.clave,
      descripcion: row.descripcion || k.descripcion || '',
      valor: dbVal,
      effectiveValue,
      updated_at: _n(row.updated_at, null),
      updated_by: _n(row.updated_by, null),
      secret: Boolean(k.secret),
      inputType: k.inputType || null,
      multiline: Boolean(k.multiline),
      placeholder: k.placeholder || null
    };
  });
}

async function loadVariablesSistemaRaw() {
  await db.ensureVariablesSistemaTable?.().catch(() => false);
  return await db.getVariablesSistemaAdmin?.().catch(() => null);
}

module.exports = {
  buildSysVarMergedList,
  loadVariablesSistemaRaw,
  SYSVAR_N8N_PEDIDOS_WEBHOOK_URL,
  SYSVAR_PEDIDOS_MAIL_TO,
  SYSVAR_SMTP_HOST,
  SYSVAR_SMTP_PORT,
  SYSVAR_SMTP_SECURE,
  SYSVAR_SMTP_USER,
  SYSVAR_SMTP_PASS,
  SYSVAR_MAIL_FROM
};
