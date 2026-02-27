-- =============================================================================
-- Script: Alta y actualización de artículos desde archivo Excel
-- Base de datos: crm_gemavip
-- Fecha: 2026-02-27
-- =============================================================================
-- INSTRUCCIONES:
-- 1. Ejecutar en una transacción para poder hacer ROLLBACK si algo falla
-- 2. Los artículos con "Pte info logistica" se EXCLUYEN (Vitgase Aceite/Gel NUEVO FORMATO)
-- 3. art_mar_id: IALOZON=2, Vitgase/Karalis/Priel/Algorest/Vemag/Deubioma=3 (ajustar según tu BD)
-- =============================================================================

START TRANSACTION;

-- Ampliar art_unidades_caja: decimal(4,2) solo permite hasta 99.99,
-- pero hay artículos con 140, 144, 150 unidades/caja.
-- NOTA: ALTER TABLE provoca COMMIT implícito en MySQL.
ALTER TABLE articulos MODIFY COLUMN art_unidades_caja DECIMAL(6,2) NOT NULL;

-- -----------------------------------------------------------------------------
-- PARTE 1: ACTUALIZAR artículos EXISTENTES (por art_ean13)
-- -----------------------------------------------------------------------------

-- IALOZON COLLUTORIO AZUL 300 ML (EAN 8050616170323)
UPDATE articulos SET
  art_codigo_interno = 100110101,
  art_sku = '220381',
  art_nombre = 'IALOZON COLLUTORIO AZUL 300 ML',
  art_unidades_caja = 20,
  art_largo_unidad = 7.00, art_ancho_unidad = 7.00, art_alto_unidad = 16.00,
  art_kg_unidad = 0.38,
  art_largo_caja = 40.00, art_ancho_caja = 30.00, art_alto_caja = 24.00,
  art_peso_kg_Caja = 7.60,
  art_cajas_palet = 40
WHERE art_ean13 = 8050616170323;

-- IALOZON COLUTORIO ROSA 300 ML (EAN 8050616170026)
UPDATE articulos SET
  art_codigo_interno = 100110102,
  art_sku = '220380',
  art_nombre = 'IALOZON COLUTORIO ROSA 300 ML',
  art_unidades_caja = 20,
  art_largo_unidad = 7.00, art_ancho_unidad = 7.00, art_alto_unidad = 16.00,
  art_kg_unidad = 0.38,
  art_largo_caja = 40.00, art_ancho_caja = 30.00, art_alto_caja = 24.00,
  art_peso_kg_Caja = 7.60,
  art_cajas_palet = 40
WHERE art_ean13 = 8050616170026;

-- IALOZON COLLUTORIO SUPER HIDRATANTE 300 ML (EAN 8050616170132)
UPDATE articulos SET
  art_codigo_interno = 100110103,
  art_sku = '220378',
  art_nombre = 'IALOZON COLLUTORIO SUPER HIDRATANTE 300 ML',
  art_unidades_caja = 20,
  art_largo_unidad = 7.00, art_ancho_unidad = 7.00, art_alto_unidad = 16.00,
  art_kg_unidad = 0.365,
  art_largo_caja = 40.00, art_ancho_caja = 30.00, art_alto_caja = 24.00,
  art_peso_kg_Caja = 7.30,
  art_cajas_palet = 40
WHERE art_ean13 = 8050616170132;

-- IALOZON DENTIFRICIO AZUL 100 ML (EAN 8050616170354)
UPDATE articulos SET
  art_codigo_interno = 100110203,
  art_sku = '220382',
  art_nombre = 'IALOZON DENTIFRICIO AZUL 100 ML',
  art_unidades_caja = 24,
  art_largo_unidad = 3.50, art_ancho_unidad = 1.85, art_alto_unidad = 5.50,
  art_kg_unidad = 0.151,
  art_largo_caja = 12.00, art_ancho_caja = 35.00, art_alto_caja = 20.00,
  art_peso_kg_Caja = 3.80,
  art_cajas_palet = 96
WHERE art_ean13 = 8050616170354;

-- IALOZON DENTIFRICIO ROSA 100 ML (EAN 8050616170361)
UPDATE articulos SET
  art_codigo_interno = 100110204,
  art_sku = '220377',
  art_nombre = 'IALOZON DENTIFRICIO ROSA 100 ML',
  art_unidades_caja = 24,
  art_largo_unidad = 3.50, art_ancho_unidad = 1.85, art_alto_unidad = 5.50,
  art_kg_unidad = 0.151,
  art_largo_caja = 12.00, art_ancho_caja = 35.00, art_alto_caja = 20.00,
  art_peso_kg_Caja = 3.80,
  art_cajas_palet = 96
WHERE art_ean13 = 8050616170361;

-- IALOZON GEL ORAL 15 ML (EAN 8050616170149)
UPDATE articulos SET
  art_codigo_interno = 100110401,
  art_sku = '220379',
  art_nombre = 'IALOZON GEL ORAL 15 ML',
  art_unidades_caja = 24,
  art_largo_unidad = 3.00, art_ancho_unidad = 3.00, art_alto_unidad = 14.00,
  art_kg_unidad = 0.03,
  art_largo_caja = 27.00, art_ancho_caja = 15.00, art_alto_caja = 14.00,
  art_peso_kg_Caja = 0.30,
  art_cajas_palet = 40
WHERE art_ean13 = 8050616170149;

-- IALOZON CLEAN SPRAY 100 ML (EAN 8050616170156)
UPDATE articulos SET
  art_codigo_interno = 100110301,
  art_sku = '220375',
  art_nombre = 'IALOZON CLEAN SPRAY 100 ML',
  art_unidades_caja = 48,
  art_largo_unidad = 5.00, art_ancho_unidad = 5.00, art_alto_unidad = 15.00,
  art_kg_unidad = 0.14,
  art_largo_caja = 40.00, art_ancho_caja = 30.00, art_alto_caja = 24.00,
  art_peso_kg_Caja = 6.70,
  art_cajas_palet = 40
WHERE art_ean13 = 8050616170156;

-- -----------------------------------------------------------------------------
-- PARTE 2: INSERTAR artículos NUEVOS
-- art_mar_id: 3 = Vitgase/Gemavip (ajustar si tu tabla marcas tiene otros IDs)
-- -----------------------------------------------------------------------------

-- Vitgase Gotas
INSERT INTO articulos (
  art_sku, art_codigo_interno, art_nombre, art_presentacion,
  art_unidades_caja, art_largo_unidad, art_ancho_unidad, art_alto_unidad, art_kg_unidad,
  art_largo_caja, art_ancho_caja, art_alto_caja, art_peso_kg_Caja, art_cajas_palet,
  art_pvl, art_iva, art_imagen, art_mar_id, art_ean13, art_activo
) VALUES (
  '200720501', 200720501, 'Vitgase Gotas', '',
  140, 3.80, 3.80, 10.00, 0.064,
  40.00, 30.00, 24.00, 9.80, 40,
  0, 21, '', 3, 8050616170446, 1
);

-- Vitgase Champú
INSERT INTO articulos (
  art_sku, art_codigo_interno, art_nombre, art_presentacion,
  art_unidades_caja, art_largo_unidad, art_ancho_unidad, art_alto_unidad, art_kg_unidad,
  art_largo_caja, art_ancho_caja, art_alto_caja, art_peso_kg_Caja, art_cajas_palet,
  art_pvl, art_iva, art_imagen, art_mar_id, art_ean13, art_activo
) VALUES (
  '200320201', 200320201, 'Vitgase Champú', '',
  35, 5.50, 5.50, 19.50, 0.32,
  40.00, 30.00, 24.00, 11.30, 40,
  0, 21, '', 3, 8050616170101, 1
);

-- Vitgase Gel Limpiador 250 ml
INSERT INTO articulos (
  art_sku, art_codigo_interno, art_nombre, art_presentacion,
  art_unidades_caja, art_largo_unidad, art_ancho_unidad, art_alto_unidad, art_kg_unidad,
  art_largo_caja, art_ancho_caja, art_alto_caja, art_peso_kg_Caja, art_cajas_palet,
  art_pvl, art_iva, art_imagen, art_mar_id, art_ean13, art_activo
) VALUES (
  '200320102', 200320102, 'Vitgase Gel Limpiador 250 ml', '250 ml',
  35, 5.50, 5.50, 16.50, 0.245,
  40.00, 30.00, 24.00, 9.00, 40,
  0, 21, '', 3, 8050616170033, 1
);

-- Karalis FS
INSERT INTO articulos (
  art_sku, art_codigo_interno, art_nombre, art_presentacion,
  art_unidades_caja, art_largo_unidad, art_ancho_unidad, art_alto_unidad, art_kg_unidad,
  art_largo_caja, art_ancho_caja, art_alto_caja, art_peso_kg_Caja, art_cajas_palet,
  art_pvl, art_iva, art_imagen, art_mar_id, art_ean13, art_activo
) VALUES (
  '200420105', 200420105, 'Karalis FS', '',
  144, 12.50, 3.50, 3.50, 0.045,
  40.00, 30.00, 24.00, 6.67, 40,
  0, 21, '', 3, 8050616170217, 1
);

-- Priel 250ml
INSERT INTO articulos (
  art_sku, art_codigo_interno, art_nombre, art_presentacion,
  art_unidades_caja, art_largo_unidad, art_ancho_unidad, art_alto_unidad, art_kg_unidad,
  art_largo_caja, art_ancho_caja, art_alto_caja, art_peso_kg_Caja, art_cajas_palet,
  art_pvl, art_iva, art_imagen, art_mar_id, art_ean13, art_activo
) VALUES (
  '201020105', 201020105, 'Priel 250ml', '250 ml',
  25, 7.00, 5.50, 21.50, 0.30,
  40.00, 30.00, 24.00, 8.10, 40,
  0, 21, '', 3, 8050616170279, 1
);

-- Algorest
INSERT INTO articulos (
  art_sku, art_codigo_interno, art_nombre, art_presentacion,
  art_unidades_caja, art_largo_unidad, art_ancho_unidad, art_alto_unidad, art_kg_unidad,
  art_largo_caja, art_ancho_caja, art_alto_caja, art_peso_kg_Caja, art_cajas_palet,
  art_pvl, art_iva, art_imagen, art_mar_id, art_ean13, art_activo
) VALUES (
  '200820105', 200820105, 'Algorest', '',
  49, 18.00, 3.80, 5.00, 0.125,
  40.00, 30.00, 34.00, 6.60, 40,
  0, 21, '', 3, 8050616170125, 1
);

-- Vitgase Crema
INSERT INTO articulos (
  art_sku, art_codigo_interno, art_nombre, art_presentacion,
  art_unidades_caja, art_largo_unidad, art_ancho_unidad, art_alto_unidad, art_kg_unidad,
  art_largo_caja, art_ancho_caja, art_alto_caja, art_peso_kg_Caja, art_cajas_palet,
  art_pvl, art_iva, art_imagen, art_mar_id, art_ean13, art_activo
) VALUES (
  '200320105', 200320105, 'Vitgase Crema', '',
  35, 5.00, 5.00, 14.00, 0.15,
  40.00, 30.00, 24.00, 5.80, 40,
  0, 21, '', 3, 8050616170095, 1
);

-- Vemag Gastro
INSERT INTO articulos (
  art_sku, art_codigo_interno, art_nombre, art_presentacion,
  art_unidades_caja, art_largo_unidad, art_ancho_unidad, art_alto_unidad, art_kg_unidad,
  art_largo_caja, art_ancho_caja, art_alto_caja, art_peso_kg_Caja, art_cajas_palet,
  art_pvl, art_iva, art_imagen, art_mar_id, art_ean13, art_activo
) VALUES (
  '200720603', 200720603, 'Vemag Gastro', '',
  36, 14.00, 7.50, 8.00, 0.35,
  40.00, 30.00, 34.00, 13.30, 32,
  0, 21, '', 3, 8050616170163, 1
);

-- Deubioma
INSERT INTO articulos (
  art_sku, art_codigo_interno, art_nombre, art_presentacion,
  art_unidades_caja, art_largo_unidad, art_ancho_unidad, art_alto_unidad, art_kg_unidad,
  art_largo_caja, art_ancho_caja, art_alto_caja, art_peso_kg_Caja, art_cajas_palet,
  art_pvl, art_iva, art_imagen, art_mar_id, art_ean13, art_activo
) VALUES (
  '200620601', 200620601, 'Deubioma', '',
  150, 15.00, 2.50, 6.70, 0.03,
  35.00, 28.00, 35.00, 4.50, 32,
  0, 21, '', 3, 8050616170248, 1
);

-- Vitgase Forte
INSERT INTO articulos (
  art_sku, art_codigo_interno, art_nombre, art_presentacion,
  art_unidades_caja, art_largo_unidad, art_ancho_unidad, art_alto_unidad, art_kg_unidad,
  art_largo_caja, art_ancho_caja, art_alto_caja, art_peso_kg_Caja, art_cajas_palet,
  art_pvl, art_iva, art_imagen, art_mar_id, art_ean13, art_activo
) VALUES (
  '200320602', 200320602, 'Vitgase Forte', '',
  45, 12.50, 5.00, 11.50, 0.125,
  39.00, 29.50, 35.00, 5.63, 32,
  0, 21, '', 3, 8050616170071, 1
);

-- Vitgase Compresse
INSERT INTO articulos (
  art_sku, art_codigo_interno, art_nombre, art_presentacion,
  art_unidades_caja, art_largo_unidad, art_ancho_unidad, art_alto_unidad, art_kg_unidad,
  art_largo_caja, art_ancho_caja, art_alto_caja, art_peso_kg_Caja, art_cajas_palet,
  art_pvl, art_iva, art_imagen, art_mar_id, art_ean13, art_activo
) VALUES (
  '200320601', 200320601, 'Vitgase Compresse', '',
  150, 11.50, 2.50, 6.50, 0.032,
  35.00, 27.50, 35.00, 4.80, 32,
  0, 21, '', 3, 8050616170088, 1
);

-- Vemag Idra GUSTO MENTA
INSERT INTO articulos (
  art_sku, art_codigo_interno, art_nombre, art_presentacion,
  art_unidades_caja, art_largo_unidad, art_ancho_unidad, art_alto_unidad, art_kg_unidad,
  art_largo_caja, art_ancho_caja, art_alto_caja, art_peso_kg_Caja, art_cajas_palet,
  art_pvl, art_iva, art_imagen, art_mar_id, art_ean13, art_activo
) VALUES (
  '200720606', 200720606, 'Vemag Idra GUSTO MENTA', '',
  150, 15.00, 2.50, 6.50, 0.035,
  35.00, 27.50, 35.00, 5.50, 32,
  0, 21, '', 3, 8050616170385, 1
);

-- Vemag Idra GUSTO FRUTOS DEL BOSQUE
INSERT INTO articulos (
  art_sku, art_codigo_interno, art_nombre, art_presentacion,
  art_unidades_caja, art_largo_unidad, art_ancho_unidad, art_alto_unidad, art_kg_unidad,
  art_largo_caja, art_ancho_caja, art_alto_caja, art_peso_kg_Caja, art_cajas_palet,
  art_pvl, art_iva, art_imagen, art_mar_id, art_ean13, art_activo
) VALUES (
  '200720605', 200720605, 'Vemag Idra GUSTO FRUTOS DEL BOSQUE', '',
  150, 15.00, 2.50, 6.50, 0.035,
  35.00, 27.50, 35.00, 5.50, 32,
  0, 21, '', 3, 8050616170392, 1
);

-- -----------------------------------------------------------------------------
-- Verificación: revisar antes de COMMIT
-- SELECT art_id, art_sku, art_nombre, art_ean13 FROM articulos ORDER BY art_id;
-- -----------------------------------------------------------------------------

COMMIT;
-- Si algo falla: ROLLBACK;
