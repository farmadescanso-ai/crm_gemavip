-- =============================================================================
-- FKs PENDIENTES (ejecutar si 32-ADD-FKs-completas.sql dio "Duplicate" en algunas)
-- =============================================================================
-- Este script contiene las FKs que pueden faltar.
-- Si alguna da "Duplicate foreign key constraint name", coméntala y continúa.
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- Forma de pago pedidos (obligatorio) - YA EXISTE, omitir si da Duplicate
-- ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_formp`
--   FOREIGN KEY (`ped_formp_id`) REFERENCES `formas_pago`(`formp_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tipo pedido (obligatorio)
ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_tipp`
  FOREIGN KEY (`ped_tipp_id`) REFERENCES `tipos_pedidos`(`tipp_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Pedidos_articulos
ALTER TABLE `pedidos_articulos` ADD CONSTRAINT `fk_pedart_ped`
  FOREIGN KEY (`pedart_ped_id`) REFERENCES `pedidos`(`ped_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `pedidos_articulos` ADD CONSTRAINT `fk_pedart_art`
  FOREIGN KEY (`pedart_art_id`) REFERENCES `articulos`(`art_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Agenda
ALTER TABLE `agenda` ADD CONSTRAINT `fk_ag_tipcar`
  FOREIGN KEY (`ag_tipcar_id`) REFERENCES `tiposcargorol`(`tipcar_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `agenda` ADD CONSTRAINT `fk_ag_esp`
  FOREIGN KEY (`ag_esp_id`) REFERENCES `especialidades`(`esp_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Clientes_contactos
ALTER TABLE `clientes_contactos` ADD CONSTRAINT `fk_clicont_cli`
  FOREIGN KEY (`clicont_cli_id`) REFERENCES `clientes`(`cli_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `clientes_contactos` ADD CONSTRAINT `fk_clicont_ag`
  FOREIGN KEY (`clicont_ag_id`) REFERENCES `agenda`(`ag_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Direcciones envío
ALTER TABLE `direccionesEnvio` ADD CONSTRAINT `fk_direnv_cli`
  FOREIGN KEY (`direnv_cli_id`) REFERENCES `clientes`(`cli_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `direccionesEnvio` ADD CONSTRAINT `fk_direnv_ag`
  FOREIGN KEY (`direnv_ag_id`) REFERENCES `agenda`(`ag_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `direccionesEnvio` ADD CONSTRAINT `fk_direnv_prov`
  FOREIGN KEY (`direnv_prov_id`) REFERENCES `provincias`(`prov_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Visitas
ALTER TABLE `visitas` ADD CONSTRAINT `fk_vis_cli`
  FOREIGN KEY (`vis_cli_id`) REFERENCES `clientes`(`cli_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `visitas` ADD CONSTRAINT `fk_vis_com`
  FOREIGN KEY (`vis_com_id`) REFERENCES `comerciales`(`com_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Notificaciones
ALTER TABLE `notificaciones` ADD CONSTRAINT `fk_notif_ag`
  FOREIGN KEY (`notif_ag_id`) REFERENCES `agenda`(`ag_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `notificaciones` ADD CONSTRAINT `fk_notif_com`
  FOREIGN KEY (`notif_com_id`) REFERENCES `comerciales`(`com_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `notificaciones` ADD CONSTRAINT `fk_notif_ped`
  FOREIGN KEY (`notif_ped_id`) REFERENCES `pedidos`(`ped_id`) ON DELETE SET NULL ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
