# Recuperación y cambio de contraseña

El CRM incluye flujos seguros para **olvidar contraseña** (por email) y **cambiar contraseña** (con sesión iniciada).

## Rutas

| Ruta | Descripción |
|------|-------------|
| `/login/olvidar-contrasena` | Solicitar enlace de recuperación por email |
| `/login/restablecer-contrasena?token=xxx` | Establecer nueva contraseña con el token del email |
| `/cuenta/cambiar-contrasena` | Cambiar contraseña estando logueado (requiere contraseña actual) |

## Variables de entorno

### Checklist en Vercel (envío de email)

En **Vercel** → tu proyecto → **Settings** → **Environment Variables**, asegúrate de tener **exactamente** estos nombres (sensibles a mayúsculas):

| Variable      | Obligatorio para email | Descripción                    | Ejemplo / Notas |
|---------------|------------------------|--------------------------------|------------------|
| `SMTP_HOST`   | Sí                     | Servidor SMTP                  | `smtp.gmail.com`, `smtp.office365.com`, `mail.tudominio.com` |
| `SMTP_USER`   | Sí                     | Usuario SMTP (normalmente el email) | `noreply@tudominio.com` |
| `SMTP_PASS`   | Sí                     | Contraseña o **App Password**  | En Gmail: usar [Contraseña de aplicación](https://myaccount.google.com/apppasswords), no la contraseña normal |
| `SMTP_PORT`   | No (por defecto 587)    | Puerto                         | `587` (TLS) o `465` (SSL) |
| `SMTP_SECURE` | No (por defecto false)  | Usar SSL (puerto 465)         | `true` solo si usas puerto 465 |
| `MAIL_FROM`   | No                     | Dirección "De" del correo     | Si no se define, se usa `SMTP_USER` |

- **Entorno:** asigna las variables al entorno **Production** (y opcionalmente Preview si quieres que funcione en previews).
- **Tras cambiar variables:** haz un **redeploy** (Deployments → ⋮ en el último deploy → Redeploy) para que el servidor use los nuevos valores.
- **Gmail:** si usas Gmail, `SMTP_PASS` debe ser una **Contraseña de aplicación** (Google Account → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones), no tu contraseña de Gmail.

### Cómo comprobar si están bien configuradas

1. En Vercel, **Deployments** → abre el último deployment → pestaña **Functions** → selecciona la función que sirve `/api` o la ruta de tu app y revisa **Logs**.
2. Solicita de nuevo "¿Olvidaste tu contraseña?" con un email que exista en el CRM.
3. En los logs deberías ver:
   - Si **no** está configurado SMTP: `[MAILER] SMTP no configurado. Estado: {"configured":false,"hasHost":false,...}`. Entonces falta alguna de las tres variables (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) o no se aplicaron (redeploy).
   - Si **sí** está configurado y falla el envío: `[MAILER] Error enviando email: ...`. Ahí el mensaje indica el motivo (credenciales, red, etc.).
   - Si se envía bien: `[MAILER] Email de recuperación enviado a xxx@...`.

### Resumen de variables (referencia)

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `SMTP_HOST` | Servidor SMTP | — |
| `SMTP_PORT` | Puerto | `587` |
| `SMTP_SECURE` | `true` para SSL (puerto 465) | `false` |
| `SMTP_USER` | Usuario SMTP | — |
| `SMTP_PASS` | Contraseña o app password | — |
| `MAIL_FROM` | Dirección "De" (opcional) | Valor de `SMTP_USER` |

**Si no configuras SMTP:** la aplicación sigue funcionando. La respuesta al usuario es la misma (no se revela si el email existe). El enlace de restablecimiento se escribe en los **logs del servidor** para que un administrador pueda enviarlo manualmente si hace falta.

### URL base del enlace de restablecimiento

El enlace que se envía por email se arma con la URL base de la aplicación:

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `APP_BASE_URL` | URL pública del CRM **sin barra final** | En Vercel: `https://<VERCEL_URL>`; en local: `http://localhost:3000` |
| `VERCEL_URL` | En Vercel se rellena solo; se usa si no existe `APP_BASE_URL` | (definido por Vercel) |

En Vercel normalmente no hace falta definir `APP_BASE_URL` (se usa `https://` + `VERCEL_URL`). Si usas **dominio propio** (ej. `https://crm.tuempresa.com`), define `APP_BASE_URL=https://crm.tuempresa.com` para que el enlace del email apunte a tu dominio.

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
