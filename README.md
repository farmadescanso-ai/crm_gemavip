# crm_gemavip

Portal CRM de GEMAVIP.

## Documentación

- **[Recuperación y cambio de contraseña](docs/RECUPERACION-CONTRASENA.md)** — Variables de entorno para SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, etc.) y URL base (`APP_BASE_URL` / `VERCEL_URL`) para el enlace de restablecimiento.
- [Roles y permisos](docs/ROLES.md)
- [Email Hefame OAuth2](docs/HEFAME-EMAIL-OAUTH2.md)

## N8N (envío de pedidos)

En `/pedidos` hay un icono de **enviar** por fila para mandar el pedido a un webhook de N8N, incluyendo el Excel:

- Si es **Transfer Hefame**, se adjunta la **plantilla** (`/pedidos/:id/hefame.xlsx`).
- En caso contrario, se adjunta el **Excel estándar** (`/pedidos/:id.xlsx`).

Configura el webhook en la variable de entorno `N8N_PEDIDOS_WEBHOOK_URL` (ver `.env.example`).

El envío al webhook se realiza en **JSON** e incluye el Excel como **Base64** en `excel.base64` junto con `excel.filename` y `excel.mime`.
