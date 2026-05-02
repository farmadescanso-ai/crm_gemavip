/**
 * Combina portal_config global + portal_cliente_override para flags efectivos.
 */
'use strict';

function boolOr(v, def) {
  if (v === null || v === undefined) return def;
  const n = Number(v);
  if (Number.isFinite(n)) return n !== 0;
  return !!v;
}

/**
 * @param {object|null} globalCfg - fila portal_config
 * @param {object|null} override - fila portal_cliente_override
 * @returns {{ ver_facturas: boolean, ver_pedidos: boolean, ver_presupuestos: boolean, ver_albaranes: boolean, ver_catalogo: boolean }}
 */
function getEffectivePortalFlags(globalCfg, override) {
  const g = globalCfg || {};
  const o = override || {};
  const heredar = o.pco_heredar_global == null || Number(o.pco_heredar_global) !== 0;

  function pick(gCol, oCol) {
    if (!heredar && o[oCol] != null) return boolOr(o[oCol], true);
    return boolOr(g[gCol], true);
  }

  return {
    ver_facturas: pick('portcfg_ver_facturas', 'pco_ver_facturas'),
    ver_pedidos: pick('portcfg_ver_pedidos', 'pco_ver_pedidos'),
    ver_presupuestos: pick('portcfg_ver_presupuestos', 'pco_ver_presupuestos'),
    ver_albaranes: pick('portcfg_ver_albaranes', 'pco_ver_albaranes'),
    ver_catalogo: pick('portcfg_ver_catalogo', 'pco_ver_catalogo')
  };
}

function isPortalGloballyEnabled(globalCfg) {
  return !!(globalCfg && Number(globalCfg.portcfg_activo) === 1);
}

module.exports = { getEffectivePortalFlags, isPortalGloballyEnabled, boolOr };
