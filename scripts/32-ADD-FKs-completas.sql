-- =============================================================================
-- PASO 32: Añadir claves foráneas completas
-- =============================================================================
-- Ejecutar DESPUÉS de:
--   1) Todos los pasos de migración (01 a 30)
--   2) Ejecutar diagnostico-integridad-fks.sql y verificar que todos los huérfanos = 0
--
-- El paso 31 (31-ADD-FKs.sql) ya añade: articulos.art_mar_id, clientes.cli_tipc_id,
-- pedidos.ped_estped_id, pedidos.ped_tarcli_id. Este script añade el resto.
--
-- Si alguna FK falla por datos huérfanos, ejecutar primero el diagnóstico y corregir.
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- CLIENTES
-- -----------------------------------------------------------------------------

-- Comercial asignado (obligatorio en clientes)
ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_com`
  FOREIGN KEY (`cli_com_id`) REFERENCES `comerciales`(`com_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Provincia (opcional)
ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_prov`
  FOREIGN KEY (`cli_prov_id`) REFERENCES `provincias`(`prov_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- País (opcional)
ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_pais`
  FOREIGN KEY (`cli_pais_id`) REFERENCES `paises`(`pais_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Estado cliente (opcional)
ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_estcli`
  FOREIGN KEY (`cli_estcli_id`) REFERENCES `estdoClientes`(`estcli_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Forma de pago (opcional)
ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_formp`
  FOREIGN KEY (`cli_formp_id`) REFERENCES `formas_pago`(`formp_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Idioma (opcional)
ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_idiom`
  FOREIGN KEY (`cli_idiom_id`) REFERENCES `idiomas`(`idiom_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Moneda (opcional)
ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_mon`
  FOREIGN KEY (`cli_mon_id`) REFERENCES `monedas`(`mon_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Código postal (opcional) - requiere codigos_postales con PK codp_id
-- ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_codp`
--   FOREIGN KEY (`cli_codp_id`) REFERENCES `codigos_postales`(`codp_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- PEDIDOS
-- -----------------------------------------------------------------------------

-- Comercial (obligatorio)
ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_com`
  FOREIGN KEY (`ped_com_id`) REFERENCES `comerciales`(`com_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cliente (obligatorio)
ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_cli`
  FOREIGN KEY (`ped_cli_id`) REFERENCES `clientes`(`cli_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Dirección envío (opcional)
ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_direnv`
  FOREIGN KEY (`ped_direnv_id`) REFERENCES `direccionesEnvio`(`direnv_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Forma de pago (obligatorio)
ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_formp`
  FOREIGN KEY (`ped_formp_id`) REFERENCES `formas_pago`(`formp_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tipo pedido (obligatorio)
ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_tipp`
  FOREIGN KEY (`ped_tipp_id`) REFERENCES `tipos_pedidos`(`tipp_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- PEDIDOS_ARTICULOS
-- -----------------------------------------------------------------------------

-- Pedido (obligatorio) - CASCADE: borrar pedido borra sus líneas
ALTER TABLE `pedidos_articulos` ADD CONSTRAINT `fk_pedart_ped`
  FOREIGN KEY (`pedart_ped_id`) REFERENCES `pedidos`(`ped_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Artículo (obligatorio)
ALTER TABLE `pedidos_articulos` ADD CONSTRAINT `fk_pedart_art`
  FOREIGN KEY (`pedart_art_id`) REFERENCES `articulos`(`art_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- AGENDA
-- -----------------------------------------------------------------------------

-- Tipo cargo/rol (opcional)
ALTER TABLE `agenda` ADD CONSTRAINT `fk_ag_tipcar`
  FOREIGN KEY (`ag_tipcar_id`) REFERENCES `tiposcargorol`(`tipcar_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Especialidad (opcional)
ALTER TABLE `agenda` ADD CONSTRAINT `fk_ag_esp`
  FOREIGN KEY (`ag_esp_id`) REFERENCES `especialidades`(`esp_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- CLIENTES_CONTACTOS
-- -----------------------------------------------------------------------------

-- Cliente (obligatorio)
ALTER TABLE `clientes_contactos` ADD CONSTRAINT `fk_clicont_cli`
  FOREIGN KEY (`clicont_cli_id`) REFERENCES `clientes`(`cli_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Contacto/agenda (obligatorio)
ALTER TABLE `clientes_contactos` ADD CONSTRAINT `fk_clicont_ag`
  FOREIGN KEY (`clicont_ag_id`) REFERENCES `agenda`(`ag_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- DIRECCIONES ENVÍO
-- -----------------------------------------------------------------------------

-- Cliente (obligatorio)
ALTER TABLE `direccionesEnvio` ADD CONSTRAINT `fk_direnv_cli`
  FOREIGN KEY (`direnv_cli_id`) REFERENCES `clientes`(`cli_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Contacto (opcional)
ALTER TABLE `direccionesEnvio` ADD CONSTRAINT `fk_direnv_ag`
  FOREIGN KEY (`direnv_ag_id`) REFERENCES `agenda`(`ag_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Provincia (opcional)
ALTER TABLE `direccionesEnvio` ADD CONSTRAINT `fk_direnv_prov`
  FOREIGN KEY (`direnv_prov_id`) REFERENCES `provincias`(`prov_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- VISITAS
-- -----------------------------------------------------------------------------

-- Cliente (opcional)
ALTER TABLE `visitas` ADD CONSTRAINT `fk_vis_cli`
  FOREIGN KEY (`vis_cli_id`) REFERENCES `clientes`(`cli_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Comercial (obligatorio)
ALTER TABLE `visitas` ADD CONSTRAINT `fk_vis_com`
  FOREIGN KEY (`vis_com_id`) REFERENCES `comerciales`(`com_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- NOTIFICACIONES
-- -----------------------------------------------------------------------------

-- Contacto (obligatorio)
ALTER TABLE `notificaciones` ADD CONSTRAINT `fk_notif_ag`
  FOREIGN KEY (`notif_ag_id`) REFERENCES `agenda`(`ag_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Comercial solicitante (obligatorio)
ALTER TABLE `notificaciones` ADD CONSTRAINT `fk_notif_com`
  FOREIGN KEY (`notif_com_id`) REFERENCES `comerciales`(`com_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Pedido (opcional)
ALTER TABLE `notificaciones` ADD CONSTRAINT `fk_notif_ped`
  FOREIGN KEY (`notif_ped_id`) REFERENCES `pedidos`(`ped_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- ARTÍCULOS (si no existe ya de 31-ADD-FKs)
-- -----------------------------------------------------------------------------

-- Marca (opcional) - 31-ADD-FKs ya lo añade como fk_art_mar
-- ALTER TABLE `articulos` ADD CONSTRAINT `fk_art_mar`
--   FOREIGN KEY (`art_mar_id`) REFERENCES `marcas`(`mar_id`) ON DELETE SET NULL ON UPDATE RESTRICT;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- NOTA: Si alguna FK ya existe (p.ej. de 31-ADD-FKs), MySQL dará error.
-- En ese caso, comenta o elimina la línea antes de ejecutar.
-- =============================================================================
