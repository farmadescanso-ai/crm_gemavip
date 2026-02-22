-- Actualizar contraseña del comercial pedidos@farmadescanso.com
-- Ejecutar en phpMyAdmin (crm_farmadescanso o crm_gemavip)
-- Hash bcrypt de: farma@gemavip2026

-- Columnas normalizadas (com_email, com_password):
UPDATE comerciales
SET `com_password` = '$2a$12$r9ty/yCEe/.AmBC.hJJeruNeDjHjQ0FqoUfBHxiHA1JydH6JCe/7C'
WHERE LOWER(TRIM(`com_email`)) = 'pedidos@farmadescanso.com';

-- Si falla, prueba con columnas legacy (Email, Password) - usar backticks:
-- UPDATE comerciales
-- SET `Password` = '$2a$12$r9ty/yCEe/.AmBC.hJJeruNeDjHjQ0FqoUfBHxiHA1JydH6JCe/7C'
-- WHERE LOWER(TRIM(`Email`)) = 'pedidos@farmadescanso.com';
