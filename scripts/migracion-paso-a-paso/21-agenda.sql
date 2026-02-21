-- =============================================================================
-- PASO 21: agenda
-- =============================================================================

ALTER TABLE `agenda` CHANGE COLUMN `Id` `ag_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `agenda` DROP PRIMARY KEY, ADD PRIMARY KEY (`ag_id`);
ALTER TABLE `agenda` CHANGE COLUMN `Nombre` `ag_nombre` VARCHAR(120) NOT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Apellidos` `ag_apellidos` VARCHAR(180) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Cargo` `ag_cargo` VARCHAR(120) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Especialidad` `ag_especialidad` VARCHAR(120) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Id_TipoCargoRol` `ag_tipcar_id` INT DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Id_Especialidad` `ag_esp_id` INT DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Empresa` `ag_empresa` VARCHAR(180) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Email` `ag_email` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Movil` `ag_movil` VARCHAR(20) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Telefono` `ag_telefono` VARCHAR(20) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Extension` `ag_extension` VARCHAR(10) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Notas` `ag_notas` TEXT;
ALTER TABLE `agenda` CHANGE COLUMN `Activo` `ag_activo` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `agenda` CHANGE COLUMN `CreadoEn` `ag_creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `agenda` CHANGE COLUMN `ActualizadoEn` `ag_actualizado_en` DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;
