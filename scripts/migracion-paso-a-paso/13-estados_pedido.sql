-- =============================================================================
-- PASO 13: estados_pedido
-- =============================================================================

ALTER TABLE `estados_pedido` CHANGE COLUMN `id` `estped_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `estados_pedido` DROP PRIMARY KEY, ADD PRIMARY KEY (`estped_id`);
ALTER TABLE `estados_pedido` CHANGE COLUMN `codigo` `estped_codigo` VARCHAR(32) NOT NULL;
ALTER TABLE `estados_pedido` CHANGE COLUMN `nombre` `estped_nombre` VARCHAR(64) NOT NULL;
ALTER TABLE `estados_pedido` CHANGE COLUMN `color` `estped_color` ENUM('ok','info','warn','danger') NOT NULL DEFAULT 'info';
ALTER TABLE `estados_pedido` CHANGE COLUMN `activo` `estped_activo` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `estados_pedido` CHANGE COLUMN `orden` `estped_orden` INT NOT NULL DEFAULT 0;
ALTER TABLE `estados_pedido` CHANGE COLUMN `created_at` `estped_creado_en` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `estados_pedido` CHANGE COLUMN `updated_at` `estped_actualizado_en` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
