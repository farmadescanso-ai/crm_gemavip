-- =============================================================================
-- PASO 20: tarifasClientes_precios
-- =============================================================================

ALTER TABLE `tarifasClientes_precios` CHANGE COLUMN `Id` `tarclip_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `tarifasClientes_precios` DROP PRIMARY KEY, ADD PRIMARY KEY (`tarclip_id`);
ALTER TABLE `tarifasClientes_precios` CHANGE COLUMN `Id_Tarifa` `tarclip_tarcli_id` INT NOT NULL;
ALTER TABLE `tarifasClientes_precios` CHANGE COLUMN `Id_Articulo` `tarclip_art_id` INT NOT NULL;
ALTER TABLE `tarifasClientes_precios` CHANGE COLUMN `Precio` `tarclip_precio` DECIMAL(10,2) NOT NULL DEFAULT 0.00;
