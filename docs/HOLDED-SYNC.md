# Sincronización Holded ↔ CRM Gemavip (clientes / leads)

## Alcance del panel (CPanel Holded)

- Solo contactos Holded con `type` **`client`** o **`lead`**. Proveedores y demás tipos se excluyen (`filterHoldedContactsClienteOLead`).
- **Vista operativa por defecto:** solo contactos que tengan la tag **`crm`** en Holded (`filterHoldedContactsConTagCrm`). La vista previa, KPIs y el import masivo trabajan sobre ese subconjunto.
- **Listado amplio (solo lectura / soporte):** `GET /cpanel/holded-clientes?alcance=completo` — todos los `client`/`lead` sin exigir tag `crm` (útil para Excel «sin tag de filtro» y auditoría).
- Implementación: [`lib/holded-sync/index.js`](../lib/holded-sync/index.js) (entrada estable: [`lib/sync-holded-clientes.js`](../lib/sync-holded-clientes.js)).

## Filtro de tags y variables de entorno

| Variable | Efecto |
|----------|--------|
| *(por defecto)* | En el conjunto efectivo OR se incluye siempre **`crm`** más `SYNC_HOLDED_DEFAULT_TAGS` si está definida. |
| `SYNC_HOLDED_DEFAULT_TAGS` | Lista separada por comas fusionada con `crm` (ej. `sepa`) para el alcance OR en la columna «Tags alcance». |

La columna «Tags alcance» en la tabla muestra qué etiquetas del alcance tiene cada contacto (no todas las tags Holded).

## Reglas Lead / CIF (opción B)

- **Holded `type=lead` sin CIF (`code` vacío):** en CRM `cli_dni_cif = 'Pendiente'`; con provincia mapeable a ES el contacto es **importable** (ya no queda bloqueado por «sin CIF» como los `client` sin CIF).
- **Holded `type=client`:** si en CRM el tipo no es ya Lead (`tipos_clientes` donde `LOWER(tipc_tipo)='lead'`), en import se asigna **`cli_tipc_id`** al Lead.
- **`client` sin CIF en Holded:** sigue **omitido** con el motivo de CIF vacío (no se importa salvo otras herramientas puntuales).

## `cli_holded_sync_pendiente`

- Se pone a **1** cuando el cliente está vinculado a Holded (`cli_Id_Holded` / `cli_referencia`) y el hash de datos **Holded (H)** y **CRM (C)** difieren (`H ≠ C`), tras guardar desde el formulario o al detectar divergencia.
- Se limpia a **0** tras import/export exitoso que alinea `cli_holded_sync_hash` (mismo criterio que el import masivo o `exportCrmClienteToHolded` / `importCrmClienteFromHolded`).

## Autorización por email (sync)

1. Tras marcar pendiente de sync, si no existe ya una notificación pendiente del mismo tipo, se crea una fila en `notificaciones` con **`tipo = aprobacion_sync_cliente`**, `id_contacto = cli_id` y notas JSON (diff resumido, sugerencia de dirección).
2. Se envía correo a **`HOLDED_SYNC_NOTIFY_EMAIL`** (por defecto `p.lara@gemavip.com`) con tres enlaces firmados (HMAC, mismo secreto que pedidos: `APROBACION_SECRET`):
   - **`/webhook/aprobar-sync-cliente?notifId=&accion=crm_to_holded&sig=`** — ejecuta `exportCrmClienteToHolded`.
   - **`accion=holded_to_crm`** — ejecuta `importCrmClienteFromHolded`.
   - **`accion=revisar`** — cierra la notificación sin sincronizar.
3. Tras aplicar CRM→Holded o Holded→CRM con éxito, se notifica a **`HOLDED_SYNC_BETACOURT_EMAIL`** (por defecto `c.betacourt@gemavip.com`) con un breve resumen.
4. El resumen digest cada 15 min (`sendHoldedSyncPendingDigestEmail`) puede seguir activo; la decisión explícita va por los enlaces anteriores.

**Nota:** `resolverSolicitudAsignacion` no resuelve notificaciones `aprobacion_sync_cliente` (deben usarse los enlaces del webhook).

## Estados de la vista previa (H / C / S)

- **H**: hash del contacto Holded (`hashFromHoldedContact`).
- **C**: hash de la fila CRM (`hashFromCrmRow`).
- **S**: `cli_holded_sync_hash` (último acuerdo tras import/export).

Tras import o export, `cli_holded_sync_hash` se guarda con el hash del CRM.

## Campos comparables

Lista: `COMPARABLE_PAYLOAD_KEYS` en código. No comparan: `cli_referencia`, `cli_Id_Holded`, `cli_tags`, `cli_id`.

## API programada (cron)

`POST /api/holded-sync/import` — mismo alcance **solo tag crm** que el import desde CPanel.

## Riesgos

- PUT a Holded puede sobrescribir datos; probar en entorno seguro.
- `notas` en `notificaciones` puede truncar JSON largo (~500 caracteres en esquemas legacy).

## Vaciado masivo de clientes (opcional, destructivo)

No forma parte del flujo normal. Si se necesita un entorno limpio: **backup completo** obligatorio, ventana de mantenimiento y borrado en orden de FKs (tablas dependientes → `clientes`). Después, import masivo desde Holded con tag `crm` y las reglas anteriores.
