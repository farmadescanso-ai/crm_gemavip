-- Estado operativo del comercial: inactivo = sin acceso CRM, clientes pasan al pool.
-- Ejecutar una vez en la BD de producción / desarrollo.

ALTER TABLE `comerciales`
  ADD COLUMN `com_activo` TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '1=acceso CRM; 0=bloqueado, clientes al pool'
  AFTER `com_roll`;
