-- Actualiza TipoContacto de todos los clientes según DNI_CIF:
--   CIF (empresa)        → Empresa
--   DNI o NIE (persona)  → Persona
--   Sin DNI/CIF o no válido → Otros
--
-- Ejecutar este archivo en tu base de datos remota (phpMyAdmin, MySQL Workbench, etc.).
-- Si tu tabla se llama "Clientes" (con mayúscula), cambia clientes por `Clientes` en las sentencias.
-- Si la columna DNI/CIF tiene otro nombre (p. ej. DniCif), sustituye DNI_CIF por el nombre correcto.

-- Una sola sentencia; funciona en MySQL 5.x / 8 y MariaDB.

UPDATE clientes
SET TipoContacto = CASE
  WHEN UPPER(TRIM(REPLACE(REPLACE(IFNULL(DNI_CIF, ''), ' ', ''), '-', ''))) = '' THEN 'Otros'
  WHEN UPPER(TRIM(REPLACE(REPLACE(IFNULL(DNI_CIF, ''), ' ', ''), '-', ''))) IN ('PENDIENTE', 'NULL', 'N/A', 'NA') THEN 'Otros'
  WHEN UPPER(TRIM(REPLACE(REPLACE(IFNULL(DNI_CIF, ''), ' ', ''), '-', ''))) LIKE 'SIN_DNI%' THEN 'Otros'
  WHEN UPPER(TRIM(REPLACE(REPLACE(IFNULL(DNI_CIF, ''), ' ', ''), '-', ''))) REGEXP '^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$' THEN 'Empresa'
  WHEN UPPER(TRIM(REPLACE(REPLACE(IFNULL(DNI_CIF, ''), ' ', ''), '-', ''))) REGEXP '^[0-9]{8}[A-Z]$' THEN 'Persona'
  WHEN UPPER(TRIM(REPLACE(REPLACE(IFNULL(DNI_CIF, ''), ' ', ''), '-', ''))) REGEXP '^[XYZ][0-9]{7}[A-Z]$' THEN 'Persona'
  ELSE 'Otros'
END;

