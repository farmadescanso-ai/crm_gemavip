-- =============================================================================
-- PASO 4: marcas
-- =============================================================================

ALTER TABLE `marcas` CHANGE COLUMN `id` `mar_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `marcas` DROP PRIMARY KEY, ADD PRIMARY KEY (`mar_id`);
ALTER TABLE `marcas` CHANGE COLUMN `Nombre` `mar_nombre` VARCHAR(50) NOT NULL;
ALTER TABLE `marcas` CHANGE COLUMN `Activo` `mar_activo` TINYINT(1) NOT NULL;
