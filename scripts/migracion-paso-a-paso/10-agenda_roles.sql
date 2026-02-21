-- =============================================================================
-- PASO 10: agenda_roles
-- =============================================================================

ALTER TABLE `agenda_roles` CHANGE COLUMN `id` `agrol_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `agenda_roles` DROP PRIMARY KEY, ADD PRIMARY KEY (`agrol_id`);
ALTER TABLE `agenda_roles` CHANGE COLUMN `Nombre` `agrol_nombre` VARCHAR(120) NOT NULL;
ALTER TABLE `agenda_roles` CHANGE COLUMN `Activo` `agrol_activo` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `agenda_roles` CHANGE COLUMN `CreadoEn` `agrol_creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `agenda_roles` CHANGE COLUMN `ActualizadoEn` `agrol_actualizado_en` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP;
