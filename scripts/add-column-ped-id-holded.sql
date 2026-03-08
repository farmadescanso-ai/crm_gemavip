-- =============================================================================
-- Añadir columna ped_id_holded en pedidos para sincronización con Holded
-- =============================================================================
-- Evita duplicados: cada pedido de Holded tiene un ID único que guardamos aquí.
-- NULL = pedido creado manualmente en el CRM (no desde Holded).
--
-- IDEMPOTENTE: Puede ejecutarse varias veces sin error.
-- =============================================================================

-- Columna ped_id_holded
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'ped_id_holded');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `pedidos` ADD COLUMN `ped_id_holded` VARCHAR(50) DEFAULT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Índice único para evitar duplicados (permite múltiples NULL)
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'pedidos' AND index_name = 'idx_pedidos_id_holded');
SET @sql = IF(@idx_exists = 0,
  'CREATE UNIQUE INDEX `idx_pedidos_id_holded` ON `pedidos` (`ped_id_holded`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
