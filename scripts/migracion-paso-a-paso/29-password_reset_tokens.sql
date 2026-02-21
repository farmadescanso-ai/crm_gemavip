-- =============================================================================
-- PASO 29: password_reset_tokens
-- =============================================================================

ALTER TABLE `password_reset_tokens` CHANGE COLUMN `id` `pwdres_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `password_reset_tokens` DROP PRIMARY KEY, ADD PRIMARY KEY (`pwdres_id`);
ALTER TABLE `password_reset_tokens` CHANGE COLUMN `comercial_id` `pwdres_com_id` INT NOT NULL;
