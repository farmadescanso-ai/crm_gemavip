-- Tabla de notificaciones (solicitudes de asignación de contactos y otras).
-- Ejecutar en la BD del CRM (crm_gemavip).

CREATE TABLE IF NOT EXISTS `notificaciones` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `tipo` VARCHAR(64) NOT NULL DEFAULT 'asignacion_contacto',
  `id_contacto` INT NOT NULL COMMENT 'Id del cliente/contacto',
  `id_comercial_solicitante` INT NOT NULL COMMENT 'Comercial que solicita la asignación',
  `estado` ENUM('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'pendiente',
  `id_admin_resolvio` INT NULL COMMENT 'Comercial/admin que aprobó o rechazó',
  `fecha_creacion` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_resolucion` DATETIME NULL,
  `notas` VARCHAR(500) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_notif_estado` (`estado`),
  KEY `idx_notif_contacto` (`id_contacto`),
  KEY `idx_notif_comercial` (`id_comercial_solicitante`),
  KEY `idx_notif_fecha_creacion` (`fecha_creacion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Solicitudes de asignación de contactos y notificaciones para el administrador';

-- Índice adicional si la tabla ya existía sin él:
-- ALTER TABLE `notificaciones` ADD KEY `idx_notif_fecha_creacion` (`fecha_creacion`);
