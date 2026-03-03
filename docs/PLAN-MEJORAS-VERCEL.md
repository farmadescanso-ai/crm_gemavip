# Plan de Mejoras para Rendimiento en Vercel

Basado en el informe de análisis del codebase (Metadata Discovery Overhead, seguridad, búsquedas).

---

## 1. Metadata Discovery Overhead (PRIORIDAD 1) ✅ Implementado

### Problema
En Vercel (serverless), cada cold start pierde la caché en memoria. Por cada búsqueda de cliente o login, el sistema hacía 5–10 consultas previas (`SHOW COLUMNS`, `information_schema`) solo para conocer nombres de tablas y columnas.

### Solución aplicada
- **`config/schema-columns.js`**: Mapeo estático de columnas para 27 tablas.
- **`config/mysql-crm.js`** (líneas 62–68): `_getColumns` usa el mapeo estático primero; solo consulta la BD si la tabla no está mapeada.
- **`config/table-names.js`**: Ya existía; evita consultas para resolver nombres de tablas.

### Tablas con mapeo estático
`agenda`, `agenda_especialidades`, `agenda_roles`, `articulos`, `clientes`, `clientes_contactos`, `codigos_postales`, `comerciales`, `comerciales_codigos_postales_marcas`, `cooperativas`, `direccionesEnvio`, `especialidades`, `estdoClientes`, `formas_pago`, `gruposCompras`, `idiomas`, `marcas`, `notificaciones`, `paises`, `pedidos`, `pedidos_articulos`, `provincias`, `tarifasClientes`, `tarifasClientes_precios`, `tipos_clientes`, `tipos_pedidos`, `visitas`

### Control
- `USE_STATIC_SCHEMA=0` desactiva el mapeo estático (fallback al comportamiento anterior).

### Añadir una tabla nueva
Editar `config/schema-columns.js` y añadir la tabla al objeto `SCHEMA_COLUMNS` con el array de columnas (ver `docs/NORMALIZACION-BD-PREFIJOS.md` para los nombres).

---

## 2. Conexiones a BD ✅ Ya configurado

- `connectionLimit: 3` cuando `VERCEL=true`.
- Variable de entorno `DB_CONNECTION_LIMIT` para ajustar.

---

## 3. Búsquedas (LIKE vs FULLTEXT)

### Estado actual
- `getClientesOptimizadoPaged` usa `MATCH...AGAINST` (FULLTEXT) cuando existe índice y el término tiene ≥3 caracteres.
- Fallback a `LIKE` para términos cortos o cuando no hay índice FULLTEXT.

### Recomendaciones
1. Asegurar índices en despliegue: ejecutar `scripts/indices-migracion.sql` o `ensureClientesIndexes`.
2. Para términos cortos (< 3 chars), considerar búsqueda por prefijo (`LIKE 'texto%'`) en lugar de `LIKE '%texto%'` cuando sea posible.

---

## 4. Caché de catálogos ✅ Ya existe

- `lib/catalog-cache.js` con TTL de 5 minutos.
- `CATALOG_CACHE_TTL_MS` para ajustar.
- En serverless, el primer request tras cold start sigue siendo lento; los siguientes (warm) usan caché.

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
| connectionLimit para Vercel | ✅ 3 por defecto |
| Caché de catálogos | ✅ Ya existe |
| Índices FULLTEXT | Verificar en BD |
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
