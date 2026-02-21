-- =============================================================================
-- PASO 17: comerciales (tabla core)
-- =============================================================================

ALTER TABLE `comerciales` CHANGE COLUMN `id` `com_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `comerciales` DROP PRIMARY KEY, ADD PRIMARY KEY (`com_id`);
ALTER TABLE `comerciales` CHANGE COLUMN `Nombre` `com_nombre` VARCHAR(255) NOT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Email` `com_email` VARCHAR(255) NOT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `DNI` `com_dni` VARCHAR(9) NOT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Password` `com_password` VARCHAR(255) NOT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Roll` `com_roll` VARCHAR(500) DEFAULT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Movil` `com_movil` VARCHAR(12) NOT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Direccion` `com_direccion` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Id_CodigoPostal` `com_codp_id` INT NOT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Poblacion` `com_poblacion` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `CodigoPostal` `com_codigo_postal` VARCHAR(7) DEFAULT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Id_Provincia` `com_prov_id` INT NOT NULL;
