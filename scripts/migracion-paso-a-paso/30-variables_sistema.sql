-- =============================================================================
-- PASO 30: variables_sistema
-- =============================================================================

ALTER TABLE `variables_sistema` CHANGE COLUMN `id` `varsis_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `variables_sistema` DROP PRIMARY KEY, ADD PRIMARY KEY (`varsis_id`);
