-- Idempotente: añade clientes.cli_Id_Holded (ID contacto Holded, mismo uso que referencia explícito).
-- Ejecutar si la importación CPanel indica que falta la columna.

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'cli_Id_Holded'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `clientes` ADD COLUMN `cli_Id_Holded` VARCHAR(255) DEFAULT NULL AFTER `cli_referencia`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
