-- =============================================================================
-- PASO 8: formas_pago
-- =============================================================================

ALTER TABLE `formas_pago` CHANGE COLUMN `id` `formp_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `formas_pago` DROP PRIMARY KEY, ADD PRIMARY KEY (`formp_id`);
ALTER TABLE `formas_pago` CHANGE COLUMN `FormaPago` `formp_nombre` VARCHAR(255) NOT NULL;
ALTER TABLE `formas_pago` CHANGE COLUMN `Dias` `formp_dias` INT NOT NULL;
