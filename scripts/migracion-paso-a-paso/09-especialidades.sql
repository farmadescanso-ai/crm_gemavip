-- =============================================================================
-- PASO 9: especialidades
-- =============================================================================

ALTER TABLE `especialidades` CHANGE COLUMN `id` `esp_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `especialidades` DROP PRIMARY KEY, ADD PRIMARY KEY (`esp_id`);
ALTER TABLE `especialidades` CHANGE COLUMN `Especialidad` `esp_nombre` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `especialidades` CHANGE COLUMN `Observaciones` `esp_observaciones` TEXT;
