/**
 * Respuestas estándar tras express-validator (sin tocar lógica de negocio ni BD).
 */
const { validationResult } = require('express-validator');

function firstValidationMessage(req) {
  const r = validationResult(req);
  if (r.isEmpty()) return null;
  const arr = r.array({ onlyFirstError: true });
  return arr[0]?.msg || 'Datos no válidos.';
}

/**
 * Devuelve JSON 400 si hay errores; si no, next().
 */
function rejectIfValidationFailsJson() {
  return (req, res, next) => {
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();
    return res.status(400).json({
      ok: false,
      error: 'validation_error',
      details: errors.array({ onlyFirstError: false })
    });
  };
}

/**
 * Renderiza vista HTML con mensaje de error si hay errores.
 * @param {string} view
 * @param {(req: object) => object} buildLocals - título y campos para re-render (sin `error`)
 */
function rejectIfValidationFailsHtml(view, buildLocals) {
  return (req, res, next) => {
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();
    const msg = firstValidationMessage(req) || 'Datos no válidos.';
    const extra = typeof buildLocals === 'function' ? buildLocals(req) : {};
    return res.status(400).render(view, { ...extra, error: msg });
  };
}

module.exports = {
  firstValidationMessage,
  rejectIfValidationFailsJson,
  rejectIfValidationFailsHtml
};
