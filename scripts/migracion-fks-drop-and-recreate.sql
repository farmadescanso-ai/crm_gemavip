-- =============================================================================
-- FKs: DROP antes de migración y ADD después (con nuevos nombres de columna)
-- Ejecutar PASO 1 antes de migracion-normalizacion-prefijos.sql
-- Ejecutar PASO 2 después de migracion-normalizacion-prefijos.sql
-- =============================================================================

-- =============================================================================
-- PASO 1: DROP de todas las FKs (ejecutar ANTES de la migración)
--
-- Para generar la lista completa de DROP, ejecuta esta query y copia el resultado:
--
--   SELECT CONCAT('ALTER TABLE `', TABLE_NAME, '` DROP FOREIGN KEY `', CONSTRAINT_NAME, '`;') AS drop_stmt
--   FROM information_schema.KEY_COLUMN_USAGE
--   WHERE TABLE_SCHEMA = 'crm_gemavip' AND REFERENCED_TABLE_NAME IS NOT NULL
--   GROUP BY TABLE_NAME, CONSTRAINT_NAME
--   ORDER BY TABLE_NAME;
--
-- Luego pega aquí abajo todas las líneas generadas y ejecuta.
-- =============================================================================

-- Lista completa de FKs (5 constraints en crm_gemavip):
ALTER TABLE `articulos` DROP FOREIGN KEY `fk_articulos_marca`;
ALTER TABLE `centros_prescriptores` DROP FOREIGN KEY `fk_centros_ruta`;
ALTER TABLE `clientes` DROP FOREIGN KEY `clientes_ibfk_1`;
ALTER TABLE `pedidos` DROP FOREIGN KEY `fk_pedidos_estado_pedido`;
ALTER TABLE `pedidos` DROP FOREIGN KEY `pedidos_ibfk_1`;


-- =============================================================================
-- PASO 2: ADD FKs después de la migración (con columnas normalizadas)
-- Ejecutar DESPUÉS de migracion-normalizacion-prefijos.sql
-- =============================================================================

-- articulos.art_mar_id -> marcas.mar_id
ALTER TABLE `articulos` ADD CONSTRAINT `fk_art_mar` 
  FOREIGN KEY (`art_mar_id`) REFERENCES `marcas`(`mar_id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- centros_prescriptores.centp_ruta_id -> rutas.ruta_id
-- (si migraste centros_prescriptores; si no, omitir o ajustar)
-- ALTER TABLE `centros_prescriptores` ADD CONSTRAINT `fk_centp_ruta` 
--   FOREIGN KEY (`centp_ruta_id`) REFERENCES `rutas`(`ruta_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- clientes.cli_tipc_id -> tipos_clientes.tipc_id
ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_tipc` 
  FOREIGN KEY (`cli_tipc_id`) REFERENCES `tipos_clientes`(`tipc_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- pedidos.ped_estped_id -> estados_pedido.estped_id
ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_estped` 
  FOREIGN KEY (`ped_estped_id`) REFERENCES `estados_pedido`(`estped_id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- pedidos.ped_tarcli_id -> tarifasClientes.tarcli_id
ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_tarcli` 
  FOREIGN KEY (`ped_tarcli_id`) REFERENCES `tarifasClientes`(`tarcli_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- NOTA: Las 5 FKs están mapeadas. Si añades nuevas FKs en el futuro, usa:
--   tabla_hija.{prefijo}_{tabla_ref}_id -> tabla_padre.{prefijo}id
-- =============================================================================
