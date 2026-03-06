-- =============================================================================
-- NORMALIZACIÓN PAÍS, PROVINCIA, CÓDIGO POSTAL Y POBLACIÓN - CLIENTES
-- =============================================================================
-- Ejecutar las sentencias EN ORDEN. Hacer BACKUP de la BD antes.
-- Ajustar nombres de columnas según tu esquema (migrado cli_* vs legacy).
--
-- Orden de ejecución:
--   1. Normalizar formato CP (5 dígitos)
--   2. País España (cuando CP o provincia española)
--   3. Rellenar CP desde codigos_postales (cuando falta CP pero hay provincia+población)
--   4. Sincronizar CodPais y Pais
--   5. Idioma y moneda por defecto para España
-- =============================================================================

SET NAMES utf8mb4;

-- =============================================================================
-- PASO 0: Verificar columnas (ejecutar para diagnosticar)
-- =============================================================================
-- SELECT COLUMN_NAME FROM information_schema.COLUMNS
-- WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes'
-- AND COLUMN_NAME IN ('cli_codigo_postal','cli_prov_id','cli_poblacion','cli_pais_id','CodigoPostal','Id_Provincia','Poblacion','Id_Pais');

-- =============================================================================
-- PASO 1: NORMALIZAR CÓDIGOS POSTALES (5 dígitos para España)
-- =============================================================================
-- CP de 4 dígitos (1XXX-9XXX) → 0XXXX

-- Esquema migrado (cli_codigo_postal):
UPDATE `clientes`
SET `cli_codigo_postal` = CONCAT('0', TRIM(REPLACE(REPLACE(COALESCE(`cli_codigo_postal`, ''), ' ', ''), '-', '')))
WHERE `cli_codigo_postal` IS NOT NULL
  AND TRIM(REPLACE(REPLACE(COALESCE(`cli_codigo_postal`, ''), ' ', ''), '-', '')) REGEXP '^[1-9][0-9]{3}$';

-- Si usas esquema legacy (CodigoPostal), comenta la anterior y descomenta:
-- UPDATE `clientes` SET `CodigoPostal` = CONCAT('0', TRIM(REPLACE(REPLACE(COALESCE(`CodigoPostal`, ''), ' ', ''), '-', '')))
-- WHERE `CodigoPostal` IS NOT NULL AND TRIM(REPLACE(REPLACE(COALESCE(`CodigoPostal`, ''), ' ', ''), '-', '')) REGEXP '^[1-9][0-9]{3}$';


-- =============================================================================
-- PASO 2: PAÍS = ESPAÑA (cuando CP español o provincia española)
-- =============================================================================
-- Condiciones: CP 5 dígitos (01-52) O provincia con prov_codigo_pais='ES'

-- Esquema migrado (clientes cli_*, provincias prov_*, paises pais_*):
UPDATE `clientes` c
LEFT JOIN `provincias` p ON c.`cli_prov_id` = p.`prov_id`
SET c.`cli_pais_id` = (SELECT `pais_id` FROM `paises` WHERE `pais_codigo` = 'ES' LIMIT 1)
WHERE (
  TRIM(REPLACE(REPLACE(COALESCE(c.`cli_codigo_postal`, ''), ' ', ''), '-', '')) REGEXP '^[0-5][0-9]{4}$'
  OR p.`prov_codigo_pais` = 'ES'
);


-- =============================================================================
-- PASO 3: RELLENAR CÓDIGO POSTAL desde codigos_postales
-- =============================================================================
-- Cuando: sin CP, con provincia española, con población
-- Esquema BD: codpos_CodigoPostal, codpos_Localidad, codpos_Id_Provincia

UPDATE `clientes` c
INNER JOIN (
  SELECT c2.`cli_id` AS cli_id,
    (SELECT cp.`codpos_CodigoPostal`
     FROM `codigos_postales` cp
     WHERE cp.`codpos_Id_Provincia` = c2.`cli_prov_id`
       AND (cp.`codpos_Localidad` COLLATE utf8mb4_unicode_ci = c2.`cli_poblacion` COLLATE utf8mb4_unicode_ci
            OR cp.`codpos_Localidad` COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', c2.`cli_poblacion`, '%')
            OR c2.`cli_poblacion` COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', cp.`codpos_Localidad`, '%'))
     ORDER BY CASE WHEN cp.`codpos_Localidad` COLLATE utf8mb4_unicode_ci = c2.`cli_poblacion` COLLATE utf8mb4_unicode_ci THEN 0 ELSE 1 END
     LIMIT 1
    ) AS cp_val
  FROM `clientes` c2
  INNER JOIN `provincias` p2 ON c2.`cli_prov_id` = p2.`prov_id` AND p2.`prov_codigo_pais` = 'ES'
  WHERE (c2.`cli_codigo_postal` IS NULL OR TRIM(c2.`cli_codigo_postal`) = '')
    AND c2.`cli_prov_id` IS NOT NULL
    AND c2.`cli_poblacion` IS NOT NULL
    AND TRIM(c2.`cli_poblacion`) != ''
) sub ON c.`cli_id` = sub.`cli_id` AND sub.`cp_val` IS NOT NULL
SET c.`cli_codigo_postal` = sub.`cp_val`;


-- =============================================================================
-- PASO 4: SINCRONIZAR CodPais y Pais (texto) con cli_pais_id
-- =============================================================================
-- Cuando cli_pais_id = España, asegurar cli_CodPais='ES' y cli_Pais='España'

UPDATE `clientes` c
INNER JOIN `paises` pa ON c.`cli_pais_id` = pa.`pais_id` AND pa.`pais_codigo` = 'ES'
SET
  c.`cli_CodPais` = 'ES',
  c.`cli_Pais` = 'España'
WHERE c.`cli_pais_id` IS NOT NULL;

-- Si las columnas se llaman CodPais y Pais (legacy):
-- SET c.`CodPais` = 'ES', c.`Pais` = 'España'


-- =============================================================================
-- PASO 5: IDIOMA Y MONEDA por defecto para clientes de España
-- =============================================================================
-- Cuando cli_pais_id = España y idioma/moneda vacíos → Español, Euro

-- Esquema BD: idiomas (idiom_id, idiom_codigo='es'), monedas (mon_id, mon_codigo='EUR')

UPDATE `clientes` c
INNER JOIN `paises` pa ON c.`cli_pais_id` = pa.`pais_id` AND pa.`pais_codigo` = 'ES'
SET
  c.`cli_idiom_id` = (SELECT `idiom_id` FROM `idiomas` WHERE `idiom_codigo` = 'es' LIMIT 1),
  c.`cli_mon_id` = (SELECT `mon_id` FROM `monedas` WHERE `mon_codigo` = 'EUR' LIMIT 1)
WHERE c.`cli_pais_id` IS NOT NULL
  AND (c.`cli_idiom_id` IS NULL OR c.`cli_idiom_id` = 0)
  AND (c.`cli_mon_id` IS NULL OR c.`cli_mon_id` = 0);

-- Versión más simple (si idiomas/monedas tienen id 1 = Español/Euro):
-- UPDATE `clientes` SET cli_idiom_id=1, cli_mon_id=1
-- WHERE cli_pais_id = (SELECT pais_id FROM paises WHERE pais_codigo='ES' LIMIT 1)
--   AND (cli_idiom_id IS NULL OR cli_idiom_id=0)
--   AND (cli_mon_id IS NULL OR cli_mon_id=0);


-- =============================================================================
-- VERIFICACIÓN (ejecutar después para comprobar)
-- =============================================================================
-- Clientes con CP español pero país distinto de España (debería ser 0):
-- SELECT c.cli_id, c.cli_nombre_razon_social, c.cli_codigo_postal, c.cli_pais_id, pa.pais_nombre
-- FROM clientes c LEFT JOIN paises pa ON c.cli_pais_id = pa.pais_id
-- WHERE TRIM(REPLACE(COALESCE(c.cli_codigo_postal,''),' ','')) REGEXP '^[0-5][0-9]{4}$'
--   AND (pa.pais_codigo != 'ES' OR pa.pais_codigo IS NULL);

-- Clientes con provincia española pero país distinto (debería ser 0):
-- SELECT c.cli_id, c.cli_nombre_razon_social, p.prov_nombre, c.cli_pais_id
-- FROM clientes c
-- INNER JOIN provincias p ON c.cli_prov_id = p.prov_id AND p.prov_codigo_pais='ES'
-- LEFT JOIN paises pa ON c.cli_pais_id = pa.pais_id
-- WHERE pa.pais_codigo != 'ES' OR pa.pais_codigo IS NULL;
