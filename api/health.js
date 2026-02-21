/**
 * Health check mínimo - sin dependencias.
 * Probar en: /api/health o /health (si hay rewrite)
 */
module.exports = (req, res) => {
  try {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).end(JSON.stringify({
      ok: true,
      service: 'crm_gemavip',
      health: true,
      timestamp: new Date().toISOString()
    }));
  } catch (e) {
    res.status(500).end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  }
};
