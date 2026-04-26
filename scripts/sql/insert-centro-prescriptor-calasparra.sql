-- Centro de Salud Calasparra + PAC (ficha MurciaSalud, texto pegado por usuario)
-- cent_codigo INT desde «Código: 08011410»
-- cent_Telefono: primer número del encabezado (968720300), no cita previa
-- cent_Coordinador: Concepcion Martinez Delgado (COORDINADORA MÉDICA en tabla profesionales)

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
  'Centro de Salud Calasparra / PAC- Punto de Atención Continuada',
  8011410,
  'C/ Sanidad S/N',
  'CALASPARRA',
  '30420',
  'CALASPARRA',
  '968 72 03 00',
  NULL,
  'Concepcion Martinez Delgado',
  NULL,
  NULL,
  'Área de Salud IV (Noroeste)'
);
