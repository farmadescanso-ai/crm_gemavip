# Resumen de cambios — Auditoría CRM Gemavip

**Fecha:** Febrero 2026  
**Origen:** Análisis completo del proyecto CRM Gemavip (24/02/2026)  
**Puntos aplicados:** 17 a 28

---

## Resumen ejecutivo

Se han aplicado las correcciones de los puntos 17 a 28 de la auditoría técnica. Los cambios afectan a: base de datos (índices, FKs, sesiones), rendimiento (caché EJS, límites body parser), seguridad (body parser, credenciales), búsquedas (LIKE/FULLTEXT), tests automatizados y documentación de dependencias.

---

## Cambios por punto

### Punto 17 — Foreign Keys

| Qué | Detalle |
|-----|---------|
| **Problema** | Sin claves foráneas reales en MySQL |
| **Solución** | Documentación del procedimiento de migración |
| **Archivos** | `docs/PUNTO-17-FOREIGN-KEYS.md` |
| **Acción** | Ejecutar scripts SQL manualmente cuando la BD esté migrada |

---

### Punto 18 — SELECT * extensivo

| Qué | Detalle |
|-----|---------|
| **Problema** | Queries con `SELECT *` aumentan tráfico y memoria |
| **Solución** | Sustitución por columnas explícitas |
| **Archivos** | `mysql-crm-comisiones.js`, `mysql-crm-clientes.js`, `mysql-crm.js`, `mysql-crm-pedidos.js`, `mysql-crm-login.js`, `domains/clientes.js`, `domains/notificaciones.js`, `mysql-crm-direcciones-envio.js`, `dashboard.js`, `api/index.js` |

---

### Punto 19 — Índices en startup

| Qué | Detalle |
|-----|---------|
| **Problema** | `CREATE INDEX` en startup bloquea tablas en producción |
| **Solución** | Índices fuera del startup por defecto; migración manual |
| **Archivos** | `scripts/indices-migracion.sql`, `docs/PUNTO-19-INDICES.md` |
| **Variable** | `ENABLE_INDEX_CREATION_ON_STARTUP=1` solo en desarrollo |
| **Acción** | `Get-Content scripts\indices-migracion.sql \| mysql -u usuario -p nombre_bd` |

---

### Punto 20 — IN() con arrays vacíos

| Qué | Detalle |
|-----|---------|
| **Problema** | `IN ()` con array vacío genera error SQL |
| **Solución** | Helper `_buildInClauseSafe()` en `mysql-crm.js` |
| **Archivos** | `config/mysql-crm.js`, `config/mysql-crm-clientes.js` |

---

### Punto 21 — Tabla sessions

| Qué | Detalle |
|-----|---------|
| **Problema** | Tabla `sessions` crece indefinidamente |
| **Solución** | `clearExpired: true` y `checkExpirationInterval` en express-mysql-session |
| **Archivos** | `api/index.js`, `docs/PUNTO-21-SESIONES.md` |
| **Variable** | `SESSION_CHECK_EXPIRATION_MS` (default 900000) |

---

### Punto 22 — Índice password_reset_tokens

| Qué | Detalle |
|-----|---------|
| **Problema** | Falta índice en `(comercial_id, used)` |
| **Solución** | Script de migración idempotente |
| **Archivos** | `scripts/add-index-password-reset-tokens.sql`, `docs/PUNTO-22-PASSWORD-RESET-INDEX.md` |

---

### Punto 23 — Búsquedas LIKE vs FULLTEXT

| Qué | Detalle |
|-----|---------|
| **Problema** | `LIKE '%texto%'` provoca full scan |
| **Solución** | Clientes ya usa MATCH AGAINST cuando puede; optimización en `getAdminPushSubscriptions` |
| **Archivos** | `config/mysql-crm.js`, `docs/PUNTO-23-LIKE-FULLTEXT.md` |
| **Cambio** | `LOWER(IFNULL(col,'')) LIKE '%admin%'` en lugar de dos LIKE |

---

### Punto 24 — Caché EJS en producción

| Qué | Detalle |
|-----|---------|
| **Problema** | Vistas EJS se recompilan en cada request |
| **Solución** | `app.set('view cache', process.env.NODE_ENV === 'production')` |
| **Archivos** | `api/index.js`, `docs/PUNTO-24-EJS-CACHE.md` |

---

### Punto 25 — Límite body parser

| Qué | Detalle |
|-----|---------|
| **Problema** | Límite 2MB permite DoS con cuerpos grandes |
| **Solución** | `express.json({ limit: '50kb' })` y `express.urlencoded({ limit: '50kb' })` |
| **Archivos** | `api/index.js`, `docs/PUNTO-25-BODY-PARSER-LIMIT.md` |

---

### Punto 26 — Tests automatizados

| Qué | Detalle |
|-----|---------|
| **Problema** | Sin suite de tests |
| **Solución** | Jest + Supertest; tests de utils, pagination y /health |
| **Archivos** | `jest.config.js`, `tests/lib/utils.test.js`, `tests/lib/pagination.test.js`, `tests/health.test.js`, `docs/PUNTO-26-TESTS.md` |
| **Comando** | `npm test` |

---

### Punto 27 — Credenciales en código

| Qué | Detalle |
|-----|---------|
| **Problema** | URLs de phpMyAdmin o credenciales en comentarios |
| **Solución** | Documentación y guía; configuración vía variables de entorno |
| **Archivos** | `docs/PUNTO-27-CREDENCIALES-EN-CODIGO.md` |

---

### Punto 28 — Dependencias

| Qué | Detalle |
|-----|---------|
| **Problema** | crypto, form-data, xlsx innecesarios o con licencia AGPL |
| **Solución** | Documentación; proyecto usa exceljs (MIT) y crypto nativo |
| **Archivos** | `docs/PUNTO-28-DEPENDENCIAS.md` |

---

## Archivos creados

| Archivo | Descripción |
|---------|-------------|
| `docs/PUNTO-17-FOREIGN-KEYS.md` | Procedimiento Foreign Keys |
| `docs/PUNTO-19-INDICES.md` | Índices fuera del startup |
| `docs/PUNTO-21-SESIONES.md` | Limpieza de sesiones |
| `docs/PUNTO-22-PASSWORD-RESET-INDEX.md` | Índice password_reset_tokens |
| `docs/PUNTO-23-LIKE-FULLTEXT.md` | Búsquedas LIKE vs FULLTEXT |
| `docs/PUNTO-24-EJS-CACHE.md` | Caché de vistas EJS |
| `docs/PUNTO-25-BODY-PARSER-LIMIT.md` | Límite body parser |
| `docs/PUNTO-26-TESTS.md` | Tests automatizados |
| `docs/PUNTO-27-CREDENCIALES-EN-CODIGO.md` | Credenciales en código |
| `docs/PUNTO-28-DEPENDENCIAS.md` | Dependencias |
| `docs/RESUMEN-AUDITORIA-CRM-GEMAVIP.md` | Este resumen |
| `scripts/indices-migracion.sql` | Índices idempotentes |
| `scripts/add-index-password-reset-tokens.sql` | Índice password reset |
| `jest.config.js` | Configuración Jest |
| `tests/lib/utils.test.js` | Tests utils |
| `tests/lib/pagination.test.js` | Tests pagination |
| `tests/health.test.js` | Test endpoint /health |

---

## Archivos modificados

| Archivo | Cambios principales |
|---------|----------------------|
| `api/index.js` | Límite urlencoded, view cache |
| `config/mysql-crm.js` | `_buildInClauseSafe`, búsqueda admin, template literal |
| `config/mysql-crm-clientes.js` | Uso de `_buildInClauseSafe` |
| `package.json` | Scripts test, devDependencies (jest, supertest) |
| `docs/DOCUMENTACION-TECNICA-CRM.md` | Enlaces a todos los PUNTO-*.md |

---

## Comandos útiles

```bash
# Ejecutar tests
npm test

# Migración de índices (PowerShell)
Get-Content scripts\indices-migracion.sql | mysql -u usuario -p nombre_bd

# Índice password_reset_tokens
mysql -u usuario -p nombre_bd < scripts/add-index-password-reset-tokens.sql
```

---

## Variables de entorno relevantes

| Variable | Uso |
|----------|-----|
| `ENABLE_INDEX_CREATION_ON_STARTUP` | 1 solo en desarrollo |
| `SESSION_CHECK_EXPIRATION_MS` | Intervalo limpieza sesiones (default 900000) |
| `SESSION_SECRET` | Obligatorio en producción |
| `DB_*` | Configuración BD (no en código) |
