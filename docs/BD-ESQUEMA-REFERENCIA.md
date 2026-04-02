# Esquema BD CRM Gemavip – Referencia

> Fuente: `crm_gemavip (3).sql`. Usar **nombres exactos** de tablas y columnas.

---

## Índice rápido (tabla → PK)

| Tabla | PK | Uso principal |
|-------|-----|---------------|
| `clientes` | `cli_id` | Contactos/clientes |
| `provincias` | `prov_id` | Provincias España |
| `paises` | `pais_id` | Países |
| `codigos_postales` | `codpos_id` | CP España |
| `tipos_clientes` | `tipc_id` | Farmacia, Clínica, etc. |
| `especialidades` | `esp_id` | CAP, Odontología, etc. |
| `estdoClientes` | `estcli_id` | Lead, Activo, Inactivo |
| `idiomas` | `idiom_id` | Español, Inglés, etc. |
| `monedas` | `mon_id` | EUR, USD, etc. |
| `formas_pago` | `formp_id` | Formas de pago |
| `comerciales` | `com_id` | Usuarios comerciales |
| `pedidos` | `ped_id` | Pedidos |
| `articulos` | `art_id` | Productos |
| `visitas` | `vis_id` | Visitas comerciales |

---

## Tablas principales

### `clientes`
**PK:** `cli_id`

| Columna | Tipo | Notas |
|---------|------|-------|
| `cli_id` | int | PK |
| `cli_com_id` | int | FK → comerciales |
| `cli_dni_cif` | varchar(15) | |
| `cli_nombre_razon_social` | varchar(255) | |
| `cli_nombre_cial` | varchar(255) | |
| `cli_numero_farmacia` | varchar(255) | |
| `cli_direccion` | varchar(255) | |
| `cli_poblacion` | varchar(255) | |
| `cli_codigo_postal` | varchar(8) | |
| `cli_movil` | varchar(13) | |
| `cli_email` | varchar(255) | |
| `cli_tipo_cliente_txt` | varchar(255) | |
| `cli_tipc_id` | int | FK → tipos_clientes |
| `cli_esp_id` | int | FK → especialidades |
| `cli_CodPais` | varchar(3) | Código ISO (ES, PT...) |
| `cli_Pais` | varchar(255) | Nombre texto |
| `cli_Idioma` | varchar(15) | |
| `cli_idiom_id` | int | FK → idiomas |
| `cli_Moneda` | varchar(4) | |
| `cli_mon_id` | int | FK → monedas |
| `cli_NomContacto` | varchar(255) | |
| `cli_tarifa_legacy` | int | |
| `cli_formp_id` | int | FK → formas_pago |
| `cli_dto` | decimal(5,2) | |
| `cli_CuentaContable` | int | |
| `cli_RE` | decimal(5,2) | |
| `cli_Banco` | varchar(255) | |
| `cli_Swift` | varchar(255) | |
| `cli_IBAN` | varchar(34) | |
| `cli_Modelo_347` | tinyint(1) | |
| `cli_prov_id` | int | FK → provincias |
| `cli_codp_id` | int | |
| `cli_telefono` | varchar(13) | |
| `cli_Web` | varchar(255) | |
| `cli_pais_id` | int | FK → paises |
| `cli_ok_ko` | varchar(2) | OK/KO |
| `cli_estcli_id` | int | FK → estdoClientes |
| `cli_activo` | tinyint(1) | |
| `cli_creado_holded` | datetime | |
| `cli_referencia` | varchar(255) | Compat. histórica; el vínculo canónico con Holded es `cli_Id_Holded` |
| `cli_Id_Holded` | varchar(255) | **ID contacto Holded** (`contact.id` en API). Índice único `ux_clientes_cli_Id_Holded`: como mucho una fila CRM por ID Holded (varias filas con NULL permitidas). Rutas `/clientes/:id` aceptan PK numérica o este ID. |
| `cli_holded_sync_hash` | char(64) | Hash comparación CRM↔Holded |
| `cli_holded_sync_pendiente` | tinyint(1) | Pendiente sincronizar |
| `cli_regimen` | varchar(100) | |
| `cli_ref_mandato` | varchar(100) | |
| `cli_tags` | text | |
| `cli_cuenta_ventas` | varchar(100) | |
| `cli_cuenta_compras` | varchar(100) | |
| `cli_visibilidad_portal` | varchar(50) | |
| `cli_FechaBaja` | datetime | |
| `cli_MotivoBaja` | varchar(200) | |
| `cli_tipo_contacto` | varchar(20) | Empresa, Persona, Otros |
| `cli_Id_cliente_relacionado` | int | |
| `cli_regfis_id` | int | FK → regimenes_fiscales (1=IVA, 2=IGIC, 3=IPSI) |

---

### `provincias`
**PK:** `prov_id`

| Columna | Tipo |
|---------|------|
| `prov_id` | int |
| `prov_nombre` | varchar(100) |
| `prov_codigo` | varchar(10) |
| `prov_pais` | varchar(50) |
| `prov_codigo_pais` | varchar(3) |

---

### `paises`
**PK:** `pais_id`

| Columna | Tipo |
|---------|------|
| `pais_id` | int |
| `pais_codigo` | varchar(3) |
| `pais_nombre` | varchar(500) |

---

### `codigos_postales`
**PK:** `codpos_id`

| Columna | Tipo |
|---------|------|
| `codpos_id` | int |
| `codpos_CodigoPostal` | varchar(5) |
| `codpos_Localidad` | varchar(255) |
| `codpos_Provincia` | varchar(100) |
| `codpos_Id_Provincia` | int |
| `codpos_ComunidadAutonoma` | varchar(100) |
| `codpos_Latitud` | decimal(10,8) |
| `codpos_Longitud` | decimal(11,8) |
| `codpos_Activo` | tinyint(1) |
| `codpos_CreadoEn` | timestamp |
| `codpos_ActualizadoEn` | timestamp |
| `codpos_NumClientes` | int |
| `codpos_regfis_id` | int | FK → regimenes_fiscales |

---

### `tipos_clientes`
**PK:** `tipc_id`

| Columna | Tipo |
|---------|------|
| `tipc_id` | int |
| `tipc_tipo` | varchar(255) |

---

### `especialidades`
**PK:** `esp_id`

| Columna | Tipo |
|---------|------|
| `esp_id` | int |
| `esp_nombre` | varchar(255) |
| `esp_observaciones` | text |

---

### `estdoClientes` *(nombre con typo)*
**PK:** `estcli_id`

| Columna | Tipo |
|---------|------|
| `estcli_id` | int |
| `estcli_nombre` | varchar(20) |

Valores: Lead (1), Activo (2), Inactivo (3).

---

### `idiomas`
**PK:** `idiom_id`

| Columna | Tipo |
|---------|------|
| `idiom_id` | int |
| `idiom_codigo` | varchar(15) |
| `idiom_nombre` | varchar(255) |

---

### `monedas`
**PK:** `mon_id`

| Columna | Tipo |
|---------|------|
| `mon_id` | int |
| `mon_codigo` | varchar(4) |
| `mon_nombre` | varchar(255) |
| `mon_simbolo` | varchar(5) |
| `mon_codigo_numerico` | int |
| `mon_bandera` | varchar(10) |

---

### `formas_pago`
**PK:** `formp_id`

| Columna | Tipo |
|---------|------|
| `formp_id` | int |
| `formp_nombre` | varchar(255) |

---

### `comerciales`
**PK:** `com_id`

| Columna | Tipo |
|---------|------|
| `com_id` | int |
| `com_nombre` | varchar(255) |
| `com_email` | varchar(255) |
| `com_dni` | varchar(9) |
| `com_password` | varchar(255) |
| `com_roll` | varchar(500) |
| `com_fijo_mensual` | int |
| `com_movil` | varchar(12) |
| `com_direccion` | varchar(255) |
| `com_codp_id` | int |
| `com_poblacion` | varchar(255) |
| `com_codigo_postal` | varchar(7) |
| `com_prov_id` | int |

---

### `pedidos`
**PK:** `ped_id`

| Columna | Tipo |
|---------|------|
| `ped_id` | int |
| `ped_com_id` | int |
| `ped_cli_id` | int |
| `ped_direnv_id` | int |
| `ped_formp_id` | int |
| `ped_tipp_id` | int |
| `ped_tarcli_id` | int |
| `ped_Serie` | varchar(8) |
| `ped_numero` | varchar(255) |
| `ped_fecha` | datetime |
| `ped_FechaEntrega` | date |
| `ped_estado_txt` | varchar(255) |
| `ped_estped_id` | int |
| `ped_Id_EstadoPedido` | int |
| `ped_total` | decimal(10,2) |
| `ped_base` | decimal(10,2) |
| `ped_iva` | decimal(10,2) |
| `ped_dto` | decimal(5,2) |
| `ped_descuento` | decimal(10,2) |
| `ped_id_holded` | varchar(255) |
| `ped_regfis_id` | int | FK → regimenes_fiscales (1=IVA, 2=IGIC, 3=IPSI) |

---

### `clientes_relacionados`
**PK:** `clirel_id`

| Columna | Tipo |
|---------|------|
| `clirel_id` | int |
| `clirel_cli_origen_id` | int |
| `clirel_cli_relacionado_id` | int |
| `clirel_descripcion` | varchar(255) |

---

### `estados_pedido`
**PK:** `estped_id`

| Columna | Tipo |
|---------|------|
| `estped_id` | int |
| `estped_codigo` | varchar(32) |
| `estped_nombre` | varchar(64) |
| `estped_color` | enum |
| `estped_activo` | tinyint(1) |
| `estped_orden` | int |

---

### Otras tablas (solo PK)

| Tabla | PK |
|-------|-----|
| `agenda` | `ag_id` |
| `agenda_especialidades` | `agesp_id` |
| `agenda_roles` | `agrol_id` |
| `articulos` | `art_id` |
| `centros_prescriptores` | `cent_id` |
| `clientes_contactos` | `clicont_cli_id` + `clicont_ag_id` |
| `clientes_cooperativas` | `detco_id` |
| `clientes_gruposCompras` | `detgru_id` |
| `comerciales_codigos_postales_marcas` | `comdod_id` |
| `cooperativas` | `coop_id` |
| `descuentos_pedido` | `descped_id` |
| `direccionesEnvio` | `direnv_id` |
| `estadoComisiones` | `estcomi_id` |
| `estados_visita` | `estvis_id` |
| `gruposCompras` | `grupcompr_id` |
| `marcas` | `mar_id` |
| `pedidos_articulos` | `pedart_id` |
| `tarifasClientes` | `tarcli_id` |
| `tiposcargorol` | `tipcar_id` |
| `tipos_pedidos` | `tipp_id` |
| `visitas` | `vis_id` |

---

## Convenciones

- **Prefijos:** `cli_` clientes, `prov_` provincias, `pais_` paises, `codpos_` codigos_postales, `tipc_` tipos_clientes, `esp_` especialidades, `estcli_` estdoClientes, `idiom_` idiomas, `mon_` monedas, `formp_` formas_pago, `com_` comerciales, `ped_` pedidos, `regfis_` regimenes_fiscales, `timp_` tipos_impuesto, `eqimp_` equivalencias_impuesto.
- **Tabla con typo:** `estdoClientes` (no estadoClientes).
- **Collation:** mezcla de `utf8mb4_unicode_ci` y `utf8mb4_0900_ai_ci`; usar `COLLATE utf8mb4_unicode_ci` en comparaciones si hay conflicto.

---

## Tablas fiscales

### `regimenes_fiscales`
**PK:** `regfis_id`

Regímenes de impuestos indirectos por territorio.

| Columna | Tipo | Notas |
|---------|------|-------|
| `regfis_id` | int | PK |
| `regfis_codigo` | varchar(10) | UNIQUE. 'IVA', 'IGIC', 'IPSI', 'IVA_PT' |
| `regfis_nombre` | varchar(150) | Nombre completo |
| `regfis_nombre_corto` | varchar(10) | Etiqueta para documentos: IVA, IGIC, IPSI |
| `regfis_pais_codigo` | varchar(3) | Código ISO país (ES, PT) |
| `regfis_activo` | tinyint(1) | |
| `regfis_creado_en` | datetime | |

Valores: 1=IVA (Península+Baleares), 2=IGIC (Canarias), 3=IPSI (Ceuta/Melilla), 4=IVA_PT (Portugal).

---

### `tipos_impuesto`
**PK:** `timp_id`

Tipos concretos de impuesto con porcentaje, vinculados a un régimen.

| Columna | Tipo | Notas |
|---------|------|-------|
| `timp_id` | int | PK |
| `timp_regfis_id` | int | FK → regimenes_fiscales |
| `timp_codigo` | varchar(30) | UNIQUE. Ej: 'IVA_GENERAL', 'IGIC_REDUCIDO' |
| `timp_nombre` | varchar(100) | 'IVA General 21%', 'IGIC General 7%' |
| `timp_porcentaje` | decimal(5,2) | Porcentaje del impuesto |
| `timp_es_defecto` | tinyint(1) | 1 si es el tipo por defecto del régimen |
| `timp_activo` | tinyint(1) | |

---

### `equivalencias_impuesto`
**PK:** `eqimp_id`

Mapeo entre tipos de IVA peninsular y sus equivalentes en otros regímenes.

| Columna | Tipo | Notas |
|---------|------|-------|
| `eqimp_id` | int | PK |
| `eqimp_timp_origen_id` | int | FK → tipos_impuesto (tipo IVA peninsular) |
| `eqimp_timp_destino_id` | int | FK → tipos_impuesto (tipo equivalente en otro régimen) |

Ejemplo: IVA General 21% (id=1) → IGIC General 7% (id=5).
