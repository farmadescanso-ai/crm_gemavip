-- =============================================================================
-- VENTAS HEFAME (Mayorista) - Tabla para almacenar ventas extraídas de PDFs
-- =============================================================================
-- Datos: Material (EAN), Provincia, Mes/Año, Cantidad.
-- Origen: Informes PDF "VENTAS GEMAVIP MMAAAA TOTAL.pdf" del mayorista Hefame.
--
-- Ejecutar en la BD del CRM (crm_gemavip o crm_farmadescanso).
-- Nombres de campos: snake_case con prefijo venhef_ (ventas_hefame).
--
-- Una sola fila por (material, provincia, mes, año). Al subir nuevos PDFs,
-- si ya existe la combinación, se SUMAN las cantidades (no se duplican).
-- =============================================================================

CREATE TABLE IF NOT EXISTS `ventas_hefame` (
  `venhef_id` INT NOT NULL AUTO_INCREMENT,
  `venhef_material_codigo` VARCHAR(13) NOT NULL COMMENT 'Código EAN del material (13 dígitos)',
  `venhef_material_descripcion` VARCHAR(255) NULL COMMENT 'Descripción del producto',
  `venhef_provincia_codigo` VARCHAR(2) NOT NULL COMMENT 'Código provincia (01-52)',
  `venhef_provincia_nombre` VARCHAR(80) NULL COMMENT 'Nombre de la provincia',
  `venhef_mes` TINYINT UNSIGNED NOT NULL COMMENT 'Mes (1-12)',
  `venhef_anio` SMALLINT UNSIGNED NOT NULL COMMENT 'Año (ej. 2025, 2026)',
  `venhef_cantidad` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Unidades vendidas (suma si se reimporta)',
  `venhef_origen_archivo` VARCHAR(255) NULL COMMENT 'Último PDF del que se importó (trazabilidad)',
  `venhef_created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Primera importación',
  `venhef_updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Última actualización',
  PRIMARY KEY (`venhef_id`),
  UNIQUE KEY `uq_ventas_hefame_material_prov_mes_anio` (
    `venhef_material_codigo`,
    `venhef_provincia_codigo`,
    `venhef_mes`,
    `venhef_anio`
  ),
  KEY `idx_ventas_hefame_material` (`venhef_material_codigo`),
  KEY `idx_ventas_hefame_provincia` (`venhef_provincia_codigo`),
  KEY `idx_ventas_hefame_periodo` (`venhef_anio`, `venhef_mes`),
  KEY `idx_ventas_hefame_updated_at` (`venhef_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Ventas Gemavip del mayorista Hefame por material, provincia y mes';

-- =============================================================================
-- INSERCIÓN: usar ON DUPLICATE KEY UPDATE para sumar cantidades (no duplicar)
-- =============================================================================
-- INSERT INTO ventas_hefame (
--   venhef_material_codigo, venhef_material_descripcion,
--   venhef_provincia_codigo, venhef_provincia_nombre,
--   venhef_mes, venhef_anio, venhef_cantidad, venhef_origen_archivo
-- ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
-- ON DUPLICATE KEY UPDATE
--   venhef_cantidad = venhef_cantidad + VALUES(venhef_cantidad),
--   venhef_material_descripcion = VALUES(venhef_material_descripcion),
--   venhef_provincia_nombre = VALUES(venhef_provincia_nombre),
--   venhef_origen_archivo = VALUES(venhef_origen_archivo);
-- =============================================================================
