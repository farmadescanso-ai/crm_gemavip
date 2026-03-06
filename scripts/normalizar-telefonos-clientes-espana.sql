-- =============================================================================
-- NORMALIZACIÓN DE TELÉFONOS EN CLIENTES (SOLO ESPAÑA)
-- Añade prefijo +34 a teléfonos/móviles de clientes en España que no lo tienen.
--
-- Condiciones:
--   - País España (Id_Pais/cli_pais_id → paises, o Pais/CodPais = 'ES')
--     O código postal español (5 dígitos, formato 01xxx-52xxx)
--   - Teléfono/móvil no vacío
--   - Valor actual sin prefijo +34
--
-- IMPORTANTE: Hacer BACKUP de la BD antes de ejecutar.
-- Incluye la creación de la función normalizar_telefono.
-- =============================================================================

SET NAMES utf8mb4;

-- Crear función normalizar_telefono (si no existe)
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

  SET s = TRIM(raw);
  SET s = REPLACE(s, ' ', '');
  SET s = REPLACE(s, '-', '');
  SET s = REPLACE(s, '.', '');
  SET s = REPLACE(s, '(', '');
  SET s = REPLACE(s, ')', '');

  SET d = '';
  SET len = LENGTH(s);
  SET i = 1;
  WHILE i <= len DO
    SET c = SUBSTRING(s, i, 1);
    IF c = '+' THEN SET has_plus = 1;
    ELSEIF c >= '0' AND c <= '9' THEN SET d = CONCAT(d, c);
    END IF;
    SET i = i + 1;
  END WHILE;

  IF d = '' THEN RETURN NULL; END IF;
  IF has_plus = 1 THEN RETURN CONCAT('+', d); END IF;
  IF LENGTH(d) = 9 AND SUBSTRING(d, 1, 1) IN ('6', '7', '8', '9') THEN RETURN CONCAT('+34', d); END IF;
  IF LENGTH(d) = 11 AND SUBSTRING(d, 1, 2) = '34' THEN RETURN CONCAT('+', d); END IF;
  IF LENGTH(d) >= 9 AND LENGTH(d) <= 15 THEN RETURN CONCAT('+', d); END IF;
  RETURN CONCAT('+', d);
END//
DELIMITER ;

-- Código postal español: 5 dígitos, primer dígito 0-5 (01xxx a 52xxx)
-- Se usa en la condición "es España o CP español"

-- -----------------------------------------------------------------------------
-- ESQUEMA CRM GEMAVIP (clientes, provincias, paises)
-- clientes: cli_id, cli_telefono, cli_movil, cli_codigo_postal, cli_prov_id, cli_pais_id, CodPais, Pais
-- provincias: prov_id, prov_codigo_pais
-- paises: pais_id, pais_codigo
-- -----------------------------------------------------------------------------

-- Teléfono
UPDATE `clientes` c
LEFT JOIN `provincias` p ON c.`cli_prov_id` = p.`prov_id`
LEFT JOIN `paises` pa ON c.`cli_pais_id` = pa.`pais_id`
SET c.`cli_telefono` = normalizar_telefono(c.`cli_telefono`)
WHERE (c.`cli_telefono` IS NOT NULL AND TRIM(c.`cli_telefono`) != '')
  AND (TRIM(c.`cli_telefono`) NOT LIKE '+34%' AND TRIM(c.`cli_telefono`) NOT LIKE '34%')
  AND (
    pa.`pais_codigo` = 'ES'
    OR p.`prov_codigo_pais` = 'ES'
    OR UPPER(TRIM(COALESCE(c.`CodPais`, ''))) = 'ES'
    OR c.`Pais` LIKE '%España%'
    OR (TRIM(REPLACE(REPLACE(COALESCE(c.`cli_codigo_postal`, ''), ' ', ''), '-', '')) REGEXP '^[0-5][0-9]{4}$')
  );

-- Móvil
UPDATE `clientes` c
LEFT JOIN `provincias` p ON c.`cli_prov_id` = p.`prov_id`
LEFT JOIN `paises` pa ON c.`cli_pais_id` = pa.`pais_id`
SET c.`cli_movil` = normalizar_telefono(c.`cli_movil`)
WHERE (c.`cli_movil` IS NOT NULL AND TRIM(c.`cli_movil`) != '')
  AND (TRIM(c.`cli_movil`) NOT LIKE '+34%' AND TRIM(c.`cli_movil`) NOT LIKE '34%')
  AND (
    pa.`pais_codigo` = 'ES'
    OR p.`prov_codigo_pais` = 'ES'
    OR UPPER(TRIM(COALESCE(c.`CodPais`, ''))) = 'ES'
    OR c.`Pais` LIKE '%España%'
    OR (TRIM(REPLACE(REPLACE(COALESCE(c.`cli_codigo_postal`, ''), ' ', ''), '-', '')) REGEXP '^[0-5][0-9]{4}$')
  );

-- -----------------------------------------------------------------------------
-- OPCIÓN B: ESQUEMA LEGACY (Telefono, Movil, CodigoPostal, Pais, CodPais, Id_Pais, Id_Provincia)
-- Si tu BD usa este esquema, comenta la OPCIÓN A y descomenta esta:
-- -----------------------------------------------------------------------------
/*
UPDATE `clientes` c
LEFT JOIN `provincias` p ON (c.`Id_Provincia` = p.`id` OR c.`Id_Provincia` = p.`Id`)
LEFT JOIN `paises` pa ON (c.`Id_Pais` = pa.`id` OR c.`Id_Pais` = pa.`Id`)
SET c.`Telefono` = normalizar_telefono(c.`Telefono`)
WHERE (c.`Telefono` IS NOT NULL AND TRIM(c.`Telefono`) != '')
  AND (TRIM(c.`Telefono`) NOT LIKE '+34%' AND TRIM(c.`Telefono`) NOT LIKE '34%')
  AND (
    (pa.`Id_pais` = 'ES' OR pa.`CodigoPais` = 'ES' OR pa.`pais_codigo` = 'ES')
    OR (p.`CodigoPais` = 'ES' OR p.`prov_codigo_pais` = 'ES')
    OR (UPPER(TRIM(COALESCE(c.`CodPais`, c.`Pais`, ''))) = 'ES' OR c.`Pais` LIKE '%España%')
    OR (TRIM(REPLACE(REPLACE(COALESCE(c.`CodigoPostal`, ''), ' ', ''), '-', '')) REGEXP '^[0-5][0-9]{4}$')
  );

UPDATE `clientes` c
LEFT JOIN `provincias` p ON (c.`Id_Provincia` = p.`id` OR c.`Id_Provincia` = p.`Id`)
LEFT JOIN `paises` pa ON (c.`Id_Pais` = pa.`id` OR c.`Id_Pais` = pa.`Id`)
SET c.`Movil` = normalizar_telefono(c.`Movil`)
WHERE (c.`Movil` IS NOT NULL AND TRIM(c.`Movil`) != '')
  AND (TRIM(c.`Movil`) NOT LIKE '+34%' AND TRIM(c.`Movil`) NOT LIKE '34%')
  AND (
    (pa.`Id_pais` = 'ES' OR pa.`CodigoPais` = 'ES' OR pa.`pais_codigo` = 'ES')
    OR (p.`CodigoPais` = 'ES' OR p.`prov_codigo_pais` = 'ES')
    OR (UPPER(TRIM(COALESCE(c.`CodPais`, c.`Pais`, ''))) = 'ES' OR c.`Pais` LIKE '%España%')
    OR (TRIM(REPLACE(REPLACE(COALESCE(c.`CodigoPostal`, ''), ' ', ''), '-', '')) REGEXP '^[0-5][0-9]{4}$')
  );
*/
