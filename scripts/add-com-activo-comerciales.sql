-- Obsoleto: usar `alter-comerciales-activo-y-fecha-baja.sql` (incluye com_fecha_baja).
-- Se mantiene este archivo por compatibilidad con despliegues antiguos.

ALTER TABLE `comerciales`
  ADD COLUMN `com_activo` TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '1=acceso CRM; 0=bloqueado, clientes al pool'
  AFTER `com_roll`;
