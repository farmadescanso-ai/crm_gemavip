-- =============================================================================
-- Añadir columnas en clientes para datos importados desde Holded
-- =============================================================================
-- Columnas para campos del Excel sin correspondencia previa en clientes:
--   Creado, Referencia, Régimen, Ref. mandato, Tags, Cuenta ventas/compras,
--   Visibilidad Portal.
--
-- La columna "Dirección de entrega" del Excel se importa en direccionesEnvio
-- (cada cliente puede tener varias direcciones de envío).
--
-- IDEMPOTENTE: Puede ejecutarse varias veces sin error.
-- =============================================================================

-- Columna de referencia para posicionar las nuevas (usar la que exista)
SET @ref_col = (
  SELECT COLUMN_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes'
  AND COLUMN_NAME IN ('cli_tipo_contacto', 'TipoContacto', 'cli_activo', 'Activo')
  LIMIT 1
);
SET @ref_col = IFNULL(@ref_col, 'Activo');

-- -----------------------------------------------------------------------------
-- Añadir cada columna si no existe
-- -----------------------------------------------------------------------------

-- Creado (fecha de creación en Holded)
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'cli_creado_holded');
SET @sql = IF(@col_exists = 0,
  CONCAT('ALTER TABLE `clientes` ADD COLUMN `cli_creado_holded` DATETIME DEFAULT NULL AFTER `', @ref_col, '`'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Referencia
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'cli_referencia');
SET @sql = IF(@col_exists = 0,
  CONCAT('ALTER TABLE `clientes` ADD COLUMN `cli_referencia` VARCHAR(255) DEFAULT NULL AFTER `cli_creado_holded`'),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Régimen (régimen fiscal, ej. "Régimen general")
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'cli_regimen');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `clientes` ADD COLUMN `cli_regimen` VARCHAR(100) DEFAULT NULL AFTER `cli_referencia`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Ref. mandato
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'cli_ref_mandato');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `clientes` ADD COLUMN `cli_ref_mandato` VARCHAR(100) DEFAULT NULL AFTER `cli_regimen`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Tags (ej. #farmacia #distribuidor)
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'cli_tags');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `clientes` ADD COLUMN `cli_tags` TEXT DEFAULT NULL AFTER `cli_ref_mandato`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Cuenta de ventas
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'cli_cuenta_ventas');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `clientes` ADD COLUMN `cli_cuenta_ventas` VARCHAR(100) DEFAULT NULL AFTER `cli_tags`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Cuenta de compras
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'cli_cuenta_compras');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `clientes` ADD COLUMN `cli_cuenta_compras` VARCHAR(100) DEFAULT NULL AFTER `cli_cuenta_ventas`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Visibilidad Portal (ej. "Por defecto")
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'cli_visibilidad_portal');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `clientes` ADD COLUMN `cli_visibilidad_portal` VARCHAR(50) DEFAULT NULL AFTER `cli_cuenta_compras`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =============================================================================
-- NOTA: Dirección de entrega
-- La tabla direccionesEnvio ya tiene la estructura necesaria (Direccion, Poblacion,
-- CodigoPostal, Id_Cliente/direnv_cli_id, etc.). Cada cliente puede tener varias.
-- Al importar, crear una fila en direccionesEnvio por cada cliente que tenga
-- "Dirección de entrega" en el Excel.
-- =============================================================================
