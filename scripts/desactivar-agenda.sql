-- =============================================================================
-- Desactivar módulo Agenda en el CRM
-- Registra en variables_sistema que la agenda está desactivada.
-- Ejecutar contra la BD del CRM (crm_gemavip).
-- =============================================================================

-- Asegurar que existe la tabla variables_sistema
CREATE TABLE IF NOT EXISTS `variables_sistema` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `clave` VARCHAR(120) NOT NULL,
  `valor` TEXT NULL,
  `descripcion` VARCHAR(255) NULL,
  `updated_by` VARCHAR(180) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_variables_sistema_clave` (`clave`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insertar o actualizar variable agenda_activo = 0
INSERT INTO `variables_sistema` (`clave`, `valor`, `descripcion`)
VALUES ('agenda_activo', '0', 'Agenda desactivada. 0=desactivada, 1=activa.')
ON DUPLICATE KEY UPDATE
  `valor` = '0',
  `descripcion` = 'Agenda desactivada. 0=desactivada, 1=activa.',
  `updated_at` = CURRENT_TIMESTAMP;
