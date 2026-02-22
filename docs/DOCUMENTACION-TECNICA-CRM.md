# Documentación técnica del CRM Gemavip

**Versión:** 1.0  
**Fecha:** Febrero 2025  
**Propósito:** Permitir a un programador ajeno al sistema entender la lógica, la base de datos y la arquitectura para poder gestionar y mantener el CRM.

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Estructura del proyecto](#3-estructura-del-proyecto)
4. [Configuración y variables de entorno](#4-configuración-y-variables-de-entorno)
5. [Base de datos](#5-base-de-datos)
6. [Lógica de negocio](#6-lógica-de-negocio)
7. [Rutas web y API REST](#7-rutas-web-y-api-rest)
8. [Arquitectura modular](#8-arquitectura-modular)
9. [Guía rápida para gestión](#9-guía-rápida-para-gestión)

---

## 1. Resumen ejecutivo

El **CRM Gemavip** es un sistema de gestión de relaciones con clientes para comerciales de Farmadescaso 2021 SL. Gestiona:

- **Clientes** (farmacias, mayoristas, etc.) asignados a comerciales
- **Contactos** (agenda) vinculados a clientes
- **Pedidos** con líneas de artículos, tarifas y descuentos
- **Visitas** comerciales (presenciales, telefónicas, online)
- **Artículos** (productos con SKU, precios, marcas)
- **Comisiones** y presupuestos
- **Notificaciones** de asignación de contactos

**Roles:** Administrador (acceso total) y Comercial (solo sus propios recursos).

---

## 2. Stack tecnológico

| Categoría | Tecnología |
|-----------|------------|
| **Runtime** | Node.js >= 18 |
| **Framework** | Express 4.18 |
| **Motor de vistas** | EJS 3.1 |
| **Base de datos** | MySQL (driver mysql2) |
| **Sesiones** | express-session + express-mysql-session |
| **Autenticación** | bcryptjs, jsonwebtoken |
| **Validación** | express-validator |
| **Documentación API** | swagger-jsdoc, swagger-ui-express |
| **Email** | nodemailer, googleapis (OAuth2) |
| **Excel** | exceljs, xlsx |
| **PDF** | pdf-parse |
| **Despliegue** | Vercel |
| **Legacy** | PHP (api/*.php para leads) |

---

## 3. Estructura del proyecto

```
CRM_Gemavip/
├── api/
│   ├── index.js              # Punto de entrada Express (app principal)
│   ├── get-lead.php          # API PHP legacy (leads)
│   ├── new-lead.php
│   └── update-lead.php
├── config/
│   ├── mysql-crm.js          # Clase MySQLCRM (acceso BD, facade)
│   ├── mysql-crm-agenda.js
│   ├── mysql-crm-articulos.js
│   ├── mysql-crm-clientes.js
│   ├── mysql-crm-comerciales.js
│   ├── mysql-crm-comisiones.js
│   ├── mysql-crm-login.js
│   ├── mysql-crm-pedidos.js
│   ├── mysql-crm-pedidos-crud.js
│   ├── mysql-crm-pedidos-with-lineas.js
│   ├── mysql-crm-visitas.js
│   ├── swagger.js
│   ├── domains/              # Dominios por entidad
│   ├── estados-visita.json
│   └── tipos-visita.json
├── lib/
│   ├── auth.js               # Autenticación y roles
│   ├── mailer.js             # SMTP / Microsoft Graph
│   ├── pagination.js
│   └── utils.js
├── public/
│   ├── assets/
│   ├── images/
│   └── scripts/
├── routes/
│   ├── api/                  # API REST
│   └── public/               # Rutas públicas (registro visitas)
├── scripts/                  # Migraciones SQL
│   ├── migracion-paso-a-paso/
│   ├── 32-ADD-FKs-completas.sql
│   └── crm_gemavip-schema-drawdb.sql
├── views/                    # Plantillas EJS
├── docs/
├── .env.example
├── package.json
└── vercel.json
```

---

## 4. Configuración y variables de entorno

Copiar `.env.example` a `.env` y configurar:

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `NODE_ENV` | Entorno | `development` / `production` |
| `DB_HOST` | Host MySQL | `localhost` |
| `DB_PORT` | Puerto MySQL | `3306` |
| `DB_USER` | Usuario BD | `root` |
| `DB_PASSWORD` | Contraseña BD | (vacío en dev) |
| `DB_NAME` | Nombre BD | `crm_gemavip` |
| `DB_SSL` | SSL para BD | `false` |
| `API_KEY` | Clave API (opcional) | - |
| `SESSION_SECRET` | Secreto sesión | (string aleatorio) |
| `SESSION_IDLE_TIMEOUT_MINUTES` | Cierre por inactividad | `60` |
| `SESSION_MAX_AGE_DAYS` | Edad máxima sesión | `30` |
| `N8N_PEDIDOS_WEBHOOK_URL` | Webhook N8N pedidos | URL |
| `PEDIDOS_MAIL_TO` | Email destino pedidos | `p.lara@gemavip.com` |
| `N8N_PEDIDOS_ENABLED` | Activar envío N8N | `0` / `1` |

---

## 5. Base de datos

### 5.1 Conexión

- **Driver:** `mysql2/promise` (pool de conexiones)
- **Pool:** `connectionLimit: 10`, `charset: utf8mb4`, `connectTimeout: 10000`
- **Sin ORM:** SQL directo vía clase `MySQLCRM` en `config/mysql-crm.js`

### 5.2 Convención de prefijos (normalización)

Cada columna sigue: **`{prefijo_tabla}_{nombre_campo}`**

- **PK:** `{prefijo}id` (ej: `cli_id`, `ped_id`)
- **FK:** `{prefijo}_{tabla_ref}_id` (ej: `ped_cli_id`, `ped_com_id`)
- **Campo propio:** `{prefijo}nombre_campo` (ej: `cli_nombre_razon_social`)

**Nota:** La BD puede tener aún nombres legacy (`Id_Cial`, `Id_Cliente`, etc.). El código usa `_pickCIFromColumns` para resolver ambos estilos. Ver `docs/NORMALIZACION-BD-PREFIJOS.md`.

### 5.3 Tablas principales (core)

| Tabla | Prefijo | Descripción |
|-------|---------|-------------|
| `clientes` | `cli_` | Clientes (farmacias, mayoristas) |
| `comerciales` | `com_` | Usuarios comerciales |
| `pedidos` | `ped_` | Pedidos |
| `pedidos_articulos` | `pedart_` | Líneas de pedido |
| `visitas` | `vis_` | Visitas comerciales |
| `agenda` | `ag_` | Contactos |
| `articulos` | `art_` | Productos |

### 5.4 Tablas de catálogo

| Tabla | Descripción |
|-------|-------------|
| `provincias` | Provincias |
| `paises` | Países |
| `idiomas` | Idiomas |
| `monedas` | Monedas |
| `formas_pago` | Formas de pago |
| `tipos_clientes` | Tipos de cliente |
| `estdoClientes` | Estado cliente (OK/KO, etc.) |
| `tipos_pedidos` | Tipos de pedido |
| `estados_pedido` | Estados de pedido (Pendiente, Enviado, Pagado, etc.) |
| `marcas` | Marcas de artículos |
| `especialidades` | Especialidades (agenda) |
| `tiposcargorol` | Cargos/roles (agenda) |
| `agenda_especialidades`, `agenda_roles` | Catálogos agenda |
| `estados_visita` | Estados de visita |
| `descuentos_pedido` | Descuentos por importe |
| `tarifasClientes`, `tarifasClientes_precios` | Tarifas y precios |

### 5.5 Tablas de relación y soporte

| Tabla | Descripción |
|-------|-------------|
| `clientes_contactos` | M:N cliente–contacto (agenda) |
| `direccionesEnvio` | Direcciones de envío por cliente |
| `notificaciones` | Solicitudes de asignación de contacto |
| `password_reset_tokens` | Tokens recuperación contraseña |
| `variables_sistema` | Configuración clave-valor |
| `sessions` | Sesiones web (express-mysql-session) |
| `api_keys` | Claves API externa |
| `comisiones`, `comisiones_detalle` | Comisiones comerciales |
| `presupuestos`, `rapeles` | Presupuestos y ráppeles |
| `cooperativas`, `gruposCompras` | Cooperativas y grupos de compra |
| `clientes_cooperativas`, `clientes_gruposCompras` | Relaciones cliente–cooperativa/grupo |

### 5.6 Relaciones y claves foráneas

> **Nota:** Las columnas pueden tener nombres legacy (`Id_Cial`, `Id_Cliente`) o normalizados (`cli_com_id`, `ped_cli_id`). El código resuelve ambos con `_pickCIFromColumns`.

#### Resumen por tabla

| Tabla | FK | Referencia | ON DELETE |
|-------|----|------------|-----------|
| **clientes** | cli_com_id | comerciales(com_id) | RESTRICT |
| **clientes** | cli_tipc_id | tipos_clientes(tipc_id) | SET NULL |
| **clientes** | cli_prov_id | provincias(prov_id) | SET NULL |
| **clientes** | cli_pais_id | paises(pais_id) | SET NULL |
| **clientes** | cli_estcli_id | estdoClientes(estcli_id) | SET NULL |
| **clientes** | cli_formp_id | formas_pago(formp_id) | SET NULL |
| **clientes** | cli_idiom_id | idiomas(idiom_id) | SET NULL |
| **clientes** | cli_mon_id | monedas(mon_id) | SET NULL |
| **pedidos** | ped_com_id | comerciales(com_id) | RESTRICT |
| **pedidos** | ped_cli_id | clientes(cli_id) | RESTRICT |
| **pedidos** | ped_direnv_id | direccionesEnvio(direnv_id) | SET NULL |
| **pedidos** | ped_formp_id | formas_pago(formp_id) | RESTRICT |
| **pedidos** | ped_tipp_id | tipos_pedidos(tipp_id) | RESTRICT |
| **pedidos** | ped_estped_id | estados_pedido(estped_id) | SET NULL |
| **pedidos** | ped_tarcli_id | tarifasClientes(tarcli_id) | SET NULL |
| **pedidos_articulos** | pedart_ped_id | pedidos(ped_id) | **CASCADE** |
| **pedidos_articulos** | pedart_art_id | articulos(art_id) | RESTRICT |
| **agenda** | ag_tipcar_id | tiposcargorol(tipcar_id) | SET NULL |
| **agenda** | ag_esp_id | especialidades(esp_id) | SET NULL |
| **clientes_contactos** | clicont_cli_id | clientes(cli_id) | **CASCADE** |
| **clientes_contactos** | clicont_ag_id | agenda(ag_id) | **CASCADE** |
| **direccionesEnvio** | direnv_cli_id | clientes(cli_id) | **CASCADE** |
| **direccionesEnvio** | direnv_ag_id | agenda(ag_id) | SET NULL |
| **direccionesEnvio** | direnv_prov_id | provincias(prov_id) | SET NULL |
| **visitas** | vis_cli_id | clientes(cli_id) | SET NULL |
| **visitas** | vis_com_id | comerciales(com_id) | RESTRICT |
| **notificaciones** | notif_ag_id | agenda(ag_id) | RESTRICT |
| **notificaciones** | notif_com_id | comerciales(com_id) | RESTRICT |
| **notificaciones** | notif_ped_id | pedidos(ped_id) | SET NULL |
| **articulos** | art_mar_id | marcas(mar_id) | SET NULL |
| **centros_prescriptores** | Id_Ruta | rutas(id) | RESTRICT |

#### Definiciones SQL de claves foráneas

Scripts: `scripts/31-ADD-FKs.sql` (catálogos) + `scripts/32-ADD-FKs-completas.sql` (core).

```sql
-- 31-ADD-FKs.sql (requiere tablas con prefijos normalizados)
ALTER TABLE `articulos` ADD CONSTRAINT `fk_art_mar`
  FOREIGN KEY (`art_mar_id`) REFERENCES `marcas`(`mar_id`) ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_tipc`
  FOREIGN KEY (`cli_tipc_id`) REFERENCES `tipos_clientes`(`tipc_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_estped`
  FOREIGN KEY (`ped_estped_id`) REFERENCES `estados_pedido`(`estped_id`) ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_tarcli`
  FOREIGN KEY (`ped_tarcli_id`) REFERENCES `tarifasClientes`(`tarcli_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 32-ADD-FKs-completas.sql
ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_com`
  FOREIGN KEY (`cli_com_id`) REFERENCES `comerciales`(`com_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_prov`
  FOREIGN KEY (`cli_prov_id`) REFERENCES `provincias`(`prov_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_pais`
  FOREIGN KEY (`cli_pais_id`) REFERENCES `paises`(`pais_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_estcli`
  FOREIGN KEY (`cli_estcli_id`) REFERENCES `estdoClientes`(`estcli_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_formp`
  FOREIGN KEY (`cli_formp_id`) REFERENCES `formas_pago`(`formp_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_idiom`
  FOREIGN KEY (`cli_idiom_id`) REFERENCES `idiomas`(`idiom_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `clientes` ADD CONSTRAINT `fk_cli_mon`
  FOREIGN KEY (`cli_mon_id`) REFERENCES `monedas`(`mon_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_com`
  FOREIGN KEY (`ped_com_id`) REFERENCES `comerciales`(`com_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_cli`
  FOREIGN KEY (`ped_cli_id`) REFERENCES `clientes`(`cli_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_direnv`
  FOREIGN KEY (`ped_direnv_id`) REFERENCES `direccionesEnvio`(`direnv_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_formp`
  FOREIGN KEY (`ped_formp_id`) REFERENCES `formas_pago`(`formp_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_tipp`
  FOREIGN KEY (`ped_tipp_id`) REFERENCES `tipos_pedidos`(`tipp_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `pedidos_articulos` ADD CONSTRAINT `fk_pedart_ped`
  FOREIGN KEY (`pedart_ped_id`) REFERENCES `pedidos`(`ped_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `pedidos_articulos` ADD CONSTRAINT `fk_pedart_art`
  FOREIGN KEY (`pedart_art_id`) REFERENCES `articulos`(`art_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `agenda` ADD CONSTRAINT `fk_ag_tipcar`
  FOREIGN KEY (`ag_tipcar_id`) REFERENCES `tiposcargorol`(`tipcar_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `agenda` ADD CONSTRAINT `fk_ag_esp`
  FOREIGN KEY (`ag_esp_id`) REFERENCES `especialidades`(`esp_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `clientes_contactos` ADD CONSTRAINT `fk_clicont_cli`
  FOREIGN KEY (`clicont_cli_id`) REFERENCES `clientes`(`cli_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `clientes_contactos` ADD CONSTRAINT `fk_clicont_ag`
  FOREIGN KEY (`clicont_ag_id`) REFERENCES `agenda`(`ag_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `direccionesEnvio` ADD CONSTRAINT `fk_direnv_cli`
  FOREIGN KEY (`direnv_cli_id`) REFERENCES `clientes`(`cli_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `direccionesEnvio` ADD CONSTRAINT `fk_direnv_ag`
  FOREIGN KEY (`direnv_ag_id`) REFERENCES `agenda`(`ag_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `direccionesEnvio` ADD CONSTRAINT `fk_direnv_prov`
  FOREIGN KEY (`direnv_prov_id`) REFERENCES `provincias`(`prov_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `visitas` ADD CONSTRAINT `fk_vis_cli`
  FOREIGN KEY (`vis_cli_id`) REFERENCES `clientes`(`cli_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `visitas` ADD CONSTRAINT `fk_vis_com`
  FOREIGN KEY (`vis_com_id`) REFERENCES `comerciales`(`com_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `notificaciones` ADD CONSTRAINT `fk_notif_ag`
  FOREIGN KEY (`notif_ag_id`) REFERENCES `agenda`(`ag_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `notificaciones` ADD CONSTRAINT `fk_notif_com`
  FOREIGN KEY (`notif_com_id`) REFERENCES `comerciales`(`com_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `notificaciones` ADD CONSTRAINT `fk_notif_ped`
  FOREIGN KEY (`notif_ped_id`) REFERENCES `pedidos`(`ped_id`) ON DELETE SET NULL ON UPDATE CASCADE;
```

### 5.7 Índices

Los índices se crean dinámicamente al arrancar (métodos `ensure*Indexes`). Endpoint `/api/db/ensure-indexes` (admin) los recrea. Las columnas pueden variar según esquema legacy vs normalizado.

#### Clientes (`config/mysql-crm-clientes.js`)

```sql
CREATE INDEX `idx_clientes_provincia` ON `clientes` (`cli_prov_id`);  -- o Id_Provincia
CREATE INDEX `idx_clientes_tipocliente` ON `clientes` (`cli_tipc_id`);  -- o Id_TipoCliente
CREATE INDEX `idx_clientes_comercial` ON `clientes` (`Id_Cial`);  -- o cli_com_id
CREATE INDEX `idx_clientes_estado_cliente` ON `clientes` (`Id_EstdoCliente`);  -- o cli_estcli_id
CREATE INDEX `idx_clientes_cp` ON `clientes` (`CodigoPostal`);  -- o cli_codigo_postal
CREATE INDEX `idx_clientes_poblacion` ON `clientes` (`Poblacion`);  -- o cli_poblacion
CREATE INDEX `idx_clientes_nombre` ON `clientes` (`Nombre_Razon_Social`);  -- o cli_nombre_razon_social
CREATE FULLTEXT INDEX `ft_clientes_busqueda` ON `clientes` (Nombre_Razon_Social, Nombre_Cial, DNI_CIF, Email, Telefono, Movil, Poblacion, CodigoPostal, ...);
CREATE FULLTEXT INDEX `ft_clientes_busqueda_basica` ON `clientes` (Nombre_Razon_Social, Nombre_Cial, DNI_CIF);
```

#### Pedidos (`config/mysql-crm-pedidos.js`)

```sql
CREATE INDEX `idx_pedidos_cliente` ON `pedidos` (`Id_Cliente`);  -- o ped_cli_id
CREATE INDEX `idx_pedidos_comercial` ON `pedidos` (`Id_Cial`);  -- o ped_com_id
CREATE INDEX `idx_pedidos_fecha` ON `pedidos` (`FechaPedido`);  -- o ped_fecha
CREATE INDEX `idx_pedidos_cliente_fecha` ON `pedidos` (Id_Cliente, FechaPedido);
CREATE INDEX `idx_pedidos_comercial_fecha` ON `pedidos` (Id_Cial, FechaPedido);
CREATE INDEX `idx_pedidos_num_pedido` ON `pedidos` (`NumPedido`);  -- o ped_numero
CREATE INDEX `idx_pedidos_estado_pedido` ON `pedidos` (`Id_EstadoPedido`);
```

#### Pedidos_articulos (`config/mysql-crm-pedidos.js`)

```sql
CREATE INDEX `idx_pedidos_articulos_num_pedido` ON `pedidos_articulos` (`NumPedido`);
CREATE INDEX `idx_pedidos_articulos_pedido_id` ON `pedidos_articulos` (`Id_NumPedido`);  -- o pedart_ped_id
CREATE INDEX `idx_pedidos_articulos_id_num_pedido` ON `pedidos_articulos` (Id_NumPedido);
CREATE INDEX `idx_pedidos_articulos_articulo` ON `pedidos_articulos` (`Id_Articulo`);  -- o pedart_art_id
CREATE INDEX `idx_pedidos_articulos_num_articulo` ON `pedidos_articulos` (NumPedido, Id_Articulo);
```

#### Visitas (`config/mysql-crm-visitas.js`)

```sql
CREATE INDEX `idx_visitas_fecha` ON `visitas` (`Fecha`);  -- o vis_fecha
CREATE INDEX `idx_visitas_comercial` ON `visitas` (`id_Comercial`);  -- o Id_Comercial, vis_com_id
CREATE INDEX `idx_visitas_cliente` ON `visitas` (`Id_Cliente`);  -- o vis_cli_id
CREATE INDEX `idx_visitas_comercial_fecha` ON `visitas` (id_Comercial, Fecha);
CREATE INDEX `idx_visitas_id_comercial` ON `visitas` (`Id_Comercial`);
CREATE INDEX `idx_visitas_id_comercial_fecha` ON `visitas` (Id_Comercial, Fecha);
```

#### Agenda / contactos (`config/mysql-crm-agenda.js`)

```sql
CREATE INDEX `idx_agenda_activo_apellidos_nombre` ON `agenda` (`Activo`, `Apellidos`, `Nombre`);
CREATE FULLTEXT INDEX `ft_agenda_busqueda` ON `agenda` (Nombre, Apellidos, Empresa, Email, Movil, Telefono);
CREATE INDEX `idx_especialidades_especialidad` ON `especialidades` (`Especialidad`);
CREATE UNIQUE INDEX `ux_especialidades_especialidad` ON `especialidades` (`Especialidad`);
```

#### Clientes_contactos (en `ensureContactosIndexes` / domains)

```sql
CREATE INDEX `idx_clientes_contactos_cliente` ON `clientes_contactos` (`Id_Cliente`);  -- o clicont_cli_id
CREATE INDEX `idx_clientes_contactos_contacto` ON `clientes_contactos` (`Id_Contacto`);  -- o clicont_ag_id
```

#### Agenda catálogos (`scripts/agenda-catalogos-relacionales.sql`)

```sql
CREATE INDEX `idx_agenda_tipo_cargo_rol` ON `agenda` (`Id_TipoCargoRol`);
CREATE INDEX `idx_agenda_especialidad` ON `agenda` (`Id_Especialidad`);
```

#### DireccionesEnvio (`config/mysql-crm.js`)

```sql
CREATE INDEX `idx_direnvio_cliente` ON `direccionesEnvio` (`Id_Cliente`);  -- o direnv_cli_id
CREATE INDEX `idx_direnvio_cliente_activa` ON `direccionesEnvio` (Id_Cliente, Activa);
CREATE INDEX `idx_direnvio_cliente_activa_principal` ON `direccionesEnvio` (Id_Cliente, Activa, Es_Principal);
```

#### Descuentos_pedido (`scripts/crear-tabla-descuentos-pedido.sql`)

```sql
CREATE INDEX `idx_desc_pedido_activo_orden` ON `descuentos_pedido` (`activo`, `orden`, `importe_desde`);
```

#### Tiposcargorol (creada con la tabla)

```sql
UNIQUE KEY `ux_tiposcargorol_nombre` (`Nombre`);
KEY `idx_tiposcargorol_activo_nombre` (`Activo`, `Nombre`);
```

### 5.8 Migraciones

- **Carpeta:** `scripts/migracion-paso-a-paso/` (00–32)
- **Orden:** 00-DROP-FKs → catálogos → tablas core → 31-ADD-FKs → 32-ADD-FKs-completas
- **Importante:** Antes de 32, ejecutar `diagnostico-integridad-fks.sql` y corregir huérfanos (registros con FK apuntando a filas inexistentes).
- **Esquema drawDB:** `scripts/crm_gemavip-schema-drawdb.sql` (para diagramas)

---

## 6. Lógica de negocio

### 6.1 Autenticación y roles

- **Tabla:** `comerciales`
- **Campo rol:** `Roll` (JSON array, string separado por comas, o valor único)
- **Administrador:** si `Roll` contiene "admin" (case-insensitive)
- **Comercial:** resto de usuarios

**Implementación:** `lib/auth.js` — `isAdminUser()`, `requireLogin`, `normalizeRoles`, `createLoadPedidoAndCheckOwner`.

### 6.2 Permisos por rol

| Recurso | Comercial | Administrador |
|---------|-----------|---------------|
| Clientes | Solo los suyos (Id_Cial) | Todos |
| Pedidos | Solo los suyos; editar solo "Pendiente" | Todos; editar cualquier estado salvo "Pagado" |
| Visitas | Solo las suyas | Todas |
| Artículos | Solo lectura | CRUD completo |
| Comerciales | Sin acceso (403) | CRUD |
| API Docs | Sin acceso (403) | Acceso |
| Descuentos, Variables, Webhooks | Sin acceso | Acceso |

### 6.3 Flujos principales

#### Clientes

- Asignación a comercial (`Id_Cial` / `cli_com_id`)
- Contactos vía `clientes_contactos` (M:N con `agenda`)
- Direcciones de envío en `direccionesEnvio`
- Tarifa por cliente (`Id_Tarifa` / `Tarifa`)

#### Pedidos

- Estados: Pendiente, Enviado, Pagado, etc. (`estados_pedido`)
- Líneas en `pedidos_articulos` (artículo, cantidad, PVP, descuentos)
- Descuentos por tramo de importe (`descuentos_pedido`)
- Exportación Excel, plantilla Hefame
- Envío por email y/o webhook N8N

#### Visitas

- Tipos: Presencial, Teléfono, Online, Formación, Seguimiento (`config/tipos-visita.json`)
- Estados: Planificada, Realizada, Cancelada, Pospuesta, Pendiente (`config/estados-visita.json`)
- Vinculadas a cliente y comercial

#### Notificaciones

- Tipo: `asignacion_contacto`
- Flujo: comercial solicita asignar contacto a cliente → admin aprueba/rechaza
- Estados: pendiente, aprobada, rechazada

#### Recuperación de contraseña

- Token en `password_reset_tokens`
- Email vía SMTP o Microsoft Graph (`lib/mailer.js`)

### 6.4 Integraciones

- **Email:** nodemailer (SMTP) o Microsoft Graph (OAuth2)
- **N8N:** webhook para pedidos (`N8N_PEDIDOS_WEBHOOK_URL`)
- **PHP legacy:** `api/get-lead.php`, `new-lead.php`, `update-lead.php` sobre tabla `clientes`

---

## 7. Rutas web y API REST

### 7.1 Rutas web (HTML)

| Ruta | Método | Descripción |
|------|--------|-------------|
| `/` | GET | Home |
| `/login`, `/logout` | GET/POST | Login/logout |
| `/login/olvidar-contrasena` | GET/POST | Recuperar contraseña |
| `/login/restablecer-contrasena` | GET/POST | Restablecer con token |
| `/cuenta/cambiar-contrasena` | GET/POST | Cambio de contraseña |
| `/dashboard` | GET | Dashboard |
| `/clientes`, `/clientes/new`, `/clientes/:id`, `/clientes/:id/edit` | GET/POST | CRUD clientes |
| `/agenda`, `/agenda/new`, `/agenda/:id`, `/agenda/:id/edit` | GET/POST | CRUD agenda |
| `/pedidos`, `/pedidos/new`, `/pedidos/:id`, `/pedidos/:id/edit` | GET/POST | CRUD pedidos |
| `/visitas`, `/visitas/new`, `/visitas/:id`, `/visitas/:id/edit` | GET/POST | CRUD visitas |
| `/articulos`, `/articulos/new`, `/articulos/:id`, `/articulos/:id/edit` | GET/POST | CRUD artículos |
| `/comerciales` | GET/POST | CRUD comerciales (admin) |
| `/notificaciones`, `/mis-notificaciones` | GET | Notificaciones |
| `/admin/descuentos-pedido` | GET/POST | Descuentos (admin) |
| `/admin/variables-sistema` | GET/POST | Variables sistema |
| `/admin/webhooks` | GET | Webhooks |
| `/admin/configuracion-email` | GET | Config email |
| `/manual` | GET | Manual operativo |
| `/registro-visitas` | GET/POST | Registro público de visitas |

### 7.2 Endpoints especiales

- `/pedidos/:id.xlsx` — Excel del pedido
- `/pedidos/:id/hefame.xlsx` — Plantilla Hefame
- `/pedidos/:id/hefame-send-email` — Envío por email
- `/pedidos/:id/enviar-n8n` — Webhook N8N
- `/health`, `/health/db` — Health checks

### 7.3 API REST (`/api/`)

| Recurso | Endpoints |
|---------|-----------|
| `/api/clientes` | GET (listar), GET `/suggest` (autocomplete), GET/POST/PUT/DELETE `/:id` |
| `/api/agenda` | GET, GET/POST/PUT/DELETE `/:id` |
| `/api/pedidos` | GET, GET `/precios`, GET/POST/PUT/DELETE `/:id`, POST `/:id/lineas`, PUT/DELETE `/:id/lineas/:lineaId` |
| `/api/visitas` | GET, GET/POST/PUT/DELETE `/:id` |
| `/api/comerciales` | GET, GET/POST/PUT/DELETE `/:id` |
| `/api/notificaciones` | GET, GET/POST `/:id/aprobar`, POST `/:id/rechazar` |
| `/api/db` | GET `/health`, POST `/query` (admin), POST `/ensure-indexes` (admin) |
| `/api/docs/` | Swagger UI (solo admin) |

---

## 8. Arquitectura modular

### 8.1 Capa de datos

- **Facade:** `config/mysql-crm.js` (clase `MySQLCRM`)
- **Módulos por dominio:**
  - `mysql-crm-clientes.js` — clientes, cooperativas, grupos
  - `mysql-crm-pedidos.js` — metadatos, estados, descuentos, índices
  - `mysql-crm-pedidos-crud.js` — createPedido, updatePedidoWithLineas
  - `mysql-crm-pedidos-with-lineas.js` — implementación updatePedidoWithLineas
  - `mysql-crm-visitas.js` — visitas, tipos, estados
  - `mysql-crm-articulos.js` — artículos
  - `mysql-crm-comerciales.js` — comerciales
  - `mysql-crm-agenda.js` — agenda, contactos
  - `mysql-crm-login.js` — login, password reset
  - `mysql-crm-comisiones.js` — comisiones

### 8.2 Dominios (config/domains/)

- `agenda.js`, `articulos.js`, `clientes.js`, `clientes-crud.js`, `comerciales.js`
- `pedidos.js`, `visitas.js`
- Delegación desde el facade para mantener API consistente

### 8.3 Resolución de nombres de columnas

El código usa `_pickCIFromColumns` y `_ensure*Meta` para soportar:
- Nombres legacy: `Id_Cial`, `Id_Cliente`, `Nombre_Razon_Social`
- Nombres normalizados: `cli_com_id`, `ped_cli_id`, `cli_nombre_razon_social`

---

## 9. Guía rápida para gestión

### Arrancar el proyecto

```bash
npm install
cp .env.example .env
# Editar .env con credenciales BD
npm run dev   # desarrollo (nodemon)
npm start     # producción
```

### Crear un nuevo comercial

1. Ir a `/comerciales` (como admin)
2. Crear con email, DNI, contraseña, rol (`Admin` o `Comercial`)

### Asignar cliente a comercial

- En cliente: campo `Id_Cial` / `cli_com_id` = id del comercial

### Estados de pedido

- Consultar tabla `estados_pedido` (codigo, nombre, color)
- Comercial solo puede editar en estado "Pendiente"

### Añadir descuento por importe

- Admin → `/admin/descuentos-pedido`
- Rangos: importe_desde, importe_hasta, dto_pct

### Variables de sistema

- Admin → `/admin/variables-sistema`
- Clave-valor para configuración dinámica

### Diagnóstico de integridad FK

- Ejecutar `scripts/diagnostico-integridad-fks.sql` antes de aplicar FKs
- Corregir huérfanos (registros con FK inválida)

### Documentos de referencia

- `docs/ROLES.md` — Roles y permisos
- `docs/NORMALIZACION-BD-PREFIJOS.md` — Prefijos y mapeo columnas
- `docs/PLAN-MODULARIZACION-MYSQL-CRM.md` — Arquitectura modular

---

*Documento generado para facilitar la incorporación de programadores al proyecto CRM Gemavip.*
