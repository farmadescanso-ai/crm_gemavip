-- Corregir FK de notificaciones: notif_ag_id almacena id de CLIENTE, no de agenda.
-- La FK fk_notif_ag apuntaba incorrectamente a agenda(ag_id).
-- Ejecutar en la BD del CRM (crm_gemavip).
--
-- Si hay huérfanos (notif_ag_id que no existe en clientes), corregir antes:
--   SELECT * FROM notificaciones n LEFT JOIN clientes c ON c.cli_id = n.notif_ag_id WHERE c.cli_id IS NULL;

SET FOREIGN_KEY_CHECKS = 0;

-- Eliminar FK incorrecta (notif_ag_id → agenda)
-- Si da error, el nombre puede ser otro: SHOW CREATE TABLE notificaciones;
ALTER TABLE `notificaciones` DROP FOREIGN KEY `fk_notif_ag`;

-- Añadir FK correcta (notif_ag_id → clientes.cli_id)
ALTER TABLE `notificaciones` ADD CONSTRAINT `fk_notif_cli`
  FOREIGN KEY (`notif_ag_id`) REFERENCES `clientes`(`cli_id`) ON DELETE CASCADE ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
