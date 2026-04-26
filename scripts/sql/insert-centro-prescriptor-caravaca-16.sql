-- Centro: MurciaSalud caps.php?id_centro=16 (Centro de Salud Caravaca de la Cruz)
-- cent_Telefono: solo primer teléfono del H1 (no cita previa)
-- cent_codigo: INT desde «Código: 08011710»
--
-- Mismo proceso para cualquier otro centro del catalogo:
--   1) Abre la ficha en el navegador (op=mostrar_centro e id_centro=...).
--   2) Si el script o el servidor reciben CAPTCHA, guarda la pagina como HTML.
--   3) node scripts/murciasalud-centros-prescriptores-sql.js --html ruta/ficha.html
--      O sin PowerShell: URL en scripts/murciasalud-centro-url.txt y doble clic en
--      run-murciasalud-centro-desde-archivo.cmd (raiz del CRM).
--   4) Revisa cent_codigo y cent_Id_Ruta; guarda el INSERT en scripts/sql/ si quieres versionarlo.
-- Fixture de prueba Jest: tests/fixtures/murciasalud-centro-16.html

INSERT INTO `centros_prescriptores` (
  `cent_Id_Ruta`,
  `cent_Nombre_Centro`,
  `cent_codigo`,
  `cent_Direccion`,
  `cent_Poblacion`,
  `cent_Cod_Postal`,
  `cent_Municipio`,
  `cent_Telefono`,
  `cent_Email`,
  `cent_Coordinador`,
  `cent_Telf_Coordinador`,
  `cent_Email_Coordinador`,
  `cent_Area_Salud`
) VALUES (
  NULL,
  'Centro de Salud Caravaca de la Cruz',
  8011710,
  'C/ Junquico S/N',
  'CARAVACA DE LA CRUZ',
  '30400',
  'CARAVACA DE LA CRUZ',
  '968 70 30 11',
  NULL,
  'Pascual Santos Villalba',
  NULL,
  NULL,
  'Área de Salud IV (Noroeste)'
);
