-- =============================================================================
-- DIAGNÓSTICO: claves foráneas hacia clientes, pedidos, notificaciones, visitas
-- =============================================================================
-- Ejecutar en la BD del CRM (ej. crm_gemavip) ANTES de scripts de borrado masivo.
-- Sirve para comprobar ON DELETE (RESTRICT / CASCADE / SET NULL) en TU instalación.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Todas las FKs que referencian la tabla clientes
-- -----------------------------------------------------------------------------
SELECT
  rc.CONSTRAINT_NAME,
  kcu.TABLE_NAME AS tabla_hija,
  kcu.COLUMN_NAME AS columna,
  rc.UPDATE_RULE,
  rc.DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS rc
JOIN information_schema.KEY_COLUMN_USAGE kcu
  ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
  AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
  AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
  AND kcu.TABLE_NAME = rc.TABLE_NAME
WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
  AND rc.REFERENCED_TABLE_NAME = 'clientes'
ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME;

-- -----------------------------------------------------------------------------
-- 2) Todas las FKs que referencian la tabla pedidos
-- -----------------------------------------------------------------------------
SELECT
  rc.CONSTRAINT_NAME,
  kcu.TABLE_NAME AS tabla_hija,
  kcu.COLUMN_NAME AS columna,
  rc.UPDATE_RULE,
  rc.DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS rc
JOIN information_schema.KEY_COLUMN_USAGE kcu
  ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
  AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
  AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
  AND kcu.TABLE_NAME = rc.TABLE_NAME
WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
  AND rc.REFERENCED_TABLE_NAME = 'pedidos'
ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME;

-- -----------------------------------------------------------------------------
-- 3) FKs en notificaciones (si la tabla existe)
-- -----------------------------------------------------------------------------
SELECT
  rc.CONSTRAINT_NAME,
  kcu.TABLE_NAME,
  kcu.COLUMN_NAME,
  rc.REFERENCED_TABLE_NAME,
  rc.DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS rc
JOIN information_schema.KEY_COLUMN_USAGE kcu
  ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
  AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
  AND kcu.TABLE_NAME = 'notificaciones'
ORDER BY kcu.COLUMN_NAME;

-- -----------------------------------------------------------------------------
-- 4) FKs en visitas (si la tabla existe)
-- -----------------------------------------------------------------------------
SELECT
  rc.CONSTRAINT_NAME,
  kcu.TABLE_NAME,
  kcu.COLUMN_NAME,
  rc.REFERENCED_TABLE_NAME,
  rc.DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS rc
JOIN information_schema.KEY_COLUMN_USAGE kcu
  ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
  AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
  AND kcu.TABLE_NAME = 'visitas'
ORDER BY kcu.COLUMN_NAME;

-- -----------------------------------------------------------------------------
-- 5) FKs en comisiones_detalle (si existe; puede no estar en todas las instalaciones)
-- -----------------------------------------------------------------------------
SELECT
  rc.CONSTRAINT_NAME,
  kcu.TABLE_NAME,
  kcu.COLUMN_NAME,
  rc.REFERENCED_TABLE_NAME,
  rc.DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS rc
JOIN information_schema.KEY_COLUMN_USAGE kcu
  ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
  AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
  AND kcu.TABLE_NAME = 'comisiones_detalle'
ORDER BY kcu.COLUMN_NAME;

-- -----------------------------------------------------------------------------
-- 6) Columnas de comisiones_detalle (nombre real del enlace al pedido)
--     Vacío si la tabla no existe.
-- -----------------------------------------------------------------------------
SELECT COLUMN_NAME, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'comisiones_detalle'
ORDER BY ORDINAL_POSITION;

-- -----------------------------------------------------------------------------
-- 7) Comprobar si existen tablas relevantes
-- -----------------------------------------------------------------------------
SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'clientes',
    'pedidos',
    'pedidos_articulos',
    'comisiones_detalle',
    'notificaciones',
    'visitas',
    'clientes_contactos',
    'direccionesEnvio',
    'clientes_relacionados',
    'clientes_cooperativas',
    'clientes_gruposCompras',
    'comisiones'
  )
ORDER BY TABLE_NAME;
