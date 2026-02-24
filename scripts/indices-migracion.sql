-- =============================================================================
-- ÍNDICES DE RENDIMIENTO (Punto 19 auditoría)
-- =============================================================================
-- Ejecutar MANUALMENTE como migración, NO en startup de la aplicación.
-- CREATE INDEX bloquea la tabla durante la creación; en producción con datos
-- puede bloquear a todos los usuarios durante segundos o minutos.
--
-- REQUISITO: BD migrada con prefijos (cli_prov_id, ped_cli_id, etc.).
-- Idempotente: si un índice ya existe, se omite (evita "Duplicate key name").
--
-- En phpMyAdmin: ejecutar TODO el script de una vez (pestaña SQL).
-- =============================================================================

DELIMITER //

DROP PROCEDURE IF EXISTS _add_index_if_not_exists//
CREATE PROCEDURE _add_index_if_not_exists(
  IN p_tabla VARCHAR(64),
  IN p_indice VARCHAR(64),
  IN p_columnas VARCHAR(500),
  IN p_tipo ENUM('BTREE','FULLTEXT') 
)
BEGIN
  DECLARE v_existe INT DEFAULT 0;
  
  SELECT COUNT(*) INTO v_existe
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = p_tabla
    AND index_name = p_indice;
  
  IF v_existe = 0 THEN
    SET @sql = CONCAT(
      'CREATE ', IF(p_tipo = 'FULLTEXT', 'FULLTEXT ', ''), 'INDEX `', p_indice, '` ON `', p_tabla, '` (', p_columnas, ')'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

DELIMITER ;

-- CLIENTES
CALL _add_index_if_not_exists('clientes', 'idx_clientes_provincia', '`cli_prov_id`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_tipocliente', '`cli_tipc_id`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_comercial', '`cli_com_id`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_estado_cliente', '`cli_estcli_id`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_cp', '`cli_codigo_postal`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_poblacion', '`cli_poblacion`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'idx_clientes_nombre', '`cli_nombre_razon_social`', 'BTREE');
CALL _add_index_if_not_exists('clientes', 'ft_clientes_busqueda', '`cli_nombre_razon_social`,`cli_nombre_cial`,`cli_dni_cif`,`cli_email`,`cli_telefono`,`cli_movil`,`cli_poblacion`,`cli_codigo_postal`', 'FULLTEXT');
CALL _add_index_if_not_exists('clientes', 'ft_clientes_busqueda_basica', '`cli_nombre_razon_social`,`cli_nombre_cial`,`cli_dni_cif`', 'FULLTEXT');

-- PEDIDOS
CALL _add_index_if_not_exists('pedidos', 'idx_pedidos_cliente', '`ped_cli_id`', 'BTREE');
CALL _add_index_if_not_exists('pedidos', 'idx_pedidos_comercial', '`ped_com_id`', 'BTREE');
CALL _add_index_if_not_exists('pedidos', 'idx_pedidos_fecha', '`ped_fecha`', 'BTREE');
CALL _add_index_if_not_exists('pedidos', 'idx_pedidos_cliente_fecha', '`ped_cli_id`,`ped_fecha`', 'BTREE');
CALL _add_index_if_not_exists('pedidos', 'idx_pedidos_comercial_fecha', '`ped_com_id`,`ped_fecha`', 'BTREE');
CALL _add_index_if_not_exists('pedidos', 'idx_pedidos_num_pedido', '`ped_numero`', 'BTREE');

-- PEDIDOS_ARTICULOS
CALL _add_index_if_not_exists('pedidos_articulos', 'idx_pedidos_articulos_num_pedido', '`pedart_numero`', 'BTREE');
CALL _add_index_if_not_exists('pedidos_articulos', 'idx_pedidos_articulos_pedido_id', '`pedart_ped_id`', 'BTREE');
CALL _add_index_if_not_exists('pedidos_articulos', 'idx_pedidos_articulos_articulo', '`pedart_art_id`', 'BTREE');
CALL _add_index_if_not_exists('pedidos_articulos', 'idx_pedidos_articulos_num_articulo', '`pedart_numero`,`pedart_art_id`', 'BTREE');

-- VISITAS
CALL _add_index_if_not_exists('visitas', 'idx_visitas_fecha', '`vis_fecha`', 'BTREE');
CALL _add_index_if_not_exists('visitas', 'idx_visitas_comercial', '`vis_com_id`', 'BTREE');
CALL _add_index_if_not_exists('visitas', 'idx_visitas_cliente', '`vis_cli_id`', 'BTREE');
CALL _add_index_if_not_exists('visitas', 'idx_visitas_comercial_fecha', '`vis_com_id`,`vis_fecha`', 'BTREE');

-- DIRECCIONES ENVÍO
CALL _add_index_if_not_exists('direccionesEnvio', 'idx_direnv_cliente', '`direnv_cli_id`', 'BTREE');
CALL _add_index_if_not_exists('direccionesEnvio', 'idx_direnv_cliente_activa', '`direnv_cli_id`,`direnv_activa`', 'BTREE');
CALL _add_index_if_not_exists('direccionesEnvio', 'idx_direnv_cliente_activa_principal', '`direnv_cli_id`,`direnv_activa`,`direnv_es_principal`', 'BTREE');

DROP PROCEDURE IF EXISTS _add_index_if_not_exists;
