-- Catálogo de estados de pedido
-- Objetivo:
-- - Normalizar estados (FK) en vez de texto libre
-- - Permitir UI con selector y colores
-- - Mantener compatibilidad (EstadoPedido/Estado legacy)

CREATE TABLE IF NOT EXISTS `estados_pedido` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `codigo` VARCHAR(32) NOT NULL,
  `nombre` VARCHAR(64) NOT NULL,
  `color` ENUM('ok','info','warn','danger') NOT NULL DEFAULT 'info',
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `orden` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_estados_pedido_codigo` (`codigo`),
  KEY `idx_estados_pedido_activo_orden` (`activo`, `orden`, `nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed inicial (id estable por código, no por id)
INSERT INTO `estados_pedido` (`codigo`, `nombre`, `color`, `activo`, `orden`) VALUES
('pendiente', 'Pendiente', 'warn', 1, 10),
('aprobado',  'Aprobado',  'ok',   1, 20),
('entregado', 'Entregado', 'info', 1, 25),
('pagado',    'Pagado',    'ok',   1, 30),
('denegado',  'Denegado',  'danger', 1, 40)
ON DUPLICATE KEY UPDATE
  `nombre` = VALUES(`nombre`),
  `color` = VALUES(`color`),
  `activo` = VALUES(`activo`),
  `orden` = VALUES(`orden`);

-- ======================================================
-- Relación con pedidos
-- ======================================================
-- Añadir columna FK en pedidos (solo si no existe)
SET @has_col_estado := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pedidos'
    AND COLUMN_NAME = 'Id_EstadoPedido'
);
SET @sql_add_col := IF(@has_col_estado > 0, 'SELECT 1', 'ALTER TABLE `pedidos` ADD COLUMN `Id_EstadoPedido` INT NULL');
PREPARE stmt FROM @sql_add_col; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Índice para la FK / filtrado por estado (solo si no existe)
SET @has_idx_estado := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pedidos'
    AND INDEX_NAME = 'idx_pedidos_estado_pedido'
);
SET @sql_add_idx := IF(@has_idx_estado > 0, 'SELECT 1', 'CREATE INDEX `idx_pedidos_estado_pedido` ON `pedidos` (`Id_EstadoPedido`)');
PREPARE stmt FROM @sql_add_idx; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK (solo si no existe). Nota: puede fallar si motor no InnoDB o hay datos incompatibles.
-- Importante: detectar la FK aunque tenga otro nombre.
SET @has_fk_estado := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pedidos'
    AND COLUMN_NAME = 'Id_EstadoPedido'
    AND REFERENCED_TABLE_NAME IS NOT NULL
);
SET @sql_add_fk := IF(
  @has_fk_estado > 0,
  'SELECT 1',
  'ALTER TABLE `pedidos` ADD CONSTRAINT `fk_pedidos_estado_pedido` FOREIGN KEY (`Id_EstadoPedido`) REFERENCES `estados_pedido` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT'
);
PREPARE stmt FROM @sql_add_fk; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Migración best-effort desde estado legacy (si existe columna EstadoPedido/Estado)
-- Esta migración se ejecuta solo si existe alguna de estas columnas en `pedidos`:
-- - `EstadoPedido` (preferida)
-- - `Estado` (fallback)
SET @col_estado := NULL;
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'pedidos'
        AND COLUMN_NAME = 'EstadoPedido'
    ) THEN 'EstadoPedido'
    WHEN EXISTS (
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'pedidos'
        AND COLUMN_NAME = 'Estado'
    ) THEN 'Estado'
    ELSE NULL
  END
INTO @col_estado;

SET @sql_mig := IF(
  @col_estado IS NULL,
  'SELECT 1',
  CONCAT(
    'UPDATE `pedidos` p ',
    'LEFT JOIN `estados_pedido` e ',
    -- Forzar collation en la comparación para evitar errores tipo:
    -- "Illegal mix of collations ... for operation '='"
    '  ON (e.codigo COLLATE utf8mb4_unicode_ci) = (LOWER(TRIM(CONVERT(p.`', @col_estado, '` USING utf8mb4))) COLLATE utf8mb4_unicode_ci) ',
    'SET p.`Id_EstadoPedido` = e.id ',
    'WHERE p.`Id_EstadoPedido` IS NULL AND e.id IS NOT NULL'
  )
);

PREPARE stmt FROM @sql_mig; EXECUTE stmt; DEALLOCATE PREPARE stmt;

