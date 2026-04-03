# Listado contactos Holded (tag `crm`)

## Cómo generar el listado real en Markdown

En la raíz del proyecto, con **`HOLDED_API_KEY`** en `.env` (misma clave que usa el CRM con Holded):

```bash
npm run export:holded-contactos-crm:md
```

Equivale a:

```bash
node scripts/export-holded-contactos-crm-excel.js --md
```

Se crea un archivo en `exports/holded-contactos-crm-<fecha>.md` con:

- Tabla resumen: `#`, `id`, `name`, `type`, `code`, `email`, `mobile`, `phone`, tags.
- Un bloque **JSON** por contacto con **todos los campos** que devuelve la API Holded.

Ruta personalizada:

```bash
node scripts/export-holded-contactos-crm-excel.js --md --out docs/mi-export-holded.md
```

**Filtros** (igual que el CPanel por defecto): solo tipos **`client`** y **`lead`**, y que tengan la tag **`crm`**.

---

## Si no puedes ejecutar el script

No hay listado automático sin acceso a la API. Opciones:

1. Ejecutar el comando en un entorno donde exista `.env` con `HOLDED_API_KEY` válida.
2. Desde Holded, exportar contactos y cruzar manualmente con la tag `crm`.

---

## Ejemplo de tabla resumen (datos ficticios)

| # | id | name | type | code | email | mobile | phone | tags (Holded) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `abc123…` | Ejemplo SL | client | B12345678 | info@ejemplo.com | 600111222 | 912000000 | crm, sepa |
| 2 | `def456…` | Farmacia Demo | lead | — | demo@mail.com | 622333444 | — | crm |

---

## Referencia de campos típicos (API contacto)

Los nombres exactos dependen de la respuesta Holded; suelen incluir entre otros:

| Área | Campos habituales |
|------|-------------------|
| Identidad | `id`, `name`, `tradeName`, `code`, `type`, `isperson` |
| Contacto | `email`, `mobile`, `phone`, `contactName` |
| Dirección facturación | `billAddress.address`, `billAddress.city`, `billAddress.postalCode`, `billAddress.province`, `billAddress.countryCode` |
| Etiquetas | `tags` (array) |
| Otros | `iban`, `notes`, `taxOperation`, `website`, etc. |

El export `--md` incluye el **JSON íntegro** por contacto para no perder ningún campo.
