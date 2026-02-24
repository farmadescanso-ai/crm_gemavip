# Punto 21: Tabla sessions — Crecimiento ilimitado

**Auditoría:** Análisis CRM Gemavip  
**Problema:** La tabla `sessions` crece indefinidamente si no se limpian las sesiones expiradas.

---

## Solución aplicada

`express-mysql-session` incluye limpieza automática con:

- **`clearExpired: true`** — Activa la tarea periódica de borrado
- **`checkExpirationInterval`** — Cada cuántos ms se ejecuta (por defecto 15 min)

Configuración en `api/index.js`:

```javascript
const sessionStore = new MySQLStore(
  {
    createDatabaseTable: true,
    expiration: sessionMaxAgeMs,
    clearExpired: true,
    checkExpirationInterval: sessionCheckExpirationMs  // 900000 = 15 min
  },
  sharedPool
);
```

---

## Variable de entorno

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `SESSION_CHECK_EXPIRATION_MS` | `900000` (15 min) | Intervalo de limpieza de sesiones expiradas |

---

## Nota en serverless (Vercel)

En Vercel, cada instancia Lambda tiene su propio proceso. La limpieza solo se ejecuta cuando la instancia está activa (hay peticiones). Si la app está inactiva, no se ejecuta hasta la siguiente petición.

Para limpieza más agresiva en entornos serverless, se puede usar un cron externo (Vercel Cron, etc.) que llame a un endpoint de limpieza o ejecute un script SQL periódico.
