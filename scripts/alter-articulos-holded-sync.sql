-- Artículos: vínculo con catálogo Holded (product.id) para importación y trazabilidad.
-- Pedidos → Holded: las líneas del documento emparejan productos por SKU (API Holded);
--   guardar art_id_holded y art_sku coherentes con Holded evita desajustes.
-- Ejecutar en la base del CRM (una vez).

SET @db := DATABASE();

-- art_id_holded
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'articulos' AND COLUMN_NAME = 'art_id_holded'
);
SET @sql := IF(@exists = 0,
  'ALTER TABLE `articulos` ADD COLUMN `art_id_holded` VARCHAR(32) NULL DEFAULT NULL COMMENT ''ID producto Holded (API /products)'' AFTER `art_ean13`',
  'SELECT ''art_id_holded ya existe'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- art_holded_sync_at
SET @exists2 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'articulos' AND COLUMN_NAME = 'art_holded_sync_at'
);
SET @sql2 := IF(@exists2 = 0,
  'ALTER TABLE `articulos` ADD COLUMN `art_holded_sync_at` DATETIME NULL DEFAULT NULL COMMENT ''Última importación/sincro desde Holded'' AFTER `art_id_holded`',
  'SELECT ''art_holded_sync_at ya existe'' AS info'
);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- Índice único (un producto Holded → un artículo CRM; varios NULL permitidos en MySQL 8 con UNIQUE)
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'articulos' AND INDEX_NAME = 'ux_articulos_art_id_holded'
);
SET @sql3 := IF(@idx = 0,
  'CREATE UNIQUE INDEX `ux_articulos_art_id_holded` ON `articulos` (`art_id_holded`)',
  'SELECT ''ux_articulos_art_id_holded ya existe'' AS info'
);
PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;
