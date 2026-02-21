-- =============================================================================
-- PASO 27: visitas
-- =============================================================================

ALTER TABLE `visitas` CHANGE COLUMN `id` `vis_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `visitas` DROP PRIMARY KEY, ADD PRIMARY KEY (`vis_id`);
ALTER TABLE `visitas` CHANGE COLUMN `Id_Cliente` `vis_cli_id` INT DEFAULT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `id_Comercial` `vis_com_id` INT NOT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Id_Centro_Pre` `vis_centp_id` INT DEFAULT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Id_Prescritor` `vis_presc_id` INT DEFAULT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Id_Ruta` `vis_ruta_id` INT DEFAULT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Tipo_Visita` `vis_tipo` VARCHAR(255) NOT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Fecha` `vis_fecha` DATE NOT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Hora` `vis_hora` TIME NOT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Hora_Final` `vis_hora_final` TIME NOT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Notas` `vis_notas` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Estado_Visita` `vis_estado` VARCHAR(255) NOT NULL;
