# Pasos para actualizar el workflow de notificaciones en n8n

## Paso 1: Reimportar el workflow

1. Abre n8n: https://farmadescanso-n8n.6f4r35.easypanel.host
2. Localiza el workflow **"Notificaciones Gemavip"**
3. Menú (⋮) del workflow → **Delete** (o desactívalo primero)
4. **Add workflow** → **Import from File** (o arrastra el archivo)
5. Selecciona: `c:\Users\pacol\CURSOR\CRM_Gemavip\n8n-workflow-notificaciones-gemavip.json`
6. **Edita el nodo "HTTP: Asignar cliente en CRM"** y sustituye `REPLACE_CON_TU_API_KEY` por tu API key real (si n8n da "access to env vars denied", este paso es obligatorio)
7. **Save** y activa el workflow (toggle en la esquina superior derecha)

## Paso 2: Verificar el correo de j.deaza (aprobación)

1. Envía una solicitud de asignación al webhook:
   ```
   POST https://farmadescanso-n8n.6f4r35.easypanel.host/webhook/76e48302-8d17-42fc-bb9e-37865d180728
   ```
   Con el body JSON indicado en `docs/N8N-ASIGNACION-CLIENTE.md`

2. **j.deaza@gemavip.com** debe recibir un email con:
   - Contenido HTML (solicitud, datos del cliente, estilo Gemavip)
   - Botones **Aprobar** y **Rechazar**

3. Si no aparecen los botones: revisa en n8n el nodo "Send message and wait for response" que tenga configurado `approvalType: "double"` y que las credenciales SMTP estén correctas.
4. El workflow tiene `appendAttribution: false` para quitar el footer "This email was sent automatically with n8n".

## Paso 3: Probar notificaciones a p.lara

1. Con el email recibido por j.deaza, haz clic en **Aprobar** o **Rechazar**
2. **p.lara@gemavip.com** debe recibir la notificación con:
   - Asunto: "✓ Asignación aprobada" o "✗ Asignación denegada"
   - Cuerpo HTML completo (datos del cliente, estilos Gemavip)
   - Sin el texto genérico "This email was sent automatically with n8n" como único contenido

3. Si se aprobó: el CRM debe haber actualizado `cli_com_id` del cliente al comercial.

## Si Aprobar no asigna el cliente

Si ves "Got it, thanks" al hacer clic en Aprobar pero el cliente no se asigna, consulta la sección **Troubleshooting** en `docs/N8N-ASIGNACION-CLIENTE.md`. Verifica:
- Variables `CRM_BASE_URL` y `API_KEY` en n8n
- Que la ejecución en n8n pase por la rama "true" del If y que el HTTP Request devuelva 200
