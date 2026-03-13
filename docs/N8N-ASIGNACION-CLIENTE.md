# Workflow n8n: Asignación de cliente según aprobación

## Descripción

El workflow `n8n-workflow-notificaciones-gemavip.json` gestiona la solicitud de asignación de un cliente a un comercial. El email incluye botones que enlazan directamente al CRM (no a n8n), evitando que se abra la ventana de n8n tras responder.

- **Aprobado**: El admin hace clic en "Aprobar" → va al CRM → actualiza `cli_com_id` y envía email al comercial. Se muestra una página "Listo" que se puede cerrar.
- **Denegado**: El admin hace clic en "Rechazar" → va al CRM → se actualiza el estado y se envía email al comercial.

**Flujo de destinatarios:**
- **Admin** (NOTIF_EMAIL_DESTINO o primer email de SYSTEM_ADMIN_EMAILS; por defecto info@farmadescanso.com) recibe el email con botones Aprobar/Rechazar.
- **Comercial** (quien solicitó) recibe la notificación del resultado vía email y en "Mis notificaciones".

## URL del Webhook

Para enviar solicitudes de asignación desde el CRM:

```
POST https://farmadescanso-n8n.6f4r35.easypanel.host/webhook/76e48302-8d17-42fc-bb9e-37865d180728
```

**Body esperado** (JSON):

```json
{
  "body": {
    "title": "Nueva solicitud de asignación",
    "body": "Lara Buitrago, Paco solicita: Batfarna SL",
    "clienteId": 50,
    "clienteNombre": "Batfarna SL",
    "cli_dni_cif": "B30922512",
    "cli_direccion": "Av. Nueva Cartagena 9",
    "cli_codigo_postal": "30310",
    "cli_poblacion": "Cartagena",
    "cli_prov_id_nombre": "Murcia",
    "cli_tipc_id_nombre": "Farmacia",
    "cli_telefono": "+34968316242",
    "cli_estcli_id_nombre": "Activo",
    "userEmail": "p.lara@gemavip.com",
    "source": "crm_gemavip",
    "timestamp": "2026-03-11T15:45:55.655Z"
  }
}
```

## Configuración en n8n

### Variables de entorno

El workflow actual no requiere variables de entorno en n8n. Solo necesita credenciales SMTP para enviar el email.

### Credenciales

- **SMTP**: Configurar credenciales "CRM GEMAVIP" para el envío de emails
- Los nodos "Send Email" usan las mismas credenciales que "Send message and wait for response"

### Aprobación en el CRM

Los botones Aprobar/Rechazar del email enlazan a `/webhook/aprobar-asignacion`. El CRM valida la firma, actualiza el cliente y envía el email al comercial. No se usa n8n para la aprobación.

## Configuración en el CRM

1. **NOTIF_EMAIL_DESTINO** (opcional): Email que recibe la solicitud de aprobación. Por defecto: primer email de SYSTEM_ADMIN_EMAILS o info@farmadescanso.com.
2. **APROBACION_SECRET** (opcional): Si se define, se usa para firmar los enlaces. Por defecto se usa `API_KEY`.
3. El endpoint `/webhook/aprobar-asignacion` es público (no requiere login).

## Importar el workflow

1. En n8n: Workflows → Import from File
2. Seleccionar `n8n-workflow-notificaciones-gemavip.json`
3. Configurar credenciales SMTP en el nodo "Send Email"
4. No se necesita API_KEY ni HTTP Request: el workflow solo envía el email de solicitud con enlaces al CRM.

## Troubleshooting

### Aprobar/Rechazar no funciona

Si al hacer clic en Aprobar o Rechazar no ocurre nada o da error:

1. Verifica que la URL del CRM sea correcta (`APP_BASE_URL` en Vercel, ej. `https://crm-gemavip.vercel.app`).
2. La firma de los enlaces usa `APROBACION_SECRET` o `API_KEY`. Deben coincidir entre el CRM y la generación de enlaces.

### Revisar ejecuciones en n8n

1. En n8n → **Executions** → busca la ejecución tras hacer clic en Aprobar
2. Abre la ejecución y revisa:
   - **Merge**: ¿El output tiene `body`, `clienteId`, `userEmail`?
   - **If**: ¿Pasó por la rama "true" (aprobación)?
   - **HTTP: Asignar cliente en CRM**: ¿La petición devolvió 200 o error (401, 404, 500)?

### 4. Probar el endpoint del CRM manualmente

```bash
curl -X POST "https://crm-gemavip.vercel.app/api/webhook/asignacion-cliente" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: TU_API_KEY" \
  -d '{"clienteId": 50, "userEmail": "p.lara@gemavip.com", "aprobado": true}'
```

Respuesta esperada: `{"ok":true,"aprobado":true,"com_id":...,"clienteId":50,"mensaje":"Cliente asignado correctamente"}`

### 5. Reimportar el workflow

Si el problema persiste, reimporta el workflow actualizado (`n8n-workflow-notificaciones-gemavip.json`). La condición del nodo **If** se ha ajustado para aceptar distintas estructuras de respuesta de aprobación (`approved`, `data.approved`, string o boolean).
