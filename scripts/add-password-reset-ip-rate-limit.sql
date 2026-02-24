-- Punto 7 auditoría: Rate limit por IP en BD (no en memoria).
-- Permite que el rate limit funcione en serverless (Vercel) donde cada instancia tiene memoria aislada.

CREATE TABLE IF NOT EXISTS `password_reset_ip_attempts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `ip` VARCHAR(45) NOT NULL COMMENT 'IPv4 o IPv6',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ip_created` (`ip`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Intentos de recuperación de contraseña por IP (rate limit serverless)';
