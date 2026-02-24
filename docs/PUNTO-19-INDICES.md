# Punto 19: Índices creados en startup — Bloqueo de tabla en producción

**Auditoría:** Análisis CRM Gemavip  
**Problema:** Al conectar, el código creaba índices automáticamente. `CREATE INDEX` en MySQL bloquea la tabla durante la creación; en producción con datos puede bloquear a todos los usuarios durante segundos o minutos.

---

## Solución aplicada

### 1. Índices fuera del startup por defecto

Los índices **ya no se crean automáticamente** al conectar. Solo se ejecutan si:

```bash
ENABLE_INDEX_CREATION_ON_STARTUP=1
```

En producción, **no** configurar esta variable.

### 2. Crear índices como migración manual

Ejecutar el script SQL una sola vez (o en ventana de mantenimiento):

```bash
# Ejemplo con mysql CLI
Get-Content scripts\indices-migracion.sql | mysql -u usuario -p nombre_bd
```

**Script:** `scripts/indices-migracion.sql` — Idempotente (omite índices que ya existen)

### 3. Endpoint admin para creación manual

`POST /api/db/ensure-indexes` (requiere sesión de administrador) crea los índices bajo demanda. Útil para:

- Entornos de desarrollo
- Bases de datos nuevas
- Cuando se necesita recrear índices sin ejecutar SQL manualmente

**Advertencia:** Este endpoint también bloquea las tablas durante la ejecución. Usar en ventana de bajo tráfico.

---

## Índices incluidos

| Tabla | Índices |
|-------|---------|
| **clientes** | provincia, tipocliente, comercial, estado_cliente, cp, poblacion, nombre, FULLTEXT busqueda |
| **pedidos** | cliente, comercial, fecha, cliente_fecha, comercial_fecha, num_pedido |
| **pedidos_articulos** | num_pedido, pedido_id, articulo, num_articulo |
| **visitas** | fecha, comercial, cliente, comercial_fecha |
| **agenda** | activo_apellidos_nombre, FULLTEXT busqueda |
| **direccionesEnvio** | cliente, cliente_activa, cliente_activa_principal |

---

## Requisitos

- **BD migrada** con prefijos (`cli_prov_id`, `ped_cli_id`, etc.). Si usas nombres legacy (`Id_Provincia`, `Id_Cliente`), adapta el script.
- Si un índice ya existe, MySQL dará "Duplicate key name". Comenta esa línea y continúa.

---

## Variables de entorno

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `ENABLE_INDEX_CREATION_ON_STARTUP` | (no definir) | Por defecto: índices no se crean en startup |
| `ENABLE_INDEX_CREATION_ON_STARTUP` | `1` | Crear índices al conectar (solo desarrollo) |
