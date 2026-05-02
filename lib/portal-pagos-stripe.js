/**
 * Pagos Stripe en portal (opcional). Requiere STRIPE_SECRET_KEY y configuración en portal_config.
 */
'use strict';

function isStripeConfigured() {
  return !!(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || '').trim();
}

/**
 * Placeholder hasta integrar Checkout / Payment Intents con facturas Holded.
 * @returns {{ ok: boolean, message: string }}
 */
function getStripePortalStatus() {
  if (!isStripeConfigured()) {
    return { ok: false, message: 'Pago online no configurado. Usa transferencia al IBAN indicado en tu ficha.' };
  }
  return { ok: true, message: 'Próximamente: pago con tarjeta desde el portal.' };
}

module.exports = { isStripeConfigured, getStripePortalStatus };
