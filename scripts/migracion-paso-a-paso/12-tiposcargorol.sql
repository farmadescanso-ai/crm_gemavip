-- =============================================================================
-- PASO 12: tiposcargorol
-- =============================================================================

ALTER TABLE `tiposcargorol` CHANGE COLUMN `id` `tipcar_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `tiposcargorol` DROP PRIMARY KEY, ADD PRIMARY KEY (`tipcar_id`);
ALTER TABLE `tiposcargorol` CHANGE COLUMN `Nombre` `tipcar_nombre` VARCHAR(120) NOT NULL;
ALTER TABLE `tiposcargorol` CHANGE COLUMN `Activo` `tipcar_activo` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `tiposcargorol` CHANGE COLUMN `CreadoEn` `tipcar_creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `tiposcargorol` CHANGE COLUMN `ActualizadoEn` `tipcar_actualizado_en` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP;
