-- crm_gemavip - Esquema simplificado para importar en drawDB
-- https://www.drawdb.app/editor
-- Sin columnas GENERATED, sin índices secundarios, solo estructura + PK + FKs

-- agenda (sin MovilNorm GENERATED)
CREATE TABLE `agenda` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `Nombre` varchar(120) NOT NULL,
  `Apellidos` varchar(180) DEFAULT NULL,
  `Cargo` varchar(120) DEFAULT NULL,
  `Especialidad` varchar(120) DEFAULT NULL,
  `Id_TipoCargoRol` int DEFAULT NULL,
  `Id_Especialidad` int DEFAULT NULL,
  `Empresa` varchar(180) DEFAULT NULL,
  `Email` varchar(255) DEFAULT NULL,
  `Movil` varchar(20) DEFAULT NULL,
  `Telefono` varchar(20) DEFAULT NULL,
  `Extension` varchar(10) DEFAULT NULL,
  `Notas` text,
  `Activo` tinyint(1) NOT NULL DEFAULT 1,
  `CreadoEn` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ActualizadoEn` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id`)
);

CREATE TABLE `agenda_especialidades` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Nombre` varchar(120) NOT NULL,
  `Activo` tinyint(1) NOT NULL DEFAULT 1,
  `CreadoEn` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ActualizadoEn` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `agenda_roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Nombre` varchar(120) NOT NULL,
  `Activo` tinyint(1) NOT NULL DEFAULT 1,
  `CreadoEn` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ActualizadoEn` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `api_keys` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `api_key` varchar(100) NOT NULL,
  `descripcion` text,
  `activa` tinyint(1) DEFAULT 1,
  `permisos` text,
  `ultimo_uso` timestamp NULL DEFAULT NULL,
  `creado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `creado_por` int DEFAULT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `articulos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `SKU` varchar(12) NOT NULL,
  `Nombre` varchar(100) NOT NULL,
  `Presentacion` varchar(20) NOT NULL,
  `Unidades_Caja` int NOT NULL,
  `Largo_Caja` int NOT NULL,
  `Alto_Caja` int NOT NULL,
  `Ancho_Caja` int NOT NULL,
  `PesoKg` decimal(4,2) NOT NULL,
  `Cajas_Palet` int NOT NULL,
  `PVL` decimal(10,2) NOT NULL,
  `IVA` decimal(4,2) NOT NULL DEFAULT 21.00,
  `Imagen` varchar(255) NOT NULL,
  `Id_Marca` int DEFAULT NULL,
  `EAN13` bigint NOT NULL,
  `Activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
);

CREATE TABLE `centros_prescriptores` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Id_Ruta` int DEFAULT NULL,
  `Nombre_Centro` varchar(255) NOT NULL,
  `Direccion` varchar(255) NOT NULL,
  `Poblacion` varchar(255) NOT NULL,
  `Cod_Postal` varchar(255) NOT NULL,
  `Municipio` varchar(255) NOT NULL,
  `Telefono` varchar(255) DEFAULT NULL,
  `Email` varchar(255) DEFAULT NULL,
  `Coordinador` varchar(255) DEFAULT NULL,
  `Telf_Coordinador` varchar(255) DEFAULT NULL,
  `Email_Coordinador` varchar(255) DEFAULT NULL,
  `Area_Salud` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `clientes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Id_Cial` int NOT NULL,
  `DNI_CIF` varchar(15) NOT NULL,
  `Nombre_Razon_Social` varchar(255) NOT NULL,
  `Nombre_Cial` varchar(255) DEFAULT NULL,
  `NumeroFarmacia` varchar(255) DEFAULT NULL,
  `Direccion` varchar(255) DEFAULT NULL,
  `Poblacion` varchar(255) DEFAULT NULL,
  `CodigoPostal` varchar(8) DEFAULT NULL,
  `Movil` varchar(13) DEFAULT NULL,
  `Email` varchar(255) DEFAULT NULL,
  `TipoCliente` varchar(255) DEFAULT NULL,
  `Id_TipoCliente` int DEFAULT NULL,
  `CodPais` varchar(3) DEFAULT NULL,
  `Pais` varchar(255) DEFAULT NULL,
  `Idioma` varchar(15) DEFAULT NULL,
  `Id_Idioma` int DEFAULT NULL,
  `Moneda` varchar(4) DEFAULT NULL,
  `Id_Moneda` int DEFAULT NULL,
  `NomContacto` varchar(255) DEFAULT NULL,
  `Tarifa` int NOT NULL DEFAULT 0,
  `Id_FormaPago` int DEFAULT NULL,
  `Dto` decimal(5,2) DEFAULT 0.00,
  `CuentaContable` int DEFAULT NULL,
  `RE` decimal(5,2) DEFAULT NULL,
  `Banco` varchar(255) DEFAULT NULL,
  `Swift` varchar(255) DEFAULT NULL,
  `IBAN` varchar(34) DEFAULT NULL,
  `Modelo_347` tinyint(1) DEFAULT 1,
  `Id_Provincia` int DEFAULT NULL,
  `Id_CodigoPostal` int DEFAULT NULL,
  `Telefono` varchar(13) DEFAULT NULL,
  `Web` varchar(255) DEFAULT NULL,
  `Id_Pais` int DEFAULT NULL,
  `OK_KO` varchar(2) DEFAULT 'OK',
  `Id_EstdoCliente` int DEFAULT NULL,
  `Activo` tinyint(1) NOT NULL DEFAULT 1,
  `FechaBaja` datetime DEFAULT NULL,
  `MotivoBaja` varchar(200) DEFAULT NULL,
  `TipoContacto` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`)
);

-- clientes_contactos (sin ActivoKey/PrincipalKey GENERATED)
CREATE TABLE `clientes_contactos` (
  `Id` bigint NOT NULL AUTO_INCREMENT,
  `Id_Cliente` int NOT NULL,
  `Id_Contacto` int NOT NULL,
  `Rol` varchar(80) DEFAULT NULL,
  `Es_Principal` tinyint(1) NOT NULL DEFAULT 0,
  `Notas` text,
  `VigenteDesde` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `VigenteHasta` datetime DEFAULT NULL,
  `MotivoBaja` varchar(200) DEFAULT NULL,
  `CreadoEn` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ActualizadoEn` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id`)
);

CREATE TABLE `clientes_cooperativas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Id_Cooperativa` int NOT NULL,
  `Id_Cliente` int NOT NULL,
  `NumAsociado` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
);

-- clientes_gruposCompras (sin ActiveKey GENERATED)
CREATE TABLE `clientes_gruposCompras` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Id_Cliente` int NOT NULL,
  `Id_GrupoCompras` int NOT NULL,
  `NumSocio` varchar(50) DEFAULT NULL,
  `Observaciones` text,
  `Activa` tinyint(1) NOT NULL DEFAULT 1,
  `Fecha_Alta` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `Fecha_Baja` datetime DEFAULT NULL,
  `CreadoEn` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ActualizadoEn` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `codigos_postales` (
  `id` int NOT NULL AUTO_INCREMENT,
  `CodigoPostal` varchar(5) NOT NULL,
  `Localidad` varchar(255) NOT NULL,
  `Provincia` varchar(100) NOT NULL,
  `Id_Provincia` int DEFAULT NULL,
  `ComunidadAutonoma` varchar(100) DEFAULT NULL,
  `Latitud` decimal(10,8) DEFAULT NULL,
  `Longitud` decimal(11,8) DEFAULT NULL,
  `Activo` tinyint(1) DEFAULT 1,
  `CreadoEn` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `ActualizadoEn` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `NumClientes` int DEFAULT 0,
  PRIMARY KEY (`id`)
);

CREATE TABLE `comerciales` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Nombre` varchar(255) NOT NULL,
  `Email` varchar(255) NOT NULL,
  `DNI` varchar(9) NOT NULL,
  `Password` varchar(255) NOT NULL,
  `Roll` varchar(500) DEFAULT NULL,
  `fijo_mensual` int NOT NULL,
  `Movil` varchar(12) NOT NULL,
  `Direccion` varchar(255) DEFAULT NULL,
  `Id_CodigoPostal` int NOT NULL,
  `Poblacion` varchar(255) DEFAULT NULL,
  `CodigoPostal` varchar(7) DEFAULT NULL,
  `Id_Provincia` int NOT NULL,
  `teams_access_token` varchar(255) DEFAULT NULL,
  `teams_refresh_token` varchar(255) DEFAULT NULL,
  `teams_email` varchar(255) DEFAULT NULL,
  `teams_token_expires_at` varchar(255) DEFAULT NULL,
  `meet_access_token` varchar(255) DEFAULT NULL,
  `meet_refresh_token` varchar(255) DEFAULT NULL,
  `meet_email` varchar(255) DEFAULT NULL,
  `meet_token_expires_at` varchar(255) DEFAULT NULL,
  `plataforma_reunion_preferida` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `comerciales_codigos_postales_marcas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Id_Comercial` int NOT NULL,
  `Id_CodigoPostal` int NOT NULL,
  `Id_Marca` int NOT NULL,
  `FechaInicio` date DEFAULT NULL,
  `FechaFin` date DEFAULT NULL,
  `Activo` tinyint(1) DEFAULT 1,
  `Prioridad` int DEFAULT 0,
  `Observaciones` text,
  `CreadoPor` int DEFAULT NULL,
  `CreadoEn` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `ActualizadoEn` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `comisiones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `comercial_id` int NOT NULL,
  `mes` int NOT NULL,
  `año` int NOT NULL,
  `fijo_mensual` decimal(10,2) DEFAULT 0.00,
  `comision_ventas` decimal(10,2) DEFAULT 0.00,
  `comision_presupuesto` decimal(10,2) DEFAULT 0.00,
  `total_ventas` decimal(10,2) DEFAULT 0.00,
  `total_comision` decimal(10,2) DEFAULT 0.00,
  `estado` varchar(50) DEFAULT 'pendiente',
  `fecha_pago` date DEFAULT NULL,
  `fecha_pago_ventas` date DEFAULT NULL,
  `pagado_ventas_por` int DEFAULT NULL,
  `fecha_pago_fijo` date DEFAULT NULL,
  `pagado_fijo_por` int DEFAULT NULL,
  `observaciones` text,
  `calculado_por` int DEFAULT NULL,
  `pagado_por` int DEFAULT NULL,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `comisiones_detalle` (
  `id` int NOT NULL AUTO_INCREMENT,
  `comision_id` int NOT NULL,
  `pedido_id` int DEFAULT NULL,
  `articulo_id` int DEFAULT NULL,
  `cantidad` int DEFAULT 0,
  `importe_venta` decimal(10,2) DEFAULT 0.00,
  `porcentaje_comision` decimal(5,2) DEFAULT 0.00,
  `importe_comision` decimal(10,2) DEFAULT 0.00,
  `tipo_comision` varchar(50) DEFAULT NULL,
  `observaciones` text,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `condiciones_especiales` (
  `id` int NOT NULL AUTO_INCREMENT,
  `comercial_id` int NOT NULL,
  `articulo_id` int NOT NULL,
  `porcentaje_comision` decimal(5,2) NOT NULL,
  `descripcion` text,
  `activo` tinyint(1) DEFAULT 1,
  `fecha_inicio` date DEFAULT NULL,
  `fecha_fin` date DEFAULT NULL,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `configuraciones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `clave` varchar(255) NOT NULL,
  `valor` text,
  `descripcion` text,
  `tipo` varchar(50) DEFAULT NULL,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `config_comisiones_tipo_pedido` (
  `id` int NOT NULL AUTO_INCREMENT,
  `marca` varchar(50) NOT NULL,
  `tipo_pedido_id` int NOT NULL,
  `nombre_tipo_pedido` varchar(255) DEFAULT NULL,
  `porcentaje_comision` decimal(5,2) NOT NULL,
  `descripcion` text,
  `activo` tinyint(1) DEFAULT 1,
  `fecha_inicio` date DEFAULT NULL,
  `fecha_fin` date DEFAULT NULL,
  `año_aplicable` int DEFAULT NULL,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `config_descuento_transporte` (
  `id` int NOT NULL AUTO_INCREMENT,
  `marca` varchar(50) NOT NULL,
  `porcentaje_descuento` decimal(5,2) NOT NULL,
  `descripcion` text,
  `activo` tinyint(1) DEFAULT 1,
  `fecha_inicio` date DEFAULT NULL,
  `fecha_fin` date DEFAULT NULL,
  `año_aplicable` int DEFAULT NULL,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `config_fijo_mensual` (
  `id` int NOT NULL AUTO_INCREMENT,
  `año_limite` int NOT NULL,
  `porcentaje_minimo_ventas` decimal(5,2) NOT NULL,
  `descripcion` text,
  `activo` tinyint(1) DEFAULT 1,
  `fecha_inicio` date DEFAULT NULL,
  `fecha_fin` date DEFAULT NULL,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `config_objetivos_venta_mensual` (
  `id` int NOT NULL AUTO_INCREMENT,
  `plan` varchar(50) NOT NULL DEFAULT 'GEMAVIP',
  `año` int NOT NULL,
  `mes` int NOT NULL,
  `canal` enum('DIRECTA','MAYORISTA') NOT NULL,
  `importe_por_delegado` decimal(10,2) NOT NULL DEFAULT 0.00,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `observaciones` text,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `config_rappel_presupuesto` (
  `id` int NOT NULL AUTO_INCREMENT,
  `marca` varchar(50) NOT NULL,
  `porcentaje_rappel` decimal(5,2) NOT NULL,
  `descripcion` text,
  `activo` tinyint(1) DEFAULT 1,
  `fecha_inicio` date DEFAULT NULL,
  `fecha_fin` date DEFAULT NULL,
  `año_aplicable` int DEFAULT NULL,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `config_reparto_presupuesto_marca` (
  `id` int NOT NULL AUTO_INCREMENT,
  `plan` varchar(50) NOT NULL DEFAULT 'GEMAVIP',
  `año` int NOT NULL,
  `canal` enum('DIRECTA','MAYORISTA') NOT NULL,
  `marca` varchar(255) NOT NULL,
  `porcentaje` decimal(5,2) NOT NULL DEFAULT 0.00,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `observaciones` text,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `cooperativas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Nombre` varchar(255) NOT NULL,
  `Email` varchar(255) NOT NULL,
  `Telefono` varchar(15) DEFAULT NULL,
  `Contacto` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `descuentos_pedido` (
  `id` int NOT NULL AUTO_INCREMENT,
  `importe_desde` decimal(10,2) NOT NULL,
  `importe_hasta` decimal(10,2) DEFAULT NULL,
  `dto_pct` decimal(5,2) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `orden` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

-- direccionesEnvio (sin PrincipalKey GENERATED)
CREATE TABLE `direccionesEnvio` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Id_Cliente` int NOT NULL,
  `Id_Contacto` int DEFAULT NULL,
  `Alias` varchar(120) DEFAULT NULL,
  `Nombre_Destinatario` varchar(255) DEFAULT NULL,
  `Direccion` varchar(255) DEFAULT NULL,
  `Direccion2` varchar(255) DEFAULT NULL,
  `Poblacion` varchar(255) DEFAULT NULL,
  `CodigoPostal` varchar(12) DEFAULT NULL,
  `Id_Provincia` int DEFAULT NULL,
  `Id_CodigoPostal` int DEFAULT NULL,
  `Id_Pais` int DEFAULT NULL,
  `Pais` varchar(255) DEFAULT NULL,
  `Telefono` varchar(20) DEFAULT NULL,
  `Movil` varchar(20) DEFAULT NULL,
  `Email` varchar(255) DEFAULT NULL,
  `Observaciones` text,
  `Es_Principal` tinyint(1) NOT NULL DEFAULT 0,
  `Activa` tinyint(1) NOT NULL DEFAULT 1,
  `CreadoEn` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ActualizadoEn` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `especialidades` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Especialidad` varchar(255) DEFAULT NULL,
  `Observaciones` text,
  PRIMARY KEY (`id`)
);

CREATE TABLE `estadoComisiones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `comision_id` int NOT NULL,
  `estado` enum('Pendiente','Calculado','Pagado') NOT NULL DEFAULT 'Pendiente',
  `fecha_estado` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_por` int DEFAULT NULL,
  `notas` text,
  `creado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `estados_pedido` (
  `id` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(32) NOT NULL,
  `nombre` varchar(64) NOT NULL,
  `color` enum('ok','info','warn','danger') NOT NULL DEFAULT 'info',
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `orden` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `estados_visita` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(80) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `estdoClientes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Nombre` varchar(20) NOT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `fijos_mensuales_marca` (
  `id` int NOT NULL AUTO_INCREMENT,
  `comercial_id` int NOT NULL,
  `marca_id` int NOT NULL,
  `año` int NOT NULL DEFAULT 0,
  `mes` int NOT NULL DEFAULT 0,
  `importe` decimal(10,2) NOT NULL,
  `activo` tinyint(1) DEFAULT 1,
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_actualizacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `formas_pago` (
  `id` int NOT NULL AUTO_INCREMENT,
  `FormaPago` varchar(255) NOT NULL,
  `Dias` int NOT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `gruposCompras` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Nombre` varchar(255) NOT NULL,
  `CIF` varchar(20) DEFAULT NULL,
  `Email` varchar(255) DEFAULT NULL,
  `Telefono` varchar(20) DEFAULT NULL,
  `Contacto` varchar(255) DEFAULT NULL,
  `Direccion` varchar(255) DEFAULT NULL,
  `Poblacion` varchar(255) DEFAULT NULL,
  `CodigoPostal` varchar(12) DEFAULT NULL,
  `Provincia` varchar(255) DEFAULT NULL,
  `Pais` varchar(255) DEFAULT NULL,
  `Observaciones` text,
  `Activo` tinyint(1) NOT NULL DEFAULT 1,
  `CreadoEn` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ActualizadoEn` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `idiomas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Codigo` varchar(15) NOT NULL,
  `Nombre` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `marcas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Nombre` varchar(50) NOT NULL,
  `Activo` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `monedas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Codigo` varchar(4) NOT NULL,
  `Nombre` varchar(255) NOT NULL,
  `Simbolo` varchar(5) DEFAULT NULL,
  `CodigoNumerico` int DEFAULT NULL,
  `Bandera` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `notificaciones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tipo` varchar(64) NOT NULL DEFAULT 'asignacion_contacto',
  `id_contacto` int NOT NULL,
  `id_comercial_solicitante` int NOT NULL,
  `estado` enum('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'pendiente',
  `id_admin_resolvio` int DEFAULT NULL,
  `fecha_creacion` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_resolucion` datetime DEFAULT NULL,
  `notas` varchar(500) DEFAULT NULL,
  `id_pedido` int DEFAULT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `objetivos_marca` (
  `id` int NOT NULL AUTO_INCREMENT,
  `comercial_id` int NOT NULL,
  `marca` varchar(50) NOT NULL,
  `trimestre` int NOT NULL,
  `año` int NOT NULL,
  `objetivo` decimal(10,2) NOT NULL,
  `activo` tinyint(1) DEFAULT 1,
  `observaciones` text,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `objetivos_marca_mes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `comercial_id` int NOT NULL,
  `marca` varchar(255) NOT NULL,
  `año` int NOT NULL,
  `mes` int NOT NULL,
  `canal` enum('DIRECTA','MAYORISTA') NOT NULL,
  `objetivo` decimal(10,2) NOT NULL DEFAULT 0.00,
  `porcentaje_marca` decimal(5,2) NOT NULL DEFAULT 0.00,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `observaciones` text,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `paises` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Id_pais` varchar(3) NOT NULL,
  `Nombre_pais` varchar(500) NOT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `password_reset_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `comercial_id` int NOT NULL,
  `token` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `expires_at` timestamp NOT NULL,
  `used` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `pedidos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Id_Cial` int NOT NULL,
  `Id_Cliente` int NOT NULL,
  `Id_DireccionEnvio` int DEFAULT NULL,
  `Id_FormaPago` int NOT NULL,
  `Id_TipoPedido` int NOT NULL,
  `Id_Tarifa` int NOT NULL DEFAULT 0,
  `Serie` varchar(255) NOT NULL,
  `NumPedido` varchar(255) NOT NULL,
  `FechaPedido` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `FechaEntrega` date DEFAULT NULL,
  `EstadoPedido` varchar(255) NOT NULL,
  `TotalDescuento` decimal(10,2) DEFAULT NULL,
  `BaseImponible` decimal(10,2) NOT NULL DEFAULT 0.00,
  `TotalIva` decimal(10,2) DEFAULT NULL,
  `TotalPedido` decimal(10,2) DEFAULT NULL,
  `numero_cooperativa` varchar(255) DEFAULT NULL,
  `cooperativa_nombre` varchar(255) DEFAULT NULL,
  `Observaciones` text,
  `NumPedidoCliente` varchar(255) DEFAULT NULL,
  `Dto` decimal(5,2) DEFAULT 0.00,
  `NumAsociadoHefame` varchar(50) DEFAULT NULL,
  `EsEspecial` tinyint(1) NOT NULL DEFAULT 0,
  `EspecialEstado` varchar(16) DEFAULT NULL,
  `EspecialNotas` varchar(500) DEFAULT NULL,
  `EspecialFechaSolicitud` datetime DEFAULT NULL,
  `EspecialFechaResolucion` datetime DEFAULT NULL,
  `EspecialIdAdminResolvio` int DEFAULT NULL,
  `Id_EstadoPedido` int DEFAULT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `pedidos_articulos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Id_NumPedido` int NOT NULL,
  `Id_Articulo` int NOT NULL,
  `NumPedido` varchar(255) NOT NULL,
  `Articulo` varchar(255) NOT NULL,
  `Cantidad` int NOT NULL,
  `PVP` decimal(10,2) NOT NULL,
  `DtoLinea` decimal(5,2) DEFAULT NULL,
  `Subtotal` decimal(10,2) DEFAULT NULL,
  `DtoTotal` decimal(5,2) DEFAULT NULL,
  `IVA` decimal(5,2) DEFAULT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `prescriptores` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Id_Centro` int DEFAULT NULL,
  `Id_Especialidad` int DEFAULT NULL,
  `Nombre` varchar(255) DEFAULT NULL,
  `Apodo` varchar(255) DEFAULT NULL,
  `Telefono` varchar(255) DEFAULT NULL,
  `Email` varchar(255) DEFAULT NULL,
  `Visitado` date DEFAULT NULL,
  `Notas` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `presupuestos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `comercial_id` int NOT NULL,
  `articulo_id` int NOT NULL,
  `año` int NOT NULL,
  `mes` int NOT NULL,
  `cantidad_presupuestada` int DEFAULT 0,
  `importe_presupuestado` decimal(10,2) DEFAULT 0.00,
  `porcentaje_comision` decimal(5,2) DEFAULT 0.00,
  `activo` tinyint(1) DEFAULT 1,
  `observaciones` text,
  `creado_por` int DEFAULT NULL,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `provincias` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Nombre` varchar(100) NOT NULL,
  `Codigo` varchar(10) NOT NULL,
  `Pais` varchar(50) NOT NULL DEFAULT 'España',
  `CodigoPais` varchar(3) NOT NULL DEFAULT 'ES',
  PRIMARY KEY (`id`)
);

CREATE TABLE `rapeles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `comercial_id` int NOT NULL,
  `marca` varchar(50) NOT NULL,
  `trimestre` int NOT NULL,
  `año` int NOT NULL,
  `ventas_trimestre` decimal(10,2) DEFAULT 0.00,
  `objetivo_trimestre` decimal(10,2) DEFAULT 0.00,
  `porcentaje_cumplimiento` decimal(5,2) DEFAULT 0.00,
  `porcentaje_rapel` decimal(5,2) DEFAULT 0.00,
  `importe_rapel` decimal(10,2) DEFAULT 0.00,
  `estado` varchar(50) DEFAULT 'pendiente',
  `fecha_pago` date DEFAULT NULL,
  `observaciones` text,
  `calculado_por` int DEFAULT NULL,
  `pagado_por` int DEFAULT NULL,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `rapeles_configuracion` (
  `id` int NOT NULL AUTO_INCREMENT,
  `marca` varchar(50) NOT NULL,
  `porcentaje_cumplimiento_min` decimal(5,2) NOT NULL,
  `porcentaje_cumplimiento_max` decimal(5,2) NOT NULL,
  `porcentaje_rapel` decimal(5,2) NOT NULL,
  `activo` tinyint(1) DEFAULT 1,
  `observaciones` text,
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `rutas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Nombre` varchar(255) NOT NULL,
  `Dias_Visita` varchar(255) NOT NULL,
  `Hora_Visita` time NOT NULL,
  `Notas` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `sessions` (
  `session_id` varchar(128) NOT NULL,
  `expires` int UNSIGNED NOT NULL,
  `data` mediumtext,
  PRIMARY KEY (`session_id`)
);

CREATE TABLE `tarifasClientes` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `NombreTarifa` varchar(100) NOT NULL,
  `Activa` tinyint(1) NOT NULL DEFAULT 1,
  `FechaInicio` date DEFAULT NULL,
  `FechaFin` date DEFAULT NULL,
  `Observaciones` text,
  PRIMARY KEY (`Id`)
);

CREATE TABLE `tarifasClientes_precios` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `Id_Tarifa` int NOT NULL,
  `Id_Articulo` int NOT NULL,
  `Precio` decimal(10,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`Id`)
);

CREATE TABLE `tiposcargorol` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Nombre` varchar(120) NOT NULL,
  `Activo` tinyint(1) NOT NULL DEFAULT 1,
  `CreadoEn` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ActualizadoEn` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `tipos_clientes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Tipo` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `tipos_pedidos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Tipo` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `variables_sistema` (
  `id` int NOT NULL AUTO_INCREMENT,
  `clave` varchar(120) NOT NULL,
  `valor` text,
  `descripcion` varchar(255) DEFAULT NULL,
  `updated_by` varchar(180) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `versiones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `numero_version` varchar(50) NOT NULL,
  `version_mayor` int DEFAULT NULL,
  `version_menor` int DEFAULT NULL,
  `version_revision` int DEFAULT NULL,
  `tipo_version` varchar(50) DEFAULT NULL,
  `estable` tinyint(1) DEFAULT 0,
  `tag_github` varchar(255) DEFAULT NULL,
  `commit_hash` varchar(255) DEFAULT NULL,
  `branch_github` varchar(255) DEFAULT NULL,
  `descripcion` text,
  `notas_cambio` text,
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_despliegue` timestamp NULL DEFAULT NULL,
  `fecha_estable` timestamp NULL DEFAULT NULL,
  `creado_por` int DEFAULT NULL,
  `activa_produccion` tinyint(1) DEFAULT 0,
  `rollback_disponible` tinyint(1) DEFAULT 0,
  `url_release` varchar(500) DEFAULT NULL,
  `observaciones` text,
  PRIMARY KEY (`id`)
);

CREATE TABLE `visitas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Id_Cliente` int DEFAULT NULL,
  `id_Comercial` int NOT NULL,
  `Id_Centro_Pre` int DEFAULT NULL,
  `Id_Prescritor` int DEFAULT NULL,
  `Id_Ruta` int DEFAULT NULL,
  `Tipo_Visita` varchar(255) NOT NULL,
  `Fecha` date NOT NULL,
  `Hora` time NOT NULL,
  `Hora_Final` time NOT NULL,
  `Notas` varchar(255) DEFAULT NULL,
  `Estado_Visita` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
);

-- Relaciones (FKs) para que drawDB muestre el diagrama
ALTER TABLE `articulos` ADD CONSTRAINT `fk_articulos_marca` FOREIGN KEY (`Id_Marca`) REFERENCES `marcas` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE `centros_prescriptores` ADD CONSTRAINT `fk_centros_ruta` FOREIGN KEY (`Id_Ruta`) REFERENCES `rutas` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `clientes` ADD CONSTRAINT `fk_clientes_tipo` FOREIGN KEY (`Id_TipoCliente`) REFERENCES `tipos_clientes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `pedidos` ADD CONSTRAINT `fk_pedidos_estado` FOREIGN KEY (`Id_EstadoPedido`) REFERENCES `estados_pedido` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `pedidos` ADD CONSTRAINT `fk_pedidos_tarifa` FOREIGN KEY (`Id_Tarifa`) REFERENCES `tarifasClientes` (`Id`) ON DELETE CASCADE ON UPDATE CASCADE;
