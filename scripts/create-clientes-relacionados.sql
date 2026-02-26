-- =============================================================================
-- CLIENTES RELACIONADOS
-- =============================================================================
-- Crea la tabla clientes_relacionados, migra cli_Id_cliente_relacionado en
-- clientes, añade FKs e índices.
--
-- REQUISITO: BD con tabla clientes y columna cli_Id_cliente_relacionado.
-- Si cli_Id_cliente_relacionado no existe, ejecutar antes:
--   ALTER TABLE clientes ADD COLUMN cli_Id_cliente_relacionado INT NULL
--   COMMENT 'Id del cliente relacionado con este';
--
-- Ejecutar en phpMyAdmin o MySQL CLI:
--   Get-Content scripts\create-clientes-relacionados.sql | mysql -u usuario -p nombre_bd
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. Crear tabla clientes_relacionados
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `clientes_relacionados` (
  `clirel_id` int NOT NULL AUTO_INCREMENT,
  `clirel_cli_origen_id` int NOT NULL COMMENT 'Cliente origen (tipo Otros)',
  `clirel_cli_relacionado_id` int NOT NULL COMMENT 'Cliente al que se relaciona',
  `clirel_descripcion` varchar(255) DEFAULT NULL COMMENT 'Descripción opcional de la relación',
  PRIMARY KEY (`clirel_id`),
  UNIQUE KEY `uk_clirel_origen_relacionado` (`clirel_cli_origen_id`, `clirel_cli_relacionado_id`),
  KEY `idx_clirel_origen` (`clirel_cli_origen_id`),
  KEY `idx_clirel_relacionado` (`clirel_cli_relacionado_id`),
  CONSTRAINT `fk_clirel_origen` FOREIGN KEY (`clirel_cli_origen_id`) REFERENCES `clientes` (`cli_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_clirel_relacionado` FOREIGN KEY (`clirel_cli_relacionado_id`) REFERENCES `clientes` (`cli_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Relaciones entre clientes (origen tipo Otros)';

-- -----------------------------------------------------------------------------
-- 2. Migrar columna cli_Id_cliente_relacionado en clientes
-- -----------------------------------------------------------------------------
-- 2.1 Permitir NULL en la columna (necesario antes de actualizar 0 → NULL)
ALTER TABLE `clientes` MODIFY COLUMN `cli_Id_cliente_relacionado` int DEFAULT NULL
COMMENT 'Id del cliente relacionado con este (principal cuando hay varias)';

-- 2.2 Sustituir 0 por NULL (0 no es un cli_id válido)
UPDATE `clientes` SET `cli_Id_cliente_relacionado` = NULL
WHERE `cli_Id_cliente_relacionado` = 0;

-- 2.3 Índice para consultas por cliente relacionado
-- Comentado si el índice ya existe (#1061). Descomenta para BD nueva.
-- CREATE INDEX `idx_clientes_cli_relacionado` ON `clientes` (`cli_Id_cliente_relacionado`);

-- 2.4 FK self-reference en clientes
-- Comentado si la FK ya existe (#1826). Descomenta para BD nueva.
-- ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_relacionado`
--   FOREIGN KEY (`cli_Id_cliente_relacionado`) REFERENCES `clientes` (`cli_id`)
--   ON DELETE SET NULL ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
