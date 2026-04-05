-- =============================================================================
-- Comerciales: estado operativo (com_activo) + fecha de baja (com_fecha_baja)
-- Ejecutar en MySQL/MariaDB contra la BD del CRM (una vez por entorno).
-- =============================================================================
--
-- com_activo      : 1 = puede usar el CRM; 0 = bloqueado (sesión, contactos al pool).
-- com_fecha_baja  : DATE NULL; se rellena al desactivar, se anula al reactivar.
--
-- Si YA tienes com_activo y solo falta la fecha, ejecuta solo el BLOQUE B.
-- Si no tienes ninguna columna, ejecuta el BLOQUE A completo.
-- =============================================================================

-- ----- BLOQUE A: instalación completa (com_activo + com_fecha_baja) -----
ALTER TABLE `comerciales`
  ADD COLUMN `com_activo` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '1=acceso CRM; 0=bloqueado, clientes al pool'
    AFTER `com_roll`,
  ADD COLUMN `com_fecha_baja` DATE NULL DEFAULT NULL
    COMMENT 'Fecha efectiva de baja/desactivación; NULL si activo'
    AFTER `com_activo`;

-- ----- BLOQUE B: solo fecha de baja (usa esto si com_activo ya existe) -----
-- ALTER TABLE `comerciales`
--   ADD COLUMN `com_fecha_baja` DATE NULL DEFAULT NULL
--     COMMENT 'Fecha efectiva de baja/desactivación; NULL si activo'
--     AFTER `com_activo`;

-- Opcional: si ya marcaste inactivos manualmente sin fecha, asignar fecha a hoy:
-- UPDATE `comerciales` SET `com_fecha_baja` = CURDATE() WHERE `com_activo` = 0 AND `com_fecha_baja` IS NULL;
