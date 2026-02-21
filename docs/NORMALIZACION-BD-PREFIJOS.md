# Normalización de BD: Sistema de prefijos por tabla

## Convención

Cada columna sigue el formato: **`{prefijo_tabla}_{nombre_campo}`**

- **PK**: `{prefijo}id` (ej: `cli_id`, `ped_id`)
- **FK**: `{prefijo}_{tabla_ref}_id` (ej: en pedidos → `ped_cli_id`, `ped_com_id`)
- **Campo propio**: `{prefijo}nombre_campo` (ej: `cli_nombre_razon_social`, `ped_fecha`)

---

## Tabla de prefijos

| Tabla | Prefijo | Uso en CRM |
|-------|---------|------------|
| `agenda` | `ag_` | Contactos/agenda |
| `agenda_especialidades` | `agesp_` | Catálogo |
| `agenda_roles` | `agrol_` | Catálogo |
| `api_keys` | `apik_` | API externa |
| `articulos` | `art_` | Productos |
| `centros_prescriptores` | `centp_` | Centros |
| `clientes` | `cli_` | **Core** |
| `clientes_contactos` | `clicont_` | M:N cliente-contacto |
| `clientes_cooperativas` | `clicoop_` | Cooperativas por cliente |
| `clientes_gruposCompras` | `cligrup_` | Grupos compras |
| `codigos_postales` | `codp_` | Catálogo CP |
| `comerciales` | `com_` | **Core** |
| `comerciales_codigos_postales_marcas` | `comcp_` | Asignación |
| `comisiones` | `comis_` | Comisiones |
| `comisiones_detalle` | `comdet_` | Detalle comisiones |
| `condiciones_especiales` | `condesp_` | Config |
| `configuraciones` | `config_` | Config |
| `config_comisiones_tipo_pedido` | `cfctp_` | Config |
| `config_descuento_transporte` | `cfdt_` | Config |
| `config_fijo_mensual` | `cffm_` | Config |
| `config_objetivos_venta_mensual` | `cfovm_` | Config |
| `config_rappel_presupuesto` | `cfrp_` | Config |
| `config_reparto_presupuesto_marca` | `cfrpm_` | Config |
| `cooperativas` | `coop_` | Catálogo |
| `descuentos_pedido` | `descped_` | Descuentos |
| `direccionesEnvio` | `direnv_` | Direcciones envío |
| `especialidades` | `esp_` | Catálogo |
| `estadoComisiones` | `estcom_` | Estado comisiones |
| `estados_pedido` | `estped_` | Catálogo estados |
| `estados_visita` | `estvis_` | Catálogo |
| `estdoClientes` | `estcli_` | Estado cliente |
| `fijos_mensuales_marca` | `fijmar_` | Fijos |
| `formas_pago` | `formp_` | Catálogo |
| `gruposCompras` | `grup_` | Grupos |
| `idiomas` | `idiom_` | Catálogo |
| `marcas` | `mar_` | Catálogo |
| `monedas` | `mon_` | Catálogo |
| `notificaciones` | `notif_` | Solicitudes |
| `objetivos_marca` | `objmar_` | Objetivos |
| `objetivos_marca_mes` | `objmarm_` | Objetivos |
| `paises` | `pais_` | Catálogo |
| `password_reset_tokens` | `pwdres_` | Tokens |
| `pedidos` | `ped_` | **Core** |
| `pedidos_articulos` | `pedart_` | Líneas pedido |
| `prescriptores` | `presc_` | Prescriptores |
| `presupuestos` | `presup_` | Presupuestos |
| `provincias` | `prov_` | Catálogo |
| `rapeles` | `rap_` | Rapeles |
| `rapeles_configuracion` | `rapcfg_` | Config |
| `rutas` | `ruta_` | Rutas |
| `sessions` | `sess_` | Sesiones |
| `tarifasClientes` | `tarcli_` | Tarifas |
| `tarifasClientes_precios` | `tarclip_` | Precios por tarifa |
| `tiposcargorol` | `tipcar_` | Cargo/rol |
| `tipos_clientes` | `tipc_` | Catálogo |
| `tipos_pedidos` | `tipp_` | Catálogo |
| `variables_sistema` | `varsis_` | Config |
| `versiones` | `ver_` | Versiones |
| `visitas` | `vis_` | **Core** |

---

## Mapeo de columnas por tabla (Core CRM)

### clientes

| Actual | Normalizado |
|--------|-------------|
| `id` / `Id` | `cli_id` |
| `Id_Cial` | `cli_com_id` |
| `DNI_CIF` | `cli_dni_cif` |
| `Nombre_Razon_Social` | `cli_nombre_razon_social` |
| `Nombre_Cial` | `cli_nombre_cial` |
| `Id_TipoCliente` | `cli_tipc_id` |
| `Id_Provincia` | `cli_prov_id` |
| `Id_Tarifa` | `cli_tarcli_id` |
| `Id_FormaPago` | `cli_formp_id` |
| `Id_Idioma` | `cli_idiom_id` |
| `Id_Moneda` | `cli_mon_id` |
| `Id_EstdoCliente` | `cli_estcli_id` |
| `Id_CodigoPostal` | `cli_codp_id` |
| `Id_Pais` | `cli_pais_id` |
| `...` | `cli_...` |

### comerciales

| Actual | Normalizado |
|--------|-------------|
| `id` / `Id` | `com_id` |
| `Id_CodigoPostal` | `com_codp_id` |
| `Id_Provincia` | `com_prov_id` |
| `Nombre` | `com_nombre` |
| `Email` | `com_email` |
| `Password` | `com_password` |
| `Roll` | `com_roll` |
| `...` | `com_...` |

### pedidos

| Actual | Normalizado |
|--------|-------------|
| `id` / `Id` | `ped_id` |
| `Id_Cial` | `ped_com_id` |
| `Id_Cliente` | `ped_cli_id` |
| `Id_DireccionEnvio` | `ped_direnv_id` |
| `Id_FormaPago` | `ped_formp_id` |
| `Id_TipoPedido` | `ped_tipp_id` |
| `Id_Tarifa` | `ped_tarcli_id` |
| `Id_EstadoPedido` | `ped_estped_id` |
| `NumPedido` | `ped_numero` |
| `FechaPedido` | `ped_fecha` |
| `TotalPedido` | `ped_total` |
| `BaseImponible` | `ped_base` |
| `TotalIva` | `ped_iva` |
| `...` | `ped_...` |

### pedidos_articulos

| Actual | Normalizado |
|--------|-------------|
| `id` / `Id` | `pedart_id` |
| `Id_NumPedido` | `pedart_ped_id` |
| `Id_Articulo` | `pedart_art_id` |
| `NumPedido` | `pedart_numero` |
| `Cantidad` | `pedart_cantidad` |
| `PVP` | `pedart_pvp` |
| `...` | `pedart_...` |

### visitas

| Actual | Normalizado |
|--------|-------------|
| `id` / `Id` | `vis_id` |
| `Id_Cliente` | `vis_cli_id` |
| `id_Comercial` / `Id_Cial` | `vis_com_id` |
| `Id_Centro_Pre` | `vis_centp_id` |
| `Id_Prescritor` | `vis_presc_id` |
| `Id_Ruta` | `vis_ruta_id` |
| `Tipo_Visita` | `vis_tipo` |
| `Fecha` | `vis_fecha` |
| `Hora` | `vis_hora` |
| `Hora_Final` | `vis_hora_final` |
| `Estado_Visita` | `vis_estado` |
| `...` | `vis_...` |

### agenda

| Actual | Normalizado |
|--------|-------------|
| `Id` | `ag_id` |
| `Id_TipoCargoRol` | `ag_tipcar_id` |
| `Id_Especialidad` | `ag_esp_id` |
| `Nombre` | `ag_nombre` |
| `Apellidos` | `ag_apellidos` |
| `Cargo` | `ag_cargo` |
| `Empresa` | `ag_empresa` |
| `Email` | `ag_email` |
| `...` | `ag_...` |

### clientes_contactos

| Actual | Normalizado |
|--------|-------------|
| `Id` | `clicont_id` |
| `Id_Cliente` | `clicont_cli_id` |
| `Id_Contacto` | `clicont_ag_id` |
| `Rol` | `clicont_rol` |
| `Es_Principal` | `clicont_es_principal` |
| `...` | `clicont_...` |

### direccionesEnvio

| Actual | Normalizado |
|--------|-------------|
| `id` / `Id` | `direnv_id` |
| `Id_Cliente` | `direnv_cli_id` |
| `Id_Contacto` | `direnv_ag_id` |
| `Id_Provincia` | `direnv_prov_id` |
| `Id_CodigoPostal` | `direnv_codp_id` |
| `Id_Pais` | `direnv_pais_id` |
| `...` | `direnv_...` |

---

## Orden de ejecución de la migración

1. **Fase 1**: Catálogos sin FKs a tablas core (provincias, tipos_clientes, estdoClientes, marcas, idiomas, monedas, paises, formas_pago, especialidades, agenda_roles, agenda_especialidades, tiposcargorol, estados_pedido, descuentos_pedido, codigos_postales, cooperativas, tipos_pedidos)

2. **Fase 2**: Tablas core (comerciales, articulos, tarifasClientes, tarifasClientes_precios, agenda, clientes)

3. **Fase 3**: Tablas que dependen de core (clientes_contactos, direccionesEnvio, pedidos, pedidos_articulos, visitas, notificaciones, password_reset_tokens, variables_sistema, api_keys)

---

## Uso en código

Tras la migración, el código en `mysql-crm.js` y rutas debe usar los nuevos nombres. Ejemplo:

```sql
-- Antes
SELECT c.Id, c.Nombre_Razon_Social, c.Id_Cial
FROM clientes c
LEFT JOIN comerciales co ON co.id = c.Id_Cial
WHERE c.Id_Provincia = ?

-- Después
SELECT c.cli_id, c.cli_nombre_razon_social, c.cli_com_id
FROM clientes c
LEFT JOIN comerciales co ON co.com_id = c.cli_com_id
WHERE c.cli_prov_id = ?
```
