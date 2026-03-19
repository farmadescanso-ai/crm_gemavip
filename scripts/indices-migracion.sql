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
CALL _add_index_if_not_exists('pedidos', 'ft_pedidos_busqueda', '`ped_numero`,`ped_estado_txt`', 'FULLTEXT');

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

-- CÓDIGOS POSTALES (búsqueda por CP para auto-rellenar provincia/país en formularios)
-- Esquema con prefijos: codpos_CodigoPostal (ver config/schema-bd.json)
CALL _add_index_if_not_exists('codigos_postales', 'idx_codpos_codigo', '`codpos_CodigoPostal`', 'BTREE');
CALL _add_index_if_not_exists('codigos_postales', 'idx_codpos_comunidad', '`codpos_ComunidadAutonoma`', 'BTREE');

-- ARTÍCULOS (filtro por marca en dashboard Ranking Productos)
CALL _add_index_if_not_exists('articulos', 'idx_articulos_marca', '`art_mar_id`', 'BTREE');

-- CLIENTES (Contactos Nuevos: filtro por fecha creación)
CALL _add_index_if_not_exists('clientes', 'idx_clientes_creado_holded', '`cli_creado_holded`', 'BTREE');

-- =============================================================================
-- ÍNDICES COMPUESTOS (v2.0 — queries pesadas del dashboard y listados paginados)
-- =============================================================================
-- Estos cubren las combinaciones WHERE + ORDER BY más frecuentes.
-- Sin ellos MySQL hace merge de índices simples o scan parciales.

-- PEDIDOS: comercial + fecha + PK (dashboard ventas, rankings, listado pedidos)
CALL _add_index_if_not_exists('pedidos', 'idx_pedidos_com_fecha_id', '`ped_com_id`,`ped_fecha`,`ped_id`', 'BTREE');

-- PEDIDOS: comercial + estado + fecha (dashboard desglose por estado de pedido)
CALL _add_index_if_not_exists('pedidos', 'idx_pedidos_com_estado_fecha', '`ped_com_id`,`ped_estped_id`,`ped_fecha`', 'BTREE');

-- PEDIDOS: cliente + fecha + PK (pedidos de un cliente, subconsulta MAX(ped_fecha) en listado clientes)
CALL _add_index_if_not_exists('pedidos', 'idx_pedidos_cli_fecha_id', '`ped_cli_id`,`ped_fecha`,`ped_id`', 'BTREE');

-- CLIENTES: comercial + estado + PK (listado clientes filtrado por comercial y estado — página más usada)
CALL _add_index_if_not_exists('clientes', 'idx_clientes_com_estado_id', '`cli_com_id`,`cli_estcli_id`,`cli_id`', 'BTREE');

-- CLIENTES: comercial + tipo cliente + PK (listado clientes filtrado por tipo)
CALL _add_index_if_not_exists('clientes', 'idx_clientes_com_tipo_id', '`cli_com_id`,`cli_tipc_id`,`cli_id`', 'BTREE');

-- CLIENTES: comercial + fecha creación (dashboard contactos nuevos)
CALL _add_index_if_not_exists('clientes', 'idx_clientes_com_creado', '`cli_com_id`,`cli_creado_holded`', 'BTREE');

-- VISITAS: cliente + fecha + PK (historial de visitas de un cliente)
CALL _add_index_if_not_exists('visitas', 'idx_visitas_cli_fecha_id', '`vis_cli_id`,`vis_fecha`,`vis_id`', 'BTREE');

-- VISITAS: comercial + fecha + PK (listado visitas del comercial, dashboard)
CALL _add_index_if_not_exists('visitas', 'idx_visitas_com_fecha_id', '`vis_com_id`,`vis_fecha`,`vis_id`', 'BTREE');

-- =============================================================================
-- FULLTEXT (v2.0 — pre-creados; evita crearlos en cold start de Vercel)
-- =============================================================================
-- La app los crea dinámicamente si faltan, pero pre-crearlos evita latencia en cold start.
-- Nota: la tabla agenda puede llamarse 'contactos' en BD legacy.

-- AGENDA: búsqueda textual
CALL _add_index_if_not_exists('agenda', 'ft_agenda_busqueda', '`ag_nombre`,`ag_apellidos`,`ag_empresa`,`ag_email`,`ag_movil`,`ag_telefono`', 'FULLTEXT');
CALL _add_index_if_not_exists('agenda', 'idx_agenda_activo_apellidos_nombre', '`ag_activo`,`ag_apellidos`,`ag_nombre`', 'BTREE');

DROP PROCEDURE IF EXISTS _add_index_if_not_exists;
