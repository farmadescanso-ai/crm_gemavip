-- Si la importación Holded falla con: Data truncated for column 'cli_Id_Holded'
-- la columna quedó demasiado corta (p. ej. VARCHAR(20)). Los IDs Holded suelen ser ~24 chars.
-- Idempotente: MODIFY solo el tamaño.

ALTER TABLE `clientes`
  MODIFY COLUMN `cli_Id_Holded` VARCHAR(255) NULL DEFAULT NULL;
