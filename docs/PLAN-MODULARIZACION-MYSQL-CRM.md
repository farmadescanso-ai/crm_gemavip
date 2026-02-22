# Plan de modularización: mysql-crm.js

## Objetivo

Mejorar **velocidad** y **mantenibilidad** del CRM separando la lógica de `config/mysql-crm.js` (~10.400 líneas) en módulos por dominio, sin romper la aplicación ni las relaciones/índices de la BD.

## Beneficios esperados

| Aspecto | Antes | Después |
|---------|-------|---------|
| **Carga inicial** | Parsear 10.400 líneas en cada cold start | Cargar solo base + dominio usado (lazy) |
| **Mantenimiento** | Buscar en archivo gigante | Código por dominio (clientes, pedidos, etc.) |
| **Seguridad** | Todo en un sitio | Lógica aislada por contexto |
| **Duplicación** | Implícita en métodos largos | Utilidades compartidas en base |

## Estructura propuesta

```
config/
├── mysql-crm.js              # Facade: mantiene API actual, delega a dominios
├── mysql-crm-base.js         # Conexión, query, metadatos, utilidades compartidas
└── domains/
    ├── index.js              # Exporta todos los dominios (para el facade)
    ├── clientes.js            # Clientes, cooperativas, gruposCompras
    ├── pedidos.js             # Pedidos, líneas, estados, descuentos
    ├── visitas.js             # Visitas, tipos, estados
    ├── articulos.js           # Artículos
    ├── agenda.js              # Contactos, roles, especialidades
    ├── comerciales.js         # Comerciales
    ├── notificaciones.js      # Notificaciones, solicitudes
    ├── login.js               # Password reset tokens
    ├── catalogos.js           # Provincias, países, formas pago, etc.
    ├── direcciones-envio.js   # Direcciones de envío
    └── codigos-postales.js    # Códigos postales, asignaciones
```

## Plan de migración (sin romper la app)

### Fase 1: Base y facade (prioridad alta)
1. Crear `mysql-crm-base.js` con: conexión, pool, `query`, `queryWithFields`, `_pickCIFromColumns`, `_getColumns`, `_resolveTableNameCaseInsensitive`, utilidades DNI/título.
2. Crear `domains/visitas.js` como primer módulo piloto (menor dependencia).
3. Hacer que `mysql-crm.js` extienda la base y delegue visitas al nuevo módulo.
4. Verificar que `/visitas` funciona igual.

### Fase 2: Dominios por prioridad de uso
Orden sugerido según impacto en login y vistas lentas:
- ~~`clientes.js`~~ ✅ (mysql-crm-clientes.js)
- ~~`pedidos.js`~~ ✅ (mysql-crm-pedidos.js + crud + with-lineas)
- ~~`visitas.js`~~ ✅ (mysql-crm-visitas.js)
- ~~`articulos.js`~~ ✅ (mysql-crm-articulos.js + domains/articulos.js)
- ~~`comerciales.js`~~ ✅ (mysql-crm-comerciales.js + domains/comerciales.js)
- ~~`agenda.js`~~ ✅ (mysql-crm-agenda.js + domains/agenda.js)
- ~~`login.js`~~ ✅ (mysql-crm-login.js)
- `catalogos.js`, `notificaciones.js`, `direcciones-envio.js`, `codigos-postales.js`

### Fase 3: Lazy loading (opcional)
- Sustituir `require('./domains/visitas')` por getter que cargue bajo demanda.
- Cada ruta solo carga los dominios que usa.

### Fase 4: Optimizaciones adicionales
- Cache de metadatos (`_ensure*Meta`) más agresivo.
- Reducir llamadas a `SHOW COLUMNS` en caliente.
- Índices específicos por tipo de consulta.

## Reglas de migración

1. **API pública idéntica**: `require('../config/mysql-crm')` sigue devolviendo el mismo objeto con los mismos métodos.
2. **Sin cambios de firma**: Los métodos mantienen sus parámetros y valores de retorno.
3. **Relaciones preservadas**: Las FKs, JOINs e índices se respetan.
4. **Tests**: Comprobar cada dominio tras extraerlo (manual o automatizado).

## Dependencias entre dominios

```
base (conexión, query, metadatos)
  ├── visitas     → clientes, comerciales (JOIN)
  ├── pedidos    → clientes, comerciales, articulos
  ├── clientes   → comerciales, provincias
  ├── articulos  → marcas
  ├── agenda     → clientes
  └── ...
```

Los dominios se comunican vía el objeto `db` compartido (this) o llamando a métodos del facade.

## Estado actual

- **Fase 1**: Completada (base + facade + módulos extraídos)
- **Archivo principal**: `config/mysql-crm.js` (~3.900 líneas, reducido desde ~6.300)
- **Módulos extraídos**:
  - `mysql-crm-clientes.js` – clientes, cooperativas, grupos
  - `mysql-crm-pedidos.js` – metadatos, estados, descuentos, índices, schema
  - `mysql-crm-pedidos-crud.js` – createPedido, updatePedidoWithLineas (delegación)
  - `mysql-crm-pedidos-with-lineas.js` – implementación de updatePedidoWithLineas
  - `mysql-crm-visitas.js` – _ensureVisitasMeta, getTiposVisita, getEstadosVisita, ensureVisitasSchema, ensureVisitasIndexes, _buildVisitasOwnerWhere
  - `mysql-crm-articulos.js` – toggleArticuloOkKo, copyTarifaMirafarmaToPvl
  - `mysql-crm-comerciales.js` – _ensureComercialesMeta, ensureComercialesReunionesNullable, _getComercialesNombresByIds, getEstadisticasComercial
  - `mysql-crm-agenda.js` – _resolveAgendaTableName, ensureContactosIndexes, _ensureTiposCargoRolTable, _ensureEspecialidadesIndexes, _normalizeAgendaCatalogLabel
  - `mysql-crm-login.js` – updateComercialPassword, password_reset_tokens (create, find, markUsed, cleanup, countRecentAttempts)
- **Dominios delegados** (config/domains/): visitas, articulos, comerciales, pedidos, agenda, etc.
- **Consumidores**: api/index.js, routes/api/*.js, lib/auth.js, lib/mailer.js
