/**
 * Health check mínimo - sin dependencias de DB, sesión ni rutas.
 * Para diagnosticar crashes en Vercel.
 */
module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'crm_gemavip',
    health: true,
    timestamp: new Date().toISOString()
  });
};
