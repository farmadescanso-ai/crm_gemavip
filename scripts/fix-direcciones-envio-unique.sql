-- =============================================================================
-- FIX: Restricción UNIQUE incorrecta en direccionesEnvio
-- =============================================================================
-- La restricción ux_direcciones_envio_principal_unica(direnv_cli_id) permite
-- solo UNA dirección por cliente, pero el código está diseñado para VARIAS
-- direcciones por cliente (fiscal, almacén, etc.).
--
-- Este script:
-- 1. Elimina la restricción incorrecta
-- 2. Añade UNIQUE (direnv_cli_id, direnv_principal_key) para garantizar solo
--    una dirección principal activa por cliente (igual que clientes_contactos)
--
-- REQUISITO: La tabla debe tener la columna direnv_principal_key (GENERATED).
--
-- Ejecutar en phpMyAdmin o MySQL CLI.
-- =============================================================================

-- 1. Eliminar restricción incorrecta (solo 1 dirección total por cliente)
ALTER TABLE `direccionesEnvio`
  DROP INDEX IF EXISTS `ux_direcciones_envio_principal_unica`;

-- 2. Añadir UNIQUE para "solo una principal activa por cliente"
--    direnv_principal_key = 1 cuando activa=1 y es_principal=1, NULL en el resto.
--    En MySQL, UNIQUE permite múltiples NULLs, así que solo una fila puede
--    tener principal_key=1 por cliente.
ALTER TABLE `direccionesEnvio`
  ADD UNIQUE KEY `ux_direnv_cliente_principal_unica` (`direnv_cli_id`, `direnv_principal_key`);
