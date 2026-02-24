# Punto 23: Búsquedas con LIKE '%texto%' y FULLTEXT

**Auditoría:** Análisis CRM Gemavip  
**Problema:** Búsquedas con `LIKE '%texto%'` provocan full table scan; conviene usar FULLTEXT (MATCH AGAINST) cuando sea posible.

---

## Estado actual

### Clientes (`config/domains/clientes.js`)

- **FULLTEXT:** Ya usa `MATCH(cols) AGAINST (? IN BOOLEAN MODE)` cuando:
  - Existe índice FULLTEXT en la tabla (`ft_clientes_busqueda` o `ft_clientes_busqueda_basica`)
  - El término tiene ≥ 3 caracteres alfanuméricos (requisito de MySQL para FULLTEXT)
- **Fallback LIKE:** Solo cuando:
  - Términos cortos (< 3 caracteres) — MySQL no indexa palabras tan cortas en FULLTEXT
  - O no hay índice FULLTEXT disponible
- **Índices:** `scripts/indices-migracion.sql` crea `ft_clientes_busqueda` y `ft_clientes_busqueda_basica`.

### Pedidos (`routes/pedidos.js`)

- Usa `LIKE '%term%'` en búsqueda de texto libre sobre pedidos + clientes + comerciales.
- FULLTEXT en una query con múltiples JOINs sería complejo; los índices BTREE existentes (cliente, fecha, comercial) ayudan a filtrar antes del LIKE.
- **Impacto:** Aceptable si hay filtros previos (comercial, fechas, etc.) que reducen el conjunto.

### Comerciales – rol admin (`config/mysql-crm.js`)

- `getAdminPushSubscriptions`: busca `com_roll LIKE '%admin%'`.
- **Optimización aplicada:** Una sola condición `LOWER(col) LIKE '%admin%'` en lugar de dos.
- **Impacto:** Tabla `comerciales` pequeña (decenas de filas); full scan aceptable.

### Herramientas (`tools/purge-youbelle.js`)

- LIKE en scripts de mantenimiento; uso puntual, impacto bajo.

---

## Recomendaciones

1. **Clientes:** Mantener la lógica actual (MATCH cuando puede, LIKE como fallback).
2. **Pedidos:** Si la búsqueda de pedidos se vuelve lenta, valorar:
   - FULLTEXT en `pedidos` + `clientes` para campos de texto
   - O limitar búsqueda a campos indexados (número pedido, DNI, etc.)
3. **Comerciales:** La tabla es pequeña; no requiere FULLTEXT.
