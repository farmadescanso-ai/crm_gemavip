-- Agenda: catálogos relacionales (Cargo/Rol + Especialidad) y columnas FK
-- Ejecutar en la BD del CRM (crm_gemavip).
--
-- Objetivo:
-- - Cargo (tipo/rol) -> tabla `tiposcargorol`
-- - Especialidad -> tabla existente `especialidades`
-- - Agenda guarda FKs: `Id_TipoCargoRol`, `Id_Especialidad`
--
-- NOTA: este script intenta ser conservador. Ajusta nombres si tu BD usa mayúsculas.

-- 1) Catálogo de cargos / roles
CREATE TABLE IF NOT EXISTS `tiposcargorol` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `Nombre` VARCHAR(120) NOT NULL,
  `Activo` TINYINT(1) NOT NULL DEFAULT 1,
  `CreadoEn` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ActualizadoEn` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_tiposcargorol_nombre` (`Nombre`),
  KEY `idx_tiposcargorol_activo_nombre` (`Activo`, `Nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Especialidades: asegurar índice UNIQUE para evitar duplicados (opcional)
-- Si ya existe, el script lo detecta y no lo crea.
SET @db := DATABASE();

SET @has_idx_especialidades := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'especialidades' AND INDEX_NAME = 'idx_especialidades_especialidad'
);
SET @sql := IF(@has_idx_especialidades = 0,
  'CREATE INDEX `idx_especialidades_especialidad` ON `especialidades` (`Especialidad`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_ux_especialidades := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'especialidades' AND INDEX_NAME = 'ux_especialidades_especialidad'
);
SET @sql := IF(@has_ux_especialidades = 0,
  'CREATE UNIQUE INDEX `ux_especialidades_especialidad` ON `especialidades` (`Especialidad`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) Agenda: añadir columnas FK (best-effort)
SET @has_col_tipo := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'agenda' AND COLUMN_NAME = 'Id_TipoCargoRol'
);
SET @sql := IF(@has_col_tipo = 0,
  'ALTER TABLE `agenda` ADD COLUMN `Id_TipoCargoRol` INT NULL AFTER `Especialidad`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col_esp := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'agenda' AND COLUMN_NAME = 'Id_Especialidad'
);
SET @sql := IF(@has_col_esp = 0,
  'ALTER TABLE `agenda` ADD COLUMN `Id_Especialidad` INT NULL AFTER `Id_TipoCargoRol`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Índices para acelerar JOINs
SET @has_idx_agenda_tipo := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'agenda' AND INDEX_NAME = 'idx_agenda_tipo_cargo_rol'
);
SET @sql := IF(@has_idx_agenda_tipo = 0,
  'CREATE INDEX `idx_agenda_tipo_cargo_rol` ON `agenda` (`Id_TipoCargoRol`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_agenda_esp := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'agenda' AND INDEX_NAME = 'idx_agenda_especialidad'
);
SET @sql := IF(@has_idx_agenda_esp = 0,
  'CREATE INDEX `idx_agenda_especialidad` ON `agenda` (`Id_Especialidad`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5) FKs (opcional, solo si te interesa integridad fuerte)
-- (descomenta si quieres FKs estrictas; dejar sin FKs funciona igual)
-- ALTER TABLE `agenda`
--   ADD CONSTRAINT `fk_agenda_tiposcargorol` FOREIGN KEY (`Id_TipoCargoRol`) REFERENCES `tiposcargorol`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
--   ADD CONSTRAINT `fk_agenda_especialidades` FOREIGN KEY (`Id_Especialidad`) REFERENCES `especialidades`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 6) Migración (opcional): crear tipos desde valores existentes en agenda.Cargo (si venías guardando texto)
-- INSERT IGNORE INTO `tiposcargorol` (`Nombre`, `Activo`)
-- SELECT DISTINCT TRIM(Cargo) AS Nombre, 1
-- FROM `agenda`
-- WHERE Cargo IS NOT NULL AND TRIM(Cargo) <> '';
--
-- UPDATE `agenda` a
-- INNER JOIN `tiposcargorol` t ON t.`Nombre` = TRIM(a.Cargo)
-- SET a.`Id_TipoCargoRol` = t.`id`
-- WHERE a.Cargo IS NOT NULL AND TRIM(a.Cargo) <> '';

