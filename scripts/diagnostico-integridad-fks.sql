-- =============================================================================
-- DIAGNÓSTICO DE INTEGRIDAD REFERENCIAL (FKs)
-- =============================================================================
-- Ejecutar ANTES de añadir claves foráneas (31-ADD-FKs.sql o 32-ADD-FKs-completas.sql).
-- Detecta registros "huérfanos": filas que referencian IDs inexistentes en tablas padre.
--
-- IMPORTANTE: Usa nombres de columna MIGRADOS (cli_com_id, ped_cli_id, etc.).
-- Si tu BD aún usa nombres legacy (Id_Cial, Id_Cliente), adapta las queries o
-- ejecuta primero los scripts de migración (migracion-paso-a-paso/).
--
-- Si algún COUNT > 0, hay que corregir los datos antes de crear FKs.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) CLIENTES
-- -----------------------------------------------------------------------------

-- 1.1 Clientes con comercial (cli_com_id) huérfano
SELECT 'clientes.cli_com_id' AS fk_check, COUNT(*) AS huérfanos
FROM clientes c
LEFT JOIN comerciales co ON co.com_id = c.cli_com_id
WHERE c.cli_com_id IS NOT NULL AND c.cli_com_id <> 0 AND co.com_id IS NULL;

-- 1.2 Clientes con tipo cliente (cli_tipc_id) huérfano
SELECT 'clientes.cli_tipc_id' AS fk_check, COUNT(*) AS huérfanos
FROM clientes c
LEFT JOIN tipos_clientes tc ON tc.tipc_id = c.cli_tipc_id
WHERE c.cli_tipc_id IS NOT NULL AND c.cli_tipc_id <> 0 AND tc.tipc_id IS NULL;

-- 1.3 Clientes con provincia (cli_prov_id) huérfana
SELECT 'clientes.cli_prov_id' AS fk_check, COUNT(*) AS huérfanos
FROM clientes c
LEFT JOIN provincias p ON p.prov_id = c.cli_prov_id
WHERE c.cli_prov_id IS NOT NULL AND c.cli_prov_id <> 0 AND p.prov_id IS NULL;

-- 1.4 Clientes con código postal (cli_codp_id) huérfano
-- codigos_postales usa PK `id` (tabla no migrada a codp_id)
SELECT 'clientes.cli_codp_id' AS fk_check, COUNT(*) AS huérfanos
FROM clientes c
LEFT JOIN codigos_postales cp ON cp.id = c.cli_codp_id
WHERE c.cli_codp_id IS NOT NULL AND c.cli_codp_id <> 0 AND cp.id IS NULL;

-- 1.5 Clientes con país (cli_pais_id) huérfano
SELECT 'clientes.cli_pais_id' AS fk_check, COUNT(*) AS huérfanos
FROM clientes c
LEFT JOIN paises pa ON pa.pais_id = c.cli_pais_id
WHERE c.cli_pais_id IS NOT NULL AND c.cli_pais_id <> 0 AND pa.pais_id IS NULL;

-- 1.6 Clientes con estado (cli_estcli_id) huérfano
SELECT 'clientes.cli_estcli_id' AS fk_check, COUNT(*) AS huérfanos
FROM clientes c
LEFT JOIN estdoClientes e ON e.estcli_id = c.cli_estcli_id
WHERE c.cli_estcli_id IS NOT NULL AND c.cli_estcli_id <> 0 AND e.estcli_id IS NULL;

-- 1.7 Clientes con forma de pago (cli_formp_id) huérfana
SELECT 'clientes.cli_formp_id' AS fk_check, COUNT(*) AS huérfanos
FROM clientes c
LEFT JOIN formas_pago fp ON fp.formp_id = c.cli_formp_id
WHERE c.cli_formp_id IS NOT NULL AND c.cli_formp_id <> 0 AND fp.formp_id IS NULL;

-- 1.8 Clientes con idioma (cli_idiom_id) huérfano
SELECT 'clientes.cli_idiom_id' AS fk_check, COUNT(*) AS huérfanos
FROM clientes c
LEFT JOIN idiomas i ON i.idiom_id = c.cli_idiom_id
WHERE c.cli_idiom_id IS NOT NULL AND c.cli_idiom_id <> 0 AND i.idiom_id IS NULL;

-- 1.9 Clientes con moneda (cli_mon_id) huérfana
SELECT 'clientes.cli_mon_id' AS fk_check, COUNT(*) AS huérfanos
FROM clientes c
LEFT JOIN monedas m ON m.mon_id = c.cli_mon_id
WHERE c.cli_mon_id IS NOT NULL AND c.cli_mon_id <> 0 AND m.mon_id IS NULL;

-- -----------------------------------------------------------------------------
-- 2) PEDIDOS
-- -----------------------------------------------------------------------------

-- 2.1 Pedidos con comercial (ped_com_id) huérfano
SELECT 'pedidos.ped_com_id' AS fk_check, COUNT(*) AS huérfanos
FROM pedidos p
LEFT JOIN comerciales co ON co.com_id = p.ped_com_id
WHERE p.ped_com_id IS NOT NULL AND p.ped_com_id <> 0 AND co.com_id IS NULL;

-- 2.2 Pedidos con cliente (ped_cli_id) huérfano
SELECT 'pedidos.ped_cli_id' AS fk_check, COUNT(*) AS huérfanos
FROM pedidos p
LEFT JOIN clientes c ON c.cli_id = p.ped_cli_id
WHERE p.ped_cli_id IS NOT NULL AND p.ped_cli_id <> 0 AND c.cli_id IS NULL;

-- 2.3 Pedidos con dirección envío (ped_direnv_id) huérfana
SELECT 'pedidos.ped_direnv_id' AS fk_check, COUNT(*) AS huérfanos
FROM pedidos p
LEFT JOIN direccionesEnvio d ON d.direnv_id = p.ped_direnv_id
WHERE p.ped_direnv_id IS NOT NULL AND p.ped_direnv_id <> 0 AND d.direnv_id IS NULL;

-- 2.4 Pedidos con forma de pago (ped_formp_id) huérfana
SELECT 'pedidos.ped_formp_id' AS fk_check, COUNT(*) AS huérfanos
FROM pedidos p
LEFT JOIN formas_pago fp ON fp.formp_id = p.ped_formp_id
WHERE p.ped_formp_id IS NOT NULL AND p.ped_formp_id <> 0 AND fp.formp_id IS NULL;

-- 2.5 Pedidos con tipo pedido (ped_tipp_id) huérfano
SELECT 'pedidos.ped_tipp_id' AS fk_check, COUNT(*) AS huérfanos
FROM pedidos p
LEFT JOIN tipos_pedidos tp ON tp.tipp_id = p.ped_tipp_id
WHERE p.ped_tipp_id IS NOT NULL AND p.ped_tipp_id <> 0 AND tp.tipp_id IS NULL;

-- 2.6 Pedidos con tarifa (ped_tarcli_id) huérfana
SELECT 'pedidos.ped_tarcli_id' AS fk_check, COUNT(*) AS huérfanos
FROM pedidos p
LEFT JOIN tarifasClientes tc ON tc.tarcli_id = p.ped_tarcli_id
WHERE p.ped_tarcli_id IS NOT NULL AND p.ped_tarcli_id <> 0 AND tc.tarcli_id IS NULL;

-- 2.7 Pedidos con estado (ped_estped_id) huérfano
SELECT 'pedidos.ped_estped_id' AS fk_check, COUNT(*) AS huérfanos
FROM pedidos p
LEFT JOIN estados_pedido ep ON ep.estped_id = p.ped_estped_id
WHERE p.ped_estped_id IS NOT NULL AND p.ped_estped_id <> 0 AND ep.estped_id IS NULL;

-- -----------------------------------------------------------------------------
-- 3) PEDIDOS_ARTICULOS
-- -----------------------------------------------------------------------------

-- 3.1 Líneas con pedido (pedart_ped_id) huérfano
SELECT 'pedidos_articulos.pedart_ped_id' AS fk_check, COUNT(*) AS huérfanos
FROM pedidos_articulos pa
LEFT JOIN pedidos p ON p.ped_id = pa.pedart_ped_id
WHERE pa.pedart_ped_id IS NOT NULL AND pa.pedart_ped_id <> 0 AND p.ped_id IS NULL;

-- 3.2 Líneas con artículo (pedart_art_id) huérfano
SELECT 'pedidos_articulos.pedart_art_id' AS fk_check, COUNT(*) AS huérfanos
FROM pedidos_articulos pa
LEFT JOIN articulos a ON a.art_id = pa.pedart_art_id
WHERE pa.pedart_art_id IS NOT NULL AND pa.pedart_art_id <> 0 AND a.art_id IS NULL;

-- -----------------------------------------------------------------------------
-- 4) AGENDA
-- -----------------------------------------------------------------------------

-- 4.1 Agenda con tipo cargo/rol (ag_tipcar_id) huérfano
SELECT 'agenda.ag_tipcar_id' AS fk_check, COUNT(*) AS huérfanos
FROM agenda a
LEFT JOIN tiposcargorol tcr ON tcr.tipcar_id = a.ag_tipcar_id
WHERE a.ag_tipcar_id IS NOT NULL AND a.ag_tipcar_id <> 0 AND tcr.tipcar_id IS NULL;

-- 4.2 Agenda con especialidad (ag_esp_id) huérfana
SELECT 'agenda.ag_esp_id' AS fk_check, COUNT(*) AS huérfanos
FROM agenda a
LEFT JOIN especialidades esp ON esp.esp_id = a.ag_esp_id
WHERE a.ag_esp_id IS NOT NULL AND a.ag_esp_id <> 0 AND esp.esp_id IS NULL;

-- -----------------------------------------------------------------------------
-- 5) CLIENTES_CONTACTOS
-- -----------------------------------------------------------------------------

-- 5.1 Relaciones con cliente (clicont_cli_id) huérfano
SELECT 'clientes_contactos.clicont_cli_id' AS fk_check, COUNT(*) AS huérfanos
FROM clientes_contactos cc
LEFT JOIN clientes c ON c.cli_id = cc.clicont_cli_id
WHERE cc.clicont_cli_id IS NOT NULL AND cc.clicont_cli_id <> 0 AND c.cli_id IS NULL;

-- 5.2 Relaciones con contacto (clicont_ag_id) huérfano
SELECT 'clientes_contactos.clicont_ag_id' AS fk_check, COUNT(*) AS huérfanos
FROM clientes_contactos cc
LEFT JOIN agenda ag ON ag.ag_id = cc.clicont_ag_id
WHERE cc.clicont_ag_id IS NOT NULL AND cc.clicont_ag_id <> 0 AND ag.ag_id IS NULL;

-- -----------------------------------------------------------------------------
-- 6) DIRECCIONES ENVÍO
-- -----------------------------------------------------------------------------

-- 6.1 Direcciones con cliente (direnv_cli_id) huérfano
SELECT 'direccionesEnvio.direnv_cli_id' AS fk_check, COUNT(*) AS huérfanos
FROM direccionesEnvio d
LEFT JOIN clientes c ON c.cli_id = d.direnv_cli_id
WHERE d.direnv_cli_id IS NOT NULL AND d.direnv_cli_id <> 0 AND c.cli_id IS NULL;

-- 6.2 Direcciones con contacto (direnv_ag_id) huérfano
SELECT 'direccionesEnvio.direnv_ag_id' AS fk_check, COUNT(*) AS huérfanos
FROM direccionesEnvio d
LEFT JOIN agenda ag ON ag.ag_id = d.direnv_ag_id
WHERE d.direnv_ag_id IS NOT NULL AND d.direnv_ag_id <> 0 AND ag.ag_id IS NULL;

-- 6.3 Direcciones con provincia (direnv_prov_id) huérfana
SELECT 'direccionesEnvio.direnv_prov_id' AS fk_check, COUNT(*) AS huérfanos
FROM direccionesEnvio d
LEFT JOIN provincias p ON p.prov_id = d.direnv_prov_id
WHERE d.direnv_prov_id IS NOT NULL AND d.direnv_prov_id <> 0 AND p.prov_id IS NULL;

-- -----------------------------------------------------------------------------
-- 7) VISITAS
-- -----------------------------------------------------------------------------

-- 7.1 Visitas con cliente (vis_cli_id) huérfano
SELECT 'visitas.vis_cli_id' AS fk_check, COUNT(*) AS huérfanos
FROM visitas v
LEFT JOIN clientes c ON c.cli_id = v.vis_cli_id
WHERE v.vis_cli_id IS NOT NULL AND v.vis_cli_id <> 0 AND c.cli_id IS NULL;

-- 7.2 Visitas con comercial (vis_com_id) huérfano
SELECT 'visitas.vis_com_id' AS fk_check, COUNT(*) AS huérfanos
FROM visitas v
LEFT JOIN comerciales co ON co.com_id = v.vis_com_id
WHERE v.vis_com_id IS NOT NULL AND v.vis_com_id <> 0 AND co.com_id IS NULL;

-- -----------------------------------------------------------------------------
-- 8) NOTIFICACIONES
-- -----------------------------------------------------------------------------

-- 8.1 Notificaciones con contacto (notif_ag_id) huérfano
SELECT 'notificaciones.notif_ag_id' AS fk_check, COUNT(*) AS huérfanos
FROM notificaciones n
LEFT JOIN agenda ag ON ag.ag_id = n.notif_ag_id
WHERE n.notif_ag_id IS NOT NULL AND n.notif_ag_id <> 0 AND ag.ag_id IS NULL;

-- 8.2 Notificaciones con comercial (notif_com_id) huérfano
SELECT 'notificaciones.notif_com_id' AS fk_check, COUNT(*) AS huérfanos
FROM notificaciones n
LEFT JOIN comerciales co ON co.com_id = n.notif_com_id
WHERE n.notif_com_id IS NOT NULL AND n.notif_com_id <> 0 AND co.com_id IS NULL;

-- 8.3 Notificaciones con pedido (notif_ped_id) huérfano
SELECT 'notificaciones.notif_ped_id' AS fk_check, COUNT(*) AS huérfanos
FROM notificaciones n
LEFT JOIN pedidos p ON p.ped_id = n.notif_ped_id
WHERE n.notif_ped_id IS NOT NULL AND n.notif_ped_id <> 0 AND p.ped_id IS NULL;

-- -----------------------------------------------------------------------------
-- 9) ARTÍCULOS
-- -----------------------------------------------------------------------------

-- 9.1 Artículos con marca (art_mar_id) huérfana
SELECT 'articulos.art_mar_id' AS fk_check, COUNT(*) AS huérfanos
FROM articulos a
LEFT JOIN marcas m ON m.mar_id = a.art_mar_id
WHERE a.art_mar_id IS NOT NULL AND a.art_mar_id <> 0 AND m.mar_id IS NULL;

-- =============================================================================
-- RESUMEN: Si todos los huérfanos = 0, puedes ejecutar 32-ADD-FKs-completas.sql
-- =============================================================================
