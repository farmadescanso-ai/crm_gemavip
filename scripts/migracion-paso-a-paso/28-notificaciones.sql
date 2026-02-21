-- =============================================================================
-- PASO 28: notificaciones
-- =============================================================================

ALTER TABLE `notificaciones` CHANGE COLUMN `id` `notif_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `notificaciones` DROP PRIMARY KEY, ADD PRIMARY KEY (`notif_id`);
ALTER TABLE `notificaciones` CHANGE COLUMN `id_contacto` `notif_ag_id` INT NOT NULL;
ALTER TABLE `notificaciones` CHANGE COLUMN `id_comercial_solicitante` `notif_com_id` INT NOT NULL;
ALTER TABLE `notificaciones` CHANGE COLUMN `id_admin_resolvio` `notif_com_admin_id` INT DEFAULT NULL;
ALTER TABLE `notificaciones` CHANGE COLUMN `id_pedido` `notif_ped_id` INT DEFAULT NULL;
