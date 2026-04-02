-- Vínculo 1:1 CRM ↔ Holded: un contacto Holded (contact.id) solo puede enlazarse a una fila en `clientes`.
-- Columna canónica: clientes.cli_Id_Holded (VARCHAR(255), NULL si sin vínculo).
-- Índice: ux_clientes_cli_Id_Holded (UNIQUE). Varias filas con NULL están permitidas en MySQL.

-- 1) Comprobar duplicados antes de crear el índice (debe devolver 0 filas)
SELECT cli_Id_Holded AS holded_contact_id, COUNT(*) AS n
FROM clientes
WHERE cli_Id_Holded IS NOT NULL AND TRIM(COALESCE(cli_Id_Holded, '')) <> ''
GROUP BY cli_Id_Holded
HAVING n > 1;

-- 2) Si no existe el índice, crearlo (idempotente si ya lo aplicó el CRM al arrancar sync Holded)
-- CREATE UNIQUE INDEX `ux_clientes_cli_Id_Holded` ON `clientes` (`cli_Id_Holded`);

-- Ejemplo: asignar ID Holded a un cliente CRM concreto (ajusta cli_id y el hex según tu caso)
-- UPDATE clientes
-- SET cli_Id_Holded = '69411b6ea6342dde4908bc5f'
-- WHERE cli_id = 425
--   AND NOT EXISTS (
--     SELECT 1 FROM clientes c2
--     WHERE c2.cli_Id_Holded = '69411b6ea6342dde4908bc5f' AND c2.cli_id <> 425
--   );
