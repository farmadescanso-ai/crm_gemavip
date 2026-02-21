-- =============================================================================
-- PASO 24: direccionesEnvio
-- =============================================================================

ALTER TABLE `direccionesEnvio` CHANGE COLUMN `id` `direnv_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `direccionesEnvio` DROP PRIMARY KEY, ADD PRIMARY KEY (`direnv_id`);
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Id_Cliente` `direnv_cli_id` INT NOT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Id_Contacto` `direnv_ag_id` INT DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Alias` `direnv_alias` VARCHAR(120) DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Nombre_Destinatario` `direnv_nombre_destinatario` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Direccion` `direnv_direccion` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Direccion2` `direnv_direccion2` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Poblacion` `direnv_poblacion` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `CodigoPostal` `direnv_codigo_postal` VARCHAR(12) DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Id_Provincia` `direnv_prov_id` INT DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Id_CodigoPostal` `direnv_codp_id` INT DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Id_Pais` `direnv_pais_id` INT DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Pais` `direnv_pais` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Telefono` `direnv_telefono` VARCHAR(20) DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Movil` `direnv_movil` VARCHAR(20) DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Email` `direnv_email` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Observaciones` `direnv_observaciones` TEXT;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Es_Principal` `direnv_es_principal` TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Activa` `direnv_activa` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `CreadoEn` `direnv_creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `ActualizadoEn` `direnv_actualizado_en` DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;
