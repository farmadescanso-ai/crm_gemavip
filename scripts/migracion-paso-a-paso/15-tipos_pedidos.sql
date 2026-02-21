-- =============================================================================
-- PASO 15: tipos_pedidos
-- =============================================================================

ALTER TABLE `tipos_pedidos` CHANGE COLUMN `id` `tipp_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `tipos_pedidos` DROP PRIMARY KEY, ADD PRIMARY KEY (`tipp_id`);
ALTER TABLE `tipos_pedidos` CHANGE COLUMN `Tipo` `tipp_tipo` VARCHAR(255) NOT NULL;
