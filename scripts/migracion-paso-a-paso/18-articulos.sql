-- =============================================================================
-- PASO 18: articulos (tabla core)
-- =============================================================================

ALTER TABLE `articulos` CHANGE COLUMN `id` `art_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `articulos` DROP PRIMARY KEY, ADD PRIMARY KEY (`art_id`);
ALTER TABLE `articulos` CHANGE COLUMN `SKU` `art_sku` VARCHAR(12) NOT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `Nombre` `art_nombre` VARCHAR(100) NOT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `Presentacion` `art_presentacion` VARCHAR(20) NOT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `Unidades_Caja` `art_unidades_caja` INT NOT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `PVL` `art_pvl` DECIMAL(10,2) NOT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `IVA` `art_iva` DECIMAL(4,2) NOT NULL DEFAULT 21.00;
ALTER TABLE `articulos` CHANGE COLUMN `Imagen` `art_imagen` VARCHAR(255) NOT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `Id_Marca` `art_mar_id` INT DEFAULT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `EAN13` `art_ean13` BIGINT NOT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `Activo` `art_activo` TINYINT(1) NOT NULL DEFAULT 1;
