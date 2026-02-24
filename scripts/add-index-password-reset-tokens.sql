-- =============================================================================
-- Punto 22 auditoría: índice en (comercial_id, used) para password_reset_tokens
-- =============================================================================
-- Mejora consultas como: WHERE comercial_id = ? AND used = 0
-- Si el índice ya existe, MySQL dará "Duplicate key name". Comenta la línea.
--
-- Si tu BD está migrada (pwdres_com_id en lugar de comercial_id), usa la
-- línea alternativa al final.
-- =============================================================================

CREATE INDEX `idx_prt_comercial_used` ON `password_reset_tokens` (`comercial_id`, `used`);

-- BD migrada (pwdres_com_id):
-- CREATE INDEX `idx_prt_comercial_used` ON `password_reset_tokens` (`pwdres_com_id`, `used`);
