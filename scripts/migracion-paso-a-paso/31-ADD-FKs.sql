-- =============================================================================
-- PASO 31: Recrear claves foráneas
-- Ejecutar DESPUÉS de todos los renombrados
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 1;

ALTER TABLE `articulos` ADD CONSTRAINT `fk_art_mar` 
  FOREIGN KEY (`art_mar_id`) REFERENCES `marcas`(`mar_id`) ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_tipc` 
  FOREIGN KEY (`cli_tipc_id`) REFERENCES `tipos_clientes`(`tipc_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_estped` 
  FOREIGN KEY (`ped_estped_id`) REFERENCES `estados_pedido`(`estped_id`) ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_tarcli` 
  FOREIGN KEY (`ped_tarcli_id`) REFERENCES `tarifasClientes`(`tarcli_id`) ON DELETE SET NULL ON UPDATE CASCADE;
