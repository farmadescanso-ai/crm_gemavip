-- Tabla para mapeo global Holded (ruta JSON) → columna CRM `clientes`.
-- El CRM crea la tabla automáticamente al guardar desde /cpanel/holded-comparar; este script es opcional (ej. crear en entorno sin pasar por la UI).

CREATE TABLE IF NOT EXISTS `crm_holded_field_map` (
  id INT NOT NULL PRIMARY KEY,
  mapping_json LONGTEXT NOT NULL,
  updated_at DATETIME NOT NULL,
  updated_by VARCHAR(255) NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
