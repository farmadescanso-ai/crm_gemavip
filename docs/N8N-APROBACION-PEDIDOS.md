# Workflow n8n: Aprobación de pedidos

## Descripción

Cuando un comercial cambia el estado de un pedido de **Pendiente** a **Revisando**, el CRM envía automáticamente un webhook a n8n con todos los datos del pedido, cliente, comercial y un Excel adjunto en Base64.

n8n envía dos emails:
1. **Al comercial**: informándole de que su pedido está en revisión.
2. **Al Director Comercial** (con copia al Responsable Comercial): con todos los datos del pedido, líneas detalladas, Excel adjunto y botones para **Aprobar** o **Denegar**.

Los botones enlazan directamente al CRM (no a n8n). Al hacer clic, el CRM valida la firma HMAC, actualiza el estado del pedido y envía un email de resultado al comercial.

## Flujo

```
Comercial: clic "Pendiente" → "Revisando"
    ↓
CRM: crea notificación (tipo: aprobacion_pedido)
CRM: genera URLs firmadas (HMAC-SHA256)
CRM: genera Excel Base64
CRM: POST webhook n8n
    ↓
n8n: Email al comercial ("Tu pedido está en revisión")
n8n: Email al Director (j.deaza@gemavip.com) CC Responsable (c.betancourt@gmavip.com)
     → con Excel adjunto + botones Aprobar/Denegar
    ↓
Director/Responsable: clic en Aprobar o Denegar
    ↓
CRM: GET /webhook/aprobar-pedido?notifId=X&approved=1|0&sig=XXX
CRM: valida firma HMAC
CRM: actualiza estado pedido → Aprobado o Denegado
CRM: envía email al comercial con el resultado
CRM: muestra página "Listo" al Director
```

## URL del Webhook

```
POST https://farmadescanso-n8n.6f4r35.easypanel.host/webhook/d6977a0f-a949-4fdc-bb45-09083fda4f8b
```

## Payload esperado (JSON)

```json
{
  "pedido": {
    "id": 71,
    "numero": "P260001",
    "fecha": "2026-03-14",
    "total": 480.00,
    "subtotal": 440.77,
    "dtoPct": 10,
    "observaciones": "",
    "estado": "Revisando"
  },
  "cliente": {
    "id": 50,
    "nombre": "FARMACIA SAN LUIS C.B.",
    "nombreComercial": "",
    "cif": "E30123456",
    "direccion": "C/ Ejemplo 1",
    "poblacion": "Murcia",
    "cp": "30001",
    "telefono": "+34968123456",
    "email": "farmacia@ejemplo.com"
  },
  "comercial": {
    "id": 1,
    "nombre": "Lara Buitrago, Paco",
    "email": "p.lara@gemavip.com",
    "movil": "+34610721369"
  },
  "lineas": [
    {
      "articuloId": 15,
      "codigo": "220381",
      "nombre": "IALOZON COLLUTORIO AZUL 300 ML",
      "cantidad": 10,
      "precio": 7.46,
      "dto": 0,
      "iva": 21
    }
  ],
  "direccionEnvio": null,
  "excel": {
    "filename": "PEDIDO_P260001.xlsx",
    "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "base64": "<base64 del Excel>"
  },
  "approvalUrlApprove": "https://crm-gemavip.vercel.app/webhook/aprobar-pedido?notifId=1&approved=1&sig=abc123",
  "approvalUrlDeny": "https://crm-gemavip.vercel.app/webhook/aprobar-pedido?notifId=1&approved=0&sig=def456",
  "emailDirector": "j.deaza@gemavip.com",
  "emailCcResponsable": "c.betancourt@gmavip.com",
  "emailComercial": "p.lara@gemavip.com",
  "source": "crm_gemavip",
  "timestamp": "2026-03-14T10:30:00.000Z"
}
```

## Destinatarios de emails

| Email | Destinatario | Contenido |
|-------|-------------|-----------|
| Comercial | `emailComercial` del payload | Informativo: "Tu pedido está en revisión" |
| Director Comercial | j.deaza@gemavip.com | Detalle completo + Excel + botones Aprobar/Denegar |
| CC Responsable | c.betancourt@gmavip.com | Copia del email del Director |
| Comercial (resultado) | Enviado por el CRM tras aprobación/denegación | "Tu pedido ha sido aprobado/denegado" |

## Configuración en n8n

### Importar el workflow

1. En n8n: **Workflows** → **Import from File**
2. Seleccionar `n8n-workflow-aprobacion-pedidos.json`
3. Configurar credenciales SMTP en los nodos "Email Comercial" y "Email Director + CC"

### Credenciales

- **SMTP**: Configurar credenciales "CRM GEMAVIP" para el envío de emails

## Configuración en el CRM

1. **APROBACION_SECRET** (opcional): Se usa para firmar los enlaces de aprobación/denegación. Por defecto usa `API_KEY`.
2. **APP_BASE_URL**: Debe apuntar al dominio público del CRM (ej. `https://crm-gemavip.vercel.app`).
3. El endpoint `/webhook/aprobar-pedido` es público (no requiere login) y valida la firma HMAC.

## Endpoints del CRM

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/webhook/aprobar-pedido` | GET | Recibe clic de aprobación/denegación desde el email |
| `POST /pedidos/:id/estado` | POST | Comercial cambia estado (dispara el webhook si es "Revisando") |

## Troubleshooting

### El email no llega al Director

1. Verificar que el webhook n8n está activo y ejecutándose.
2. En n8n → **Executions** → buscar la ejecución tras el cambio de estado.
3. Verificar las credenciales SMTP en n8n.

### Aprobar/Denegar no funciona

1. Verificar que `APP_BASE_URL` apunta al dominio correcto del CRM.
2. Verificar que `APROBACION_SECRET` o `API_KEY` coinciden entre el CRM y la generación de enlaces.
3. Comprobar que la notificación no haya sido ya resuelta (solo se puede aprobar/denegar una vez).

### El Excel no se adjunta

1. Verificar que las líneas del pedido se cargan correctamente.
2. El Excel se genera con `buildStandardPedidoXlsxBuffer` y se envía como Base64 en el payload.
3. En n8n, el nodo "Preparar Excel adjunto" decodifica el Base64 y lo pasa como binary al nodo de email.
