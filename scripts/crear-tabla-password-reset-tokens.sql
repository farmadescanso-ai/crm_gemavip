-- Tabla de tokens para recuperación de contraseña (evitar phishing: un solo uso, caducidad corta).
-- Ejecutar en la BD del CRM.

CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `comercial_id` INT NOT NULL,
  `token` VARCHAR(128) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `used` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_token` (`token`),
  KEY `idx_email_created` (`email`, `created_at`),
  KEY `idx_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Tokens de un solo uso para restablecer contraseña (caducidad 1h)';
