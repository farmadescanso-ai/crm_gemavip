-- =============================================================================
-- NORMALIZACIÓN DE TELÉFONOS EXISTENTES EN BD
-- Formato objetivo en BD: todo junto sin espacios. Ej: +34630874781
-- Ejecutar tras aplicar los cambios en la aplicación.
-- IMPORTANTE: Hacer BACKUP de la BD antes de ejecutar.
-- =============================================================================

SET NAMES utf8mb4;

-- Función auxiliar: limpia y normaliza un teléfono (MySQL 5.7+ compatible, sin REGEXP_REPLACE)
-- Quita espacios, guiones, puntos, paréntesis. Añade +34 si es número español sin prefijo.
DROP FUNCTION IF EXISTS `normalizar_telefono`;
DELIMITER //
CREATE FUNCTION `normalizar_telefono`(raw VARCHAR(50)) RETURNS VARCHAR(25)
DETERMINISTIC
BEGIN
  DECLARE s VARCHAR(50) DEFAULT '';
  DECLARE d VARCHAR(50) DEFAULT '';
  DECLARE i INT DEFAULT 1;
  DECLARE c CHAR(1);
  DECLARE len INT;
  DECLARE has_plus TINYINT DEFAULT 0;

  IF raw IS NULL OR TRIM(raw) = '' THEN
    RETURN NULL;
  END IF;

  -- Quitar espacios, guiones, puntos, paréntesis
  SET s = TRIM(raw);
  SET s = REPLACE(s, ' ', '');
  SET s = REPLACE(s, '-', '');
  SET s = REPLACE(s, '.', '');
  SET s = REPLACE(s, '(', '');
  SET s = REPLACE(s, ')', '');

  -- Extraer solo + y dígitos
  SET d = '';
  SET len = LENGTH(s);
  SET i = 1;
  WHILE i <= len DO
    SET c = SUBSTRING(s, i, 1);
    IF c = '+' THEN
      SET has_plus = 1;
    ELSEIF c >= '0' AND c <= '9' THEN
      SET d = CONCAT(d, c);
    END IF;
    SET i = i + 1;
  END WHILE;

  IF d = '' THEN
    RETURN NULL;
  END IF;

  -- Si tenía + o el número empieza por 34, devolver +digits
  IF has_plus = 1 THEN
    RETURN CONCAT('+', d);
  END IF;

  -- Sin +: si es 9 dígitos español (6,7,8,9), añadir +34
  IF LENGTH(d) = 9 AND SUBSTRING(d, 1, 1) IN ('6', '7', '8', '9') THEN
    RETURN CONCAT('+34', d);
  END IF;

  -- Si empieza por 34 y tiene 11 dígitos, añadir +
  IF LENGTH(d) = 11 AND SUBSTRING(d, 1, 2) = '34' THEN
    RETURN CONCAT('+', d);
  END IF;

  -- Por defecto, añadir + si son solo dígitos (9-15 dígitos)
  IF LENGTH(d) >= 9 AND LENGTH(d) <= 15 THEN
    RETURN CONCAT('+', d);
  END IF;

  RETURN CONCAT('+', d);
END//
DELIMITER ;

-- =============================================================================
-- ACTUALIZACIONES POR TABLA
-- Ajusta los nombres de columna según tu esquema (puede ser cli_telefono o Telefono, etc.)
-- =============================================================================

-- clientes: usar cli_telefono/cli_movil si migrado, o Telefono/Movil si no
-- Ejecuta solo las líneas que coincidan con las columnas de tu BD:
UPDATE `clientes`
SET `cli_telefono` = normalizar_telefono(`cli_telefono`)
WHERE `cli_telefono` IS NOT NULL AND TRIM(`cli_telefono`) != '';
UPDATE `clientes`
SET `cli_movil` = normalizar_telefono(`cli_movil`)
WHERE `cli_movil` IS NOT NULL AND TRIM(`cli_movil`) != '';
-- Si tu BD usa Telefono/Movil (sin prefijo cli_):
-- UPDATE `clientes` SET `Telefono` = normalizar_telefono(`Telefono`) WHERE `Telefono` IS NOT NULL AND TRIM(`Telefono`) != '';
-- UPDATE `clientes` SET `Movil` = normalizar_telefono(`Movil`) WHERE `Movil` IS NOT NULL AND TRIM(`Movil`) != '';

-- comerciales: com_movil (si migrado) o Movil (si no)
UPDATE `comerciales`
SET `com_movil` = normalizar_telefono(`com_movil`)
WHERE `com_movil` IS NOT NULL AND TRIM(`com_movil`) != '';
-- Si tu BD usa Movil (sin prefijo): UPDATE `comerciales` SET `Movil` = normalizar_telefono(`Movil`) WHERE `Movil` IS NOT NULL AND TRIM(`Movil`) != '';

-- agenda: ag_telefono, ag_movil (si migrado) o Telefono, Movil (si no)
UPDATE `agenda`
SET `ag_telefono` = normalizar_telefono(`ag_telefono`)
WHERE `ag_telefono` IS NOT NULL AND TRIM(`ag_telefono`) != '';
UPDATE `agenda`
SET `ag_movil` = normalizar_telefono(`ag_movil`)
WHERE `ag_movil` IS NOT NULL AND TRIM(`ag_movil`) != '';
-- Si tu BD usa Telefono/Movil: comenta las de arriba y descomenta:
-- UPDATE `agenda` SET `Telefono` = normalizar_telefono(`Telefono`) WHERE `Telefono` IS NOT NULL AND TRIM(`Telefono`) != '';
-- UPDATE `agenda` SET `Movil` = normalizar_telefono(`Movil`) WHERE `Movil` IS NOT NULL AND TRIM(`Movil`) != '';

-- direccionesEnvio: direnv_telefono, direnv_movil (si migrado) o Telefono, Movil (si no)
UPDATE `direccionesEnvio`
SET `direnv_telefono` = normalizar_telefono(`direnv_telefono`)
WHERE `direnv_telefono` IS NOT NULL AND TRIM(`direnv_telefono`) != '';
UPDATE `direccionesEnvio`
SET `direnv_movil` = normalizar_telefono(`direnv_movil`)
WHERE `direnv_movil` IS NOT NULL AND TRIM(`direnv_movil`) != '';
-- Si tu BD usa Telefono/Movil: comenta las de arriba y descomenta:
-- UPDATE `direccionesEnvio` SET `Telefono` = normalizar_telefono(`Telefono`) WHERE `Telefono` IS NOT NULL AND TRIM(`Telefono`) != '';
-- UPDATE `direccionesEnvio` SET `Movil` = normalizar_telefono(`Movil`) WHERE `Movil` IS NOT NULL AND TRIM(`Movil`) != '';

-- cooperativas: coop_telefono (si migrado) o Telefono (si no)
UPDATE `cooperativas`
SET `coop_telefono` = normalizar_telefono(`coop_telefono`)
WHERE `coop_telefono` IS NOT NULL AND TRIM(`coop_telefono`) != '';
-- Si tu BD usa Telefono: UPDATE `cooperativas` SET `Telefono` = normalizar_telefono(`Telefono`) WHERE `Telefono` IS NOT NULL AND TRIM(`Telefono`) != '';

-- gruposCompras: Telefono (si existe)
UPDATE `gruposCompras`
SET `Telefono` = normalizar_telefono(`Telefono`)
WHERE `Telefono` IS NOT NULL AND TRIM(`Telefono`) != '';

-- Limpiar función
DROP FUNCTION IF EXISTS `normalizar_telefono`;
