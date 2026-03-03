# Plan de Mejoras para Rendimiento en Vercel

Basado en el informe de análisis del codebase (Metadata Discovery Overhead, seguridad, búsquedas).

---

## 1. Metadata Discovery Overhead (PRIORIDAD 1) ✅ Implementado

### Problema
En Vercel (serverless), cada cold start pierde la caché en memoria. Por cada búsqueda de cliente o login, el sistema hacía 5–10 consultas previas (`SHOW COLUMNS`, `information_schema`) solo para conocer nombres de tablas y columnas.

### Solución aplicada
- **`config/schema-columns.js`**: Mapeo estático de columnas para 27 tablas.
- **`config/mysql-crm.js`** (`_getColumns`): Usa el mapeo estático primero; solo consulta la BD si la tabla no está mapeada.
- **`config/table-names.js`**: Ya existía; evita consultas para resolver nombres de tablas.

**Impacto estimado:** ~80% menos consultas de metadatos en cold start (login, búsquedas, altas).

### Tablas con mapeo estático (27)

| Dominio | Tablas |
|---------|--------|
| **Core** | `clientes`, `comerciales`, `pedidos`, `pedidos_articulos`, `visitas` |
| **Catálogos** | `provincias`, `paises`, `formas_pago`, `tipos_clientes`, `tipos_pedidos`, `especialidades`, `estdoClientes`, `marcas`, `idiomas`, `articulos` |
| **Direcciones** | `codigos_postales`, `direccionesEnvio` |
| **Agenda** | `agenda`, `agenda_especialidades`, `agenda_roles` |
| **Otros** | `clientes_contactos`, `comerciales_codigos_postales_marcas`, `cooperativas`, `gruposCompras`, `notificaciones`, `tarifasClientes`, `tarifasClientes_precios` |

### Control
- `USE_STATIC_SCHEMA=0` desactiva el mapeo estático (fallback al comportamiento anterior).

### Añadir una tabla nueva
Editar `config/schema-columns.js` y añadir la tabla al objeto `SCHEMA_COLUMNS`:

```javascript
nombre_tabla: ['col1_id', 'col1_nombre', 'col1_activo', ...],
```

Ver `docs/NORMALIZACION-BD-PREFIJOS.md` para los nombres de columnas con prefijo por tabla.

---

## 2. Conexiones a BD ✅ Configurado y centralizado

### Configuración actual
- **`config/db-pool-config.js`**: Config centralizada para el pool MySQL (evita duplicación).
- **Pool compartido**: `api/index.js` crea un único pool usado por sesión, db y comisiones.
- **`connectionLimit`**: 3 en Vercel, 10 en local. Variable `DB_CONNECTION_LIMIT` para ajustar.
- **`queueLimit`**: 5 en Vercel (falla rápido si hay saturación); 0 en local (cola ilimitada).
- **`enableKeepAlive`**: true (evita desconexiones por inactividad).
- **`connectTimeout`**: 10 segundos.

### Variables de entorno
| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `DB_CONNECTION_LIMIT` | Máximo de conexiones por instancia | 3 (Vercel) / 10 (local) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Conexión MySQL | — |

### Recomendaciones
- En Vercel: mantener `connectionLimit` bajo (2–5) para evitar "too many connections" en el servidor MySQL.
- Si hay errores de cola: aumentar `DB_CONNECTION_LIMIT` o revisar consultas lentas.

---

## 3. Búsquedas (LIKE vs FULLTEXT)

### Estado actual
- **`getClientesOptimizadoPaged`** y **`countClientesOptimizado`** (`config/domains/clientes.js`):
  - **FULLTEXT** (`MATCH...AGAINST` en BOOLEAN MODE con wildcard `*`): cuando existe índice `ft_clientes_busqueda` o `ft_clientes_busqueda_basica` y el término tiene ≥3 caracteres alfanuméricos.
  - **Fallback LIKE** (`LIKE '%texto%'`): para términos &lt; 3 chars, solo dígitos, o cuando no hay índice FULLTEXT.
  - **Solo números**: búsqueda directa por ID o código postal (sin full scan).
- **Pedidos**: `buildPedidosTermClauses` en `lib/pedido-helpers.js` usa FULLTEXT en clientes + pedidos cuando hay índices.

### Índices necesarios
| Tabla | Índice | Columnas |
|-------|--------|----------|
| `clientes` | `ft_clientes_busqueda` | cli_nombre_razon_social, cli_nombre_cial, cli_dni_cif, cli_email, cli_telefono, cli_movil, cli_poblacion, cli_codigo_postal |
| `clientes` | `ft_clientes_busqueda_basica` | cli_nombre_razon_social, cli_nombre_cial, cli_dni_cif |
| `pedidos` | `ft_pedidos_busqueda` | ped_numero, ped_estado_txt |

### Cómo asegurar índices
1. **Migración manual**: ejecutar `scripts/indices-migracion.sql` en la BD (idempotente).
2. **Desde la app**: `POST /api/db/ensure-indexes` (admin) o `ENABLE_INDEX_CREATION_ON_STARTUP=1` (solo desarrollo).

### Recomendaciones
1. **Despliegue**: ejecutar `scripts/indices-migracion.sql` antes de ir a producción para activar FULLTEXT.
2. **Términos cortos (1–2 chars)**: actualmente usa `LIKE '%texto%'` (full scan). Opcional: añadir `LIKE 'texto%'` en columnas indexadas (ej. `cli_nombre_razon_social`) para aprovechar índices BTREE cuando el usuario busca por inicio de nombre. Cambia ligeramente la semántica (prefijo vs contiene).

Ver `docs/PUNTO-23-LIKE-FULLTEXT.md` para más detalle.

---

## 4. Caché de catálogos ✅ Ya existe

### Configuración
- **`lib/catalog-cache.js`**: Caché en memoria con TTL configurable.
- **TTL por defecto**: 5 minutos (`300000` ms).
- **Variable**: `CATALOG_CACHE_TTL_MS` para ajustar (ej. `600000` = 10 min).

### Catálogos cacheados
| Clave | Uso | Sufijo |
|-------|-----|--------|
| `formasPago` | Formas de pago | — |
| `tiposPedido` | Tipos de pedido | — |
| `especialidades` | Especialidades | — |
| `provincias` | Provincias (por país) | `filtroPais` |
| `paises` | Países | — |

### Invalidación
- **`invalidateCatalogCache(key)`**: invalida un catálogo por clave (ej. tras crear/actualizar forma de pago).
- **`invalidateCatalogCache()`** (sin argumento): limpia toda la caché.

### Comportamiento en Vercel (serverless)
- **Cold start**: caché vacía; el primer request de cada instancia consulta la BD.
- **Warm**: los siguientes requests usan caché hasta que expire el TTL o se recicle la instancia.
- No hay caché distribuida entre instancias; cada función tiene su propia caché en memoria.

---

## 5. Login y bcrypt

### Estado
- bcrypt con 12 rondas (seguro pero más lento en serverless).

### Opciones
- **10 rondas**: Menor latencia, sigue siendo seguro. Cambiar en `routes/auth.js` y `routes/comerciales.js`.
- Mantener 12 rondas si la prioridad es máxima seguridad.

---

## 6. Seguridad (SQL dinámico)

- Se usa `mysql2` con parámetros (`?`).
- Nombres de tablas/columnas vienen del mapeo estático o de `_getColumns` (no de input de usuario).
- `_sanitizeIdentifier` existe como capa adicional.
- Riesgo bajo si los identificadores no dependen de input de usuario.

---

## Resumen de acciones

| Acción | Estado |
|--------|--------|
| Mapeo estático de columnas | ✅ Implementado |
| Mapeo estático de tablas | ✅ Ya existía |
| Config centralizada pool (db-pool-config.js) | ✅ Implementado |
| connectionLimit para Vercel | ✅ 3 por defecto |
| queueLimit en Vercel | ✅ 5 (falla rápido si saturado) |
| Caché de catálogos | ✅ Ya existe |
| Índices FULLTEXT (clientes, pedidos) | scripts/indices-migracion.sql o ensure-indexes |
| bcrypt rounds | Opcional: 10 vs 12 |

---

## Cómo probar

1. Desplegar en Vercel con `USE_STATIC_SCHEMA` sin definir (por defecto activo).
2. Medir tiempo de login y búsqueda de clientes antes/después.
3. Si hay problemas con una tabla no mapeada, añadirla a `config/schema-columns.js`.

## Troubleshooting

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| Error "Unknown column" en una tabla | La tabla está en schema-columns pero faltan columnas | Actualizar el array en `schema-columns.js` con las columnas reales de la BD |
| Comportamiento raro tras migración de BD | El mapeo estático tiene columnas antiguas | Revisar `NORMALIZACION-BD-PREFIJOS.md` y actualizar `schema-columns.js` |
| Quiero volver al modo dinámico | — | Definir `USE_STATIC_SCHEMA=0` en las variables de entorno |
