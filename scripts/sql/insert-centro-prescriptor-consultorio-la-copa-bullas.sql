-- Consultorio La Copa de Bullas (ficha MurciaSalud, texto pegado por usuario)
-- cent_codigo INT desde «Código: 08011231»
-- cent_Telefono: NULL (en el texto solo constan teléfonos de cita previa; no hay troncal en el H1)
-- cent_Coordinador: NULL (no se incluyó tabla de profesionales / coordinador)

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
  'Consultorio La Copa de Bullas',
  8011231,
  'C/ Cehegín, s/n',
  'LA COPA',
  '30189',
  'BULLAS',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'Área de Salud IV (Noroeste)'
);
