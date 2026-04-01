-- Si la importación Holded falla con: Data truncated for column 'cli_Id_Holded'
-- (o datos largos en referencia), ensanchar columnas. Idempotente.
--
-- "Conjunto vacío" en phpMyAdmin tras ALTER es normal: DDL no devuelve filas.

ALTER TABLE `clientes`
  MODIFY COLUMN `cli_Id_Holded` VARCHAR(255) NULL DEFAULT NULL;

ALTER TABLE `clientes`
  MODIFY COLUMN `cli_referencia` VARCHAR(255) NULL DEFAULT NULL;
