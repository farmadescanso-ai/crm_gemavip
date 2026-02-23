-- =============================================================================
-- Añade el tipo de cliente "Otro" a la tabla tipos_clientes
-- Ejecutar una vez contra la BD del CRM
-- =============================================================================

-- Si la tabla usa columnas normalizadas (tipc_id, tipc_tipo):
INSERT INTO `tipos_clientes` (`tipc_tipo`)
SELECT 'Otro' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `tipos_clientes` WHERE `tipc_tipo` = 'Otro');

-- Si la tabla usa columnas legacy (id, Tipo), descomenta y ejecuta en su lugar:
-- INSERT INTO `tipos_clientes` (`Tipo`)
-- SELECT 'Otro' FROM DUAL
-- WHERE NOT EXISTS (SELECT 1 FROM `tipos_clientes` WHERE `Tipo` = 'Otro');
