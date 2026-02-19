-- Agenda + relaciones con clientes (M:N con histórico) + catálogo de roles
-- Ejecutar en la BD del CRM (crm_gemavip).
--
-- Este script NO borra nada.
-- Si ya existe `agenda`, solo crea las tablas auxiliares.

-- 1) Tabla relación clientes_contactos (M:N) con histórico de vigencia
CREATE TABLE IF NOT EXISTS `clientes_contactos` (
  `Id` INT NOT NULL AUTO_INCREMENT,
  `Id_Cliente` INT NOT NULL,
  `Id_Contacto` INT NOT NULL,
  `Rol` VARCHAR(120) NULL,
  `Es_Principal` TINYINT(1) NOT NULL DEFAULT 0,
  `Notas` VARCHAR(500) NULL,
  `VigenteDesde` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `VigenteHasta` DATETIME NULL,
  `MotivoBaja` VARCHAR(200) NULL,
  `CreadoEn` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id`),
  KEY `idx_cc_cliente_vigente` (`Id_Cliente`, `VigenteHasta`),
  KEY `idx_cc_contacto_vigente` (`Id_Contacto`, `VigenteHasta`),
  KEY `idx_cc_cliente_principal` (`Id_Cliente`, `Es_Principal`, `VigenteHasta`),
  KEY `idx_cc_rol` (`Rol`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Relación M:N entre clientes y contactos de agenda con histórico';

-- 2) Catálogo simple de roles/tipos (para sugerencias)
CREATE TABLE IF NOT EXISTS `agenda_roles` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `Nombre` VARCHAR(120) NOT NULL,
  `Activo` TINYINT(1) NOT NULL DEFAULT 1,
  `CreadoEn` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ActualizadoEn` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_agenda_roles_nombre` (`Nombre`),
  KEY `idx_agenda_roles_activo_nombre` (`Activo`, `Nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Catálogo de roles/tipo de contacto (director, compras, etc.)';

-- 3) (Opcional) FKs. Actívalas si tus tablas tienen PK `Id` y quieres integridad fuerte.
-- ALTER TABLE `clientes_contactos`
--   ADD CONSTRAINT `fk_cc_cliente` FOREIGN KEY (`Id_Cliente`) REFERENCES `clientes`(`Id`) ON DELETE RESTRICT ON UPDATE CASCADE,
--   ADD CONSTRAINT `fk_cc_agenda`  FOREIGN KEY (`Id_Contacto`) REFERENCES `agenda`(`Id`) ON DELETE RESTRICT ON UPDATE CASCADE;

