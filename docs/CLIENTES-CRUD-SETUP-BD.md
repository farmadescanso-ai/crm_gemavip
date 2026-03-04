# Configuración BD para CRUD de Clientes

Si los desplegables (Tipo Cliente, Especialidad, Estado) no cargan en el formulario de edición de clientes, ejecuta el script de índices y relaciones.

## Pasos

### 1. Diagnóstico (opcional)

Ejecuta `scripts/diagnostico-integridad-fks.sql` para detectar registros huérfanos (IDs que apuntan a filas inexistentes). Si algún conteo > 0, corrige los datos antes de añadir FKs.

### 2. Índices y relaciones

Ejecuta **todo** el script en phpMyAdmin o tu cliente MySQL:

```
scripts/clientes-crud-indices-y-fks.sql
```

Este script:

- Añade la columna `cli_esp_id` si no existe
- Crea índices en las columnas FK de `clientes`
- Crea las claves foráneas hacia: `tipos_clientes`, `especialidades`, `estdoClientes`, `comerciales`, `provincias`, `paises`, `idiomas`, `monedas`, `formas_pago`
- Inserta un registro mínimo en cada catálogo si está vacío

### 3. Verificación

Comprueba que las tablas tienen datos:

```sql
SELECT * FROM tipos_clientes;
SELECT * FROM especialidades;
SELECT * FROM estdoClientes;
```

Si están vacías, inserta manualmente los valores que necesites (ej. CAP, Farmacia, Potencial, Activo, etc.).

### Tablas y columnas esperadas

| Tabla           | PK        | Columna nombre   |
|-----------------|-----------|------------------|
| tipos_clientes  | tipc_id   | tipc_tipo        |
| especialidades  | esp_id    | esp_nombre       |
| estdoClientes   | estcli_id | estcli_nombre    |

Si tu BD usa nombres distintos (ej. `Tipo`, `Nombre`, `Especialidad`), el código los detecta dinámicamente, pero los INSERT del script pueden fallar. En ese caso, inserta los datos a mano.
