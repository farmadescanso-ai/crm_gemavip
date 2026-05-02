-- Portal del cliente CRM Gemavip — tablas e índices (InnoDB, utf8mb4_unicode_ci)
-- Ejecutar en la BD crm_gemavip tras backup.

SET NAMES utf8mb4;

-- Configuración global (fila única id=1)
CREATE TABLE IF NOT EXISTS `portal_config` (
  `portcfg_id` INT NOT NULL PRIMARY KEY DEFAULT 1,
  `portcfg_activo` TINYINT(1) NOT NULL DEFAULT 0,
  `portcfg_enlaces_horas` INT NOT NULL DEFAULT 48,
  `portcfg_ver_facturas` TINYINT(1) NOT NULL DEFAULT 1,
  `portcfg_ver_pedidos` TINYINT(1) NOT NULL DEFAULT 1,
  `portcfg_ver_presupuestos` TINYINT(1) NOT NULL DEFAULT 1,
  `portcfg_ver_albaranes` TINYINT(1) NOT NULL DEFAULT 1,
  `portcfg_ver_catalogo` TINYINT(1) NOT NULL DEFAULT 0,
  `portcfg_stripe_activo` TINYINT(1) NOT NULL DEFAULT 0,
  `portcfg_actualizado_en` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `portal_config` (`portcfg_id`, `portcfg_activo`) VALUES (1, 0);

-- Overrides por cliente (NULL en flag = heredar global)
CREATE TABLE IF NOT EXISTS `portal_cliente_override` (
  `pco_id` INT NOT NULL AUTO_INCREMENT,
  `pco_cli_id` INT NOT NULL,
  `pco_heredar_global` TINYINT(1) NOT NULL DEFAULT 1,
  `pco_ver_facturas` TINYINT(1) NULL DEFAULT NULL,
  `pco_ver_pedidos` TINYINT(1) NULL DEFAULT NULL,
  `pco_ver_presupuestos` TINYINT(1) NULL DEFAULT NULL,
  `pco_ver_albaranes` TINYINT(1) NULL DEFAULT NULL,
  `pco_ver_catalogo` TINYINT(1) NULL DEFAULT NULL,
  PRIMARY KEY (`pco_id`),
  UNIQUE KEY `ux_pco_cli` (`pco_cli_id`),
  CONSTRAINT `fk_pco_cli` FOREIGN KEY (`pco_cli_id`) REFERENCES `clientes` (`cli_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Credenciales portal (1 fila por contacto cliente con acceso)
CREATE TABLE IF NOT EXISTS `portal_acceso_cliente` (
  `pac_id` INT NOT NULL AUTO_INCREMENT,
  `pac_cli_id` INT NOT NULL,
  `pac_email_login` VARCHAR(255) NOT NULL,
  `pac_password_hash` VARCHAR(255) NOT NULL,
  `pac_activo` TINYINT(1) NOT NULL DEFAULT 1,
  `pac_invitado_en` DATETIME NULL DEFAULT NULL,
  `pac_ultimo_acceso_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`pac_id`),
  UNIQUE KEY `ux_pac_cli` (`pac_cli_id`),
  UNIQUE KEY `ux_pac_email` (`pac_email_login`),
  CONSTRAINT `fk_pac_cli` FOREIGN KEY (`pac_cli_id`) REFERENCES `clientes` (`cli_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Recuperación contraseña portal (independiente de comerciales)
CREATE TABLE IF NOT EXISTS `portal_password_reset_tokens` (
  `pprt_id` INT NOT NULL AUTO_INCREMENT,
  `pprt_cli_id` INT NOT NULL,
  `pprt_token` VARCHAR(128) NOT NULL,
  `pprt_email` VARCHAR(255) NOT NULL,
  `pprt_expires_at` DATETIME NOT NULL,
  `pprt_used` TINYINT(1) NOT NULL DEFAULT 0,
  `pprt_created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pprt_id`),
  UNIQUE KEY `ux_pprt_token` (`pprt_token`),
  KEY `idx_pprt_email_created` (`pprt_email`, `pprt_created_at`),
  KEY `idx_pprt_cli` (`pprt_cli_id`),
  CONSTRAINT `fk_pprt_cli` FOREIGN KEY (`pprt_cli_id`) REFERENCES `clientes` (`cli_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Enlaces temporales a documentos
CREATE TABLE IF NOT EXISTS `portal_documento_enlace` (
  `pde_id` INT NOT NULL AUTO_INCREMENT,
  `pde_cli_id` INT NOT NULL,
  `pde_tipo_doc` VARCHAR(32) NOT NULL,
  `pde_ref_externa` VARCHAR(64) NOT NULL,
  `pde_token_hash` CHAR(64) NOT NULL,
  `pde_expires_at` DATETIME NOT NULL,
  `pde_used_at` DATETIME NULL DEFAULT NULL,
  `pde_creado_por_com_id` INT NULL DEFAULT NULL,
  `pde_activo` TINYINT(1) NOT NULL DEFAULT 1,
  `pde_creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pde_id`),
  UNIQUE KEY `ux_pde_token_hash` (`pde_token_hash`),
  KEY `idx_pde_cli_tipo_ref` (`pde_cli_id`, `pde_tipo_doc`, `pde_ref_externa`),
  CONSTRAINT `fk_pde_cli` FOREIGN KEY (`pde_cli_id`) REFERENCES `clientes` (`cli_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_pde_com` FOREIGN KEY (`pde_creado_por_com_id`) REFERENCES `comerciales` (`com_id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Comentarios por documento (cliente o comercial)
CREATE TABLE IF NOT EXISTS `portal_documento_comentario` (
  `pdc_id` INT NOT NULL AUTO_INCREMENT,
  `pdc_cli_id` INT NOT NULL,
  `pdc_tipo_doc` VARCHAR(32) NOT NULL,
  `pdc_ref_externa` VARCHAR(64) NOT NULL,
  `pdc_mensaje` TEXT NOT NULL,
  `pdc_es_cliente` TINYINT(1) NOT NULL DEFAULT 1,
  `pdc_com_id` INT NULL DEFAULT NULL,
  `pdc_leido_por_comercial` TINYINT(1) NOT NULL DEFAULT 0,
  `pdc_creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pdc_id`),
  KEY `idx_pdc_doc` (`pdc_cli_id`, `pdc_tipo_doc`, `pdc_ref_externa`),
  KEY `idx_pdc_creado` (`pdc_creado_en`),
  CONSTRAINT `fk_pdc_cli` FOREIGN KEY (`pdc_cli_id`) REFERENCES `clientes` (`cli_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_pdc_com` FOREIGN KEY (`pdc_com_id`) REFERENCES `comerciales` (`com_id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
