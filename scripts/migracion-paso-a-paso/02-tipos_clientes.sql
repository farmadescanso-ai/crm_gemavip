-- =============================================================================
-- PASO 2: tipos_clientes
-- =============================================================================

ALTER TABLE `tipos_clientes` CHANGE COLUMN `id` `tipc_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `tipos_clientes` DROP PRIMARY KEY, ADD PRIMARY KEY (`tipc_id`);
ALTER TABLE `tipos_clientes` CHANGE COLUMN `Tipo` `tipc_tipo` VARCHAR(255) NOT NULL;
