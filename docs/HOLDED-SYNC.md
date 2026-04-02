# Sincronización Holded ↔ CRM Gemavip (clientes / leads)

## Alcance

- Solo contactos Holded con `type` **`client`** o **`lead`**. Proveedores, acreedores y demás tipos se excluyen en código (`filterHoldedContactsClienteOLead`).
- Implementación: [`lib/holded-sync/index.js`](../lib/holded-sync/index.js) (entrada estable: [`lib/sync-holded-clientes.js`](../lib/sync-holded-clientes.js)).

## Filtro de tags y variables de entorno

| Variable | Efecto |
|----------|--------|
| *(ninguna / vacío)* | Sin `HOLDED_SYNC_REQUIRE_TAGS`: se evalúan **todos** los client/lead que cumplan CIF + provincia ES (no hace falta marcar tags en la UI). |
| `HOLDED_SYNC_REQUIRE_TAGS=1` | Obliga a elegir tags en el CPanel **o** definir `SYNC_HOLDED_DEFAULT_TAGS`. |
| `SYNC_HOLDED_DEFAULT_TAGS` | Lista separada por comas (ej. `crm,farmacia`) fusionada con las tags marcadas en la UI. |

## Estados de la vista previa (H / C / S)

- **H**: hash del contacto Holded actual (`hashFromHoldedContact`).
- **C**: hash de la fila CRM (`hashFromCrmRow`).
- **S**: `cli_holded_sync_hash` en BD (último estado acordado tras import o export).

| Etiqueta en UI | Condición (resumida) |
|----------------|----------------------|
| Al día | `H === C` |
| Pte. importar | Holded cambió respecto al sync; CRM aún como en último sync (`S` no nulo, `H ≠ S`, `C === S`) y vínculo Holded coherente. |
| Sincronizar (export) | CRM cambió; Holded como en último sync (`C ≠ S`, `H === S`). Botón **Volcar CRM → Holded** en la tabla. |
| Desincronizado | Ambos divergen u otro conflicto de vínculo. Revisar manualmente. |

Tras **import** o **export**, `cli_holded_sync_hash` se guarda con el **hash del CRM** (`hashFromCrmRow` tras leer el cliente), para alinear con la normalización de `createCliente` / `updateCliente`.

## Mapeo de campos (comparables)

Lista canónica: `COMPARABLE_PAYLOAD_KEYS` en código. Origen Holded → CRM: `buildClientePayloadFromHoldedContact`. CRM → Holded (export): `buildHoldedPutBodyFromCrmRow`.

Campos típicos: `cli_referencia`, `cli_Id_Holded`, nombre, CIF, email, móvil, teléfono, dirección, población, CP, `cli_prov_id`, `cli_pais_id`, `cli_tags`, IBAN/SWIFT, web, observaciones, régimen, mandato, cuentas, etc.

## Auditoría

Tablas `sync_run` y `sync_event` (creadas al vuelo con `ensureSyncRunTables` o vía [`scripts/add-sync-run-tables.sql`](../scripts/add-sync-run-tables.sql)). Cada ejecución de import desde CPanel o API registra contadores y eventos por fila (insert/update/error).

## API programada (cron)

`POST /api/holded-sync/import`

- Cabecera: `Authorization: Bearer <CRON_SECRET>` (variable `CRON_SECRET` en entorno).
- Cuerpo o query opcional: `tags` (misma lógica que el CPanel), `dryRun=1`, `maxRows` (límite de filas a procesar).

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
