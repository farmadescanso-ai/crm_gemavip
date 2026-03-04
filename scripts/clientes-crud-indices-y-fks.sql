-- =============================================================================
-- CLIENTES CRUD: Índices y relaciones (FKs) necesarias
-- =============================================================================
-- Ejecutar en phpMyAdmin o cliente MySQL para que el CRUD de clientes funcione
-- correctamente con los desplegables (Tipo Cliente, Especialidad, Estado, etc.).
--
-- REQUISITOS:
--   1. Tablas migradas con prefijos (tipos_clientes.tipc_id, estdoClientes.estcli_id, etc.)
--   2. Ejecutar diagnostico-integridad-fks.sql y corregir huérfanos si hay alguno > 0
--
-- IDEMPOTENTE: Puede ejecutarse varias veces sin error (índices y FKs se omiten si ya existen).
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1) Asegurar que la columna cli_esp_id existe en clientes
-- -----------------------------------------------------------------------------
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'clientes'
    AND COLUMN_NAME = 'cli_esp_id'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `clientes` ADD COLUMN `cli_esp_id` INT DEFAULT NULL AFTER `cli_tipc_id`',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 2) Índices para columnas FK de clientes (mejora JOINs y búsquedas)
-- -----------------------------------------------------------------------------
DELIMITER //

DROP PROCEDURE IF EXISTS _add_index_if_not_exists//
CREATE PROCEDURE _add_index_if_not_exists(
  IN p_tabla VARCHAR(64),
  IN p_indice VARCHAR(64),
  IN p_columnas VARCHAR(500),
  IN p_tipo VARCHAR(20)
)
BEGIN
  DECLARE v_existe INT DEFAULT 0;

  SELECT COUNT(*) INTO v_existe
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = p_tabla
    AND index_name = p_indice;

  IF v_existe = 0 THEN
    SET @sql = CONCAT(
      'CREATE ', IF(p_tipo = 'FULLTEXT', 'FULLTEXT ', ''), 'INDEX `', p_indice, '` ON `', p_tabla, '` (', p_columnas, ')'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

DELIMITER ;

-- Índices clientes (FKs usadas en CRUD)
CALL _add_index_if_not_exists('clientes', 'idx_clientes_comercial', '`cli_com_id`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_tipocliente', '`cli_tipc_id`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_especialidad', '`cli_esp_id`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_estado_cliente', '`cli_estcli_id`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_provincia', '`cli_prov_id`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_pais', '`cli_pais_id`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_idioma', '`cli_idiom_id`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_moneda', '`cli_mon_id`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_formapago', '`cli_formp_id`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_nombre', '`cli_nombre_razon_social`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_codigo_postal', '`cli_codigo_postal`', 'BTREE');

DROP PROCEDURE IF EXISTS _add_index_if_not_exists;

-- -----------------------------------------------------------------------------
-- 3) Claves foráneas: clientes -> tablas de catálogo
-- -----------------------------------------------------------------------------
DELIMITER //

DROP PROCEDURE IF EXISTS _add_fk_if_not_exists//
CREATE PROCEDURE _add_fk_if_not_exists(
  IN p_tabla VARCHAR(64),
  IN p_constraint VARCHAR(64),
  IN p_columna VARCHAR(64),
  IN p_ref_tabla VARCHAR(64),
  IN p_ref_columna VARCHAR(64),
  IN p_on_delete VARCHAR(32),
  IN p_on_update VARCHAR(32)
)
BEGIN
  DECLARE v_existe INT DEFAULT 0;

  SELECT COUNT(*) INTO v_existe
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = p_tabla
    AND CONSTRAINT_NAME = p_constraint
    AND CONSTRAINT_TYPE = 'FOREIGN KEY';

  IF v_existe = 0 THEN
    SET @sql = CONCAT(
      'ALTER TABLE `', p_tabla, '` ADD CONSTRAINT `', p_constraint, '` ',
      'FOREIGN KEY (`', p_columna, '`) REFERENCES `', p_ref_tabla, '`(`', p_ref_columna, '`) ',
      'ON DELETE ', p_on_delete, ' ON UPDATE ', p_on_update
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

DELIMITER ;

-- Tipo Cliente (tipos_clientes)
CALL _add_fk_if_not_exists('clientes', 'fk_cli_tipc', 'cli_tipc_id', 'tipos_clientes', 'tipc_id', 'SET NULL', 'CASCADE');

-- Especialidad (especialidades)
CALL _add_fk_if_not_exists('clientes', 'fk_cli_esp', 'cli_esp_id', 'especialidades', 'esp_id', 'SET NULL', 'CASCADE');

-- Estado Cliente (estdoClientes)
CALL _add_fk_if_not_exists('clientes', 'fk_cli_estcli', 'cli_estcli_id', 'estdoClientes', 'estcli_id', 'SET NULL', 'CASCADE');

-- Comercial (comerciales)
CALL _add_fk_if_not_exists('clientes', 'fk_cli_com', 'cli_com_id', 'comerciales', 'com_id', 'RESTRICT', 'CASCADE');

-- Provincia (provincias)
CALL _add_fk_if_not_exists('clientes', 'fk_cli_prov', 'cli_prov_id', 'provincias', 'prov_id', 'SET NULL', 'CASCADE');

-- País (paises)
CALL _add_fk_if_not_exists('clientes', 'fk_cli_pais', 'cli_pais_id', 'paises', 'pais_id', 'SET NULL', 'CASCADE');

-- Idioma (idiomas)
CALL _add_fk_if_not_exists('clientes', 'fk_cli_idiom', 'cli_idiom_id', 'idiomas', 'idiom_id', 'SET NULL', 'CASCADE');

-- Moneda (monedas)
CALL _add_fk_if_not_exists('clientes', 'fk_cli_mon', 'cli_mon_id', 'monedas', 'mon_id', 'SET NULL', 'CASCADE');

-- Forma de pago (formas_pago)
CALL _add_fk_if_not_exists('clientes', 'fk_cli_formp', 'cli_formp_id', 'formas_pago', 'formp_id', 'SET NULL', 'CASCADE');

DROP PROCEDURE IF EXISTS _add_fk_if_not_exists;

SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- 4) Datos mínimos en catálogos (solo si están vacíos)
-- -----------------------------------------------------------------------------
-- Si las tablas de catálogo están vacías, los desplegables no mostrarán opciones.
-- Estos INSERT solo se ejecutan cuando la tabla no tiene filas.

-- tipos_clientes (solo si vacía)
INSERT INTO `tipos_clientes` (`tipc_tipo`)
SELECT 'CAP' FROM DUAL WHERE (SELECT COUNT(*) FROM `tipos_clientes`) = 0;

-- especialidades (solo si vacía)
INSERT INTO `especialidades` (`esp_nombre`)
SELECT 'Farmacia' FROM DUAL WHERE (SELECT COUNT(*) FROM `especialidades`) = 0;

-- estdoClientes (solo si vacía)
INSERT INTO `estdoClientes` (`estcli_nombre`)
SELECT 'Potencial' FROM DUAL WHERE (SELECT COUNT(*) FROM `estdoClientes`) = 0;

-- =============================================================================
-- NOTA: Si los desplegables siguen vacíos, verifica que las tablas tengan datos:
--   SELECT * FROM tipos_clientes; SELECT * FROM especialidades; SELECT * FROM estdoClientes;
-- Si usan columnas distintas (tipc_nombre, esp_observaciones), inserta manualmente.
-- =============================================================================

-- =============================================================================
-- Verificación: listar FKs de clientes
-- =============================================================================
-- SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
-- FROM information_schema.KEY_COLUMN_USAGE
-- WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND REFERENCED_TABLE_NAME IS NOT NULL;
-- =============================================================================
