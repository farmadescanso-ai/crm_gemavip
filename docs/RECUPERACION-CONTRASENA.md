# Recuperación y cambio de contraseña

El CRM incluye flujos seguros para **olvidar contraseña** (por email) y **cambiar contraseña** (con sesión iniciada).

## Rutas

| Ruta | Descripción |
|------|-------------|
| `/login/olvidar-contrasena` | Solicitar enlace de recuperación por email |
| `/login/restablecer-contrasena?token=xxx` | Establecer nueva contraseña con el token del email |
| `/cuenta/cambiar-contrasena` | Cambiar contraseña estando logueado (requiere contraseña actual) |

## Variables de entorno

### Envío de email (recuperación de contraseña)

Para que se envíe el correo con el enlace de restablecimiento, configura SMTP:

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `SMTP_HOST` | Servidor SMTP | `smtp.gmail.com` |
| `SMTP_PORT` | Puerto (587 TLS, 465 SSL) | `587` |
| `SMTP_SECURE` | `true` para SSL (puerto 465) | `false` |
| `SMTP_USER` | Usuario SMTP | `noreply@tudominio.com` |
| `SMTP_PASS` | Contraseña o app password | `********` |
| `MAIL_FROM` | Dirección "De" del correo (opcional; por defecto usa `SMTP_USER`) | `CRM Gemavip <noreply@tudominio.com>` |

**Si no configuras SMTP:** la aplicación sigue funcionando. La respuesta al usuario es la misma (no se revela si el email existe). El enlace de restablecimiento se escribe en los **logs del servidor** para que un administrador pueda enviarlo manualmente si hace falta.

### URL base del enlace de restablecimiento

El enlace que se envía por email se arma con la URL base de la aplicación:

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `APP_BASE_URL` | URL pública del CRM (sin barra final) | En Vercel: `https://<VERCEL_URL>`; en local: `http://localhost:3000` |
| `VERCEL_URL` | En Vercel se usa automáticamente si no existe `APP_BASE_URL` | (definido por Vercel) |

En producción (por ejemplo Vercel) suele bastar con `VERCEL_URL`. Si el CRM se sirve por otro dominio, define `APP_BASE_URL` con esa URL (ej. `https://crm-gemavip.vercel.app`).

## Base de datos

La tabla `password_reset_tokens` guarda los tokens de un solo uso. Si no existe, el código intenta crearla al arrancar (best-effort).

Para crearla a mano:

```bash
# Ejecutar el script en tu BD
mysql -u usuario -p nombre_bd < scripts/crear-tabla-password-reset-tokens.sql
```

## Seguridad

- **Sin enumeración de usuarios:** en "olvidar contraseña" la respuesta es la misma exista o no el email.
- **Límite de intentos:** máx. 3 solicitudes por email en 1 hora; máx. 10 por IP en 1 hora.
- **Token:** 64 caracteres hex (crypto), un solo uso, caducidad 1 hora.
- **Contraseñas:** almacenadas con bcrypt (12 rounds).
- **Cambio con sesión:** obligatorio indicar la contraseña actual.

## Enlaces en la interfaz

- En la pantalla de **login**: "¿Olvidaste tu contraseña?" → `/login/olvidar-contrasena`.
- Con **sesión iniciada**: menú de usuario → "Cambiar contraseña" → `/cuenta/cambiar-contrasena`.
