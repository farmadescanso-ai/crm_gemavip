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

- **FULLTEXT aplicado (25/02/2026):** Usa `MATCH...AGAINST` cuando existen índices `ft_clientes_busqueda` y `ft_pedidos_busqueda`.
- Helper `buildPedidosTermClauses` en `lib/pedido-helpers.js`: combina MATCH en clientes + pedidos con LIKE para catálogos (provincia, comercial, tipo cliente, estado).
- Índice `ft_pedidos_busqueda` en `pedidos` (ped_numero, ped_estado_txt) — `scripts/indices-migracion.sql` y `ensurePedidosIndexes()`.
- **Fallback LIKE:** Términos &lt; 3 caracteres o cuando no hay índices FULLTEXT.

### Comerciales – rol admin (`config/mysql-crm.js`)

- `getAdminPushSubscriptions`: busca `com_roll LIKE '%admin%'`.
- **Optimización aplicada:** Una sola condición `LOWER(col) LIKE '%admin%'` en lugar de dos.
- **Impacto:** Tabla `comerciales` pequeña (decenas de filas); full scan aceptable.

### Herramientas (`tools/purge-youbelle.js`)

- LIKE en scripts de mantenimiento; uso puntual, impacto bajo.

---

## Recomendaciones

1. **Clientes:** Mantener la lógica actual (MATCH cuando puede, LIKE como fallback).
2. **Pedidos:** ✅ Implementado — FULLTEXT en `pedidos` y reutilización de `ft_clientes_busqueda` en búsquedas combinadas.
3. **Comerciales:** La tabla es pequeña; no requiere FULLTEXT.
