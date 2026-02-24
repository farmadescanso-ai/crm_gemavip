# Punto 17: Foreign Keys en la base de datos

**Auditoría:** Análisis CRM Gemavip  
**Problema:** Sin claves foráneas reales en MySQL; el código hace checks de integridad en JavaScript en lugar de en la BD.

---

## Contexto

Sin FKs en MySQL es posible:

- Borrar una provincia que tiene clientes asignados
- Borrar un comercial con pedidos activos
- Borrar un artículo con líneas de pedido

El código en `config/mysql-crm.js` (líneas 238–387) ejecuta checks manuales de huérfanos (`runCount`) como diagnóstico. Estos checks son útiles como health check, pero **no sustituyen** a las FKs reales en la BD.

---

## Requisitos previos

### 1. Base de datos migrada

Los scripts de FKs usan **nombres de columna migrados**:

| Legacy (antes) | Migrado (después) |
|---------------|-------------------|
| `Id_Cial` | `cli_com_id` |
| `Id_Cliente` | `ped_cli_id` |
| `id` (comerciales) | `com_id` |
| `id` (clientes) | `cli_id` |
| `Id_Provincia` | `cli_prov_id` |
| `prov_id` (provincias) | `prov_id` |

Si la BD aún usa nombres legacy, hay que ejecutar primero la migración completa (`scripts/migracion-paso-a-paso/` pasos 01–30).

### 2. Sin registros huérfanos

Antes de crear FKs, **todos los conteos de huérfanos deben ser 0**. Si hay filas que referencian IDs inexistentes en tablas padre, MySQL rechazará la creación de la FK.

---

## Scripts involucrados

| Script | Propósito |
|--------|-----------|
| `scripts/diagnostico-integridad-fks.sql` | Detecta huérfanos en todas las relaciones. Ejecutar primero. |
| `scripts/corregir-huerfanos-fks.sql` | Corrige huérfanos (asignar valores por defecto o eliminar). |
| `scripts/migracion-paso-a-paso/31-ADD-FKs.sql` | 4 FKs básicas: articulos→marcas, clientes→tipos_clientes, pedidos→estados_pedido, pedidos→tarifasClientes. |
| `scripts/32-ADD-FKs-completas.sql` | FKs completas: clientes, pedidos, pedidos_articulos, agenda, clientes_contactos, direccionesEnvio, visitas, notificaciones. |
| `scripts/32-ADD-FKs-pendientes.sql` | FKs que pueden faltar si 32-ADD-FKs-completas dio errores "Duplicate". |

---

## Orden de ejecución

```
1. HACER BACKUP DE LA BASE DE DATOS
2. Ejecutar diagnostico-integridad-fks.sql
3. Si algún COUNT > 0 (huérfanos):
   → Ejecutar corregir-huerfanos-fks.sql
   → Repetir paso 2 hasta que todos los huérfanos = 0
4. Ejecutar 31-ADD-FKs.sql
5. Ejecutar 32-ADD-FKs-completas.sql
6. Si alguna FK da "Duplicate foreign key constraint name":
   → Comentar esa línea en 32-ADD-FKs-completas.sql (ya existe)
   → O ejecutar 32-ADD-FKs-pendientes.sql para las que faltan
```

### Ejecución desde terminal (PowerShell)

```powershell
# Ejemplo con mysql CLI (ajustar credenciales y nombre de BD)
Get-Content scripts\diagnostico-integridad-fks.sql | mysql -u usuario -p nombre_bd
Get-Content scripts\migracion-paso-a-paso\31-ADD-FKs.sql | mysql -u usuario -p nombre_bd
Get-Content scripts\32-ADD-FKs-completas.sql | mysql -u usuario -p nombre_bd
```

---

## Relaciones cubiertas por las FKs

### Clientes
- `cli_com_id` → comerciales (RESTRICT)
- `cli_prov_id` → provincias (SET NULL)
- `cli_pais_id` → paises (SET NULL)
- `cli_estcli_id` → estdoClientes (SET NULL)
- `cli_formp_id` → formas_pago (SET NULL)
- `cli_idiom_id` → idiomas (SET NULL)
- `cli_mon_id` → monedas (SET NULL)
- `cli_tipc_id` → tipos_clientes (SET NULL)

### Pedidos
- `ped_com_id` → comerciales (RESTRICT)
- `ped_cli_id` → clientes (RESTRICT)
- `ped_direnv_id` → direccionesEnvio (SET NULL)
- `ped_formp_id` → formas_pago (RESTRICT)
- `ped_tipp_id` → tipos_pedidos (RESTRICT)
- `ped_estped_id` → estados_pedido (SET NULL)
- `ped_tarcli_id` → tarifasClientes (SET NULL)

### Pedidos_articulos
- `pedart_ped_id` → pedidos (CASCADE: borrar pedido borra líneas)
- `pedart_art_id` → articulos (RESTRICT)

### Otras tablas
- agenda, clientes_contactos, direccionesEnvio, visitas, notificaciones, articulos→marcas

---

## Comportamiento ON DELETE

| Acción | RESTRICT | SET NULL | CASCADE |
|--------|----------|----------|---------|
| Borrar padre con hijos | Error | Hijos quedan con FK=NULL | Borra hijos |
| Uso típico | Relaciones obligatorias | Relaciones opcionales | Hijos dependen del padre |

---

## Si la BD no está migrada

Si la BD usa nombres legacy (`Id_Cial`, `Id_Cliente`, `id` en comerciales/clientes, etc.):

1. Ejecutar primero la migración completa (`migracion-paso-a-paso/` 01–30).
2. O crear un script alternativo con nombres legacy (no incluido en este proyecto).

---

## Checks en JavaScript (runCount)

El método `checkIntegridadReferencial()` en `config/mysql-crm.js` sigue siendo útil como **health check** en runtime: detecta huérfanos sin depender de que las FKs estén creadas. Puede mantenerse como diagnóstico adicional una vez aplicadas las FKs.
