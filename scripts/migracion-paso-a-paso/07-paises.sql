-- =============================================================================
-- PASO 7: paises
-- =============================================================================

ALTER TABLE `paises` CHANGE COLUMN `id` `pais_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `paises` DROP PRIMARY KEY, ADD PRIMARY KEY (`pais_id`);
ALTER TABLE `paises` CHANGE COLUMN `Id_pais` `pais_codigo` VARCHAR(3) NOT NULL;
ALTER TABLE `paises` CHANGE COLUMN `Nombre_pais` `pais_nombre` VARCHAR(500) NOT NULL;
