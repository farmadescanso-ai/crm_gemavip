-- Revisión de contraseñas inseguras en comerciales
-- BD objetivo: crm_gemavip
-- Nota: MySQL no genera bcrypt nativo de forma compatible con la app.
-- Para aplicar hash seguro usar: node scripts/hash-comerciales-passwords.js --apply

SELECT
  com_id,
  com_nombre,
  com_email,
  com_dni,
  CASE
    WHEN com_password IS NULL OR TRIM(com_password) = '' THEN 'VACIA'
    WHEN com_password LIKE '$2a$%' OR com_password LIKE '$2b$%' OR com_password LIKE '$2y$%' THEN 'BCRYPT_OK'
    WHEN com_password = com_dni THEN 'PLANO_IGUAL_DNI'
    ELSE 'PLANO_OTRO'
  END AS estado_password
FROM comerciales
ORDER BY com_id;

-- Solo pendientes de migración:
SELECT
  com_id,
  com_nombre,
  com_email,
  com_dni,
  com_password
FROM comerciales
WHERE
  com_password IS NULL
  OR TRIM(com_password) = ''
  OR NOT (
    com_password LIKE '$2a$%'
    OR com_password LIKE '$2b$%'
    OR com_password LIKE '$2y$%'
  )
ORDER BY com_id;
