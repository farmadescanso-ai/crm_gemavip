-- ============================================================
-- Migración: Regímenes Fiscales (IVA / IGIC / IPSI)
-- Crea tablas de regímenes, tipos de impuesto y equivalencias.
-- Añade columnas FK en codigos_postales, clientes y pedidos.
-- Asigna regímenes a CP existentes y clientes.
-- ============================================================

-- 1) Tabla regimenes_fiscales
CREATE TABLE IF NOT EXISTS regimenes_fiscales (
  regfis_id      INT AUTO_INCREMENT PRIMARY KEY,
  regfis_codigo  VARCHAR(10)  NOT NULL UNIQUE,
  regfis_nombre  VARCHAR(150) NOT NULL,
  regfis_nombre_corto VARCHAR(10) NOT NULL,
  regfis_pais_codigo  VARCHAR(3)  DEFAULT 'ES',
  regfis_activo  TINYINT(1)   DEFAULT 1,
  regfis_creado_en DATETIME    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO regimenes_fiscales (regfis_id, regfis_codigo, regfis_nombre, regfis_nombre_corto, regfis_pais_codigo) VALUES
  (1, 'IVA',    'Impuesto sobre el Valor Añadido',                                          'IVA',  'ES'),
  (2, 'IGIC',   'Impuesto General Indirecto Canario',                                       'IGIC', 'ES'),
  (3, 'IPSI',   'Impuesto sobre la Producción, los Servicios y la Importación',              'IPSI', 'ES'),
  (4, 'IVA_PT', 'Imposto sobre o Valor Acrescentado',                                       'IVA',  'PT');


-- 2) Tabla tipos_impuesto
CREATE TABLE IF NOT EXISTS tipos_impuesto (
  timp_id        INT AUTO_INCREMENT PRIMARY KEY,
  timp_regfis_id INT          NOT NULL,
  timp_codigo    VARCHAR(30)  NOT NULL UNIQUE,
  timp_nombre    VARCHAR(100) NOT NULL,
  timp_porcentaje DECIMAL(5,2) NOT NULL,
  timp_es_defecto TINYINT(1)  DEFAULT 0,
  timp_activo    TINYINT(1)   DEFAULT 1,
  FOREIGN KEY (timp_regfis_id) REFERENCES regimenes_fiscales(regfis_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- IVA España
INSERT IGNORE INTO tipos_impuesto (timp_id, timp_regfis_id, timp_codigo, timp_nombre, timp_porcentaje, timp_es_defecto) VALUES
  (1,  1, 'IVA_GENERAL',        'IVA General 21%',        21.00, 1),
  (2,  1, 'IVA_REDUCIDO',       'IVA Reducido 10%',       10.00, 0),
  (3,  1, 'IVA_SUPERREDUCIDO',  'IVA Superreducido 4%',    4.00, 0),
  (4,  1, 'IVA_EXENTO',         'IVA Exento 0%',           0.00, 0);

-- IGIC Canarias
INSERT IGNORE INTO tipos_impuesto (timp_id, timp_regfis_id, timp_codigo, timp_nombre, timp_porcentaje, timp_es_defecto) VALUES
  (5,  2, 'IGIC_GENERAL',       'IGIC General 7%',         7.00, 1),
  (6,  2, 'IGIC_REDUCIDO',      'IGIC Reducido 3%',        3.00, 0),
  (7,  2, 'IGIC_CERO',          'IGIC Tipo Cero 0%',       0.00, 0),
  (8,  2, 'IGIC_INCREMENTADO1', 'IGIC Incrementado 9,5%',  9.50, 0),
  (9,  2, 'IGIC_INCREMENTADO2', 'IGIC Incrementado 15%',  15.00, 0);

-- IPSI Ceuta y Melilla
INSERT IGNORE INTO tipos_impuesto (timp_id, timp_regfis_id, timp_codigo, timp_nombre, timp_porcentaje, timp_es_defecto) VALUES
  (10, 3, 'IPSI_05',            'IPSI 0,5%',               0.50, 0),
  (11, 3, 'IPSI_1',             'IPSI 1%',                 1.00, 0),
  (12, 3, 'IPSI_2',             'IPSI 2%',                 2.00, 0),
  (13, 3, 'IPSI_GENERAL',       'IPSI General 4%',         4.00, 1),
  (14, 3, 'IPSI_8',             'IPSI 8%',                 8.00, 0),
  (15, 3, 'IPSI_10',            'IPSI 10%',               10.00, 0);

-- IVA Portugal (preparado para futuro)
INSERT IGNORE INTO tipos_impuesto (timp_id, timp_regfis_id, timp_codigo, timp_nombre, timp_porcentaje, timp_es_defecto) VALUES
  (16, 4, 'IVA_PT_GENERAL',     'IVA Portugal 23%',       23.00, 1),
  (17, 4, 'IVA_PT_INTERMEDIO',  'IVA Portugal 13%',       13.00, 0),
  (18, 4, 'IVA_PT_REDUCIDO',    'IVA Portugal 6%',         6.00, 0);


-- 3) Tabla equivalencias_impuesto
CREATE TABLE IF NOT EXISTS equivalencias_impuesto (
  eqimp_id              INT AUTO_INCREMENT PRIMARY KEY,
  eqimp_timp_origen_id  INT NOT NULL,
  eqimp_timp_destino_id INT NOT NULL,
  FOREIGN KEY (eqimp_timp_origen_id)  REFERENCES tipos_impuesto(timp_id),
  FOREIGN KEY (eqimp_timp_destino_id) REFERENCES tipos_impuesto(timp_id),
  UNIQUE KEY uk_equivalencia (eqimp_timp_origen_id, eqimp_timp_destino_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- IVA → IGIC
INSERT IGNORE INTO equivalencias_impuesto (eqimp_timp_origen_id, eqimp_timp_destino_id) VALUES
  (1, 5),   -- IVA General 21%       → IGIC General 7%
  (2, 6),   -- IVA Reducido 10%      → IGIC Reducido 3%
  (3, 7),   -- IVA Superreducido 4%  → IGIC Cero 0%
  (4, 7);   -- IVA Exento 0%         → IGIC Cero 0%

-- IVA → IPSI
INSERT IGNORE INTO equivalencias_impuesto (eqimp_timp_origen_id, eqimp_timp_destino_id) VALUES
  (1, 13),  -- IVA General 21%       → IPSI General 4%
  (2, 12),  -- IVA Reducido 10%      → IPSI 2%
  (3, 10),  -- IVA Superreducido 4%  → IPSI 0,5%
  (4, 10);  -- IVA Exento 0%         → IPSI 0,5%

-- IVA → IVA Portugal
INSERT IGNORE INTO equivalencias_impuesto (eqimp_timp_origen_id, eqimp_timp_destino_id) VALUES
  (1, 16),  -- IVA General 21%       → IVA PT 23%
  (2, 17),  -- IVA Reducido 10%      → IVA PT 13%
  (3, 18),  -- IVA Superreducido 4%  → IVA PT 6%
  (4, 18);  -- IVA Exento 0%         → IVA PT 6%


-- 4) ALTER tablas existentes
ALTER TABLE codigos_postales
  ADD COLUMN IF NOT EXISTS codpos_regfis_id INT NULL,
  ADD CONSTRAINT fk_codpos_regfis FOREIGN KEY (codpos_regfis_id) REFERENCES regimenes_fiscales(regfis_id);

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS cli_regfis_id INT NULL DEFAULT 1,
  ADD CONSTRAINT fk_cli_regfis FOREIGN KEY (cli_regfis_id) REFERENCES regimenes_fiscales(regfis_id);

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS ped_regfis_id INT NULL DEFAULT 1,
  ADD CONSTRAINT fk_ped_regfis FOREIGN KEY (ped_regfis_id) REFERENCES regimenes_fiscales(regfis_id);


-- 5) Asignar régimen fiscal a códigos postales existentes
UPDATE codigos_postales SET codpos_regfis_id = 2
  WHERE (codpos_CodigoPostal LIKE '35%' OR codpos_CodigoPostal LIKE '38%')
    AND (codpos_regfis_id IS NULL OR codpos_regfis_id != 2);

UPDATE codigos_postales SET codpos_regfis_id = 3
  WHERE (codpos_CodigoPostal LIKE '51%' OR codpos_CodigoPostal LIKE '52%')
    AND (codpos_regfis_id IS NULL OR codpos_regfis_id != 3);

UPDATE codigos_postales SET codpos_regfis_id = 1
  WHERE codpos_regfis_id IS NULL;


-- 6) Asignar régimen fiscal a clientes existentes según su CP
UPDATE clientes c
  JOIN codigos_postales cp ON cp.codpos_CodigoPostal = c.cli_codigo_postal
  SET c.cli_regfis_id = cp.codpos_regfis_id
  WHERE c.cli_codigo_postal IS NOT NULL
    AND c.cli_codigo_postal != ''
    AND cp.codpos_regfis_id IS NOT NULL;

-- Clientes sin CP o sin match: IVA por defecto
UPDATE clientes SET cli_regfis_id = 1 WHERE cli_regfis_id IS NULL;

-- Pedidos existentes: heredar del cliente
UPDATE pedidos p
  JOIN clientes c ON c.cli_id = p.ped_cli_id
  SET p.ped_regfis_id = c.cli_regfis_id
  WHERE c.cli_regfis_id IS NOT NULL;

UPDATE pedidos SET ped_regfis_id = 1 WHERE ped_regfis_id IS NULL;
