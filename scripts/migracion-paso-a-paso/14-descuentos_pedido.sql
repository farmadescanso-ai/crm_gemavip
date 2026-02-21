-- =============================================================================
-- PASO 14: descuentos_pedido
-- =============================================================================

ALTER TABLE `descuentos_pedido` CHANGE COLUMN `id` `descped_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `descuentos_pedido` DROP PRIMARY KEY, ADD PRIMARY KEY (`descped_id`);
ALTER TABLE `descuentos_pedido` CHANGE COLUMN `importe_desde` `descped_importe_desde` DECIMAL(10,2) NOT NULL;
ALTER TABLE `descuentos_pedido` CHANGE COLUMN `importe_hasta` `descped_importe_hasta` DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE `descuentos_pedido` CHANGE COLUMN `dto_pct` `descped_pct` DECIMAL(5,2) NOT NULL;
ALTER TABLE `descuentos_pedido` CHANGE COLUMN `activo` `descped_activo` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `descuentos_pedido` CHANGE COLUMN `orden` `descped_orden` INT NOT NULL DEFAULT 0;
ALTER TABLE `descuentos_pedido` CHANGE COLUMN `created_at` `descped_creado_en` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `descuentos_pedido` CHANGE COLUMN `updated_at` `descped_actualizado_en` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
