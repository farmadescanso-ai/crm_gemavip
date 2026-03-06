-- =============================================================================
-- ELIMINAR TODOS LOS CLIENTES EXCEPTO cli_id = 1510
-- =============================================================================
-- Mantiene la integridad referencial de la BD. Borra en orden correcto:
-- primero tablas hijas, luego clientes.
--
-- REQUISITO: BD con esquema migrado (cli_id, ped_cli_id, clicont_cli_id, etc.).
-- Si usas nombres legacy (id, Id_Cliente), adapta las columnas según los
-- comentarios al final del script.
--
-- EJECUTAR EN phpMyAdmin o MySQL CLI sobre la BD crm_gemavip.
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. PEDIDOS_ARTICULOS (líneas de pedidos de clientes a eliminar)
--    pedidos_articulos -> pedidos (CASCADE al borrar pedido, pero lo hacemos
--    explícito por si no hay FK)
-- -----------------------------------------------------------------------------
DELETE pa FROM `pedidos_articulos` pa
INNER JOIN `pedidos` p ON p.`ped_id` = pa.`pedart_ped_id`
WHERE p.`ped_cli_id` != 1510;

-- Si tu BD usa Id_NumPedido en vez de pedart_ped_id:
-- DELETE pa FROM pedidos_articulos pa
-- INNER JOIN pedidos p ON p.id = pa.Id_NumPedido
-- WHERE p.ped_cli_id != 1510;

-- -----------------------------------------------------------------------------
-- 2. NOTIFICACIONES (referencias a pedidos que vamos a borrar)
--    Al borrar pedidos, notif_ped_id se pondría a NULL por FK, pero
--    borramos explícitamente las que apunten a pedidos de clientes a eliminar
-- -----------------------------------------------------------------------------
UPDATE `notificaciones` n
INNER JOIN `pedidos` p ON p.`ped_id` = n.`notif_ped_id`
SET n.`notif_ped_id` = NULL
WHERE p.`ped_cli_id` != 1510;

-- Si usas id_pedido en vez de notif_ped_id:
-- UPDATE notificaciones n
-- INNER JOIN pedidos p ON p.ped_id = n.id_pedido
-- SET n.id_pedido = NULL
-- WHERE p.ped_cli_id != 1510;

-- -----------------------------------------------------------------------------
-- 3. PEDIDOS (de clientes distintos de 1510)
-- -----------------------------------------------------------------------------
DELETE FROM `pedidos` WHERE `ped_cli_id` != 1510;

-- -----------------------------------------------------------------------------
-- 4. CLIENTES_CONTACTOS
-- -----------------------------------------------------------------------------
DELETE FROM `clientes_contactos` WHERE `clicont_cli_id` != 1510;

-- -----------------------------------------------------------------------------
-- 5. DIRECCIONES ENVÍO
-- -----------------------------------------------------------------------------
DELETE FROM `direccionesEnvio` WHERE `direnv_cli_id` != 1510;

-- -----------------------------------------------------------------------------
-- 6. VISITAS (poner vis_cli_id a NULL para clientes a eliminar)
--    Así conservamos el historial de visitas sin referencia huérfana
-- -----------------------------------------------------------------------------
UPDATE `visitas` SET `vis_cli_id` = NULL WHERE `vis_cli_id` != 1510;

-- -----------------------------------------------------------------------------
-- 7. CLIENTES_RELACIONADOS (origen o relacionado = cliente a eliminar)
-- -----------------------------------------------------------------------------
DELETE FROM `clientes_relacionados`
WHERE `clirel_cli_origen_id` != 1510 OR `clirel_cli_relacionado_id` != 1510;

-- -----------------------------------------------------------------------------
-- 8. CLIENTES_COOPERATIVAS (columna: detco_Id_Cliente)
-- -----------------------------------------------------------------------------
DELETE FROM `clientes_cooperativas` WHERE `detco_Id_Cliente` != 1510;

-- -----------------------------------------------------------------------------
-- 9. CLIENTES_GRUPOSCOMPRAS (columna: detgru_Id_Cliente)
-- -----------------------------------------------------------------------------
DELETE FROM `clientes_gruposCompras` WHERE `detgru_Id_Cliente` != 1510;

-- -----------------------------------------------------------------------------
-- 10. CLIENTES (por último)
-- -----------------------------------------------------------------------------
DELETE FROM `clientes` WHERE `cli_id` != 1510;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- VERIFICACIÓN: tras ejecutar, debería quedar solo 1 cliente
-- =============================================================================
-- SELECT COUNT(*) AS total_clientes FROM clientes;
-- SELECT * FROM clientes;
-- =============================================================================

-- =============================================================================
-- Esquema BD: clientes_cooperativas (detco_Id_Cliente), clientes_gruposCompras (detgru_Id_Cliente)
-- =============================================================================

-- =============================================================================
-- ALTERNATIVA PARA BD CON NOMBRES LEGACY (sin migración de prefijos)
-- =============================================================================
-- Si tu BD usa id, Id_Cliente, Id_NumPedido, id_pedido, etc., sustituye las
-- sentencias anteriores por estas (adaptando las que fallen según tu esquema):
--
-- DELETE pa FROM pedidos_articulos pa
-- INNER JOIN pedidos p ON p.id = pa.Id_NumPedido
-- WHERE p.Id_Cliente != 1510;
--
-- UPDATE notificaciones n
-- INNER JOIN pedidos p ON p.id = n.id_pedido
-- SET n.id_pedido = NULL
-- WHERE p.Id_Cliente != 1510;
--
-- DELETE FROM pedidos WHERE Id_Cliente != 1510;
-- DELETE FROM clientes_contactos WHERE Id_Cliente != 1510;
-- DELETE FROM direccionesEnvio WHERE Id_Cliente != 1510;
-- UPDATE visitas SET Id_Cliente = NULL WHERE Id_Cliente != 1510;
-- DELETE FROM clientes_relacionados WHERE clirel_cli_origen_id != 1510 OR clirel_cli_relacionado_id != 1510;
-- DELETE FROM clientes_cooperativas WHERE Id_Cliente != 1510;
-- DELETE FROM clientes_gruposCompras WHERE Id_Cliente != 1510;
-- DELETE FROM clientes WHERE id != 1510;
-- =============================================================================
