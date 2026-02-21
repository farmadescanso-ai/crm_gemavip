-- =============================================================================
-- PASO 19: tarifasClientes
-- =============================================================================

ALTER TABLE `tarifasClientes` CHANGE COLUMN `Id` `tarcli_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `tarifasClientes` DROP PRIMARY KEY, ADD PRIMARY KEY (`tarcli_id`);
ALTER TABLE `tarifasClientes` CHANGE COLUMN `NombreTarifa` `tarcli_nombre` VARCHAR(100) NOT NULL;
ALTER TABLE `tarifasClientes` CHANGE COLUMN `Activa` `tarcli_activa` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `tarifasClientes` CHANGE COLUMN `FechaInicio` `tarcli_fecha_inicio` DATE DEFAULT NULL;
ALTER TABLE `tarifasClientes` CHANGE COLUMN `FechaFin` `tarcli_fecha_fin` DATE DEFAULT NULL;
ALTER TABLE `tarifasClientes` CHANGE COLUMN `Observaciones` `tarcli_observaciones` TEXT;
