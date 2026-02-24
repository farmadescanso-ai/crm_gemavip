-- Suscripciones Web Push (admins reciben notificaciones en el navegador)
-- Ejecutar en la BD del CRM (crm_gemavip).

CREATE TABLE IF NOT EXISTS `push_subscriptions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL COMMENT 'Id del comercial (comerciales.com_id)',
  `subscription` JSON NOT NULL COMMENT 'Objeto PushSubscription',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_push_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Suscripciones Web Push para notificaciones en el navegador';
