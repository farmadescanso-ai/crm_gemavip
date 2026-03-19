-- =============================================================================
-- FOREIGN KEYS — Integridad referencial
-- =============================================================================
-- Ejecutar MANUALMENTE. Si hay datos huérfanos, algunas FKs fallarán.
-- Revisar errores y limpiar datos antes de reintentar.
--
-- Política:
--   RESTRICT  → tablas críticas (impide borrar padre si tiene hijos)
--   SET NULL  → tablas de catálogo opcionales (al borrar catálogo, campo queda NULL)
--   CASCADE   → relaciones padre-hijo directas (al borrar padre, se borran hijos)
--
-- Idempotente: si la FK ya existe, se omite.
-- =============================================================================

DELIMITER //

DROP PROCEDURE IF EXISTS _add_fk_if_not_exists//
CREATE PROCEDURE _add_fk_if_not_exists(
  IN p_tabla VARCHAR(64),
  IN p_fk_name VARCHAR(128),
  IN p_columna VARCHAR(64),
  IN p_ref_tabla VARCHAR(64),
  IN p_ref_columna VARCHAR(64),
  IN p_on_delete VARCHAR(20)
)
BEGIN
  DECLARE v_existe INT DEFAULT 0;

  SELECT COUNT(*) INTO v_existe
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = p_tabla
    AND CONSTRAINT_NAME = p_fk_name
    AND CONSTRAINT_TYPE = 'FOREIGN KEY';

  IF v_existe = 0 THEN
    SET @sql = CONCAT(
      'ALTER TABLE `', p_tabla, '` ',
      'ADD CONSTRAINT `', p_fk_name, '` ',
      'FOREIGN KEY (`', p_columna, '`) REFERENCES `', p_ref_tabla, '`(`', p_ref_columna, '`) ',
      'ON DELETE ', p_on_delete, ' ON UPDATE CASCADE'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

DELIMITER ;

-- =============================================================================
-- PEDIDOS (relaciones críticas)
-- =============================================================================
CALL _add_fk_if_not_exists('pedidos', 'fk_ped_comercial', 'ped_com_id', 'comerciales', 'com_id', 'RESTRICT');
CALL _add_fk_if_not_exists('pedidos', 'fk_ped_cliente', 'ped_cli_id', 'clientes', 'cli_id', 'RESTRICT');
CALL _add_fk_if_not_exists('pedidos', 'fk_ped_estado', 'ped_estped_id', 'estados_pedido', 'estped_id', 'SET NULL');
CALL _add_fk_if_not_exists('pedidos', 'fk_ped_tipo', 'ped_tipp_id', 'tipos_pedidos', 'tipp_id', 'RESTRICT');
CALL _add_fk_if_not_exists('pedidos', 'fk_ped_formapago', 'ped_formp_id', 'formas_pago', 'formp_id', 'RESTRICT');
CALL _add_fk_if_not_exists('pedidos', 'fk_ped_direnvio', 'ped_direnv_id', 'direccionesEnvio', 'direnv_id', 'SET NULL');
CALL _add_fk_if_not_exists('pedidos', 'fk_ped_regfis', 'ped_regfis_id', 'regimenes_fiscales', 'regfis_id', 'SET NULL');

-- =============================================================================
-- PEDIDOS_ARTICULOS (cascade: al borrar pedido, se borran sus líneas)
-- =============================================================================
CALL _add_fk_if_not_exists('pedidos_articulos', 'fk_pedart_pedido', 'pedart_ped_id', 'pedidos', 'ped_id', 'CASCADE');
CALL _add_fk_if_not_exists('pedidos_articulos', 'fk_pedart_articulo', 'pedart_art_id', 'articulos', 'art_id', 'RESTRICT');

-- =============================================================================
-- CLIENTES (comercial obligatorio, catálogos opcionales)
-- =============================================================================
CALL _add_fk_if_not_exists('clientes', 'fk_cli_comercial', 'cli_com_id', 'comerciales', 'com_id', 'RESTRICT');
CALL _add_fk_if_not_exists('clientes', 'fk_cli_tipo', 'cli_tipc_id', 'tipos_clientes', 'tipc_id', 'SET NULL');
CALL _add_fk_if_not_exists('clientes', 'fk_cli_especialidad', 'cli_esp_id', 'especialidades', 'esp_id', 'SET NULL');
CALL _add_fk_if_not_exists('clientes', 'fk_cli_estado', 'cli_estcli_id', 'estdoClientes', 'estcli_id', 'SET NULL');
CALL _add_fk_if_not_exists('clientes', 'fk_cli_provincia', 'cli_prov_id', 'provincias', 'prov_id', 'SET NULL');
CALL _add_fk_if_not_exists('clientes', 'fk_cli_pais', 'cli_pais_id', 'paises', 'pais_id', 'SET NULL');
CALL _add_fk_if_not_exists('clientes', 'fk_cli_idioma', 'cli_idiom_id', 'idiomas', 'idiom_id', 'SET NULL');
CALL _add_fk_if_not_exists('clientes', 'fk_cli_moneda', 'cli_mon_id', 'monedas', 'mon_id', 'SET NULL');
CALL _add_fk_if_not_exists('clientes', 'fk_cli_formapago', 'cli_formp_id', 'formas_pago', 'formp_id', 'SET NULL');
CALL _add_fk_if_not_exists('clientes', 'fk_cli_regfis', 'cli_regfis_id', 'regimenes_fiscales', 'regfis_id', 'SET NULL');

-- =============================================================================
-- VISITAS
-- =============================================================================
CALL _add_fk_if_not_exists('visitas', 'fk_vis_comercial', 'vis_com_id', 'comerciales', 'com_id', 'RESTRICT');
CALL _add_fk_if_not_exists('visitas', 'fk_vis_cliente', 'vis_cli_id', 'clientes', 'cli_id', 'RESTRICT');
-- vis_estvis_id no existe; el estado es vis_estado (texto libre)
-- CALL _add_fk_if_not_exists('visitas', 'fk_vis_estado', 'vis_estvis_id', 'estados_visita', 'estvis_id', 'SET NULL');

-- =============================================================================
-- DIRECCIONES ENVÍO (cascade: al borrar cliente, se borran sus direcciones)
-- =============================================================================
CALL _add_fk_if_not_exists('direccionesEnvio', 'fk_direnv_cliente', 'direnv_cli_id', 'clientes', 'cli_id', 'CASCADE');
CALL _add_fk_if_not_exists('direccionesEnvio', 'fk_direnv_provincia', 'direnv_prov_id', 'provincias', 'prov_id', 'SET NULL');

-- =============================================================================
-- CLIENTES RELACIONADOS
-- =============================================================================
CALL _add_fk_if_not_exists('clientes_relacionados', 'fk_clirel_origen', 'clirel_cli_origen_id', 'clientes', 'cli_id', 'CASCADE');
CALL _add_fk_if_not_exists('clientes_relacionados', 'fk_clirel_destino', 'clirel_cli_relacionado_id', 'clientes', 'cli_id', 'CASCADE');

-- =============================================================================
-- ARTÍCULOS
-- =============================================================================
CALL _add_fk_if_not_exists('articulos', 'fk_art_marca', 'art_mar_id', 'marcas', 'mar_id', 'SET NULL');

-- =============================================================================
-- TABLAS FISCALES
-- =============================================================================
CALL _add_fk_if_not_exists('tipos_impuesto', 'fk_timp_regfis', 'timp_regfis_id', 'regimenes_fiscales', 'regfis_id', 'CASCADE');
CALL _add_fk_if_not_exists('equivalencias_impuesto', 'fk_eqimp_origen', 'eqimp_timp_origen_id', 'tipos_impuesto', 'timp_id', 'CASCADE');
CALL _add_fk_if_not_exists('equivalencias_impuesto', 'fk_eqimp_destino', 'eqimp_timp_destino_id', 'tipos_impuesto', 'timp_id', 'CASCADE');

-- =============================================================================
-- CÓDIGOS POSTALES
-- =============================================================================
CALL _add_fk_if_not_exists('codigos_postales', 'fk_codpos_regfis', 'codpos_regfis_id', 'regimenes_fiscales', 'regfis_id', 'SET NULL');

DROP PROCEDURE IF EXISTS _add_fk_if_not_exists;
