-- Variables del sistema (configuración editable desde el panel de administrador)
-- Ejecuta este script si tu entorno NO permite CREATE TABLE desde la app.

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

-- Variable recomendada:
INSERT INTO `variables_sistema` (`clave`, `valor`, `descripcion`, `updated_by`)
VALUES ('N8N_PEDIDOS_WEBHOOK_URL', NULL, 'Webhook de N8N para envío de pedidos + Excel (multipart/form-data).', 'seed')
ON DUPLICATE KEY UPDATE
  `descripcion` = VALUES(`descripcion`);

