-- =============================================================================
-- PASO 6: monedas
-- =============================================================================

ALTER TABLE `monedas` CHANGE COLUMN `id` `mon_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `monedas` DROP PRIMARY KEY, ADD PRIMARY KEY (`mon_id`);
ALTER TABLE `monedas` CHANGE COLUMN `Codigo` `mon_codigo` VARCHAR(4) NOT NULL;
ALTER TABLE `monedas` CHANGE COLUMN `Nombre` `mon_nombre` VARCHAR(255) NOT NULL;
ALTER TABLE `monedas` CHANGE COLUMN `Simbolo` `mon_simbolo` VARCHAR(5) DEFAULT NULL;
ALTER TABLE `monedas` CHANGE COLUMN `CodigoNumerico` `mon_codigo_numerico` INT DEFAULT NULL;
ALTER TABLE `monedas` CHANGE COLUMN `Bandera` `mon_bandera` VARCHAR(10) DEFAULT NULL;
