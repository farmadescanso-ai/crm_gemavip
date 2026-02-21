-- =============================================================================
-- PASO 1: provincias
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE `provincias` CHANGE COLUMN `id` `prov_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `provincias` DROP PRIMARY KEY, ADD PRIMARY KEY (`prov_id`);
ALTER TABLE `provincias` CHANGE COLUMN `Nombre` `prov_nombre` VARCHAR(100) NOT NULL;
ALTER TABLE `provincias` CHANGE COLUMN `Codigo` `prov_codigo` VARCHAR(10) NOT NULL;
ALTER TABLE `provincias` CHANGE COLUMN `Pais` `prov_pais` VARCHAR(50) NOT NULL DEFAULT 'España';
ALTER TABLE `provincias` CHANGE COLUMN `CodigoPais` `prov_codigo_pais` VARCHAR(3) NOT NULL DEFAULT 'ES';
