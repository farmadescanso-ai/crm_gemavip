-- =============================================================================
-- PASO 11: agenda_especialidades
-- =============================================================================

ALTER TABLE `agenda_especialidades` CHANGE COLUMN `id` `agesp_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `agenda_especialidades` DROP PRIMARY KEY, ADD PRIMARY KEY (`agesp_id`);
ALTER TABLE `agenda_especialidades` CHANGE COLUMN `Nombre` `agesp_nombre` VARCHAR(120) NOT NULL;
ALTER TABLE `agenda_especialidades` CHANGE COLUMN `Activo` `agesp_activo` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `agenda_especialidades` CHANGE COLUMN `CreadoEn` `agesp_creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `agenda_especialidades` CHANGE COLUMN `ActualizadoEn` `agesp_actualizado_en` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP;
