/**
 * Lógica compartida entre CRM (/pedidos/new) y portal (/portal/pedidos/nuevo):
 * filtrado Transfer y ajuste tarifa/forma de pago para pedidos tipo Transfer.
 */
'use strict';

const { _n } = require('./app-helpers');

function filterOutTransferOptions(formasPago, tiposPedido) {
  const nameOf = (item) =>
    String(item?.formp_nombre ?? item?.Nombre ?? item?.FormaPago ?? item?.nombre ?? item?.tipp_tipo ?? item?.Tipo ?? '');
  return {
    formasPago: (formasPago || []).filter((fp) => !/transfer/i.test(nameOf(fp))),
    tiposPedido: (tiposPedido || []).filter((tp) => !/transfer/i.test(nameOf(tp)))
  };
}

function ensureTransferTarifaYFormaPago(payload, body, tarifas, formasPago, tiposPedido) {
  const idTipo = Number(body.Id_TipoPedido) || 0;
  if (!idTipo) return payload;
  const tipo = (tiposPedido || []).find((t) => Number(_n(t.tipp_id, _n(t.id, t.Id))) === idTipo);
  const tipoNombre = String(_n(tipo && (tipo.tipp_tipo || tipo.Nombre || tipo.Tipo || tipo.nombre), '')).trim();
  if (!/transfer/i.test(tipoNombre)) return payload;
  const getTarifaNombre = (t) => String(_n(t.tarcli_nombre, _n(t.NombreTarifa, _n(t.Nombre, t.nombre))));
  const getFormaPagoNombre = (fp) => String(_n(fp.formp_nombre, _n(fp.Nombre, _n(fp.FormaPago, fp.nombre))));
  const tarTransfer = (tarifas || []).find((t) => /transfer/i.test(getTarifaNombre(t)));
  const fpTransfer = (formasPago || []).find((fp) => /transfer/i.test(getFormaPagoNombre(fp)));
  const out = { ...payload };
  if (tarTransfer) out.Id_Tarifa = Number(_n(tarTransfer.tarcli_id, _n(tarTransfer.Id, tarTransfer.id))) || 0;
  if (fpTransfer) out.Id_FormaPago = Number(_n(fpTransfer.formp_id, _n(fpTransfer.id, fpTransfer.Id))) || 0;
  return out;
}

module.exports = {
  filterOutTransferOptions,
  ensureTransferTarifaYFormaPago
};
