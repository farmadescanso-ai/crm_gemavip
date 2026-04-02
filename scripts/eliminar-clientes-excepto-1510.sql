-- =============================================================================
-- ELIMINAR TODOS LOS CLIENTES EXCEPTO cli_id = 1510
-- =============================================================================
-- Mantiene la integridad referencial de la BD. Borra en orden correcto:
-- primero tablas hijas (incl. comisiones_detalle y pedidos), luego clientes.
--
-- ANTES DE EJECUTAR:
--   1) Backup completo de la BD.
--   2) Opcional: scripts/diagnostico-fks-clientes-pedidos.sql para ver FKs reales.
--   3) Revisar POLÍTICA COMISIONES (bloque comentado más abajo).
--
-- REQUISITO: BD con esquema migrado (cli_id, ped_cli_id, clicont_cli_id, etc.).
-- Si usas nombres legacy (id, Id_Cliente), adapta las columnas según los
-- comentarios al final del script.
--
-- EJECUTAR EN phpMyAdmin o MySQL CLI sobre la BD crm_gemavip.
--
-- TRANSACCIÓN (recomendado en CLI): ejecutar START TRANSACTION; antes de
-- SET FOREIGN_KEY_CHECKS = 0, y tras revisar resultados COMMIT; o ROLLBACK;.
-- En phpMyAdmin suele ejecutarse todo el bloque de una vez sin transacción explícita.
-- =============================================================================
--
-- POLÍTICA COMISIONES (cabecera `comisiones` vs detalle `comisiones_detalle`):
--   - Tabla `comisiones`: totales por comercial/mes/año; NO tiene FK a pedidos.
--     Este script NO la borra. Tras eliminar pedidos, los totales históricos
--     pueden no coincidir con ventas reales; valorar recalcular en la app o
--     aceptar divergencia.
--   - Tabla `comisiones_detalle`: líneas con FK al pedido. Se eliminan filas
--     vinculadas a pedidos de clientes que se purgan (paso 0).
--     El nombre de columna varía (pedido_id, comdet_pedido_id, Id_Pedido…);
--     el paso 0 elige una columna conocida vía information_schema.
--     Si la tabla no existe, el paso 0 no hace DELETE (solo SELECT 1).
--
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 0. COMISIONES_DETALLE (líneas por pedido; antes de borrar pedidos)
--     Columna hacia pedidos: se detecta (whitelist). Si falta tu nombre, añádelo
--     al IN y al FIELD() del subquery siguiente.
-- -----------------------------------------------------------------------------
SET @cd_col_pedido = (
  SELECT c.COLUMN_NAME
  FROM information_schema.COLUMNS c
  WHERE c.TABLE_SCHEMA = DATABASE()
    AND c.TABLE_NAME = 'comisiones_detalle'
    AND c.COLUMN_NAME IN (
      'comdet_pedido_id',
      'pedido_id',
      'Id_Pedido',
      'Id_NumPedido',
      'comi_pedido_id'
    )
  ORDER BY FIELD(
    c.COLUMN_NAME,
    'comdet_pedido_id',
    'pedido_id',
    'Id_Pedido',
    'Id_NumPedido',
    'comi_pedido_id'
  )
  LIMIT 1
);
SET @sql_cd = IF(
  @cd_col_pedido IS NULL,
  'SELECT 1 AS comisiones_detalle_sin_columna_pedido_o_sin_tabla',
  CONCAT(
    'DELETE cd FROM `comisiones_detalle` cd ',
    'INNER JOIN `pedidos` p ON p.`ped_id` = cd.`',
    @cd_col_pedido,
    '` WHERE p.`ped_cli_id` <> 1510'
  )
);
PREPARE _stmt_cd FROM @sql_cd;
EXECUTE _stmt_cd;
DEALLOCATE PREPARE _stmt_cd;

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
-- 10. NOTIFICACIONES cuyo notif_ag_id es un cliente que se va a borrar
--      (válido cuando notif_ag_id almacena cli_id; ver scripts/fix-notif-fk-cliente.sql)
--      Si notif_ag_id apuntara solo a agenda, esta sentencia no borraría esas filas.
-- -----------------------------------------------------------------------------
DELETE n FROM `notificaciones` n
INNER JOIN `clientes` c ON c.`cli_id` = n.`notif_ag_id`
WHERE c.`cli_id` != 1510;

-- -----------------------------------------------------------------------------
-- 11. AUTORREFERENCIA clientes.cli_Id_cliente_relacionado
--     Quitar enlaces hacia clientes que se eliminarán (distintos de 1510)
-- -----------------------------------------------------------------------------
UPDATE `clientes` SET `cli_Id_cliente_relacionado` = NULL
WHERE `cli_Id_cliente_relacionado` IS NOT NULL
  AND `cli_Id_cliente_relacionado` != 1510;

-- -----------------------------------------------------------------------------
-- 12. CLIENTES (por último)
-- -----------------------------------------------------------------------------
DELETE FROM `clientes` WHERE `cli_id` != 1510;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- VERIFICACIÓN: tras ejecutar, usar scripts/validacion-post-eliminacion-clientes.sql
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
-- sentencias siguientes (el paso 0 del script principal ya elige columna de
-- detalle vía information_schema; añade el nombre al IN del paso 0 si falta):
--
-- DELETE cd FROM comisiones_detalle cd
-- INNER JOIN pedidos p ON p.id = cd.<columna_pedido>
-- WHERE p.Id_Cliente != 1510;
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
-- DELETE n FROM notificaciones n INNER JOIN clientes c ON c.id = n.notif_ag_id WHERE c.id != 1510;
-- UPDATE clientes SET cli_Id_cliente_relacionado = NULL WHERE cli_Id_cliente_relacionado IS NOT NULL AND cli_Id_cliente_relacionado != 1510;
-- DELETE FROM clientes WHERE id != 1510;
-- =============================================================================
