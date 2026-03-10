-- Migración: Cambiar estado "OK" a "Activo" en estdoClientes
-- Ejecutar: mysql -u usuario -p base_datos < scripts/migracion-estado-ok-a-activo.sql

UPDATE `estdoClientes`
SET `estcli_nombre` = 'Activo'
WHERE UPPER(TRIM(COALESCE(`estcli_nombre`, ''))) = 'OK';
