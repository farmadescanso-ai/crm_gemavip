/**
 * Reglas de negocio: pedidos creados desde el portal del cliente (solo lectura / condiciones fijadas en CRM).
 */
'use strict';

const { _n } = require('./app-helpers');
const { ensureTransferTarifaYFormaPago } = require('./pedido-form-shared');

function getClienteTarifaIdNum(cliente) {
  if (!cliente || typeof cliente !== 'object') return 0;
  const raw =
    cliente.cli_tarcli_id ??
    cliente.cli_tarifa_legacy ??
    cliente.Id_Tarifa ??
    cliente.id_tarifa ??
    cliente.Tarifa ??
    cliente.tarifa ??
    0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getClienteFormaPagoId(cliente) {
  if (!cliente || typeof cliente !== 'object') return 0;
  const n = Number(cliente.cli_formp_id ?? cliente.Id_FormaPago ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function tarifaNombreById(tarifas, tarifaId) {
  const tid = Number(tarifaId);
  if (!Number.isFinite(tid) || tid <= 0) return '';
  const t = (tarifas || []).find((x) => Number(_n(x.tarcli_id, x.Id, x.id)) === tid);
  return String(_n(t?.tarcli_nombre, _n(t?.NombreTarifa, t?.Nombre)) || '').trim();
}

function findTransferTipoId(tiposPedido) {
  const row = (tiposPedido || []).find((tp) =>
    /transfer/i.test(String(_n(tp.tipp_tipo, tp.Nombre, tp.Tipo, tp.nombre, tp.tipo) || ''))
  );
  if (!row) return 0;
  return Number(_n(row.tipp_id, row.Id, row.id)) || 0;
}

/**
 * ¿El pedido está en estado pendiente (editable solo en portal si en el futuro hubiera edición)?
 * @param {object} pedido
 * @param {number|null|undefined} estadoPendienteId - id catálogo estado 'pendiente'
 */
function portalPedidoEstaPendiente(pedido, estadoPendienteId) {
  if (!pedido) return false;
  const pendId = Number(estadoPendienteId);
  const idCur = Number(_n(pedido.Id_EstadoPedido, pedido.ped_estped_id, pedido.ped_Id_EstadoPedido) || 0) || 0;
  if (Number.isFinite(pendId) && pendId > 0 && Number.isFinite(idCur) && idCur > 0) return idCur === pendId;
  const txt = String(_n(_n(_n(pedido.EstadoPedido, pedido.Estado), pedido.ped_estado_txt), ''))
    .trim()
    .toLowerCase();
  return txt === 'pendiente' || txt === '';
}

/**
 * Cabecera de pedido nueva desde portal: cliente fijo, tarifa y condiciones de pago/tipo según ficha
 * (no se confía en el body salvo líneas, observaciones, ref. cliente y dirección de envío).
 */
function buildPortalPedidoCreatePayload({
  cliId,
  comId,
  cliente,
  estadoPendienteId,
  body,
  tarifas,
  formasPago,
  tiposPedido
}) {
  const tarifaId = getClienteTarifaIdNum(cliente);
  const formaId = getClienteFormaPagoId(cliente);
  const tn = tarifaNombreById(tarifas, tarifaId);
  let tipoId = 0;
  if (/transfer/i.test(tn)) tipoId = findTransferTipoId(tiposPedido);

  let pedidoPayload = {
    Id_Cial: comId,
    Id_Cliente: cliId,
    Id_DireccionEnvio: body.Id_DireccionEnvio ? Number(body.Id_DireccionEnvio) || null : null,
    Id_FormaPago: formaId || 0,
    Id_TipoPedido: tipoId || 0,
    Id_EstadoPedido: Number(estadoPendienteId) > 0 ? Number(estadoPendienteId) : null,
    Serie: 'P',
    EsEspecial: 0,
    NumPedidoCliente: String(body.NumPedidoCliente || '').trim() || null,
    FechaPedido: new Date().toISOString().slice(0, 10),
    FechaEntrega: null,
    EstadoPedido: 'Pendiente',
    Observaciones: String(body.Observaciones || '').trim() || null
  };
  if (tarifaId > 0) pedidoPayload.Id_Tarifa = tarifaId;

  pedidoPayload = ensureTransferTarifaYFormaPago(
    pedidoPayload,
    { Id_TipoPedido: pedidoPayload.Id_TipoPedido },
    tarifas,
    formasPago,
    tiposPedido
  );
  return pedidoPayload;
}

/** Fuerza dto de línea al dto de cabecera del cliente (portal no negocia condiciones por línea). */
function aplicarDtoLineasPortal(lineas, dtoClientePct) {
  const d = Number(String(dtoClientePct ?? '').replace(',', '.'));
  const fixed = Number.isFinite(d) ? Math.max(0, Math.min(100, d)) : 0;
  return (Array.isArray(lineas) ? lineas : []).map((l) => ({
    ...l,
    Dto: fixed
  }));
}

module.exports = {
  getClienteTarifaIdNum,
  getClienteFormaPagoId,
  tarifaNombreById,
  findTransferTipoId,
  portalPedidoEstaPendiente,
  buildPortalPedidoCreatePayload,
  aplicarDtoLineasPortal
};
