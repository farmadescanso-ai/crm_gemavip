-- =============================================================================
-- CORRECCIÓN DE REGISTROS HUÉRFANOS (FKs)
-- =============================================================================
-- IMPORTANTE: Copia SOLO este archivo en phpMyAdmin. NO pegues la salida
-- de consultas anteriores (mensajes "Su consulta se ejecutó...", tablas, etc.)
--
-- Ejecutar cada bloque por separado en la pestaña SQL de phpMyAdmin.
-- Hacer BACKUP de la BD antes.
-- =============================================================================

-- BLOQUE 1: Clientes con comercial huérfano (266) -> asignar primer comercial
UPDATE clientes c
LEFT JOIN comerciales co ON co.com_id = c.cli_com_id
SET c.cli_com_id = (SELECT com_id FROM comerciales ORDER BY com_id ASC LIMIT 1)
WHERE c.cli_com_id IS NOT NULL AND c.cli_com_id <> 0 AND co.com_id IS NULL;

-- BLOQUE 2: Clientes con forma de pago huérfana (265) -> poner NULL
UPDATE clientes c
LEFT JOIN formas_pago fp ON fp.formp_id = c.cli_formp_id
SET c.cli_formp_id = NULL
WHERE c.cli_formp_id IS NOT NULL AND c.cli_formp_id <> 0 AND fp.formp_id IS NULL;

-- BLOQUE 3: Pedidos con forma de pago huérfana (incluye ped_formp_id=0) -> asignar primera forma_pago
UPDATE pedidos p
LEFT JOIN formas_pago fp ON fp.formp_id = p.ped_formp_id
SET p.ped_formp_id = (SELECT formp_id FROM formas_pago ORDER BY formp_id ASC LIMIT 1)
WHERE fp.formp_id IS NULL;

-- BLOQUE 4: Pedidos con tipo pedido (ped_tipp_id) huérfano -> asignar primero
UPDATE pedidos p
LEFT JOIN tipos_pedidos tp ON tp.tipp_id = p.ped_tipp_id
SET p.ped_tipp_id = (SELECT tipp_id FROM tipos_pedidos ORDER BY tipp_id ASC LIMIT 1)
WHERE tp.tipp_id IS NULL;

-- BLOQUE 5: Notificaciones con contacto huérfano (5) -> eliminar
DELETE n FROM notificaciones n
LEFT JOIN agenda ag ON ag.ag_id = n.notif_ag_id
WHERE n.notif_ag_id IS NOT NULL AND n.notif_ag_id <> 0 AND ag.ag_id IS NULL;
