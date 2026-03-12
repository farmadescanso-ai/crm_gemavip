/**
 * Script para n8n - Genera HTML de email de aceptación/denegación
 * de solicitud de asignación de cliente.
 *
 * INPUT esperado: items con body con los datos del cliente y la solicitud.
 * Parámetro: asignar "aceptacion" o "denegacion" según el flujo.
 *
 * Uso en n8n:
 * 1. Añade un nodo Code antes del nodo Send Email
 * 2. Pega este código
 * 3. El output se pasa al nodo Email (campo html o body)
 */

const accion = $input.first().json.accion || 'aceptacion'; // 'aceptacion' | 'denegacion'
const body = $input.first().json.body || $input.first().json;

const {
  title = 'Solicitud de asignación',
  body: textoSolicitud = '',
  clienteNombre = '',
  cli_dni_cif = '',
  cli_direccion = '',
  cli_codigo_postal = '',
  cli_poblacion = '',
  cli_prov_id_nombre = '',
  cli_tipc_id_nombre = '',
  cli_telefono = '',
  cli_estcli_id_nombre = '',
  userEmail = '',
  timestamp = ''
} = body;

const esAceptacion = accion === 'aceptacion';
const tituloEmail = esAceptacion ? '✓ Asignación aprobada' : '✗ Asignación denegada';
const mensajePrincipal = esAceptacion
  ? 'Se ha aprobado tu solicitud de asignación del siguiente cliente.'
  : 'Se ha denegado tu solicitud de asignación del siguiente cliente.';
const colorPrincipal = esAceptacion ? '#22c55e' : '#ef4444';
const colorBorde = esAceptacion ? '#16a34a' : '#dc2626';

const fechaFormateada = timestamp
  ? new Date(timestamp).toLocaleString('es-ES', {
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  : '';

const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${tituloEmail}</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f5; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <tr>
      <td style="padding: 32px 40px;">
        <!-- Cabecera -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-left: 4px solid ${colorBorde}; margin-bottom: 24px;">
          <tr>
            <td style="padding-left: 16px;">
              <h1 style="margin: 0; font-size: 20px; font-weight: 600; color: #18181b;">
                ${tituloEmail}
              </h1>
              <p style="margin: 8px 0 0 0; font-size: 14px; color: #71717a;">
                CRM Gemavip · ${fechaFormateada}
              </p>
            </td>
          </tr>
        </table>

        <!-- Mensaje principal -->
        <p style="margin: 0 0 24px 0; font-size: 15px; color: #3f3f46;">
          ${mensajePrincipal}
        </p>
        ${textoSolicitud ? `<p style="margin: 0 0 24px 0; font-size: 14px; color: #52525b; font-style: italic;">"${textoSolicitud}"</p>` : ''}

        <!-- Datos del cliente -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e4e4e7; border-radius: 8px; margin-bottom: 24px;">
          <tr>
            <td style="padding: 20px; background-color: #fafafa;">
              <h2 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #18181b;">
                ${clienteNombre}
              </h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size: 13px; color: #52525b;">
                <tr><td style="padding: 4px 0;"><strong>CIF/NIF:</strong></td><td>${cli_dni_cif || '—'}</td></tr>
                <tr><td style="padding: 4px 0;"><strong>Dirección:</strong></td><td>${cli_direccion || '—'}</td></tr>
                <tr><td style="padding: 4px 0;"><strong>CP / Población:</strong></td><td>${cli_codigo_postal || ''} ${cli_poblacion || '—'}</td></tr>
                <tr><td style="padding: 4px 0;"><strong>Provincia:</strong></td><td>${cli_prov_id_nombre || '—'}</td></tr>
                <tr><td style="padding: 4px 0;"><strong>Tipo:</strong></td><td>${cli_tipc_id_nombre || '—'}</td></tr>
                <tr><td style="padding: 4px 0;"><strong>Teléfono:</strong></td><td>${cli_telefono || '—'}</td></tr>
                <tr><td style="padding: 4px 0;"><strong>Estado:</strong></td><td>${cli_estcli_id_nombre || '—'}</td></tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Pie -->
        <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
          Este correo ha sido generado automáticamente por el CRM Gemavip.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
`;

return [{ json: { html, subject: tituloEmail, to: userEmail, body } }];
