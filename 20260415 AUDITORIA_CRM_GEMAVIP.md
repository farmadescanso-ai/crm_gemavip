# AUDITORIA COMPLETA - CRM Gemavip

**Fecha:** 15 de abril de 2026
**Analista:** Claude AI
**Proyecto:** CRM_Gemavip
**Rama:** main

---

## INDICE

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Estructura del Proyecto](#2-estructura-del-proyecto)
3. [Analisis de la Base de Datos](#3-analisis-de-la-base-de-datos)
4. [Auditoria de Seguridad](#4-auditoria-de-seguridad)
5. [Calidad de Codigo](#5-calidad-de-codigo)
6. [Rendimiento](#6-rendimiento)
7. [Recomendaciones Prioritarias](#7-recomendaciones-prioritarias)
8. [Conclusion](#8-conclusion)

---

## 1. Resumen Ejecutivo

CRM Gemavip es una aplicacion **Node.js + Express** para gestion comercial (CRM) orientada al sector farmaceutico/parafarmacia. Gestiona clientes (farmacias), comerciales, pedidos, visitas y comisiones, con integraciones externas (Holded ERP, Prestashop, Google OAuth, N8N).

*Valoraciones revisadas tras intervenciones en código (abril 2026): CORS, endurecimiento de endpoints, correcciones XSS y MIME en rutas concretas, validación con express-validator, modularización de `api/index.js` y `routes/clientes`, troceo de `cliente-form.ejs` en partials, CSP con nonces (`api/middleware/csp.js`), utilidades de importes (`toNum` / `round2`) expuestas en `res.locals` para EJS.*

| Aspecto | Valoracion |
|---------|-----------|
| Seguridad General | **8/10** - Buena base; CORS y varios frentes del §4 cerrados; revisar XSS/superficie restante |
| Calidad de Codigo | **6.5/10** - Mejor troceo; aún hay módulos muy extensos (p. ej. capa MySQL, otras vistas) |
| Esquema BD | **7/10** - Completo; criterio de dumps/credenciales sin cambio sustancial |
| Arquitectura | **7.5/10** - Entrada API y rutas HTML de clientes más claras; responsabilidades mejor separadas en zonas tocadas |
| Mantenibilidad | **6.5/10** - Menos duplicación en vistas/servidor (`lib/utils`, CSP extraída); sigue la deuda del núcleo `mysql-crm.js` y vistas extensas (p. ej. `pedidos.ejs`) |

### Puntuacion Global: **7.1 / 10** *(media de la tabla anterior: 8 + 6.5 + 7 + 7.5 + 6.5 = 35.5 → 35.5/5)*

---

## 2. Estructura del Proyecto

### 2.1 Stack Tecnologico

| Componente | Tecnologia |
|-----------|-----------|
| Runtime | Node.js >= 18 |
| Framework | Express 4.18.2 |
| Base de Datos | MySQL 9.6.0 (utf8mb4) |
| Motor de Plantillas | EJS 3.1.9 |
| Despliegue | Vercel (serverless) |
| Testing | Jest 30.2.0 + Supertest |
| Documentacion API | Swagger/OpenAPI |

### 2.2 Dependencias Principales

**Core:**
- `express` 4.18.2, `mysql2` 3.6.5, `ejs` 3.1.9
- `express-session` 1.17.3, `express-mysql-session` 3.0.3
- `bcryptjs` 2.4.3, `helmet` 7.1.0, `express-rate-limit` 8.3.1

**Integraciones:**
- `axios` 1.13.2, `nodemailer` 7.0.10, `googleapis` 166.0.0
- `web-push` 3.6.7, `exceljs` 4.4.0, `pdf-parse` 1.1.1

**Utilidades:**
- `express-validator` 7.0.1, `jsonwebtoken` 9.0.2, `compression` 1.7.4
- `swagger-jsdoc` 6.2.8, `swagger-ui-express` 5.0.1

### 2.3 Arbol de Directorios

```
CRM_Gemavip/
├── api/                        # Punto de entrada (serverless)
│   ├── index.js               # App principal (~145 lineas; CSP y errores en middleware/)
│   ├── health.js              # Health check
│   └── *.php                  # Legacy PHP endpoints
├── config/                     # Configuracion y dominios
│   ├── domains/               # Logica de negocio (7 modulos)
│   ├── db-pool-config.js      # Pool de conexiones
│   ├── mysql-crm*.js          # 20+ modulos de datos
│   └── schema-bd.json         # Esquema de BD
├── lib/                        # Utilidades (40+ archivos)
│   ├── auth.js                # Autenticacion
│   ├── csrf.js                # Proteccion CSRF
│   ├── rate-limit.js          # Rate limiting
│   ├── logger.js              # Logging
│   └── utils.js               # Helpers generales
├── routes/                     # Rutas
│   ├── api/                   # 13 endpoints REST API
│   ├── public/                # Rutas publicas
│   └── *.js                   # 11+ rutas HTML
├── views/                      # 45+ plantillas EJS
│   └── partials/              # Componentes reutilizables
├── public/                     # Assets estaticos
│   ├── scripts/               # JS cliente
│   └── styles/                # CSS
├── scripts/                    # 100+ scripts utilidad
├── tests/                      # 11+ archivos *.test.js (Jest)
├── uploads/                    # Subidas de usuarios
├── docs/                       # Documentacion (28+ archivos)
└── sql/                        # Scripts SQL
```

### 2.4 Puntos de Entrada y Rutas

| Tipo | Archivo | Endpoints |
|------|---------|-----------|
| API REST | `routes/api/clientes.js` | CRUD clientes |
| API REST | `routes/api/comerciales.js` | CRUD comerciales |
| API REST | `routes/api/pedidos.js` | CRUD pedidos |
| API REST | `routes/api/visitas.js` | CRUD visitas |
| API REST | `routes/api/notificaciones.js` | Notificaciones |
| API REST | `routes/api/holded-sync.js` | Sync Holded ERP |
| HTML | `routes/auth.js` | Login/logout/recuperacion |
| HTML | `routes/dashboard.js` | Panel principal |
| HTML | `routes/clientes.js` | Gestion clientes UI |
| HTML | `routes/pedidos.js` | Gestion pedidos UI |
| HTML | `routes/ventas-gemavip.js` | Informes ventas |

---

## 3. Analisis de la Base de Datos

### 3.1 Visión General

| Metrica | Valor |
|---------|-------|
| Nombre BD | `crm_gemavip` |
| Version MySQL | 9.6.0 |
| Total Tablas | 69 |
| Charset | utf8mb4 |
| Tamano dump | ~1.1 MB |
| Lineas SQL | 11.196 |

### 3.2 Tablas Principales

**Nucleo de negocio:**

| Tabla | Columnas | Descripcion |
|-------|----------|-------------|
| `clientes` | 69 | Gestion de clientes (farmacias) |
| `comerciales` | 23 | Representantes de ventas |
| `pedidos` | 34 | Pedidos de clientes |
| `pedidos_articulos` | 10 | Lineas de pedido |
| `articulos` | 21 | Catalogo de productos |
| `visitas` | 13 | Visitas comerciales |
| `agenda` | 18 | Contactos/agenda |

**Configuracion:**

| Tabla | Columnas | Descripcion |
|-------|----------|-------------|
| `configuraciones` | 7 | Ajustes del sistema |
| `variables_sistema` | 7 | Variables globales |
| `api_keys` | 10 | Claves API |
| `password_reset_tokens` | 6 | Tokens de recuperacion |

**Comisiones y finanzas:**

| Tabla | Columnas | Descripcion |
|-------|----------|-------------|
| `comisiones` | 17 | Cabecera de comisiones |
| `comisiones_detalle` | 9 | Detalle de comisiones |
| `config_comisiones_tipo_pedido` | 12 | Configuracion comisiones |
| `tarifasClientes` | 11 | Tarifas por cliente |
| `tarifasClientes_precios` | 6 | Precios de tarifas |

**Datos maestros:**

| Tabla | Descripcion |
|-------|-------------|
| `bancos` | Bancos |
| `paises` | Paises |
| `provincias` | Provincias espanolas |
| `codigos_postales` | Codigos postales |
| `formas_pago` | Formas de pago |
| `monedas` | Monedas |
| `idiomas` | Idiomas |
| `marcas` | Marcas de productos |
| `especialidades` | Especialidades farmaceuticas |

**Relaciones:**

| Tabla | Descripcion |
|-------|-------------|
| `clientes_contactos` | Contactos de clientes |
| `clientes_cooperativas` | Cooperativas de clientes |
| `clientes_gruposCompras` | Grupos de compra |
| `clientes_relacionados` | Clientes relacionados |
| `comerciales_codigos_postales_marcas` | Asignacion territorial |

### 3.3 Relaciones (Foreign Keys)

```
clientes ──→ comerciales (cli_com_id)
clientes ──→ especialidades (esp_id)
clientes ──→ formas_pago (formp_id)
clientes ──→ paises (pais_id)
clientes ──→ provincias (prov_id)

pedidos ──→ clientes (ped_cli_id)
pedidos ──→ comerciales (ped_com_id)
pedidos ──→ estados_pedido (estped_id)
pedidos ──→ formas_pago (formp_id)
pedidos ──→ tipos_pedidos (tipp_id)

pedidos_articulos ──→ pedidos (ped_id)
pedidos_articulos ──→ articulos (art_id)

visitas ──→ clientes (cli_id)
visitas ──→ comerciales (com_id)
```

**Acciones de borrado:**
- CASCADE en tablas de detalle
- RESTRICT en relaciones comerciales-clientes
- SET NULL en foreign keys opcionales

### 3.4 Indices Relevantes

**Indices unicos:**
- `NumberFarmacia`, `CuentaContable` (clientes)
- `cli_Id_Holded` (clientes)
- `SKU`, `EAN13`, `art_id_holded` (articulos)
- `api_api_key` (api_keys)
- `pwdres_token` (password_reset_tokens)

**Indices compuestos clave:**
- `idx_clientes_com_estado_id` (cli_com_id, cli_estcli_id, cli_id)
- `idx_clientes_com_tipo_id` (cli_com_id, cli_tipc_id, cli_id)
- `idx_clientes_cial_okko` (cli_com_id, cli_ok_ko)

**Busqueda full-text:**
- `ft_clientes_busqueda` (8 columnas para busqueda de clientes)
- `ft_contactos_busqueda` (6 columnas para busqueda de contactos)

**Total:** 200+ indices en todo el esquema

### 3.5 Procedimientos Almacenados

| Procedimiento | Descripcion |
|---------------|-------------|
| `_add_index_if_not_exists` | Creacion condicional de indices |
| `normalizar_telefono` | Normalizacion de telefonos (formato espanol) |
| `title_es` | Formateo title case con reglas de acentos |

### 3.6 Convenciones de Nomenclatura

**Tablas:** Nombres en espanol, minusculas con guiones bajos
- Prefijos en columnas: `cli_`, `com_`, `ped_`, `art_`
- Foreign keys: `tabla_id` (ej: `cli_com_id`, `ped_cli_id`)
- Booleanos: `activo`, `esta_activo`

**Inconsistencias detectadas:**
- Nombres mezclados espanol/ingles (`created_at` vs `creado_en`)
- CamelCase mezclado con snake_case (`gruposCompras`, `codigos_postales`)
- Columnas duplicadas por migracion (texto vs FK: `ped_estado_txt` / `ped_estped_id`)

---

## 4. Auditoria de Seguridad

### 4.1 Autenticacion: BUENA (9/10)

**Aciertos:**
- Contrasenas hasheadas con bcrypt (cost factor 12)
- Sesiones basadas en MySQL con `express-mysql-session`
- Rate limiting en login (5 intentos / 15 minutos)
- Tokens de recuperacion con expiracion (1 hora)
- Comprobacion de usuario activo/inactivo
- La cuenta "pool comercial" (ID 26) no puede hacer login

**Implementacion:** `routes/auth.js`, `lib/auth.js`

### 4.2 Proteccion CSRF: BUENA (8/10)

**Aciertos:**
- Implementacion custom con patron Synchronizer Token
- Tokens almacenados en sesion
- Validacion en POST/PUT/DELETE para usuarios autenticados
- Excluye rutas API (protegidas por API key), webhooks, health y `sw.js`; rutas con flujo especial (p. ej. subida) pueden usar validacion diferida
- Formularios HTML relevantes incluyen campo oculto `_csrf` vía `views/partials/csrf-field.ejs` donde se integró
- Cabecera `X-CSRF-Token` admitida en preflight CORS cuando hay lista de orígenes

**Implementacion:** `lib/csrf.js`, `api/index.js` (`csrfProtection({ skipPaths, deferValidationPaths })`)

### 4.3 Inyeccion SQL: BUENA (9/10)

**Aciertos:**
- TODAS las consultas usan sentencias preparadas con parametros
- Uso de `mysql2` con sintaxis de placeholders (`?`)
- Nombres de columnas escapados con backticks
- Nombres de tablas validados con regex: `/^[a-zA-Z0-9_\-]+$/`

**NO SE ENCONTRARON VULNERABILIDADES DE INYECCION SQL**

### 4.4 Vulnerabilidades XSS: MEJORABLE (6/10)

**Situacion actual:**

- **`escapeHtml`** disponible en todas las vistas vía `res.locals.escapeHtml` (`api/middleware/ejs-res-locals.js`, implementación en `lib/utils.js`). Mensajes **`error`** en formularios/listados pasan por `escapeHtml(error)` en la mayoría de plantillas.
- Reflejos de búsqueda **`q`** / **`returnTo`** / textos de error en páginas sensibles (login, `clientes`, `pedidos`, `dashboard`, comparar Holded) escapados en atributos `value` o en texto.
- La vista **`error.ejs`** escapa título, resumen, pasos, etiqueta de acción, ID de petición y bloque de soporte.
- **CSP** con nonces limita `<script>` arbitrario; siguen revisándose otras salidas `<%= %>` (nombres de negocio en tablas, etc.) y el JS que construye HTML en string (ficha cliente).
- Atributo **`href`** en `error.ejs` sigue confiando en valores generados por el servidor (`primaryAction.href`); no reflejar ahí input de usuario sin allowlist.

**Prioridad:** Extender el mismo criterio al resto de campos reflejados (URLs en tablas, tooltips con datos externos) y revisar concatenaciones en scripts cliente.

### 4.5 Subida de Archivos: MEJORABLE (6/10)

**Configuracion actual (`routes/ventas-gemavip.js`):**
- `multer` en memoria, límites 15MB y hasta 5 ficheros
- **`fileFilter`:** extensión `.pdf` y MIME permitidos (`application/pdf`, `application/x-pdf`, u `application/octet-stream` solo si la extensión es `.pdf`)
- Tras multer, comprobación de **cabecera binaria `%PDF`** (`bufferLooksLikePdf`) para mitigar renombrados

**Aciertos:** Límites razonables, doble capa extensión + MIME + firma PDF.

**Problemas residuales:**
- Sin escaneo antivirus
- Nombre de archivo al persistir: revisar sanitización en `lib/ventas-storage` si se expone al cliente o al disco

### 4.6 Configuracion de Sesiones: BUENA (9/10)

**Aciertos:**
- Cookies: `httpOnly: true`; `sameSite` configurable por entorno (`SESSION_COOKIE_SAMESITE`: `lax` / `strict` / `none`)
- Con `sameSite: 'none'`, `secure: true` es obligatorio; en el resto de casos `secure` sigue el modo producción
- Sesiones rolling (`rolling: true`)
- Almacen MySQL (`express-mysql-session`) con expiración y limpieza
- Timeout / `maxAge` derivados de `SESSION_IDLE_TIMEOUT_MINUTES` y `SESSION_MAX_AGE_DAYS` (ver `api/setup-session-pool.js`)
- En desarrollo, si falta `SESSION_SECRET`, se usa secreto **efímero** (sesiones no sobreviven al reinicio) o `DEV_SESSION_SECRET` si está definido

### 4.7 Variables de Entorno: MEJORABLE (7/10)

**Aciertos:**
- `.env.example` documenta sesión, CORS, DB, flags de debug, etc.
- En entornos tipo producción (`NODE_ENV=production` o `VERCEL`), **falta de `SESSION_SECRET` aborta el arranque**
- API keys y rutas sensibles acotadas con middleware (`requireApiKeyIfConfigured`)

**Puntos a vigilar:**

1. **Desarrollo local:** sin `SESSION_SECRET` el secreto es aleatorio en cada arranque; para sesiones estables usar `SESSION_SECRET` o `DEV_SESSION_SECRET` (ya no se usa el literal fijo `dev-secret-change-me` del informe original).
2. **`/api/debug-login`:** solo responde si **no** es producción, `ENABLE_DEBUG_LOGIN=1`, existe `DEBUG_LOGIN_SECRET` (≥16 caracteres) y coincide con `?secret=…`. En producción típica devuelve **404**. Riesgo residual: configuración errónea en un entorno “no prod” con datos reales.
3. **`GET /health/db`:** en **producción** la respuesta exitosa es mínima (`ok`, `service`, `timestamp`); el detalle de host/usuario/BD y ping solo en no producción. Sigue protegido por API key si está configurada.

### 4.8 CORS: IMPLEMENTADO (7/10)

**Estado:** Middleware `corsMiddleware` en `lib/cors-middleware.js`, registrado en `api/index.js`.

**Comportamiento:**
- Variable **`CORS_ORIGINS`**: lista separada por comas de orígenes permitidos (sin barra final).
- Si la lista está **vacía**, no se envían cabeceras CORS adicionales: el comportamiento por defecto del navegador es mismo origen.
- Si hay orígenes: se refleja `Access-Control-Allow-Origin` solo para `Origin` permitido, `Access-Control-Allow-Credentials: true`, y respuesta **204** a `OPTIONS` con métodos y cabeceras habituales (incl. `X-API-Key`, `X-CSRF-Token`).

**Riesgo residual:** Origen olvidado en la lista en despliegues con front separado; pruebas de preflight en cada entorno.

### 4.9 Validacion de Entrada: MEJORABLE (6/10)

**Aciertos:**
- Coercion y trim manual en muchas rutas legacy
- **`express-validator`** centralizado en módulos bajo `lib/validators/` (API: clientes, pedidos, visitas, comerciales, notificaciones, webhook, holded-sync, push; UI HTML: clientes, pedidos, visitas; `lib/validators/auth.js`)
- **`lib/validation-handlers.js`** para respuestas JSON uniformes tras validación
- Tests sobre validadores de query de API clientes (`tests/lib/validators-api-clientes-query.test.js`)

**Problemas persistentes:**
- Cobertura desigual: no todas las rutas pasan por cadenas `express-validator`
- Límites de longitud y sanitización de strings no siempre explícitos en HTML/forms
- Algunos endpoints siguen validando “a mano”

### 4.10 Autorizacion: BUENA (8/10)

**Aciertos:**
- Control de acceso basado en roles (admin vs comercial)
- Middlewares: `requireAdmin`, `requireLogin`, `requireLoginJson`, `requireSystemAdmin`
- Comprobacion de propiedad de recursos por usuario
- No se detectaron bypasses de autorizacion

### 4.11 Manejo de Errores: BUENA (8/10)

**Aciertos:**
- Registro de manejadores HTTP vía `registerHttpErrorHandlers` (`api/middleware/http-error-handlers.js`), montado desde `api/index.js`
- Paginas de error personalizadas
- Stack traces solo en desarrollo
- Request IDs para debugging (`X-Request-Id`)

### 4.12 Content Security Policy (CSP) y Helmet: BUENA (8/10)

**Estado:** `api/middleware/csp.js` + `helmet` (CSP desactivada en el bloque principal de Helmet porque la CSP se aplica con middleware dedicado).

**Directivas principales (app HTML):**
- `default-src 'self'`
- `script-src` / `style-src`: `'self'`, **nonce por petición**, CDNs usados (p. ej. jsDelivr, fuentes Google), `vercel.live` en scripts donde aplica
- Sin `'unsafe-inline'` en esas dos directivas para bloques `<script>`/`<style>`; los bloques en EJS llevan `nonce="<%= cspNonce %>"` (vía `res.locals.cspNonce`)
- **`script-src-attr`** / **`style-src-attr`**: `'unsafe-inline'` de forma **transitoria** (handlers `onclick` / estilos en atributo) hasta migrar a listeners y CSS
- `frame-ancestors 'none'`
- **`/api/docs` (Swagger UI):** CSP relajada con `'unsafe-inline'` en script y estilo (Swagger inyecta bloques inline sin nonce)

### 4.13 Credenciales Expuestas en el Dump SQL: CRITICA

**Encontradas en `crm_gemavip (8).sql`:**

| Secreto | Ubicacion |
|---------|-----------|
| Prestashop API Key | `variables_sistema` |
| Prestashop Webservice Key | `variables_sistema` |
| Google OAuth Client Secret | `variables_sistema` |
| URL admin Prestashop con token | `variables_sistema` |
| Contrasena SMTP en texto plano | `variables_sistema` (`Ozono@2026_`) |
| Tokens OAuth (Teams/Meet) | `comerciales` (access + refresh) |

**ACCION INMEDIATA REQUERIDA:**
- Rotar TODAS las claves expuestas
- Eliminar el archivo SQL del repositorio
- Anadir `*.sql` al `.gitignore`
- Cifrar tokens OAuth en la base de datos

---

## 5. Calidad de Codigo

*Revisión de coherencia (post-cambios en código): métricas de líneas alineadas con el repo; rutas de clientes ya no son un único archivo; tests y utilidades comunes mejor documentados.*

### 5.1 Archivos Monoliticos (Alto Riesgo)

| Archivo | Lineas (conteo repo) | Nota |
|---------|----------------------|------|
| `api/index.js` | ~145 | Entrada y montaje de middleware/rutas; CSP en `api/middleware/csp.js` |
| `routes/clientes/*.js` | ~1460 en conjunto | Carpeta modular (`edit.js` ~440 líneas es el mayor; luego `new.js`); conviene seguir troceando handlers largos |
| `config/mysql-crm.js` | ~1810 | Núcleo + mixins (`mysql-crm-*.js`, p. ej. `mysql-crm-push.js`); sigue siendo el mayor acoplamiento de datos |
| `views/cliente-form.ejs` | ~112 | Troceado en partials; carga principal en componentes incluidos |
| `views/pedidos.ejs` | ~565 | Lógica de tabs/estados en `public/scripts/pedidos-page.js` + `public/styles/pedidos-page.css`; queda HTML/EJS y un JSON de config |

**Otros candidatos** (no tabulados arriba): `lib/pedido-helpers.js`, `routes/pedidos.js` o vistas de panel Holded pueden superar con holgura las 400–600 líneas; conviene revisión por dominio.

### 5.2 Duplicacion de Codigo

**Patrones duplicados o parcialmente mitigados:**

1. **Resolucion de columnas case-insensitive:** Implementación única en `MySQLCRM._pickCIFromColumns` (`mysql-crm.js`); los mixins la reutilizan (persiste verbosidad de llamadas, no duplicación del algoritmo).
2. **Numeros en vistas (importes, redondeos):** `toNum` y `round2` centralizados en `lib/utils.js` y expuestos en `res.locals` (`ejs-res-locals.js`); aún puede quedar lógica numérica puntual en EJS o partials legacy.
3. **Normalizacion de telefonos:** Base en `lib/telefono-utils.js` + helpers EJS; revisar que no se reintroduzcan variantes en rutas sueltas.
4. **Logica de paginacion:** Patron repetido en varios endpoints (existe `lib/pagination.js` con tests; adopción desigual).
5. **Checks de permisos admin / validacion de sesion:** Middlewares en `lib/auth.js` y rutas; aún hay repetición de `requireLogin` / `isAdminUser` en handlers.

### 5.3 Anti-Patrones

| Anti-Patron | Ubicacion | Descripcion |
|-------------|-----------|-------------|
| God Object | `config/mysql-crm.js` | Núcleo de BD + muchos dominios mezclados en una clase instanciada una vez |
| Magic Numbers | Multiples archivos | IDs o constantes de negocio embebidos (revisar al tocar pool/config) |
| Magic Strings | Rutas / estados | Valores de estado o códigos como cadenas sin enum centralizado |
| Handlers largos | `routes/clientes/edit.js`, `routes/pedidos.js` | Rutas con bloques de 100+ líneas (ya no aplica un único `routes/clientes.js`) |
| Null inconsistente | Global | Mezcla `??`, `||` y checks manuales según archivo |

### 5.4 Convenciones de API

**Aciertos:**
- Convenciones RESTful generalmente seguidas
- Formato de respuesta consistente: `{ok: true/false, data/error}`
- HTTP methods apropiados (GET, POST, PUT, DELETE, PATCH)
- Documentacion Swagger/OpenAPI presente

**Problemas:**
- Nomenclatura inconsistente (camelCase vs snake_case en parametros)
- Algunos endpoints sin paginacion
- Respuestas no uniformes en algunos casos

### 5.5 Testing

| Metrica | Estado |
|---------|--------|
| Framework | Jest 30.2.0 + Supertest |
| Archivos `*.test.js` | 11 (carpeta `tests/`, p. ej. `lib/utils`, `pagination`, `tax-helpers`, `validators-api-clientes-query`, …) |
| Cobertura estimada | Baja global; algo de cobertura en utilidades puras (`lib/`) |
| Tipos test | Mayoría unitarios sobre helpers; `tests/health.test.js` como smoke HTTP |

**Aciertos recientes:**
- Tests sobre `toNum` / `round2`, `safeJsonInline`, CORS parse, paginación, validadores de query API clientes, timezone del pool MySQL.

**Carencias:**
- Pocos o ningún test sobre rutas HTML dominantes (`pedidos`, `clientes`) o capa `config/mysql-crm-*`
- Sin batería dedicada de seguridad (CSP, CSRF, auth) ni de rendimiento
- Sin suite de integración amplia (BD + flujos E2E)

### 5.6 Logging

| Aspecto | Estado |
|---------|--------|
| Logger dedicado | `lib/logger.js` |
| Niveles | Condicionales por entorno |
| Request ID | Implementado |
| Formato estructurado | Parcial |

**Problemas:**
- `console.log` dispersos por el codigo
- Sin formato estructurado consistente
- Sin agregacion de logs
- Logs de debug en codigo de produccion

---

## 6. Rendimiento

### 6.1 Problemas de Base de Datos

| Problema | Severidad | Descripcion |
|----------|-----------|-------------|
| Over-indexing | Media | Algunas tablas con 20+ indices |
| Columnas VARCHAR(500) | Baja | Para arrays JSON |
| Full-text indexes | Baja | Puede impactar rendimiento de escritura |
| Datos denormalizados | Media | Nombres de cliente en multiples tablas |

### 6.2 Problemas de Aplicacion

| Problema | Severidad | Descripcion |
|----------|-----------|-------------|
| N+1 queries | Alta | Consultas en bucle en `domains/clientes.js` |
| Sin cache HTTP | Media | No hay headers de cache en API |
| Sin cache de datos | Media | Solo cache de metadata de esquema |
| Plantillas grandes | Baja | `cliente-form.ejs` ya troceado; otras vistas (p. ej. informes, panel) pueden seguir siendo pesadas |

### 6.3 Recomendaciones de Rendimiento

1. Resolver queries N+1 con JOINs o carga anticipada
2. Implementar cache HTTP para respuestas API
3. Revisar y optimizar indices de BD
4. Implementar paginacion en todos los endpoints de lista
5. Considerar particionamiento en tablas grandes (pedidos, clientes)
6. Implementar replicas de lectura para informes

---

## 7. Recomendaciones Prioritarias

### CRITICO (Inmediato - 1 semana)

| # | Accion | Impacto |
|---|--------|---------|
| 1 | **Rotar TODAS las credenciales expuestas** en el dump SQL | Seguridad |
| 2 | **Eliminar `crm_gemavip (8).sql` del repositorio** y anadir `*.sql` a `.gitignore` | Seguridad |
| 3 | **Seguir endureciendo XSS** (revisar salidas `<%= %>` restantes, HTML generado en cliente, `href` dinámicos) | Seguridad |

*Del borrador original del informe, las acciones “implementar CORS” y “cerrar debug-login en producción” ya están cubiertas en código — ver §4.8 y §4.7. Mantener revisión operativa: `CORS_ORIGINS` correcto por entorno y flags de debug desactivados fuera de local. Volcados SQL: además de `data/bd-dumps/*.sql`, se ignora `/*.sql` en la raíz del repo.*

### ALTO (2-3 semanas)

| # | Accion | Impacto |
|---|--------|---------|
| 6 | Revisar nombres de fichero y pipeline de subidas (Holded/otros) si aplica el mismo patrón | Seguridad |
| 7 | Extender `express-validator` a las rutas API/HTML que aún validan solo a mano | Seguridad |
| 8 | Revisar documentación de `SESSION_SECRET` / `DEV_SESSION_SECRET` y rotación en equipos | Seguridad |
| 9 | Continuar troceo de rutas y vistas pesadas (`routes/pedidos.js`, panel Holded, etc.) | Mantenibilidad |
| 10 | Resolver queries N+1 en modulos de dominio | Rendimiento |
| 11 | Cifrar tokens OAuth en la base de datos | Seguridad |

### MEDIO (1 mes)

| # | Accion | Impacto |
|---|--------|---------|
| 12 | Crear middleware de validacion centralizado | Calidad |
| 13 | Extraer logica duplicada en utilidades compartidas | Mantenibilidad |
| 14 | Mejorar cobertura de tests (objetivo: 50%) | Calidad |
| 15 | Implementar logging estructurado | Operaciones |
| 16 | Estandarizar formato de respuestas API | Calidad |
| 17 | Implementar cache HTTP para endpoints API | Rendimiento |

### BAJO (Backlog)

| # | Accion | Impacto |
|---|--------|---------|
| 18 | Refactorizar plantillas EJS grandes | Mantenibilidad |
| 19 | Anadir JSDoc/TypeScript para tipado | Calidad |
| 20 | Crear documentacion de arquitectura | Documentacion |
| 21 | Implementar auditoria de logs | Cumplimiento |
| 22 | Revisar y optimizar indices de BD | Rendimiento |
| 23 | Separar configuracion por entorno | Operaciones |

---

## 8. Conclusion

CRM Gemavip es una aplicacion funcional con **buenas bases de seguridad** en autenticacion, proteccion CSRF y prevencion de inyeccion SQL. Sin embargo, presenta **vulnerabilidades criticas** que requieren atencion inmediata:

### Fortalezas
- Autenticacion robusta con bcrypt y sesiones seguras (cookies endurecidas, `SESSION_SECRET` obligatorio en prod)
- Todas las consultas SQL usan parametros preparados
- Proteccion CSRF (token de sesión + campos en formularios donde aplica)
- **Helmet** + **CSP con nonces** y `frame-ancestors 'none'`; CORS con lista blanca opcional
- Rate limiting en endpoints criticos
- Arquitectura modular en crecimiento (`routes/clientes/*`, middleware CSP, assets de `pedidos`)

### Debilidades Criticas
- **Credenciales expuestas** en el dump SQL (API keys, SMTP password, OAuth secrets) — rotación y retirada del artefacto del repo
- **XSS reflejado / HTML injection** en salidas que aún no pasan por `escapeHtml` o allowlist; la CSP ayuda pero no sustituye el escape
- **Otras subidas** (si existen fuera de ventas PDF) sin el mismo rigor MIME + firma

### Debilidades de seguridad a vigilar (no críticas si la config es correcta)
- Lista **`CORS_ORIGINS`** y preflights en cada despliegue con front separado
- **`/api/debug-login`** solo en entornos locales con flags explícitos; evitar datos reales en máquinas compartidas con debug activado

### Debilidades de Calidad
- Núcleo de datos **`config/mysql-crm.js`** y varias rutas/vistas aún voluminosas
- Duplicacion de codigo significativa
- Cobertura de tests baja
- Logging inconsistente
- Convenciones de nomenclatura mezcladas

### Siguiente Paso Inmediato

**Priorizar las acciones críticas restantes** de la sección 7 (sobre todo credenciales del dump y rotación). XSS y subidas PDF: mitigaciones aplicadas en código — mantener auditoría de nuevas vistas y rutas.

---

*Informe generado automaticamente el 15 de abril de 2026*
