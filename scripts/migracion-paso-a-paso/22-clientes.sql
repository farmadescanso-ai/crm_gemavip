-- =============================================================================
-- PASO 22: clientes (tabla core)
-- =============================================================================

ALTER TABLE `clientes` CHANGE COLUMN `id` `cli_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `clientes` DROP PRIMARY KEY, ADD PRIMARY KEY (`cli_id`);
ALTER TABLE `clientes` CHANGE COLUMN `Id_Cial` `cli_com_id` INT NOT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `DNI_CIF` `cli_dni_cif` VARCHAR(15) NOT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Nombre_Razon_Social` `cli_nombre_razon_social` VARCHAR(255) NOT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Nombre_Cial` `cli_nombre_cial` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `NumeroFarmacia` `cli_numero_farmacia` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Direccion` `cli_direccion` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Poblacion` `cli_poblacion` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `CodigoPostal` `cli_codigo_postal` VARCHAR(8) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Movil` `cli_movil` VARCHAR(13) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Email` `cli_email` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `TipoCliente` `cli_tipo_cliente_txt` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Id_TipoCliente` `cli_tipc_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Id_Idioma` `cli_idiom_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Id_Moneda` `cli_mon_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Tarifa` `cli_tarifa_legacy` INT NOT NULL DEFAULT 0;
ALTER TABLE `clientes` CHANGE COLUMN `Id_FormaPago` `cli_formp_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Dto` `cli_dto` DECIMAL(5,2) DEFAULT 0.00;
ALTER TABLE `clientes` CHANGE COLUMN `Id_Provincia` `cli_prov_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Id_CodigoPostal` `cli_codp_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Telefono` `cli_telefono` VARCHAR(13) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Id_Pais` `cli_pais_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `OK_KO` `cli_ok_ko` VARCHAR(2) DEFAULT 'OK';
ALTER TABLE `clientes` CHANGE COLUMN `Id_EstdoCliente` `cli_estcli_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Activo` `cli_activo` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `clientes` CHANGE COLUMN `TipoContacto` `cli_tipo_contacto` VARCHAR(20) DEFAULT NULL;
