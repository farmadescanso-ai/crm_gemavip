-- =============================================================================
-- Limpieza: cli_referencia no debe duplicar el ID de contacto Holded.
-- El vínculo canónico es clientes.cli_Id_Holded (= contact.id en API Holded).
-- Collation: utf8mb4_unicode_ci (regla proyecto CRM Gemavip).
-- =============================================================================
-- Ejecutar en el MySQL de destino (backup recomendado antes).
-- =============================================================================

-- Vista previa: filas donde ambas columnas coinciden (se vaciará solo cli_referencia)
-- SELECT cli_id, cli_referencia, cli_Id_Holded
-- FROM clientes
-- WHERE cli_referencia IS NOT NULL
--   AND cli_Id_Holded IS NOT NULL
--   AND TRIM(cli_referencia) = TRIM(cli_Id_Holded);

-- 1) Caso seguro: mismo valor en cli_referencia y cli_Id_Holded → quitar duplicado en referencia
-- (Si tu cliente SQL rechaza la comparación, usar: (TRIM(cli_referencia) COLLATE utf8mb4_unicode_ci) = (TRIM(cli_Id_Holded) COLLATE utf8mb4_unicode_ci))
UPDATE clientes
SET cli_referencia = NULL
WHERE cli_referencia IS NOT NULL
  AND cli_Id_Holded IS NOT NULL
  AND TRIM(cli_referencia) = TRIM(cli_Id_Holded);

-- Comprobar filas afectadas: ROW_COUNT() en cliente MySQL / revisar en Workbench.


-- =============================================================================
-- 2) OPCIONAL — Solo si confirmas que, históricamente, cuando cli_Id_Holded estaba
--    vacío, cli_referencia guardaba únicamente el ID Holded (mismo criterio que el import antiguo).
--    Si cli_referencia se usó para otra referencia de negocio, NO ejecutes este bloque.
-- =============================================================================
/*
UPDATE clientes
SET cli_Id_Holded = TRIM(cli_referencia),
    cli_referencia = NULL
WHERE (cli_Id_Holded IS NULL OR TRIM(cli_Id_Holded) = '')
  AND cli_referencia IS NOT NULL
  AND TRIM(cli_referencia) <> '';
*/

-- Tras el paso 2 (si lo descomentas), conviene reevaluar sync:
-- import desde CPanel o dejar que el siguiente guardado recalcule cli_holded_sync_hash si aplica.
