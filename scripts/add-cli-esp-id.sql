-- Añade la columna cli_esp_id a clientes para vincular con especialidades (CAP, Odontología, etc.)
-- Ejecutar si la columna no existe. Es seguro ejecutar varias veces.

-- Verificar si la columna existe antes de añadirla (MySQL 5.7+)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'clientes'
    AND COLUMN_NAME = 'cli_esp_id'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `clientes` ADD COLUMN `cli_esp_id` INT DEFAULT NULL AFTER `cli_tipc_id`',
  'SELECT "Columna cli_esp_id ya existe" AS msg'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Opcional: FK a especialidades (descomentar si quieres integridad referencial)
-- ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_esp` 
--   FOREIGN KEY (`cli_esp_id`) REFERENCES `especialidades`(`esp_id`) ON DELETE SET NULL ON UPDATE CASCADE;
