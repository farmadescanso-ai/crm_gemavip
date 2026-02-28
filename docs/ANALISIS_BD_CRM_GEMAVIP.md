# Análisis de estructura e integridad de la BD CRM Gemavip

**Fecha:** 28 de febrero de 2026  
**Origen:** `crm_gemavip (1).sql` (dump phpMyAdmin)  
**Última actualización:** Revisión completa – FK aplicadas

---

## 1. Resumen ejecutivo

La base de datos `crm_gemavip` tiene **~55 tablas** con relaciones bien definidas en las tablas principales (clientes, pedidos, comerciales, etc.). Existen **varias tablas sin claves foráneas** que deberían tenerlas para garantizar integridad referencial. También se detectan **inconsistencias menores** (nomenclatura, ENGINE faltante, columnas duplicadas).

### Estado de FK aplicadas (verificado)
- ✅ `clientes_cooperativas` – FK añadidas (Id_Cooperativa → cooperativas.coop_id, Id_Cliente → clientes.cli_id)
- ✅ `clientes_gruposCompras` – FK añadidas (Id_Cliente → clientes, Id_GrupoCompras → gruposCompras)

---

## 2. Tablas con integridad referencial correcta (FK definidas)

| Tabla | Relaciones |
|-------|------------|
| `agenda` | → especialidades, tiposcargorol |
| `articulos` | → marcas |
| `clientes` | → comerciales, estdoClientes, formas_pago, idiomas, monedas, paises, provincias, tipos_clientes, clientes (self) |
| `clientes_contactos` | → agenda, clientes |
| `clientes_cooperativas` | → cooperativas (coop_id), clientes (cli_id) |
| `clientes_gruposCompras` | → clientes (cli_id), gruposCompras (id) |
| `clientes_relacionados` | → clientes (self) |
| `direccionesEnvio` | → agenda, clientes, provincias |
| `notificaciones` | → agenda, comerciales, pedidos |
| `pedidos` | → clientes, comerciales, direccionesEnvio, estados_pedido, formas_pago, tarifasClientes, tipos_pedidos |
| `pedidos_articulos` | → articulos, pedidos |
| `visitas` | → clientes, comerciales |

---

## 3. Tablas sin claves foráneas (recomendaciones)

### 3.1 `clientes_cooperativas` ✅ APLICADO
- **Id_Cooperativa** → `cooperativas.coop_id`
- **Id_Cliente** → `clientes.cli_id`

### 3.2 `clientes_gruposCompras` ✅ APLICADO
- **Id_Cliente** → `clientes.cli_id`
- **Id_GrupoCompras** → `gruposCompras.id`

### 3.3 `centros_prescriptores`
- **Id_Ruta** → `rutas.id` (si existe)

### 3.4 `prescriptores`
- **Id_Centro** → `centros_prescriptores.id`
- **Id_Especialidad** → `especialidades.esp_id`

### 3.5 `presupuestos`
- **comercial_id** → `comerciales.com_id`
- **articulo_id** → `articulos.art_id`

### 3.6 `estadoComisiones`
- **comision_id** → `comisiones.id`
- **actualizado_por** → `comerciales.com_id` o `agenda.ag_id`

### 3.7 `comisiones_detalle`
- **comision_id** → `comisiones.id`
- **pedido_id** → `pedidos.ped_id`
- **articulo_id** → `articulos.art_id`

### 3.8 `tarifasClientes_precios`
- **tarclip_tarcli_id** → `tarifasClientes.tarcli_id`
- **tarclip_art_id** → `articulos.art_id`

### 3.9 `comerciales_codigos_postales_marcas`
- **Id_Comercial** → `comerciales.com_id`
- **Id_CodigoPostal** → `codigos_postales.id`
- **Id_Marca** → `marcas.mar_id`

### 3.10 `codigos_postales`
- **Id_Provincia** → `provincias.prov_id`

### 3.11 `api_keys`
- **creado_por** → `comerciales.com_id` o `agenda.ag_id` (opcional)

---

## 4. Inconsistencias detectadas

### 4.1 Tabla `descuentos_pedido`
- **Problema:** No se especifica `ENGINE` en el `CREATE TABLE`.
- **Solución:** Añadir `ENGINE=InnoDB` para consistencia.

### 4.2 Tabla `pedidos` – columnas redundantes
- `ped_estado_txt` (varchar) y `ped_estped_id` (FK a estados_pedido) almacenan el mismo concepto.
- `Id_EstadoPedido` (int) parece duplicar `ped_estped_id`.
- **Recomendación:** Unificar en `ped_estped_id` y deprecar las otras columnas.

### 4.3 Tabla `pedidos` – tarifa con valor 0
- `ped_tarcli_id` puede ser `0` (tarifa TRANSFER).
- `tarifasClientes` tiene `tarcli_id=0` (PVL 2026), por lo que es válido.
- La FK actual permite NULL pero el default es 0; verificar que no haya conflictos.

### 4.4 Nomenclatura mixta
- Algunas tablas usan prefijos (`cli_`, `ped_`, `direnv_`), otras usan `Id_*` o `id`.
- Ejemplo: `clientes_cooperativas.Id_Cooperativa` vs `cooperativas.coop_id`.

### 4.5 `clientes` – `cli_codp_id`
- Existe índice pero **no hay FK** a `codigos_postales.id`.
- `direccionesEnvio.direnv_codp_id` tampoco tiene FK a `codigos_postales`.

---

## 5. Diagrama de relaciones principales

```
clientes ─┬─► comerciales (cli_com_id)
          ├─► estdoClientes (cli_estcli_id)
          ├─► formas_pago (cli_formp_id)
          ├─► provincias (cli_prov_id)
          ├─► tipos_clientes (cli_tipc_id)
          ├─► clientes_cooperativas (Id_Cliente) ✅ FK
          └─► clientes_gruposCompras (Id_Cliente) ✅ FK

pedidos ──┬─► clientes (ped_cli_id)
          ├─► comerciales (ped_com_id)
          ├─► direccionesEnvio (ped_direnv_id)
          ├─► formas_pago (ped_formp_id)
          ├─► tipos_pedidos (ped_tipp_id)
          ├─► tarifasClientes (ped_tarcli_id)
          └─► estados_pedido (ped_estped_id)

cooperativas ◄── clientes_cooperativas.Id_Cooperativa ✅ FK
```

---

## 6. Script de migración sugerido (FK pendientes)

Las FK de `clientes_cooperativas` y `clientes_gruposCompras` ya están aplicadas.

Pendiente (requiere limpiar huérfanos en tarifasClientes_precios):

```sql
-- 1. tarifasClientes_precios: eliminar huérfanos primero
DELETE FROM tarifasClientes_precios WHERE tarclip_tarcli_id = 1;
DELETE FROM tarifasClientes_precios WHERE tarclip_art_id BETWEEN 2 AND 13;

-- 2. Añadir FK
ALTER TABLE tarifasClientes_precios
  ADD CONSTRAINT fk_tarclip_tarcli FOREIGN KEY (tarclip_tarcli_id) REFERENCES tarifasClientes(tarcli_id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT fk_tarclip_art FOREIGN KEY (tarclip_art_id) REFERENCES articulos(art_id) ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. descuentos_pedido - corregir ENGINE
ALTER TABLE descuentos_pedido ENGINE=InnoDB;
```

---

## 7. Verificación previa a añadir FK

Antes de ejecutar el script anterior, comprobar que no haya referencias rotas:

```sql
-- clientes_cooperativas: Id_Cliente inexistentes
SELECT cc.* FROM clientes_cooperativas cc
LEFT JOIN clientes c ON c.cli_id = cc.Id_Cliente
WHERE c.cli_id IS NULL;

-- clientes_cooperativas: Id_Cooperativa inexistentes
SELECT cc.* FROM clientes_cooperativas cc
LEFT JOIN cooperativas co ON co.coop_id = cc.Id_Cooperativa
WHERE co.coop_id IS NULL;

-- clientes_gruposCompras: Id_Cliente inexistentes
SELECT cg.* FROM clientes_gruposCompras cg
LEFT JOIN clientes c ON c.cli_id = cg.Id_Cliente
WHERE c.cli_id IS NULL;
```

---

## 8. Conclusión

- **Integridad general:** Buena en las tablas core (clientes, pedidos, comerciales).
- **FK aplicadas:** `clientes_cooperativas` y `clientes_gruposCompras` ya tienen integridad referencial.
- **Pendiente:** `tarifasClientes_precios` (limpiar huérfanos antes de añadir FK), corregir ENGINE en `descuentos_pedido`.
- **Mejoras secundarias:** Unificar estado de pedido en `pedidos`, añadir FK en tablas de comisiones, presupuestos.

---

## 9. Nota sobre tabla `cooperativas`

El dump muestra columnas `coop_id`, `coop_nombre`, `coop_email`, etc. El código en `mysql-crm.js` y `mysql-crm-clientes.js` usa `id`, `Nombre`, `Email`. Si la BD usa `coop_*`, las consultas fallarían. Verificar en producción qué columnas tiene la tabla `cooperativas`.
