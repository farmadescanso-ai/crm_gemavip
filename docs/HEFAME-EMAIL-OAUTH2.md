# Envío Hefame por email con Office 365 (OAuth2)

Si tu cuenta usa **Exchange / Office 365** con **OAuth2** (sin contraseña SMTP), el CRM puede enviar el email Hefame usando un token de Azure AD.

## Variables de entorno (Vercel o servidor)

Configura estas variables además de las habituales:

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST` | `outlook.office365.com` (para detectar OAuth2) |
| `SMTP_USER` | Email de la cuenta, ej. `p.lara@gemavip.com` |
| `AZURE_CLIENT_ID` | ID de la aplicación en Azure AD |
| `AZURE_CLIENT_SECRET` | Secret de la aplicación |
| `AZURE_REFRESH_TOKEN` | Refresh token (se obtiene una vez, ver abajo) |
| `AZURE_TENANT_ID` | Opcional. Tu tenant (ej. `common` o el GUID del tenant) |
| `HEFAME_MAIL_TO` | Opcional. Destinatario del email (por defecto p.lara@gemavip.com) |

**Nota:** Para **enviar** correo, Office 365 usa el servidor SMTP `smtp.office365.com` en el puerto **587** (STARTTLS). El puerto 443 de la configuración de Thunderbird es para recibir (Exchange), no para SMTP. El código usa automáticamente `smtp.office365.com:587` cuando detecta OAuth2.

## Cómo obtener el refresh token (una vez)

1. **Registrar una aplicación en Azure AD**
   - Entra en [Azure Portal](https://portal.azure.com) → **Azure Active Directory** → **Registros de aplicaciones** → **Nueva inscripción**.
   - Nombre: por ejemplo "CRM Gemavip Hefame".
   - Tipos de cuenta: "Solo en este directorio".
   - Crear.

2. **Permisos de la aplicación**
   - En la app → **Permisos de API** → **Agregar un permiso**.
   - **Microsoft Graph** → **Permisos delegados**.
   - Añade: `SMTP.Send` (o busca "Enviar correo como usuario").
   - Opcional: `offline_access` para poder usar refresh token.
   - Conceder consentimiento de administrador si te lo pide.

3. **Secret**
   - En la app → **Certificados y secretos** → **Nuevo secreto de cliente**. Copia el valor (solo se muestra una vez) → será `AZURE_CLIENT_SECRET`.
   - **Id de aplicación (cliente)** → será `AZURE_CLIENT_ID`.

4. **Obtener el refresh token (flujo de autorización)**
   - Opción A: Usar [esta herramienta de Microsoft](https://developer.microsoft.com/en-us/graph/graph-explorer) o un script de Node que abra el navegador, el usuario inicie sesión y se intercambie el código por tokens.
   - Opción B: Construir la URL de inicio de sesión y hacer el intercambio manualmente:
     - URL de autorización (en el navegador, con tu CLIENT_ID y TENANT):
       ```
       https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/authorize?client_id={CLIENT_ID}&response_type=code&redirect_uri=http://localhost&response_mode=query&scope=https://outlook.office365.com/SMTP.Send%20offline_access
       ```
     - Tras iniciar sesión, te redirige a `http://localhost?code=...`. Copia el valor de `code`.
     - Intercambia el código por tokens (POST a `https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token` con `grant_type=authorization_code`, `client_id`, `client_secret`, `code`, `redirect_uri`). En la respuesta, `refresh_token` es lo que debes guardar como `AZURE_REFRESH_TOKEN`.

5. **Configurar en Vercel**
   - En el proyecto → Settings → Environment Variables, añade:
     - `SMTP_HOST` = `outlook.office365.com`
     - `SMTP_USER` = `p.lara@gemavip.com`
     - `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_REFRESH_TOKEN`
     - Opcional: `AZURE_TENANT_ID` (si no usas `common`)

Tras desplegar, el botón **HEFAME (enviar email)** usará OAuth2 en lugar de contraseña y el envío debería funcionar.
