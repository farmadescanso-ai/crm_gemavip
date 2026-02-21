-- =============================================================================
-- PASO 16: cooperativas
-- =============================================================================

ALTER TABLE `cooperativas` CHANGE COLUMN `id` `coop_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `cooperativas` DROP PRIMARY KEY, ADD PRIMARY KEY (`coop_id`);
ALTER TABLE `cooperativas` CHANGE COLUMN `Nombre` `coop_nombre` VARCHAR(255) NOT NULL;
ALTER TABLE `cooperativas` CHANGE COLUMN `Email` `coop_email` VARCHAR(255) NOT NULL;
ALTER TABLE `cooperativas` CHANGE COLUMN `Telefono` `coop_telefono` VARCHAR(15) DEFAULT NULL;
ALTER TABLE `cooperativas` CHANGE COLUMN `Contacto` `coop_contacto` VARCHAR(255) DEFAULT NULL;
