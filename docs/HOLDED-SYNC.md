# Sincronización Holded ↔ CRM Gemavip (clientes / leads)

## Alcance del panel (CPanel Holded)

- Solo contactos Holded con `type` **`client`** o **`lead`**. Proveedores y demás tipos se excluyen (`filterHoldedContactsClienteOLead`).
- **Vista operativa por defecto:** solo contactos que tengan la tag **`crm`** en Holded (`filterHoldedContactsConTagCrm`). La vista previa, KPIs y el import masivo trabajan sobre ese subconjunto.
- **Bloque «Mismo dato que el listado Clientes»:** en la página del CPanel se muestran `countClientesOptimizado({})` (igual que `/clientes` sin filtros, admin), recuento de filas con `cli_Id_Holded` y el total Holded del panel, para no mezclar cifras de orígenes distintos sin contexto.
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

## Checklist operativa (antes de dar por bueno el flujo)

1. **Vercel (o `.env`):** `HOLDED_API_KEY`, `APP_BASE_URL` (URL pública del CRM, para enlaces del correo), `API_KEY` (para POST `/webhook/aprobar-sync-cliente` desde n8n), `APROBACION_SECRET` o mismo valor que firma HMAC del webhook n8n si usas `X-CRM-Signature`.
2. **Correo de aprobación:** `HOLDED_SYNC_NOTIFY_EMAIL`, opcional `HOLDED_SYNC_NOTIFY_CC`; `HOLDED_SYNC_N8N_WEBHOOK_URL` apuntando al webhook n8n correcto, o `0` para forzar solo Graph/SMTP.
3. **n8n:** Workflow **activo**, nodo Webhook con el **mismo path** que recibe el CRM, nodo SMTP con credencial válida; si el CRM responde 2xx al POST, no hace falta SMTP en el propio CRM.
4. **Cliente:** `cli_Id_Holded` (o `cli_referencia`) rellenado; sin vínculo no hay comparación ni email.
5. **Divergencia:** Tras guardar, debe cumplirse **H ≠ C** (hash Holded vs hash CRM). Si ya están alineados, **no** se envía correo de aprobación (comportamiento esperado).
6. **Tras guardar:** Si el correo se envía, la ficha muestra un aviso de éxito; si eres admin y falta API key o falla el envío, verás avisos técnicos en la misma vista.

## Autorización por email (sync)

### Prefetch, Microsoft Safe Links y GET

Rastreadores, antivirus o la **previsualización de enlaces** pueden hacer **GET** a una URL antes de que el usuario pulse. Si el GET **ejecutara** la sincronización, la notificación quedaría resuelta y el usuario vería «La solicitud ya fue resuelta o no existe».

**Comportamiento actual:**

- **`GET /webhook/aprobar-sync-cliente?notifId=&accion=&sig=`** solo valida la firma HMAC y muestra una **página de confirmación** (no cambia el estado de `notificaciones`).
- La acción se ejecuta con **`POST`** al mismo path (`application/x-www-form-urlencoded`) con los mismos `notifId`, `accion` y `sig` (formulario «Confirmar» de esa página).
- **`POST` con `X-API-Key` / `Authorization: Bearer` = `API_KEY`** (n8n, scripts) ejecuta directamente con JSON `{ notifId, accion }` y **no** depende de GET; no sufre este problema.

1. Tras marcar pendiente de sync, si no existe ya una notificación pendiente del mismo tipo, se crea una fila en `notificaciones` con **`tipo = aprobacion_sync_cliente`**, `id_contacto = cli_id` y notas JSON (diff resumido, sugerencia de dirección).
2. Se envía correo a **`HOLDED_SYNC_NOTIFY_EMAIL`** (por defecto `p.lara@gemavip.com`) con tres enlaces firmados (HMAC, mismo secreto que pedidos: `APROBACION_SECRET`):
   - **`/webhook/aprobar-sync-cliente?notifId=&accion=crm_to_holded&sig=`** — abre confirmación; al confirmar, `exportCrmClienteToHolded`.
   - **`accion=holded_to_crm`** — abre confirmación; al confirmar, `importCrmClienteFromHolded`.
   - **`accion=revisar`** — abre confirmación; al confirmar, cierra la notificación sin sincronizar.
3. Tras aplicar CRM→Holded o Holded→CRM con éxito, se notifica a **`HOLDED_SYNC_BETACOURT_EMAIL`** (por defecto `c.betacourt@gemavip.com`) con un breve resumen.
4. El resumen digest cada 15 min (`sendHoldedSyncPendingDigestEmail`) puede seguir activo; la decisión explícita va por los enlaces anteriores.

5. **N8N (sin SMTP @gemavip):** si está configurado `HOLDED_SYNC_N8N_WEBHOOK_URL` (por defecto el webhook Easypanel farmadescanso-n8n), el CRM envía primero un **POST JSON** a ese webhook; si responde 2xx, no se intenta Graph/SMTP. Campos comunes: `event`, `to`, `subject`, `html`, `meta`, `appBaseUrl`, `source`, `ts`. Valores de `event`: `holded_sync_approval_request` (incluye `meta.links` con URLs firmadas), `holded_sync_digest`, `holded_sync_applied`. Cabecera opcional `X-CRM-Signature` (HMAC-SHA256 del body JSON) si defines `HOLDED_SYNC_N8N_WEBHOOK_SECRET` o `APROBACION_SECRET`. Flujo n8n exportable (mismo patrón que «Aprobación Pedidos»): [`docs/n8n/sincronizacion-holded-gemavip.json`](n8n/sincronizacion-holded-gemavip.json) — importar en n8n, reasignar credencial SMTP **CRM GEMAVIP** si hace falta, activar el workflow y comprobar URL `POST .../webhook/58663207-04f0-4a20-b333-1bd4ff36bf00`.

**Conflicto de webhook en n8n:** Si el error menciona `d6977a0f-a949-4fdc-bb45-09083fda4f8b` (ruta de **Aprobación Pedidos**), no es el flujo Holded: suele haber **dos copias** del mismo workflow de pedidos o un duplicado con el mismo path. Desactiva o elimina el duplicado, o cambia el path del webhook en uno de ellos. Holded usa siempre el path distinto `58663207-04f0-4a20-b333-1bd4ff36bf00`.

6. **Ejecutar sincronización desde n8n (o automatización):**  
   - **Enlaces del correo:** el HTML incluye enlaces firmados a `GET /webhook/aprobar-sync-cliente` → página intermedia → el usuario pulsa **Confirmar** (POST con firma).  
   - **POST con API key** (recomendado si el correo pasa por escaneo agresivo de URLs): `POST https://<tu-crm>/webhook/aprobar-sync-cliente` con cabecera `X-API-Key: <API_KEY>` (o `Authorization: Bearer <API_KEY>`) y cuerpo JSON `{ "notifId": <número>, "accion": "crm_to_holded" | "holded_to_crm" | "revisar" }`. Requiere `API_KEY` en variables de entorno del servidor. El workflow importable en [`docs/n8n/sincronizacion-holded-gemavip.json`](n8n/sincronizacion-holded-gemavip.json) incluye un segundo webhook «Ejecutar sync (manual)» → nodo HTTP que llama a este POST; define en n8n la variable `CRM_GEMAVIP_API_KEY` igual a `API_KEY` de Vercel.

**Nota:** `resolverSolicitudAsignacion` no resuelve notificaciones `aprobacion_sync_cliente` (deben usarse los enlaces del webhook).

## Estados de la vista previa (H / C / S)

- **H**: hash del contacto Holded (`hashFromHoldedContact`).
- **C**: hash de la fila CRM (`hashFromCrmRow`).
- **S**: `cli_holded_sync_hash` (último acuerdo: hash de los datos comparables según un **GET del contacto en Holded** tras import/export, no solo el hash de la fila CRM — así **S** coincide con lo que el panel calcula como **H**).

Tras import o export exitoso, `cli_holded_sync_hash` se actualiza con `hashFromHoldedContact` sobre la respuesta de la API Holded (y `cli_holded_sync_pendiente = 1` solo si aún difiere el hash de la fila CRM respecto a ese estado).

## Campos comparables

Lista: `COMPARABLE_PAYLOAD_KEYS` en [`lib/holded-sync/index.js`](../lib/holded-sync/index.js). No comparan: `cli_referencia`, `cli_Id_Holded`, `cli_tags`, `cli_id`.

El **código postal** se normaliza a 5 dígitos (relleno con ceros a la izquierda) en import, comparación y export a Holded para evitar divergencias por `03581` vs `3581`. **`TipoContacto`** (Persona/Empresa) se importa desde `isperson` en Holded y se reenvía en el PUT como `isperson` al volcar CRM→Holded.

## API programada (cron)

`POST /api/holded-sync/import` — mismo alcance **solo tag crm** que el import desde CPanel.

## Riesgos

- PUT a Holded puede sobrescribir datos; probar en entorno seguro.
- `notas` en `notificaciones` puede truncar JSON largo (~500 caracteres en esquemas legacy).

## Vaciado masivo de clientes (opcional, destructivo)

No forma parte del flujo normal. Si se necesita un entorno limpio: **backup completo** obligatorio, ventana de mantenimiento y borrado en orden de FKs (tablas dependientes → `clientes`). Después, import masivo desde Holded con tag `crm` y las reglas anteriores.
