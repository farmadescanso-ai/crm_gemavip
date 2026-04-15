/**
 * 404 y manejador de errores Express (al final del pipeline).
 */
function registerHttpErrorHandlers(app, deps) {
  const { wantsHtml, renderErrorPage } = deps;

  app.use((req, res) => {
    if (wantsHtml(req)) {
      return renderErrorPage(req, res, {
        status: 404,
        title: 'No encontrado',
        heading: 'No encontramos esa página',
        summary: 'Puede que el enlace esté desactualizado o que no tengas acceso.',
        statusLabel: 'Not Found',
        whatToDo: [
          'Comprueba la URL y vuelve a intentarlo.',
          'Vuelve al Dashboard y navega desde el menú.',
          'Si llegaste aquí desde un enlace interno, envía el ID a soporte.'
        ]
      });
    }
    return res.status(404).json({ ok: false, error: 'Not Found', requestId: req.requestId });
  });

  app.use((err, req, res, _next) => {
    const status = Number(err?.status || err?.statusCode || res.statusCode || 500) || 500;
    const code = err?.code;
    const message = err?.message || String(err);

    if (wantsHtml(req)) {
      const publicMessage = status >= 500 ? 'Se produjo un error interno al procesar la solicitud.' : message;
      return renderErrorPage(req, res, {
        status,
        title: `Error ${status}`,
        heading: status >= 500 ? 'Error interno' : 'No se ha podido completar la acción',
        summary: publicMessage,
        statusLabel: status >= 500 ? 'Server Error' : 'Error',
        publicMessage,
        code
      });
    }

    return res.status(status).json({ ok: false, error: message, code, requestId: req.requestId });
  });
}

module.exports = { registerHttpErrorHandlers };
