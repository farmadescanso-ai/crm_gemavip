/**
 * Duplicados y unificación (admin).
 */
const { rejectIfValidationFailsJson } = require('../../lib/validation-handlers');
const { unificarDuplicadosValidators } = require('../../lib/validators/html-clientes-ui');

function registerDuplicadosRoutes(router, { db, requireLogin, requireAdmin }) {
  router.get('/duplicados', requireLogin, requireAdmin, async (req, res, next) => {
    try {
      const grupos = await db.getClientesDuplicados({});
      res.render('clientes-duplicados', { grupos: grupos || [], admin: true });
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/unificar',
    requireLogin,
    requireAdmin,
    ...unificarDuplicadosValidators,
    rejectIfValidationFailsJson(),
    async (req, res, next) => {
    const wantsJson =
      req.get('Accept')?.includes('application/json') || req.get('X-Requested-With') === 'XMLHttpRequest';
    try {
      const raw = req.body.ids;
      const ids = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? raw
              .split(',')
              .map((x) => parseInt(String(x).trim(), 10))
              .filter((n) => Number.isFinite(n) && n > 0)
          : [];
      if (ids.length < 2) {
        if (wantsJson) return res.status(400).json({ error: 'Se necesitan al menos 2 IDs para unificar.' });
        req.flash?.('error', 'Se necesitan al menos 2 IDs para unificar.');
        return res.redirect('/clientes/duplicados');
      }
      const { primaryId } = await db.mergeClientesDuplicados(ids);
      if (wantsJson) return res.json({ ok: true, redirect: `/clientes/${primaryId}` });
      req.flash?.('success', `Clientes unificados correctamente en el registro #${primaryId}.`);
      return res.redirect(`/clientes/${primaryId}`);
    } catch (e) {
      if (wantsJson) return res.status(400).json({ error: e.message || 'Error al unificar clientes.' });
      req.flash?.('error', e.message || 'Error al unificar clientes.');
      return res.redirect('/clientes/duplicados');
    }
    }
  );
}

module.exports = { registerDuplicadosRoutes };
