-- =============================================================================
-- VALIDACIÓN POST-ELIMINACIÓN (clientes / pedidos)
-- =============================================================================
-- Ejecutar tras scripts/eliminar-clientes-excepto-1510.sql (o variantes).
-- No modifica datos; solo lectura para smoke check de integridad lógica.
-- Sustituir 1510 por el cli_id superviviente si usas otro script.
--
-- Smoke test manual en el CRM (tras backup y solo en entorno adecuado):
--   login, listado clientes/pedidos, ficha cliente, comisiones si aplica.
-- =============================================================================

-- Debe quedar exactamente el número de clientes esperado (ej. 1)
SELECT COUNT(*) AS total_clientes FROM `clientes`;

-- No deben quedar pedidos de clientes inexistentes
SELECT COUNT(*) AS pedidos_huerfanos
FROM `pedidos` p
LEFT JOIN `clientes` c ON c.`cli_id` = p.`ped_cli_id`
WHERE c.`cli_id` IS NULL;

-- Líneas de pedido sin pedido padre (debería ser 0)
SELECT COUNT(*) AS lineas_sin_pedido
FROM `pedidos_articulos` pa
LEFT JOIN `pedidos` p ON p.`ped_id` = pa.`pedart_ped_id`
WHERE p.`ped_id` IS NULL;

-- Contactos cliente sin cliente (0)
SELECT COUNT(*) AS contactos_huerfanos
FROM `clientes_contactos` cc
LEFT JOIN `clientes` c ON c.`cli_id` = cc.`clicont_cli_id`
WHERE c.`cli_id` IS NULL;

-- Direcciones sin cliente (0)
SELECT COUNT(*) AS direcciones_huerfanas
FROM `direccionesEnvio` d
LEFT JOIN `clientes` c ON c.`cli_id` = d.`direnv_cli_id`
WHERE c.`cli_id` IS NULL;

-- Visitas con vis_cli_id que no existe en clientes (0)
SELECT COUNT(*) AS visitas_cli_invalido
FROM `visitas` v
LEFT JOIN `clientes` c ON c.`cli_id` = v.`vis_cli_id`
WHERE v.`vis_cli_id` IS NOT NULL AND c.`cli_id` IS NULL;

-- Autorreferencia: no debe apuntar a cli_id inexistente (0)
SELECT COUNT(*) AS clientes_rel_apunta_a_borrado
FROM `clientes` c
LEFT JOIN `clientes` r ON r.`cli_id` = c.`cli_Id_cliente_relacionado`
WHERE c.`cli_Id_cliente_relacionado` IS NOT NULL AND r.`cli_id` IS NULL;

-- comisiones_detalle: líneas con pedido_id inexistente (0 si se limpió bien)
-- Omitir si la tabla no existe.
-- SELECT COUNT(*) AS cd_pedido_huerfano
-- FROM comisiones_detalle cd
-- LEFT JOIN pedidos p ON p.ped_id = cd.pedido_id
-- WHERE cd.pedido_id IS NOT NULL AND p.ped_id IS NULL;
