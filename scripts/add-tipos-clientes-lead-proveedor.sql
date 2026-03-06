-- =============================================================================
-- Verificar y añadir tipos de cliente "Lead" y "Proveedor" en tipos_clientes
-- Necesarios para importar Excel Holded (columna Tipo: Lead, Cliente, Proveedor)
-- Ejecutar en phpMyAdmin contra la BD del CRM
-- =============================================================================

-- 1) Verificación: listar tipos actuales
SELECT 'Tipos actuales en tipos_clientes:' AS info;
SELECT * FROM `tipos_clientes` ORDER BY tipc_id;

-- 2) Añadir Lead y Proveedor si no existen (esquema migrado: tipc_tipo)
INSERT INTO `tipos_clientes` (`tipc_tipo`)
SELECT 'Lead' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `tipos_clientes` WHERE `tipc_tipo` = 'Lead');

INSERT INTO `tipos_clientes` (`tipc_tipo`)
SELECT 'Proveedor' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `tipos_clientes` WHERE `tipc_tipo` = 'Proveedor');

-- Si la tabla usa columnas legacy (id, Tipo), ejecuta en su lugar:
-- INSERT INTO `tipos_clientes` (`Tipo`) SELECT 'Lead' FROM DUAL
--   WHERE NOT EXISTS (SELECT 1 FROM `tipos_clientes` WHERE `Tipo` = 'Lead');
-- INSERT INTO `tipos_clientes` (`Tipo`) SELECT 'Proveedor' FROM DUAL
--   WHERE NOT EXISTS (SELECT 1 FROM `tipos_clientes` WHERE `Tipo` = 'Proveedor');

-- 3) Verificación final
SELECT 'Tipos tras ejecución:' AS info;
SELECT * FROM `tipos_clientes` ORDER BY tipc_id;
