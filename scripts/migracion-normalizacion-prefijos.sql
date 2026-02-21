-- =============================================================================
-- MIGRACIÓN: Normalización de columnas con prefijo de tabla
-- Base: crm_gemavip
-- Convención: {prefijo}_{nombre_campo} (ver docs/NORMALIZACION-BD-PREFIJOS.md)
--
-- IMPORTANTE:
-- 1. Hacer BACKUP de la BD antes de ejecutar
-- 2. Ejecutar en ventana de mantenimiento (bajo tráfico)
-- 3. Las tablas pueden tener Id o id según entorno; cambiar en el script si falla
-- 4. Ejecutar por fases (FASE 1, luego FASE 2, luego FASE 3) y verificar entre cada una
-- 5. Si tienes FKs activas, hay que DROPearlas antes. Consultar:
--    SELECT * FROM information_schema.KEY_COLUMN_USAGE
--    WHERE TABLE_SCHEMA = 'crm_gemavip' AND REFERENCED_TABLE_NAME IS NOT NULL;
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;  -- Permite renombrar columnas referenciadas por FKs

-- =============================================================================
-- FASE 1: Catálogos (sin FKs a tablas que renombramos)
-- =============================================================================

-- provincias
ALTER TABLE `provincias` CHANGE COLUMN `id` `prov_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `provincias` DROP PRIMARY KEY, ADD PRIMARY KEY (`prov_id`);
ALTER TABLE `provincias` CHANGE COLUMN `Nombre` `prov_nombre` VARCHAR(100) NOT NULL;
ALTER TABLE `provincias` CHANGE COLUMN `Codigo` `prov_codigo` VARCHAR(10) NOT NULL;
ALTER TABLE `provincias` CHANGE COLUMN `Pais` `prov_pais` VARCHAR(50) NOT NULL DEFAULT 'España';
ALTER TABLE `provincias` CHANGE COLUMN `CodigoPais` `prov_codigo_pais` VARCHAR(3) NOT NULL DEFAULT 'ES';

-- tipos_clientes
ALTER TABLE `tipos_clientes` CHANGE COLUMN `id` `tipc_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `tipos_clientes` DROP PRIMARY KEY, ADD PRIMARY KEY (`tipc_id`);
ALTER TABLE `tipos_clientes` CHANGE COLUMN `Tipo` `tipc_tipo` VARCHAR(255) NOT NULL;

-- estdoClientes
ALTER TABLE `estdoClientes` CHANGE COLUMN `id` `estcli_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `estdoClientes` DROP PRIMARY KEY, ADD PRIMARY KEY (`estcli_id`);
ALTER TABLE `estdoClientes` CHANGE COLUMN `Nombre` `estcli_nombre` VARCHAR(20) NOT NULL;

-- marcas
ALTER TABLE `marcas` CHANGE COLUMN `id` `mar_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `marcas` DROP PRIMARY KEY, ADD PRIMARY KEY (`mar_id`);
ALTER TABLE `marcas` CHANGE COLUMN `Nombre` `mar_nombre` VARCHAR(50) NOT NULL;
ALTER TABLE `marcas` CHANGE COLUMN `Activo` `mar_activo` TINYINT(1) NOT NULL;

-- idiomas
ALTER TABLE `idiomas` CHANGE COLUMN `id` `idiom_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `idiomas` DROP PRIMARY KEY, ADD PRIMARY KEY (`idiom_id`);
ALTER TABLE `idiomas` CHANGE COLUMN `Codigo` `idiom_codigo` VARCHAR(15) NOT NULL;
ALTER TABLE `idiomas` CHANGE COLUMN `Nombre` `idiom_nombre` VARCHAR(255) NOT NULL;

-- monedas
ALTER TABLE `monedas` CHANGE COLUMN `id` `mon_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `monedas` DROP PRIMARY KEY, ADD PRIMARY KEY (`mon_id`);
ALTER TABLE `monedas` CHANGE COLUMN `Codigo` `mon_codigo` VARCHAR(4) NOT NULL;
ALTER TABLE `monedas` CHANGE COLUMN `Nombre` `mon_nombre` VARCHAR(255) NOT NULL;
ALTER TABLE `monedas` CHANGE COLUMN `Simbolo` `mon_simbolo` VARCHAR(5) DEFAULT NULL;
ALTER TABLE `monedas` CHANGE COLUMN `CodigoNumerico` `mon_codigo_numerico` INT DEFAULT NULL;
ALTER TABLE `monedas` CHANGE COLUMN `Bandera` `mon_bandera` VARCHAR(10) DEFAULT NULL;

-- paises
ALTER TABLE `paises` CHANGE COLUMN `id` `pais_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `paises` DROP PRIMARY KEY, ADD PRIMARY KEY (`pais_id`);
ALTER TABLE `paises` CHANGE COLUMN `Id_pais` `pais_codigo` VARCHAR(3) NOT NULL;
ALTER TABLE `paises` CHANGE COLUMN `Nombre_pais` `pais_nombre` VARCHAR(500) NOT NULL;

-- formas_pago
ALTER TABLE `formas_pago` CHANGE COLUMN `id` `formp_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `formas_pago` DROP PRIMARY KEY, ADD PRIMARY KEY (`formp_id`);
ALTER TABLE `formas_pago` CHANGE COLUMN `FormaPago` `formp_nombre` VARCHAR(255) NOT NULL;
ALTER TABLE `formas_pago` CHANGE COLUMN `Dias` `formp_dias` INT NOT NULL;

-- especialidades
ALTER TABLE `especialidades` CHANGE COLUMN `id` `esp_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `especialidades` DROP PRIMARY KEY, ADD PRIMARY KEY (`esp_id`);
ALTER TABLE `especialidades` CHANGE COLUMN `Especialidad` `esp_nombre` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `especialidades` CHANGE COLUMN `Observaciones` `esp_observaciones` TEXT;

-- agenda_roles
ALTER TABLE `agenda_roles` CHANGE COLUMN `id` `agrol_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `agenda_roles` DROP PRIMARY KEY, ADD PRIMARY KEY (`agrol_id`);
ALTER TABLE `agenda_roles` CHANGE COLUMN `Nombre` `agrol_nombre` VARCHAR(120) NOT NULL;
ALTER TABLE `agenda_roles` CHANGE COLUMN `Activo` `agrol_activo` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `agenda_roles` CHANGE COLUMN `CreadoEn` `agrol_creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `agenda_roles` CHANGE COLUMN `ActualizadoEn` `agrol_actualizado_en` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP;

-- agenda_especialidades
ALTER TABLE `agenda_especialidades` CHANGE COLUMN `id` `agesp_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `agenda_especialidades` DROP PRIMARY KEY, ADD PRIMARY KEY (`agesp_id`);
ALTER TABLE `agenda_especialidades` CHANGE COLUMN `Nombre` `agesp_nombre` VARCHAR(120) NOT NULL;
ALTER TABLE `agenda_especialidades` CHANGE COLUMN `Activo` `agesp_activo` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `agenda_especialidades` CHANGE COLUMN `CreadoEn` `agesp_creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `agenda_especialidades` CHANGE COLUMN `ActualizadoEn` `agesp_actualizado_en` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP;

-- tiposcargorol
ALTER TABLE `tiposcargorol` CHANGE COLUMN `id` `tipcar_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `tiposcargorol` DROP PRIMARY KEY, ADD PRIMARY KEY (`tipcar_id`);
ALTER TABLE `tiposcargorol` CHANGE COLUMN `Nombre` `tipcar_nombre` VARCHAR(120) NOT NULL;
ALTER TABLE `tiposcargorol` CHANGE COLUMN `Activo` `tipcar_activo` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `tiposcargorol` CHANGE COLUMN `CreadoEn` `tipcar_creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `tiposcargorol` CHANGE COLUMN `ActualizadoEn` `tipcar_actualizado_en` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP;

-- estados_pedido
ALTER TABLE `estados_pedido` CHANGE COLUMN `id` `estped_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `estados_pedido` DROP PRIMARY KEY, ADD PRIMARY KEY (`estped_id`);
ALTER TABLE `estados_pedido` CHANGE COLUMN `codigo` `estped_codigo` VARCHAR(32) NOT NULL;
ALTER TABLE `estados_pedido` CHANGE COLUMN `nombre` `estped_nombre` VARCHAR(64) NOT NULL;
ALTER TABLE `estados_pedido` CHANGE COLUMN `color` `estped_color` ENUM('ok','info','warn','danger') NOT NULL DEFAULT 'info';
ALTER TABLE `estados_pedido` CHANGE COLUMN `activo` `estped_activo` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `estados_pedido` CHANGE COLUMN `orden` `estped_orden` INT NOT NULL DEFAULT 0;
ALTER TABLE `estados_pedido` CHANGE COLUMN `created_at` `estped_creado_en` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `estados_pedido` CHANGE COLUMN `updated_at` `estped_actualizado_en` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- descuentos_pedido
ALTER TABLE `descuentos_pedido` CHANGE COLUMN `id` `descped_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `descuentos_pedido` DROP PRIMARY KEY, ADD PRIMARY KEY (`descped_id`);
ALTER TABLE `descuentos_pedido` CHANGE COLUMN `importe_desde` `descped_importe_desde` DECIMAL(10,2) NOT NULL;
ALTER TABLE `descuentos_pedido` CHANGE COLUMN `importe_hasta` `descped_importe_hasta` DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE `descuentos_pedido` CHANGE COLUMN `dto_pct` `descped_pct` DECIMAL(5,2) NOT NULL;
ALTER TABLE `descuentos_pedido` CHANGE COLUMN `activo` `descped_activo` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `descuentos_pedido` CHANGE COLUMN `orden` `descped_orden` INT NOT NULL DEFAULT 0;
ALTER TABLE `descuentos_pedido` CHANGE COLUMN `created_at` `descped_creado_en` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `descuentos_pedido` CHANGE COLUMN `updated_at` `descped_actualizado_en` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- tipos_pedidos
ALTER TABLE `tipos_pedidos` CHANGE COLUMN `id` `tipp_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `tipos_pedidos` DROP PRIMARY KEY, ADD PRIMARY KEY (`tipp_id`);
ALTER TABLE `tipos_pedidos` CHANGE COLUMN `Tipo` `tipp_tipo` VARCHAR(255) NOT NULL;

-- codigos_postales (si existe)
-- ALTER TABLE `codigos_postales` CHANGE COLUMN `id` `codp_id` INT NOT NULL AUTO_INCREMENT;
-- ... (añadir resto según esquema real)

-- cooperativas
ALTER TABLE `cooperativas` CHANGE COLUMN `id` `coop_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `cooperativas` DROP PRIMARY KEY, ADD PRIMARY KEY (`coop_id`);
ALTER TABLE `cooperativas` CHANGE COLUMN `Nombre` `coop_nombre` VARCHAR(255) NOT NULL;
ALTER TABLE `cooperativas` CHANGE COLUMN `Email` `coop_email` VARCHAR(255) NOT NULL;
ALTER TABLE `cooperativas` CHANGE COLUMN `Telefono` `coop_telefono` VARCHAR(15) DEFAULT NULL;
ALTER TABLE `cooperativas` CHANGE COLUMN `Contacto` `coop_contacto` VARCHAR(255) DEFAULT NULL;

-- =============================================================================
-- FASE 2: Tablas core (comerciales, articulos, tarifas, agenda, clientes)
-- Nota: Si existen FKs desde otras tablas, hay que DROPearlas antes.
-- =============================================================================

-- comerciales
ALTER TABLE `comerciales` CHANGE COLUMN `id` `com_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `comerciales` DROP PRIMARY KEY, ADD PRIMARY KEY (`com_id`);
ALTER TABLE `comerciales` CHANGE COLUMN `Nombre` `com_nombre` VARCHAR(255) NOT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Email` `com_email` VARCHAR(255) NOT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `DNI` `com_dni` VARCHAR(9) NOT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Password` `com_password` VARCHAR(255) NOT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Roll` `com_roll` VARCHAR(500) DEFAULT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Movil` `com_movil` VARCHAR(12) NOT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Direccion` `com_direccion` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Id_CodigoPostal` `com_codp_id` INT NOT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Poblacion` `com_poblacion` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `CodigoPostal` `com_codigo_postal` VARCHAR(7) DEFAULT NULL;
ALTER TABLE `comerciales` CHANGE COLUMN `Id_Provincia` `com_prov_id` INT NOT NULL;

-- articulos
ALTER TABLE `articulos` CHANGE COLUMN `id` `art_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `articulos` DROP PRIMARY KEY, ADD PRIMARY KEY (`art_id`);
ALTER TABLE `articulos` CHANGE COLUMN `SKU` `art_sku` VARCHAR(12) NOT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `Nombre` `art_nombre` VARCHAR(100) NOT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `Presentacion` `art_presentacion` VARCHAR(20) NOT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `Unidades_Caja` `art_unidades_caja` INT NOT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `PVL` `art_pvl` DECIMAL(10,2) NOT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `IVA` `art_iva` DECIMAL(4,2) NOT NULL DEFAULT 21.00;
ALTER TABLE `articulos` CHANGE COLUMN `Imagen` `art_imagen` VARCHAR(255) NOT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `Id_Marca` `art_mar_id` INT DEFAULT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `EAN13` `art_ean13` BIGINT NOT NULL;
ALTER TABLE `articulos` CHANGE COLUMN `Activo` `art_activo` TINYINT(1) NOT NULL DEFAULT 1;

-- tarifasClientes
ALTER TABLE `tarifasClientes` CHANGE COLUMN `Id` `tarcli_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `tarifasClientes` DROP PRIMARY KEY, ADD PRIMARY KEY (`tarcli_id`);
ALTER TABLE `tarifasClientes` CHANGE COLUMN `NombreTarifa` `tarcli_nombre` VARCHAR(100) NOT NULL;
ALTER TABLE `tarifasClientes` CHANGE COLUMN `Activa` `tarcli_activa` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `tarifasClientes` CHANGE COLUMN `FechaInicio` `tarcli_fecha_inicio` DATE DEFAULT NULL;
ALTER TABLE `tarifasClientes` CHANGE COLUMN `FechaFin` `tarcli_fecha_fin` DATE DEFAULT NULL;
ALTER TABLE `tarifasClientes` CHANGE COLUMN `Observaciones` `tarcli_observaciones` TEXT;

-- tarifasClientes_precios
ALTER TABLE `tarifasClientes_precios` CHANGE COLUMN `Id` `tarclip_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `tarifasClientes_precios` DROP PRIMARY KEY, ADD PRIMARY KEY (`tarclip_id`);
ALTER TABLE `tarifasClientes_precios` CHANGE COLUMN `Id_Tarifa` `tarclip_tarcli_id` INT NOT NULL;
ALTER TABLE `tarifasClientes_precios` CHANGE COLUMN `Id_Articulo` `tarclip_art_id` INT NOT NULL;
ALTER TABLE `tarifasClientes_precios` CHANGE COLUMN `Precio` `tarclip_precio` DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- agenda
ALTER TABLE `agenda` CHANGE COLUMN `Id` `ag_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `agenda` DROP PRIMARY KEY, ADD PRIMARY KEY (`ag_id`);
ALTER TABLE `agenda` CHANGE COLUMN `Nombre` `ag_nombre` VARCHAR(120) NOT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Apellidos` `ag_apellidos` VARCHAR(180) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Cargo` `ag_cargo` VARCHAR(120) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Especialidad` `ag_especialidad` VARCHAR(120) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Id_TipoCargoRol` `ag_tipcar_id` INT DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Id_Especialidad` `ag_esp_id` INT DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Empresa` `ag_empresa` VARCHAR(180) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Email` `ag_email` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Movil` `ag_movil` VARCHAR(20) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Telefono` `ag_telefono` VARCHAR(20) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Extension` `ag_extension` VARCHAR(10) DEFAULT NULL;
ALTER TABLE `agenda` CHANGE COLUMN `Notas` `ag_notas` TEXT;
ALTER TABLE `agenda` CHANGE COLUMN `Activo` `ag_activo` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `agenda` CHANGE COLUMN `CreadoEn` `ag_creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `agenda` CHANGE COLUMN `ActualizadoEn` `ag_actualizado_en` DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

-- clientes
ALTER TABLE `clientes` CHANGE COLUMN `id` `cli_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `clientes` DROP PRIMARY KEY, ADD PRIMARY KEY (`cli_id`);
ALTER TABLE `clientes` CHANGE COLUMN `Id_Cial` `cli_com_id` INT NOT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `DNI_CIF` `cli_dni_cif` VARCHAR(15) NOT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Nombre_Razon_Social` `cli_nombre_razon_social` VARCHAR(255) NOT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Nombre_Cial` `cli_nombre_cial` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `NumeroFarmacia` `cli_numero_farmacia` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Direccion` `cli_direccion` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Poblacion` `cli_poblacion` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `CodigoPostal` `cli_codigo_postal` VARCHAR(8) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Movil` `cli_movil` VARCHAR(13) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Email` `cli_email` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `TipoCliente` `cli_tipo_cliente_txt` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Id_TipoCliente` `cli_tipc_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Id_Idioma` `cli_idiom_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Id_Moneda` `cli_mon_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Tarifa` `cli_tarifa_legacy` INT NOT NULL DEFAULT 0;
ALTER TABLE `clientes` CHANGE COLUMN `Id_FormaPago` `cli_formp_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Dto` `cli_dto` DECIMAL(5,2) DEFAULT 0.00;
ALTER TABLE `clientes` CHANGE COLUMN `Id_Provincia` `cli_prov_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Id_CodigoPostal` `cli_codp_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Telefono` `cli_telefono` VARCHAR(13) DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Id_Pais` `cli_pais_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `OK_KO` `cli_ok_ko` VARCHAR(2) DEFAULT 'OK';
ALTER TABLE `clientes` CHANGE COLUMN `Id_EstdoCliente` `cli_estcli_id` INT DEFAULT NULL;
ALTER TABLE `clientes` CHANGE COLUMN `Activo` `cli_activo` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `clientes` CHANGE COLUMN `TipoContacto` `cli_tipo_contacto` VARCHAR(20) DEFAULT NULL;

-- =============================================================================
-- FASE 3: Tablas dependientes (clientes_contactos, direccionesEnvio, pedidos, etc.)
-- =============================================================================

-- clientes_contactos
ALTER TABLE `clientes_contactos` CHANGE COLUMN `Id` `clicont_id` BIGINT NOT NULL AUTO_INCREMENT;
ALTER TABLE `clientes_contactos` DROP PRIMARY KEY, ADD PRIMARY KEY (`clicont_id`);
ALTER TABLE `clientes_contactos` CHANGE COLUMN `Id_Cliente` `clicont_cli_id` INT NOT NULL;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `Id_Contacto` `clicont_ag_id` INT NOT NULL;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `Rol` `clicont_rol` VARCHAR(80) DEFAULT NULL;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `Es_Principal` `clicont_es_principal` TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `Notas` `clicont_notas` TEXT;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `VigenteDesde` `clicont_vigente_desde` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `VigenteHasta` `clicont_vigente_hasta` DATETIME DEFAULT NULL;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `MotivoBaja` `clicont_motivo_baja` VARCHAR(200) DEFAULT NULL;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `CreadoEn` `clicont_creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `clientes_contactos` CHANGE COLUMN `ActualizadoEn` `clicont_actualizado_en` DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

-- direccionesEnvio
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `id` `direnv_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `direccionesEnvio` DROP PRIMARY KEY, ADD PRIMARY KEY (`direnv_id`);
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Id_Cliente` `direnv_cli_id` INT NOT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Id_Contacto` `direnv_ag_id` INT DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Id_Provincia` `direnv_prov_id` INT DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Id_CodigoPostal` `direnv_codp_id` INT DEFAULT NULL;
ALTER TABLE `direccionesEnvio` CHANGE COLUMN `Id_Pais` `direnv_pais_id` INT DEFAULT NULL;
-- ... (resto de columnas según esquema)

-- pedidos
ALTER TABLE `pedidos` CHANGE COLUMN `id` `ped_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `pedidos` DROP PRIMARY KEY, ADD PRIMARY KEY (`ped_id`);
ALTER TABLE `pedidos` CHANGE COLUMN `Id_Cial` `ped_com_id` INT NOT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `Id_Cliente` `ped_cli_id` INT NOT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `Id_DireccionEnvio` `ped_direnv_id` INT DEFAULT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `Id_FormaPago` `ped_formp_id` INT NOT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `Id_TipoPedido` `ped_tipp_id` INT NOT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `Id_Tarifa` `ped_tarcli_id` INT NOT NULL DEFAULT 0;
ALTER TABLE `pedidos` CHANGE COLUMN `NumPedido` `ped_numero` VARCHAR(255) NOT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `FechaPedido` `ped_fecha` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `pedidos` CHANGE COLUMN `EstadoPedido` `ped_estado_txt` VARCHAR(255) NOT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `TotalPedido` `ped_total` DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `BaseImponible` `ped_base` DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE `pedidos` CHANGE COLUMN `TotalIva` `ped_iva` DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `TotalDescuento` `ped_descuento` DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE `pedidos` CHANGE COLUMN `Dto` `ped_dto` DECIMAL(5,2) DEFAULT 0.00;
ALTER TABLE `pedidos` CHANGE COLUMN `Id_EstadoPedido` `ped_estped_id` INT DEFAULT NULL;

-- pedidos_articulos
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `id` `pedart_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `pedidos_articulos` DROP PRIMARY KEY, ADD PRIMARY KEY (`pedart_id`);
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `Id_NumPedido` `pedart_ped_id` INT NOT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `Id_Articulo` `pedart_art_id` INT NOT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `NumPedido` `pedart_numero` VARCHAR(255) NOT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `Articulo` `pedart_articulo_txt` VARCHAR(255) NOT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `Cantidad` `pedart_cantidad` INT NOT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `PVP` `pedart_pvp` DECIMAL(10,2) NOT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `DtoLinea` `pedart_dto` DECIMAL(5,2) DEFAULT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `Subtotal` `pedart_subtotal` DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE `pedidos_articulos` CHANGE COLUMN `IVA` `pedart_iva` DECIMAL(5,2) DEFAULT NULL;

-- visitas
ALTER TABLE `visitas` CHANGE COLUMN `id` `vis_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `visitas` DROP PRIMARY KEY, ADD PRIMARY KEY (`vis_id`);
ALTER TABLE `visitas` CHANGE COLUMN `Id_Cliente` `vis_cli_id` INT DEFAULT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `id_Comercial` `vis_com_id` INT NOT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Id_Centro_Pre` `vis_centp_id` INT DEFAULT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Id_Prescritor` `vis_presc_id` INT DEFAULT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Id_Ruta` `vis_ruta_id` INT DEFAULT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Tipo_Visita` `vis_tipo` VARCHAR(255) NOT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Fecha` `vis_fecha` DATE NOT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Hora` `vis_hora` TIME NOT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Hora_Final` `vis_hora_final` TIME NOT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Notas` `vis_notas` VARCHAR(255) DEFAULT NULL;
ALTER TABLE `visitas` CHANGE COLUMN `Estado_Visita` `vis_estado` VARCHAR(255) NOT NULL;

-- notificaciones
ALTER TABLE `notificaciones` CHANGE COLUMN `id` `notif_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `notificaciones` DROP PRIMARY KEY, ADD PRIMARY KEY (`notif_id`);
ALTER TABLE `notificaciones` CHANGE COLUMN `id_contacto` `notif_ag_id` INT NOT NULL;
ALTER TABLE `notificaciones` CHANGE COLUMN `id_comercial_solicitante` `notif_com_id` INT NOT NULL;
ALTER TABLE `notificaciones` CHANGE COLUMN `id_admin_resolvio` `notif_com_admin_id` INT DEFAULT NULL;
ALTER TABLE `notificaciones` CHANGE COLUMN `id_pedido` `notif_ped_id` INT DEFAULT NULL;

-- password_reset_tokens
ALTER TABLE `password_reset_tokens` CHANGE COLUMN `id` `pwdres_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `password_reset_tokens` DROP PRIMARY KEY, ADD PRIMARY KEY (`pwdres_id`);
ALTER TABLE `password_reset_tokens` CHANGE COLUMN `comercial_id` `pwdres_com_id` INT NOT NULL;

-- variables_sistema
ALTER TABLE `variables_sistema` CHANGE COLUMN `id` `varsis_id` INT NOT NULL AUTO_INCREMENT;
ALTER TABLE `variables_sistema` DROP PRIMARY KEY, ADD PRIMARY KEY (`varsis_id`);

-- =============================================================================
-- Recrear FKs (ejemplo; ajustar nombres de constraint según BD)
-- =============================================================================
-- ALTER TABLE `articulos` ADD CONSTRAINT `fk_art_mar` FOREIGN KEY (`art_mar_id`) REFERENCES `marcas`(`mar_id`) ON DELETE SET NULL ON UPDATE RESTRICT;
-- ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_tipc` FOREIGN KEY (`cli_tipc_id`) REFERENCES `tipos_clientes`(`tipc_id`) ON DELETE SET NULL ON UPDATE CASCADE;
-- ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_com` FOREIGN KEY (`cli_com_id`) REFERENCES `comerciales`(`com_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
-- ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_estped` FOREIGN KEY (`ped_estped_id`) REFERENCES `estados_pedido`(`estped_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
-- ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_tarcli` FOREIGN KEY (`ped_tarcli_id`) REFERENCES `tarifasClientes`(`tarcli_id`) ON DELETE SET NULL ON UPDATE CASCADE;
-- ... etc

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- NOTA POST-MIGRACIÓN
-- Tras ejecutar este script, hay que actualizar TODO el código en:
-- - config/mysql-crm.js
-- - routes/api/*.js
-- - api/index.js
-- - config/mysql-crm-comisiones.js
-- para usar los nuevos nombres de columna.
-- =============================================================================
