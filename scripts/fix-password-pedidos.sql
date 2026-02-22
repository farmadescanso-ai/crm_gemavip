-- Actualizar contraseña del comercial pedidos@farmadescanso.com
-- Ejecutar en phpMyAdmin (crm_farmadescanso o crm_gemavip)
-- Hash bcrypt de: farma@gemavip2026

-- Si la tabla tiene columnas legacy (Password, Email):
UPDATE comerciales
SET Password = '$2a$12$r9ty/yCEe/.AmBC.hJJeruNeDjHjQ0FqoUfBHxiHA1JydH6JCe/7C'
WHERE LOWER(TRIM(Email)) = 'pedidos@farmadescanso.com';

-- Si la tabla tiene columnas normalizadas (com_password, com_email):
-- UPDATE comerciales
-- SET com_password = '$2a$12$r9ty/yCEe/.AmBC.hJJeruNeDjHjQ0FqoUfBHxiHA1JydH6JCe/7C'
-- WHERE LOWER(TRIM(com_email)) = 'pedidos@farmadescanso.com';
