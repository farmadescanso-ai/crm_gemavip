# Resumen del CRM GEMAVIP – Para revisión

## 1. ¿Qué hace la aplicación?

Es un **portal CRM para comerciales** de Farmadescaso 2021 SL (GEMAVIP). Sirve para:

- **Contactos (clientes):** ver y gestionar la cartera de clientes asignada a cada comercial.
- **Pedidos:** crear, editar y seguir pedidos; exportar Excel; enviar a webhooks (p. ej. N8N).
- **Visitas:** registrar visitas a clientes (calendario, formularios).
- **Artículos:** catálogo de productos (solo lectura para comerciales; CRUD para admins).
- **Comerciales:** gestión de usuarios comerciales (solo administradores).
- **Notificaciones:** solicitudes de asignación de clientes y notificaciones push.
- **Dashboard:** resumen de clientes, pedidos y visitas (según rol).

**Stack:** Node.js, Express, EJS, MySQL, bcrypt, express-session. Desplegable en Vercel.

---

## 2. Cómo funciona el login (explicación sencilla)

### 2.1 Flujo general

1. El usuario entra en `/login` y envía **email** y **contraseña**.
2. La app busca el comercial en la tabla `comerciales` por email.
3. Si existe, compara la contraseña con el hash bcrypt guardado.
4. Si coincide, guarda en sesión: `id`, `nombre`, `email`, `roles`.
5. Redirige a `/dashboard`.

### 2.2 Dónde está el código

- **Rutas de login:** `routes/auth.js` (GET/POST `/login`, `/logout`, recuperar contraseña).
- **Lógica de autenticación:** `lib/auth.js` (middleware `requireLogin`, `isAdminUser`, etc.).
- **Base de datos:** `config/mysql-crm-login.js` y `config/domains/comerciales.js` (usuarios y tokens de reset).

### 2.3 Sesiones

- **Almacenamiento:** MySQL (tabla `sessions`), no en memoria.
- **Cookie:** `crm_session`, `httpOnly`, `sameSite: lax`, `secure` en producción.
- **Expiración:** por inactividad (`SESSION_IDLE_TIMEOUT_MINUTES`, por defecto 60 min) o por antigüedad (`SESSION_MAX_AGE_DAYS`).
- **Renovación:** `rolling: true` (cada petición renueva la sesión si hay actividad).

### 2.4 Contraseñas

- **Hash:** bcrypt (coste 12 al restablecer).
- **Recuperación:** enlace por email con token de 1 hora.
- **Rate limiting:** máximo 3 solicitudes de recuperación por email en 1 hora; tabla `password_reset_tokens` para tokens; `password_reset_ip_attempts` para intentos por IP.

### 2.5 Roles

- **Admin:** si el campo `Roll` del comercial contiene `"admin"` (case-insensitive).
- **Comercial:** resto de usuarios.
- Los roles se normalizan desde `Roll` (JSON, string separado por comas o valor único) y se guardan en `req.session.user.roles`.

---

## 3. Protección de rutas

| Middleware | Función |
|-----------|---------|
| `requireLogin` | Si no hay `req.session.user`, redirige a `/login`. |
| `requireAdmin` | Si no es admin, devuelve 403. |
| `loadPedidoAndCheckOwner` | Comprueba que el pedido pertenezca al comercial o que sea admin; si no, 404. |

**Rutas públicas:** `/login`, `/login/olvidar-contrasena`, `/login/restablecer-contrasena`, `/health`, rutas bajo `/public/`.

**Rutas protegidas:** casi todo lo demás usa `requireLogin`; algunas añaden `requireAdmin` (comerciales, admin, API docs, etc.).

---

## 4. API REST

- Base: `/api/`.
- Autenticación: sesión de la web (cookie) o API key (`requireApiKeyIfConfigured`).
- Rutas como `/api/comerciales` exigen admin.
- Documentación Swagger en `/api/docs/` (solo admins).

---

## 5. Variables de entorno relevantes para login

- `SESSION_SECRET` – Obligatorio en producción.
- `SESSION_IDLE_TIMEOUT_MINUTES` – Minutos de inactividad antes de expirar (por defecto 60).
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` – Conexión MySQL.
- `APP_BASE_URL` o `VERCEL_URL` – Para enlaces de restablecimiento de contraseña.
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` – Para enviar emails de recuperación.

---

## 6. Diagrama simplificado del flujo de login

```
Usuario → POST /login (email, password)
    ↓
db.getComercialByEmail(email)
    ↓
¿Existe? NO → 401 "Credenciales incorrectas"
    ↓ SÍ
¿Contraseña bcrypt válida? NO → 401 "Credenciales incorrectas"
    ↓ SÍ
req.session.user = { id, nombre, email, roles }
    ↓
redirect /dashboard
```
