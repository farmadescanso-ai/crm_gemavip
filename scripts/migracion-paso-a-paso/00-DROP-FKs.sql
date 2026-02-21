-- =============================================================================
-- PASO 0: DROP de todas las claves foráneas
-- Ejecutar PRIMERO en phpMyAdmin (pestaña SQL, BD crm_gemavip)
-- =============================================================================

ALTER TABLE `articulos` DROP FOREIGN KEY `fk_articulos_marca`;
ALTER TABLE `centros_prescriptores` DROP FOREIGN KEY `fk_centros_ruta`;
ALTER TABLE `clientes` DROP FOREIGN KEY `clientes_ibfk_1`;
ALTER TABLE `pedidos` DROP FOREIGN KEY `fk_pedidos_estado_pedido`;
ALTER TABLE `pedidos` DROP FOREIGN KEY `pedidos_ibfk_1`;
