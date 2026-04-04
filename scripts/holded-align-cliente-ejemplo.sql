-- =============================================================================
-- CRM Gemavip · Ejemplo: alinear un cliente con datos equivalentes a Holded
-- (revisar valores y ejecutar en transacción de prueba antes de producción).
-- Requiere opcionalmente: ALTER en formas_pago para formp_id_holded (ver
-- lib/holded-payment-methods.js → buildFormasPagoSyncSql).
-- =============================================================================

-- SET @cli_id := 426;

-- START TRANSACTION;

-- Opcional: columna para ID de método de pago en Holded (si aún no existe):
-- ALTER TABLE formas_pago
--   ADD COLUMN formp_id_holded VARCHAR(64) NULL DEFAULT NULL
--   COMMENT 'ID Holded GET /paymentmethods'
--   AFTER formp_dias;

-- Ejemplo: vincular forma de pago CRM con ID Holded (sustituir IDs reales):
-- UPDATE formas_pago SET formp_id_holded = 'ID_HOLDED_PM' WHERE formp_id = 1 LIMIT 1;

/*
UPDATE clientes c
SET
  c.cli_nombre_razon_social = 'ALBIR HILLS RESORT SAU',
  c.cli_nombre_cial = 'Farmacia',
  c.cli_dni_cif = 'A54081518',
  c.cli_email = 'finances@shawellnessclinic.com',
  c.cli_movil = NULL,
  c.cli_telefono = '+34965850812',
  c.cli_direccion = 'CALLE VERDEROL, 5',
  c.cli_poblacion = 'El Albir',
  c.cli_codigo_postal = '03581',
  c.cli_Web = 'www.shawellness.com',
  c.cli_IBAN = '',
  c.cli_Swift = '',
  c.cli_cuenta_ventas = '43000055',
  c.cli_cuenta_compras = '0',
  c.cli_Id_Holded = '69426fed13bc70fe750efb79',
  c.cli_tags = 'farmacia, crm',
  c.cli_idiom_id = (SELECT idiom_id FROM idiomas WHERE LOWER(TRIM(idiom_codigo)) = 'es' LIMIT 1),
  c.cli_Idioma = 'es',
  c.cli_mon_id = (SELECT mon_id FROM monedas WHERE UPPER(TRIM(mon_codigo)) = 'EUR' LIMIT 1),
  c.cli_Moneda = 'EUR',
  c.cli_dto = 0,
  c.cli_Modelo_347 = 1,
  c.cli_prov_id = (
    SELECT prov_id FROM provincias
    WHERE prov_codigo_pais = 'ES'
      AND LOWER(TRIM(prov_nombre)) COLLATE utf8mb4_unicode_ci
        = LOWER(TRIM('Alicante')) COLLATE utf8mb4_unicode_ci
    LIMIT 1
  ),
  c.cli_pais_id = (SELECT pais_id FROM paises WHERE UPPER(TRIM(pais_codigo)) = 'ES' LIMIT 1),
  c.cli_CodPais = 'ES',
  -- c.cli_formp_id: solo si Holded defaults.paymentMethod ≠ 0 y existe fila con formp_id_holded
  c.cli_tarifa_legacy = (
    SELECT tarcli_id FROM tarifasClientes
    WHERE UPPER(TRIM(tarcli_nombre)) = UPPER(TRIM('FARMACIAS'))
      AND (tarcli_activa IS NULL OR tarcli_activa = 1)
    LIMIT 1
  )
WHERE c.cli_id = @cli_id;
*/

-- Nota: si defaults.paymentMethod en Holded es 0, no fuerces cli_formp_id
-- salvo que exista regla explícita (dejar NULL o valor actual).

-- ROLLBACK;
-- COMMIT;
