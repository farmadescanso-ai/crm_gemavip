-- Ampliar cli_codigo_postal para códigos postales internacionales (UK, etc.)
-- Ejecutar si recibes "Data too long for column 'cli_codigo_postal'"
-- Tras ejecutar, actualizar MAX_CODIGO_POSTAL_LENGTH en config/domains/clientes-crud.js a 12

ALTER TABLE `clientes` MODIFY COLUMN `cli_codigo_postal` VARCHAR(12) DEFAULT NULL;
