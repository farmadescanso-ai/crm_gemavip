-- =============================================================================
-- PASO 5: idiomas
-- =============================================================================

ALTER TABLE `idiomas` CHANGE COLUMN `id` `idiom_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `idiomas` DROP PRIMARY KEY, ADD PRIMARY KEY (`idiom_id`);
ALTER TABLE `idiomas` CHANGE COLUMN `Codigo` `idiom_codigo` VARCHAR(15) NOT NULL;
ALTER TABLE `idiomas` CHANGE COLUMN `Nombre` `idiom_nombre` VARCHAR(255) NOT NULL;
