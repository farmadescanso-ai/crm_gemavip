-- Catálogo de entidades bancarias españolas (código CCC de 4 dígitos → nombre + BIC/SWIFT).
-- Ejecutar una vez en la BD del CRM. Charset alineado con el resto de tablas.

CREATE TABLE IF NOT EXISTS `bancos` (
  `banco_id` int NOT NULL AUTO_INCREMENT,
  `banco_nombre` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `banco_entidad` char(4) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Código de entidad (4 dígitos, IBAN ES pos. 5-8)',
  `banco_swift_bic` varchar(11) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `banco_fecha_alta` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`banco_id`),
  UNIQUE KEY `uk_banco_entidad` (`banco_entidad`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
