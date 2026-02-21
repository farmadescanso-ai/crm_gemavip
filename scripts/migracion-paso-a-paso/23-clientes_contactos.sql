-- =============================================================================
-- PASO 23: clientes_contactos
-- =============================================================================

ALTER TABLE `clientes_contactos` CHANGE COLUMN `Id` `clicont_id` BIGINT NOT NULL AUTO_INCREMENT;
ALTER TABLE `clientes_contactos` DROP PRIMARY KEY, ADD PRIMARY KEY (`clicont_id`);
ALTER TABLE `clientes_contactos` CHANGE COLUMN `Id_Cliente` `clicont_cli_id` INT NOT NULL;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `Id_Contacto` `clicont_ag_id` INT NOT NULL;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `Rol` `clicont_rol` VARCHAR(80) DEFAULT NULL;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `Es_Principal` `clicont_es_principal` TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `Notas` `clicont_notas` TEXT;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `VigenteDesde` `clicont_vigente_desde` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `VigenteHasta` `clicont_vigente_hasta` DATETIME DEFAULT NULL;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `MotivoBaja` `clicont_motivo_baja` VARCHAR(200) DEFAULT NULL;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `CreadoEn` `clicont_creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `ActualizadoEn` `clicont_actualizado_en` DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;
