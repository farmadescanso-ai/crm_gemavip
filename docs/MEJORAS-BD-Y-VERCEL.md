# Mejoras CRM Gemavip: Base de Datos y Vercel

Análisis basado en el dump `crm_gemavip (1).sql` y el estado actual de la aplicación.

---

## 1. Cambios ya aplicados en el código

### Schema-columns alineado con la BD real

El archivo `config/schema-columns.js` tenía columnas que **no existen** en tu base de datos. Se han corregido:

| Tabla           | Antes (incorrecto)              | Después (correcto)              |
|-----------------|----------------------------------|----------------------------------|
| especialidades   | esp_id, esp_nombre, **esp_activo** | esp_id, esp_nombre, **esp_observaciones** |
| estdoClientes   | estcli_id, estcli_nombre, **estcli_activo** | estcli_id, estcli_nombre |
| tipos_clientes  | tipc_id, tipc_tipo, **tipc_activo** | tipc_id, tipc_tipo |

Esto evita errores cuando `USE_STATIC_SCHEMA=1` o cuando el código usa el esquema estático para validaciones.

---

## 2. Mejoras recomendadas para la App

### 2.1 CRUD de clientes (desplegables)

- **Catálogos**: Los desplegables (Tipo Cliente, Especialidad, Estado) usan `loadSimpleCatalogForSelect` y `loadEstadosClienteForSelect`, que ya detectan dinámicamente las columnas de la BD.
- **Delegado**: El campo Delegado se muestra en la pestaña Identificación cuando el usuario es admin (`canChangeComercial`).
- **Rol admin**: `isAdminUser` reconoce roles que contengan `"admin"` (p. ej. `"Administrador"`, `"Admin"`).

Si los desplegables siguen vacíos en producción:

1. Comprueba que las tablas `tipos_clientes`, `especialidades`, `estdoClientes` tengan datos.
2. Revisa los logs de Vercel para ver si hay timeouts o errores de conexión a la BD.

### 2.2 Índices y claves foráneas

Si aún no lo has hecho, ejecuta el script:

```
scripts/clientes-crud-indices-y-fks.sql
```

Añade índices en las columnas FK de `clientes` y crea las relaciones hacia catálogos. Si hay registros huérfanos, ejecuta antes `scripts/diagnostico-integridad-fks.sql`.

### 2.3 Variable USE_STATIC_SCHEMA

- Si está en `1`: el código usa el esquema estático (ya corregido).
- Si está en `0` o no definida: se detectan columnas dinámicamente desde la BD.

En Vercel, si tienes problemas con catálogos, prueba **no definir** `USE_STATIC_SCHEMA` o ponerla en `0` para que la app se adapte a la estructura real de la BD.

---

## 3. Mejoras recomendadas para Vercel

### 3.1 Variables de entorno obligatorias

| Variable           | Descripción                          | Ejemplo                          |
|--------------------|--------------------------------------|----------------------------------|
| DB_HOST            | Host de MySQL                        | `farmadescanso_sql-crm-farmadescanso` |
| DB_USER            | Usuario de BD                        | `crm_user`                       |
| DB_PASSWORD        | Contraseña                           | (secreto)                        |
| DB_NAME            | Nombre de la base de datos           | `crm_gemavip`                    |
| DB_PORT            | Puerto (opcional)                    | `3306`                           |
| DB_SSL             | SSL para conexión remota             | `true` si el host lo exige       |
| DB_CONNECTION_LIMIT| Límite de conexiones (opcional)      | `3` (recomendado en Vercel)      |

### 3.2 Conexión a la base de datos

- **Host**: Si usas un proveedor tipo Hostinger, el host suele ser algo como `sql123.hostinger.com` o similar. Comprueba que sea accesible desde Vercel (IPs permitidas, firewall).
- **SSL**: Muchos hosts MySQL remotos requieren SSL. Configura `DB_SSL=true` en Vercel.
- **Timeout**: Las funciones serverless tienen límite de tiempo. Si las consultas son lentas, considera:
  - Aumentar índices en tablas grandes.
  - Usar caché para catálogos (ya implementado en `lib/catalog-cache.js`).

### 3.3 Comprobación de salud

La app expone un endpoint de salud en `/api/health` que comprueba la conexión a la BD. Úsalo para verificar que Vercel puede conectar:

```
https://crm-gemavip.vercel.app/api/health
```

Si devuelve error en la parte de BD, el problema está en la conexión o en las variables de entorno.

### 3.4 Despliegues

- Tras cambiar variables de entorno, hay que **redesplegar** el proyecto para que se apliquen.
- Si usas ramas de preview, cada rama usa las mismas variables de entorno del proyecto principal.

---

## 4. Resumen de acciones

| Prioridad | Acción |
|-----------|--------|
| Alta      | Verificar variables de entorno en Vercel (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL) |
| Alta      | Ejecutar `scripts/clientes-crud-indices-y-fks.sql` en la BD si no se ha hecho |
| Media     | Comprobar que `tipos_clientes`, `especialidades`, `estdoClientes` tienen datos |
| Media     | Revisar logs de Vercel si los desplegables siguen vacíos |
| Baja      | Probar `USE_STATIC_SCHEMA=0` o no definirla si hay problemas con catálogos |

---

## 5. Estructura de tablas relevante (BD real)

```
clientes
  cli_id, cli_com_id, cli_tipc_id, cli_esp_id, cli_estcli_id, ...

tipos_clientes
  tipc_id, tipc_tipo

especialidades
  esp_id, esp_nombre, esp_observaciones

estdoClientes
  estcli_id, estcli_nombre

comerciales
  com_id, com_nombre, com_email, com_roll (JSON: ["Administrador"], ["Comercial"], etc.)
```
