-- =============================================================================
-- RENUMERAR cli_id de la tabla clientes desde 1 hasta N
-- =============================================================================
-- Reasigna cli_id secuencialmente (1, 2, 3, ...) manteniendo el orden actual.
-- Actualiza todas las tablas que referencian clientes.cli_id.
--
-- IMPORTANTE: Hacer backup de la BD antes de ejecutar.
-- Ejecutar en phpMyAdmin o MySQL CLI sobre crm_gemavip.
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. Crear tabla de mapeo old_id -> new_id (1, 2, 3, ...)
-- -----------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS _cli_id_map;
CREATE TEMPORARY TABLE _cli_id_map (
  old_id INT PRIMARY KEY,
  new_id INT NOT NULL
);

SET @n = 0;
INSERT INTO _cli_id_map (old_id, new_id)
SELECT cli_id, @n := @n + 1
FROM `clientes`
ORDER BY cli_id;

-- -----------------------------------------------------------------------------
-- 2. Actualizar tablas que referencian clientes
-- -----------------------------------------------------------------------------

-- pedidos
UPDATE `pedidos` p
INNER JOIN _cli_id_map m ON p.`ped_cli_id` = m.old_id
SET p.`ped_cli_id` = m.new_id;

-- clientes_contactos
UPDATE `clientes_contactos` cc
INNER JOIN _cli_id_map m ON cc.`clicont_cli_id` = m.old_id
SET cc.`clicont_cli_id` = m.new_id;

-- direccionesEnvio
UPDATE `direccionesEnvio` d
INNER JOIN _cli_id_map m ON d.`direnv_cli_id` = m.old_id
SET d.`direnv_cli_id` = m.new_id;

-- visitas
UPDATE `visitas` v
INNER JOIN _cli_id_map m ON v.`vis_cli_id` = m.old_id
SET v.`vis_cli_id` = m.new_id;

-- clientes_relacionados (ambas columnas)
UPDATE `clientes_relacionados` cr
INNER JOIN _cli_id_map mo ON cr.`clirel_cli_origen_id` = mo.old_id
SET cr.`clirel_cli_origen_id` = mo.new_id;
UPDATE `clientes_relacionados` cr
INNER JOIN _cli_id_map mr ON cr.`clirel_cli_relacionado_id` = mr.old_id
SET cr.`clirel_cli_relacionado_id` = mr.new_id;

-- clientes_cooperativas (comentar si no existe o usa otra columna)
UPDATE `clientes_cooperativas` cc
INNER JOIN _cli_id_map m ON cc.`detco_Id_Cliente` = m.old_id
SET cc.`detco_Id_Cliente` = m.new_id;

-- clientes_gruposCompras (comentar si no existe o usa otra columna)
UPDATE `clientes_gruposCompras` cg
INNER JOIN _cli_id_map m ON cg.`detgru_Id_Cliente` = m.old_id
SET cg.`detgru_Id_Cliente` = m.new_id;

-- -----------------------------------------------------------------------------
-- 3. Añadir columna temporal y asignar nuevos IDs en clientes
--    (elimina cli_id_new si existe por ejecución previa incompleta)
-- -----------------------------------------------------------------------------
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'cli_id_new');
SET @sql = IF(@col_exists > 0, 'ALTER TABLE `clientes` DROP COLUMN `cli_id_new`', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE `clientes` ADD COLUMN `cli_id_new` INT NULL;

UPDATE `clientes` c
INNER JOIN _cli_id_map m ON c.`cli_id` = m.old_id
SET c.`cli_id_new` = m.new_id;

-- cli_Id_cliente_relacionado (autoreferencia)
UPDATE `clientes` c
INNER JOIN _cli_id_map m ON c.`cli_Id_cliente_relacionado` = m.old_id
SET c.`cli_Id_cliente_relacionado` = m.new_id
WHERE c.`cli_Id_cliente_relacionado` IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Eliminar FKs que referencian clientes.cli_id (solo las que existen)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _drop_fks_to_clientes;
DELIMITER //
CREATE PROCEDURE _drop_fks_to_clientes()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_tbl VARCHAR(64);
  DECLARE v_fk VARCHAR(64);
  DECLARE cur CURSOR FOR
    SELECT rc.TABLE_NAME, rc.CONSTRAINT_NAME
    FROM information_schema.REFERENTIAL_CONSTRAINTS rc
    WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
      AND rc.REFERENCED_TABLE_NAME = 'clientes';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO v_tbl, v_fk;
    IF done THEN LEAVE read_loop; END IF;
    SET @sql = CONCAT('ALTER TABLE `', v_tbl, '` DROP FOREIGN KEY `', v_fk, '`');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END LOOP;
  CLOSE cur;
END//
DELIMITER ;
CALL _drop_fks_to_clientes();
DROP PROCEDURE _drop_fks_to_clientes;

-- -----------------------------------------------------------------------------
-- 5. Reemplazar cli_id por cli_id_new
-- -----------------------------------------------------------------------------
ALTER TABLE `clientes` DROP PRIMARY KEY;
ALTER TABLE `clientes` DROP COLUMN `cli_id`;
ALTER TABLE `clientes` CHANGE COLUMN `cli_id_new` `cli_id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST;

-- -----------------------------------------------------------------------------
-- 6. Recrear FKs (una por tabla; si alguna falla, comenta la línea)
-- -----------------------------------------------------------------------------
ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_cli`
  FOREIGN KEY (`ped_cli_id`) REFERENCES `clientes`(`cli_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `clientes_contactos` ADD CONSTRAINT `fk_clicont_cli`
  FOREIGN KEY (`clicont_cli_id`) REFERENCES `clientes`(`cli_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `direccionesEnvio` ADD CONSTRAINT `fk_direnv_cli`
  FOREIGN KEY (`direnv_cli_id`) REFERENCES `clientes`(`cli_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `visitas` ADD CONSTRAINT `fk_vis_cli`
  FOREIGN KEY (`vis_cli_id`) REFERENCES `clientes`(`cli_id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `clientes_relacionados` ADD CONSTRAINT `fk_clirel_origen`
  FOREIGN KEY (`clirel_cli_origen_id`) REFERENCES `clientes`(`cli_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `clientes_relacionados` ADD CONSTRAINT `fk_clirel_relacionado`
  FOREIGN KEY (`clirel_cli_relacionado_id`) REFERENCES `clientes`(`cli_id`) ON DELETE CASCADE ON UPDATE CASCADE;
-- ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_relacionado`
--   FOREIGN KEY (`cli_Id_cliente_relacionado`) REFERENCES `clientes`(`cli_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 7. Ajustar AUTO_INCREMENT
-- -----------------------------------------------------------------------------
SET @max_id = (SELECT COALESCE(MAX(`cli_id`), 0) FROM `clientes`);
SET @sql = CONCAT('ALTER TABLE `clientes` AUTO_INCREMENT = ', @max_id + 1);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;

DROP TEMPORARY TABLE IF EXISTS _cli_id_map;

-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================
-- SELECT MIN(cli_id) AS min_id, MAX(cli_id) AS max_id, COUNT(*) AS total FROM clientes;
-- Debería mostrar min_id=1, max_id=total (sin huecos)
-- =============================================================================
