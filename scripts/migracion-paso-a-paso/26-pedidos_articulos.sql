-- =============================================================================
-- PASO 26: pedidos_articulos
-- =============================================================================

ALTER TABLE `pedidos_articulos` CHANGE COLUMN `id` `pedart_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `pedidos_articulos` DROP PRIMARY KEY, ADD PRIMARY KEY (`pedart_id`);
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `Id_NumPedido` `pedart_ped_id` INT NOT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `Id_Articulo` `pedart_art_id` INT NOT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `NumPedido` `pedart_numero` VARCHAR(255) NOT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `Articulo` `pedart_articulo_txt` VARCHAR(255) NOT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `Cantidad` `pedart_cantidad` INT NOT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `PVP` `pedart_pvp` DECIMAL(10,2) NOT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `DtoLinea` `pedart_dto` DECIMAL(5,2) DEFAULT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `Subtotal` `pedart_subtotal` DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `IVA` `pedart_iva` DECIMAL(5,2) DEFAULT NULL;
