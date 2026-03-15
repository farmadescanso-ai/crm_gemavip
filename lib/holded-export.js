/**
 * Exportación de pedidos aprobados a Holded como Purchase Order.
 * Se invoca tras la aprobación de un pedido por un administrador.
 */
'use strict';

const db = require('../config/mysql-crm');
const { fetchHolded, postHolded } = require('./holded-api');

const _n = (v, d) => (v != null && v !== '' ? v : d);

/**
 * Genera el tag del comercial: nombre + primer apellido, minúsculas, sin espacios ni acentos.
 * Ej. "Paco Lara" → "pacolara", "María García López" → "mariagarcialopez"
 */
function buildComercialTag(comNombre) {
  return String(comNombre || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim() || 'sincomercial';
}

/**
 * Busca o crea el contacto en Holded a partir del cliente del CRM.
 * Prioridad: cli_referencia (ya vinculado) > búsqueda por CIF > creación nueva.
 * @returns {string} contactId en Holded
 */
async function resolveHoldedContactId(cliente) {
  if (!cliente) throw new Error('Cliente no disponible para resolver contacto Holded');

  const ref = _n(cliente.cli_referencia, _n(cliente.Referencia, null));
  if (ref) return ref;

  const cif = String(_n(cliente.DNI_CIF, _n(cliente.cli_dni_cif, '')) || '').trim();
  const nombre = _n(cliente.Nombre_Razon_Social, _n(cliente.cli_nombre_razon_social, _n(cliente.Nombre, '')));

  if (cif) {
    try {
      const contacts = await fetchHolded('/contacts');
      const match = (Array.isArray(contacts) ? contacts : [])
        .find((c) => String(c.code || '').trim().toUpperCase() === cif.toUpperCase());
      if (match?.id) {
        await _saveClienteReferencia(cliente, match.id);
        return match.id;
      }
    } catch (_) {}
  }

  const newContact = await postHolded('/contacts', {
    name: nombre || 'Cliente CRM',
    code: cif || undefined,
    email: _n(cliente.Email, _n(cliente.cli_email, undefined)),
    phone: _n(cliente.Telefono, _n(cliente.cli_telefono, undefined)),
    mobile: _n(cliente.Movil, _n(cliente.cli_movil, undefined)),
    billAddress: {
      address: _n(cliente.Direccion, _n(cliente.cli_direccion, undefined)),
      city: _n(cliente.Poblacion, _n(cliente.cli_poblacion, undefined)),
      postalCode: _n(cliente.CodigoPostal, _n(cliente.cli_codigo_postal, undefined))
    }
  });

  const contactId = newContact?.id || newContact?.contactId;
  if (!contactId) throw new Error('Holded no devolvió contactId al crear contacto');

  await _saveClienteReferencia(cliente, contactId);
  return contactId;
}

async function _saveClienteReferencia(cliente, holdedContactId) {
  const cliId = Number(_n(cliente.Id, _n(cliente.cli_id, _n(cliente.id, 0)))) || 0;
  if (!cliId) return;
  try {
    await db.query('UPDATE clientes SET cli_referencia = ? WHERE cli_id = ?', [holdedContactId, cliId]);
  } catch (e) {
    console.warn('[HOLDED-EXPORT] No se pudo guardar cli_referencia:', e?.message);
  }
}

/**
 * Mapea las líneas del pedido CRM al formato items[] de Holded.
 */
function mapLineasToHoldedItems(lineas) {
  return (lineas || []).map((l) => {
    const nombre = String(
      _n(l.art_nombre, _n(l.Nombre, _n(l.pedart_articulo_txt, _n(l.Articulo, '')))) || ''
    ).trim();
    const sku = String(
      _n(l.art_sku, _n(l.art_codigo_interno, _n(l.SKU, _n(l.Codigo, '')))) || ''
    ).trim();
    const units = Number(_n(l.Linea_Cantidad, _n(l.pedart_cantidad, _n(l.Cantidad, 0)))) || 0;
    const subtotal = Number(_n(l.Linea_PVP, _n(l.pedart_pvp, _n(l.PVP, _n(l.pvp, 0))))) || 0;
    const tax = Number(_n(l.Linea_IVA, _n(l.pedart_iva, _n(l.IVA, 0)))) || 0;
    const discount = Number(_n(l.Linea_Dto, _n(l.pedart_dto, _n(l.Dto, 0)))) || 0;

    return {
      name: nombre || sku || 'Artículo',
      desc: sku ? `SKU: ${sku}` : '',
      units,
      subtotal,
      tax,
      discount,
      sku: sku || undefined
    };
  });
}

/**
 * Envía un pedido aprobado a Holded como Purchase Order.
 * No lanza excepción si HOLDED_API_KEY no está configurada (solo loguea warning).
 *
 * @param {number} pedidoId - ID del pedido en el CRM
 * @param {number} [comercialId] - ID del comercial (para tag); si no se pasa, se obtiene del pedido
 */
async function pushPedidoToHolded(pedidoId, comercialId) {
  if (!(process.env.HOLDED_API_KEY || '').trim()) {
    console.warn('[HOLDED-EXPORT] HOLDED_API_KEY no configurada, se omite envío a Holded');
    return null;
  }

  const item = await db.getPedidoById(pedidoId).catch(() => null);
  if (!item) throw new Error(`Pedido ${pedidoId} no encontrado`);

  const holdedDocId = _n(item.ped_id_holded, _n(item.Id_Holded, null));
  if (holdedDocId) {
    console.info(`[HOLDED-EXPORT] Pedido ${pedidoId} ya tiene ped_id_holded=${holdedDocId}, no se reenvía`);
    return { alreadySent: true, holdedDocId };
  }

  const idCliente = Number(_n(item.Id_Cliente, _n(item.id_cliente, _n(item.ped_cli_id, 0)))) || 0;
  const idComercial = comercialId || Number(_n(item.Id_Cial, _n(item.id_cial, _n(item.ped_com_id, 0)))) || 0;

  const [lineas, cliente, comercial] = await Promise.all([
    db.getArticulosByPedido(pedidoId).catch(() => []),
    idCliente ? db.getClienteById(idCliente).catch(() => null) : null,
    idComercial ? db.getComercialById(idComercial).catch(() => null) : null
  ]);

  const contactId = await resolveHoldedContactId(cliente);

  const comNombre = _n(comercial?.com_nombre, _n(comercial?.Nombre, _n(comercial?.nombre, '')));
  const tagComercial = buildComercialTag(comNombre);

  const numPedido = String(
    _n(item.NumPedido, _n(item.Num_Pedido, _n(item.ped_numero, pedidoId)))
  ).trim();
  const fechaRaw = _n(item.FechaPedido, _n(item.ped_fecha, _n(item.Fecha, null)));
  const fechaUnix = fechaRaw ? Math.floor(new Date(fechaRaw).getTime() / 1000) : Math.floor(Date.now() / 1000);
  const observaciones = String(_n(item.Observaciones, _n(item.ped_observaciones, '')) || '').trim();

  const items = mapLineasToHoldedItems(lineas);
  if (!items.length) {
    console.warn(`[HOLDED-EXPORT] Pedido ${pedidoId} sin líneas, no se envía a Holded`);
    return null;
  }

  const payload = {
    contactId,
    desc: `Pedido ${numPedido} - CRM Gemavip`,
    date: fechaUnix,
    notes: observaciones || undefined,
    tags: ['crm', tagComercial],
    items
  };

  console.info(`[HOLDED-EXPORT] Enviando pedido ${pedidoId} a Holded como purchaseorder...`);
  const result = await postHolded('/documents/purchaseorder', payload);

  const newDocId = result?.id || result?.documentId || null;
  if (newDocId) {
    try {
      await db.query('UPDATE pedidos SET ped_id_holded = ? WHERE ped_id = ?', [newDocId, pedidoId]);
    } catch (e) {
      console.warn('[HOLDED-EXPORT] No se pudo guardar ped_id_holded:', e?.message);
    }
  }

  console.info(`[HOLDED-EXPORT] Pedido ${pedidoId} enviado a Holded OK (doc: ${newDocId || 'sin id'})`);
  return { ok: true, holdedDocId: newDocId, tags: payload.tags };
}

module.exports = { pushPedidoToHolded, buildComercialTag, resolveHoldedContactId, mapLineasToHoldedItems };
