-- =============================================================================
-- PASO 3: estdoClientes
-- =============================================================================

ALTER TABLE `estdoClientes` CHANGE COLUMN `id` `estcli_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `estdoClientes` DROP PRIMARY KEY, ADD PRIMARY KEY (`estcli_id`);
ALTER TABLE `estdoClientes` CHANGE COLUMN `Nombre` `estcli_nombre` VARCHAR(20) NOT NULL;
