-- =============================================================================
-- NORMALIZAR CÓDIGOS POSTALES ESPAÑA: añadir 0 delante de los de 4 dígitos
-- =============================================================================
-- Los códigos postales españoles tienen 5 dígitos (01XXX a 52XXX).
-- Los que tienen 4 dígitos (1XXX a 9XXX) deben llevar un 0 delante.
-- Ejemplo: 8172 -> 08172, 3001 -> 03001, 8850 -> 08850
--
-- Condición: 4 dígitos, primer dígito 1-9 (no 0, que ya sería correcto).
-- Ejecutar en phpMyAdmin o MySQL CLI sobre crm_gemavip.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. clientes (cli_codigo_postal)
-- -----------------------------------------------------------------------------
UPDATE `clientes`
SET `cli_codigo_postal` = CONCAT('0', TRIM(REPLACE(REPLACE(COALESCE(`cli_codigo_postal`, ''), ' ', ''), '-', '')))
WHERE `cli_codigo_postal` IS NOT NULL
  AND TRIM(REPLACE(REPLACE(COALESCE(`cli_codigo_postal`, ''), ' ', ''), '-', '')) REGEXP '^[1-9][0-9]{3}$';

-- -----------------------------------------------------------------------------
-- 2. direccionesEnvio (direnv_codigo_postal o CodigoPostal)
-- -----------------------------------------------------------------------------
-- Esquema migrado:
UPDATE `direccionesEnvio`
SET `direnv_codigo_postal` = CONCAT('0', TRIM(REPLACE(REPLACE(COALESCE(`direnv_codigo_postal`, ''), ' ', ''), '-', '')))
WHERE `direnv_codigo_postal` IS NOT NULL
  AND TRIM(REPLACE(REPLACE(COALESCE(`direnv_codigo_postal`, ''), ' ', ''), '-', '')) REGEXP '^[1-9][0-9]{3}$';

-- Si usas CodigoPostal (legacy), comenta la anterior y descomenta:
-- UPDATE `direccionesEnvio`
-- SET `CodigoPostal` = CONCAT('0', TRIM(REPLACE(REPLACE(COALESCE(`CodigoPostal`, ''), ' ', ''), '-', '')))
-- WHERE `CodigoPostal` IS NOT NULL
--   AND TRIM(REPLACE(REPLACE(COALESCE(`CodigoPostal`, ''), ' ', ''), '-', '')) REGEXP '^[1-9][0-9]{3}$';

-- -----------------------------------------------------------------------------
-- 3. comerciales (com_codigo_postal o CodigoPostal)
-- -----------------------------------------------------------------------------
UPDATE `comerciales`
SET `com_codigo_postal` = CONCAT('0', TRIM(REPLACE(REPLACE(COALESCE(`com_codigo_postal`, ''), ' ', ''), '-', '')))
WHERE `com_codigo_postal` IS NOT NULL
  AND TRIM(REPLACE(REPLACE(COALESCE(`com_codigo_postal`, ''), ' ', ''), '-', '')) REGEXP '^[1-9][0-9]{3}$';

-- -----------------------------------------------------------------------------
-- 4. codigos_postales (usar la columna que exista en tu BD)
-- -----------------------------------------------------------------------------
-- Opción A: columna codpos_CodigoPostal (esquema migrado)
UPDATE `codigos_postales`
SET `codpos_CodigoPostal` = CONCAT('0', TRIM(REPLACE(REPLACE(COALESCE(`codpos_CodigoPostal`, ''), ' ', ''), '-', '')))
WHERE `codpos_CodigoPostal` IS NOT NULL
  AND TRIM(REPLACE(REPLACE(COALESCE(`codpos_CodigoPostal`, ''), ' ', ''), '-', '')) REGEXP '^[1-9][0-9]{3}$';

-- Opción B: columna CodigoPostal (esquema legacy) - comenta la anterior y descomenta:
-- UPDATE `codigos_postales`
-- SET `CodigoPostal` = CONCAT('0', TRIM(REPLACE(REPLACE(COALESCE(`CodigoPostal`, ''), ' ', ''), '-', '')))
-- WHERE `CodigoPostal` IS NOT NULL
--   AND TRIM(REPLACE(REPLACE(COALESCE(`CodigoPostal`, ''), ' ', ''), '-', '')) REGEXP '^[1-9][0-9]{3}$';

-- =============================================================================
-- VERIFICACIÓN (ejecutar después)
-- =============================================================================
-- Códigos de 4 dígitos que queden (debería ser 0):
-- SELECT cli_codigo_postal, cli_nombre_razon_social FROM clientes
-- WHERE cli_codigo_postal REGEXP '^[1-9][0-9]{3}$' LIMIT 20;
-- =============================================================================
