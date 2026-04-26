-- Centro: MurciaSalud caps.php?id_centro=12 (Centro de Salud Bullas)
-- Fuente: texto ficha MurciaSalud (usuario). cent_codigo INT desde «Código: 08011210»
-- cent_Telefono: primer número del encabezado (968652150), no cita previa
-- cent_Coordinador: profesional con Observaciones «COORDINADOR MÉDICO» (Luis Puebla Manzanos)

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
  'Centro de Salud Bullas',
  8011210,
  'C/ Fco. Puerta González-Conde, S/N',
  'BULLAS',
  '30180',
  'BULLAS',
  '968 65 21 50',
  NULL,
  'Luis Puebla Manzanos',
  NULL,
  NULL,
  'Área de Salud IV (Noroeste)'
);
