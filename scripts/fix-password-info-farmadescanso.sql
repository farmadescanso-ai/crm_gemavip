-- Actualizar contraseña del comercial info@farmadescanso.com (administrador)
-- Ejecutar en phpMyAdmin o cliente MySQL (crm_farmadescanso o crm_gemavip)
-- Hash bcrypt de: farma@gemavip2026
--
-- Este script corrige el error "Contraseña no válida" cuando la contraseña
-- en BD no está en formato bcrypt (vacía, texto plano o formato antiguo).

-- Opción 1: Si tu tabla usa columnas normalizadas (com_email, com_password):
UPDATE comerciales
SET `com_password` = '$2a$12$r9ty/yCEe/.AmBC.hJJeruNeDjHjQ0FqoUfBHxiHA1JydH6JCe/7C'
WHERE LOWER(TRIM(`com_email`)) = 'info@farmadescanso.com';

-- Opción 2: Si falla, prueba con columnas legacy (Email, Password):
-- UPDATE comerciales
-- SET `Password` = '$2a$12$r9ty/yCEe/.AmBC.hJJeruNeDjHjQ0FqoUfBHxiHA1JydH6JCe/7C'
-- WHERE LOWER(TRIM(`Email`)) = 'info@farmadescanso.com';
