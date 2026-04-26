-- Centro: MurciaSalud caps.php?id_centro=16 (Centro de Salud Caravaca de la Cruz)
-- cent_Telefono: solo primer teléfono del H1 (no cita previa)
-- cent_codigo: INT desde «Código: 08011710»

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
