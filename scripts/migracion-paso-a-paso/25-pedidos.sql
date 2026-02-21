-- =============================================================================
-- PASO 25: pedidos (tabla core)
-- =============================================================================

ALTER TABLE `pedidos` CHANGE COLUMN `id` `ped_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `pedidos` DROP PRIMARY KEY, ADD PRIMARY KEY (`ped_id`);
ALTER TABLE `pedidos` CHANGE COLUMN `Id_Cial` `ped_com_id` INT NOT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `Id_Cliente` `ped_cli_id` INT NOT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `Id_DireccionEnvio` `ped_direnv_id` INT DEFAULT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `Id_FormaPago` `ped_formp_id` INT NOT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `Id_TipoPedido` `ped_tipp_id` INT NOT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `Id_Tarifa` `ped_tarcli_id` INT NOT NULL DEFAULT 0;
ALTER TABLE `pedidos` CHANGE COLUMN `NumPedido` `ped_numero` VARCHAR(255) NOT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `FechaPedido` `ped_fecha` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `pedidos` CHANGE COLUMN `EstadoPedido` `ped_estado_txt` VARCHAR(255) NOT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `TotalPedido` `ped_total` DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `BaseImponible` `ped_base` DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE `pedidos` CHANGE COLUMN `TotalIva` `ped_iva` DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `TotalDescuento` `ped_descuento` DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `Dto` `ped_dto` DECIMAL(5,2) DEFAULT 0.00;
ALTER TABLE `pedidos` CHANGE COLUMN `Id_EstadoPedido` `ped_estped_id` INT DEFAULT NULL;
