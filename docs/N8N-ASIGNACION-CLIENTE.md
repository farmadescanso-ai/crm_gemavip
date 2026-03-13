# Workflow n8n: Asignación de cliente según aprobación

## Descripción

El workflow `n8n-workflow-notificaciones-gemavip.json` gestiona la solicitud de asignación de un cliente a un comercial. Cuando el responsable (j.deaza@gemavip.com) aprueba o deniega el email, se:

**Nota:** El Webhook está configurado con `responseMode: "onReceived"` para responder inmediatamente al POST inicial y evitar el error "Unused Respond to Webhook node" (al usar "Send and Wait", los nodos Respond to Webhook no son alcanzables en la misma ejecución).

- **Aprobado**: Actualiza `cli_com_id` en el CRM y envía email de confirmación al comercial
- **Denegado**: Envía email de denegación al comercial

**Flujo de destinatarios:**
- **j.deaza@gemavip.com** recibe el email con botones Aprobar/Rechazar (es quien decide).
- **p.lara@gemavip.com** (comercial que solicitó) recibe la notificación del resultado (aprobada o denegada).

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

| Variable | Descripción |
|----------|-------------|
| `CRM_BASE_URL` | URL base del CRM (ej. `https://crm-gemavip.vercel.app`) |
| `API_KEY` | Clave API del CRM (debe coincidir con `API_KEY` en el CRM) |

### Credenciales

- **SMTP**: Configurar credenciales "CRM GEMAVIP" para el envío de emails
- Los nodos "Send Email" usan las mismas credenciales que "Send message and wait for response"

### Endpoint del CRM

El workflow llama a:

```
POST {{CRM_BASE_URL}}/api/webhook/asignacion-cliente
Header: X-API-Key: {{API_KEY}}
Body: { "clienteId": number, "userEmail": string, "aprobado": boolean }
```

## Configuración en el CRM

1. **API_KEY**: Definir en `.env` o Vercel para proteger la API
2. El endpoint `/api/webhook/asignacion-cliente` usa la misma autenticación que el resto de la API

## Importar el workflow

1. En n8n: Workflows → Import from File
2. Seleccionar `n8n-workflow-notificaciones-gemavip.json`
3. Configurar variables de entorno y credenciales SMTP
4. Ajustar la URL del CRM en el nodo "HTTP: Asignar cliente en CRM" si no usas `CRM_BASE_URL`
