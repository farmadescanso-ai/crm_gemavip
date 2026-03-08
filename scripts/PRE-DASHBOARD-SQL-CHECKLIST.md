# Checklist SQL antes del Dashboard Admin/Comercial

Ejecutar **en este orden** antes de implementar el nuevo dashboard:

## 1. Columnas en clientes (Contactos Nuevos)

Si la columna `cli_creado_holded` no existe, el KPI "Contactos Nuevos" no se mostrará.

```bash
# Ejecutar en phpMyAdmin o MySQL CLI:
scripts/add-columns-clientes-holded.sql
```

**Idempotente**: puede ejecutarse varias veces sin error. Añade `cli_creado_holded` y otras columnas Holded si faltan.

## 2. Índices de rendimiento

```bash
scripts/indices-migracion.sql
```

**Importante**: El índice `idx_clientes_creado_holded` requiere que exista la columna `cli_creado_holded`. Si no la tienes, ejecuta primero el paso 1. Si la columna no existe, ese índice fallará (puedes comentar esa línea temporalmente).

**Índices añadidos para el dashboard**:
- `codigos_postales.idx_codpos_comunidad` – filtro Zona (CCAA)
- `articulos.idx_articulos_marca` – filtro Marca en Ranking Productos
- `clientes.idx_clientes_creado_holded` – KPI Contactos Nuevos

## Verificación rápida

```sql
-- ¿Existe cli_creado_holded?
SELECT COLUMN_NAME FROM information_schema.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'cli_creado_holded';

-- ¿Existen los índices?
SHOW INDEX FROM codigos_postales WHERE Key_name IN ('idx_codpos_codigo','idx_codpos_comunidad');
SHOW INDEX FROM articulos WHERE Key_name = 'idx_articulos_marca';
SHOW INDEX FROM clientes WHERE Key_name = 'idx_clientes_creado_holded';
```
