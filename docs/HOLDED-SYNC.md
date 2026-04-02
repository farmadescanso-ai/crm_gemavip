# Sincronización Holded ↔ CRM Gemavip (clientes / leads)

## Alcance

- Solo contactos Holded con `type` **`client`** o **`lead`**. Proveedores, acreedores y demás tipos se excluyen en código (`filterHoldedContactsClienteOLead`).
- El filtro de tags incluye **siempre** `crm` (y opcionalmente `SYNC_HOLDED_DEFAULT_TAGS`). En la UI solo se muestra la tag `crm`; en la tabla de vista previa la columna Tags muestra únicamente `crm` si el contacto la tiene (no el resto de etiquetas Holded del registro).
- Implementación: [`lib/holded-sync/index.js`](../lib/holded-sync/index.js) (entrada estable: [`lib/sync-holded-clientes.js`](../lib/sync-holded-clientes.js)).

## Filtro de tags y variables de entorno

| Variable | Efecto |
|----------|--------|
| *(por defecto)* | Siempre se exige la tag **`crm`** en el conjunto de filtro (OR con otras si las hay). |
| `SYNC_HOLDED_DEFAULT_TAGS` | Lista separada por comas fusionada con `crm` (ej. `farmacia`) para ampliar el alcance sin listar más tags en el CPanel. |

Las variables `HOLDED_SYNC_REQUIRE_TAGS` y el modo «sin tags» ya no aplican: `crm` se inyecta siempre en el filtro.

## Estados de la vista previa (H / C / S)

- **H**: hash del contacto Holded actual (`hashFromHoldedContact`), **solo campos de datos de contacto** (ver abajo).
- **C**: hash de la fila CRM (`hashFromCrmRow`), mismos campos.
- **S**: `cli_holded_sync_hash` en BD (último estado acordado tras import o export).

| Etiqueta en UI | Condición (resumida) |
|----------------|----------------------|
| Al día | `H === C` |
| Pte. importar | Holded cambió respecto al sync; CRM aún como en último sync (`S` no nulo, `H ≠ S`, `C === S`) y vínculo Holded coherente. |
| Sincronizar (export) | CRM cambió; Holded como en último sync (`C ≠ S`, `H === S`). Botón **Volcar CRM → Holded** en la tabla. |
| Desincronizado | Ambos divergen u otro conflicto de vínculo. Revisar manualmente. |

Tras **import** o **export**, `cli_holded_sync_hash` se guarda con el **hash del CRM** (`hashFromCrmRow` tras leer el cliente), para alinear con la normalización de `createCliente` / `updateCliente`.

## Campos que entran en el hash (comparables)

Lista canónica: `COMPARABLE_PAYLOAD_KEYS` en código. **No** se comparan (no disparan “datos distintos”): `cli_referencia`, `cli_Id_Holded`, `cli_tags`, ni `cli_id` — son enlaces o metadatos operativos, no el registro de contacto en sí.

Origen Holded → CRM: `buildClientePayloadFromHoldedContact` guarda el ID del contacto solo en `cli_Id_Holded` (no en `cli_referencia`). CRM → Holded (export): `buildHoldedPutBodyFromCrmRow`.

Campos típicos en el hash: nombre, CIF, email, móvil, teléfono, dirección, población, CP, provincia, país, IBAN/SWIFT, web, observaciones, régimen, mandato, cuentas, persona de contacto, etc.

**Nota:** Tras cambiar el conjunto de campos del hash, los valores antiguos de `cli_holded_sync_hash` pueden dejar de coincidir hasta el siguiente import/export por fila.

## Auditoría

Tablas `sync_run` y `sync_event` (creadas al vuelo con `ensureSyncRunTables` o vía [`scripts/add-sync-run-tables.sql`](../scripts/add-sync-run-tables.sql)). Cada ejecución de import desde CPanel o API registra contadores y eventos por fila (insert/update/error).

## API programada (cron)

`POST /api/holded-sync/import`

- Cabecera: `Authorization: Bearer <CRON_SECRET>` (variable `CRON_SECRET` en entorno).
- Cuerpo o query opcional: `tags` (se fusiona con `crm` como en el CPanel), `dryRun=1`, `maxRows` (límite de filas a procesar).

Ejemplo:

```bash
curl -sS -X POST "https://tu-dominio/api/holded-sync/import" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"maxRows":200}'
```

## Riesgos

- **API List Contacts**: no expone filtro por fecha; el listado completo sigue siendo el cuello de botella en red.
- **Conflictos CIF**: duplicados o vínculos incoherentes entre `cli_Id_Holded` y CIF requieren intervención en BD.
- **Export a Holded**: el PUT puede sobrescribir campos en Holded; usar primero en entornos de prueba si es posible.
