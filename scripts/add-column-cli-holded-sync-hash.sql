-- Sincronización Holded ↔ CRM: hash del último estado acordado (vista previa CPanel).
-- Ejecutar una vez en la BD del CRM.

ALTER TABLE `clientes`
  ADD COLUMN `cli_holded_sync_hash` CHAR(64) NULL DEFAULT NULL
  COMMENT 'SHA-256 hex de campos comparables tras último import/export Holded'
  AFTER `cli_Id_Holded`;
