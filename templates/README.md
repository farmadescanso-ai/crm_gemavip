# Plantillas Excel

## Excel estándar (botón «Excel»)

El botón **Excel** en la ficha de un pedido genera siempre un libro desde cero (sin plantilla), válido para imprimir cualquier pedido.

---

## Plantilla Transfer Hefame (botón «HEFAME»)

El botón **HEFAME** descarga un Excel rellenando la plantilla **PLANTILLA TRANSFER DIRECTO CRM.xlsx**.

Coloca el fichero en esta carpeta con el nombre exacto:
```
PLANTILLA TRANSFER DIRECTO CRM.xlsx
```

### Mapeo de celdas

| Celda | Contenido |
|-------|-----------|
| **F5** | Nº Pedido; si viene vacío se pone la fecha del día en formato dd-mm-yyyy |
| **C13** | Nombre (cliente) |
| **C14** | Código Hefame (Nº asociado Hefame del pedido) |
| **C15** | Teléfono |
| **C16** | Código Postal + " " + Población |

### Líneas de pedido (desde fila 21)

Cada producto en una fila (21, 22, 23…):

| Columna | Contenido |
|---------|-----------|
| **B** | Cantidad |
| **C** | CN (SKU / código artículo) |
| **D** | Descripción (nombre del artículo) |
| **E** | Descuento (% bonificación) |

### Nombre del fichero descargado

El Excel se descarga con el nombre: **yyyymmdd_** + nombre del pedido + `.xlsx` (ej. `20260213_P250001.xlsx`).

### Envío por correo

Al pulsar HEFAME se envía un correo a **p.lara@gemavip.com** (o a la dirección en `HEFAME_MAIL_TO`) con:

- **Asunto:** nombre del pedido
- **Adjunto:** el mismo Excel (con el nombre yyyymmdd_nombrepedido.xlsx)
- **Cuerpo:** datos del cliente en HTML (estilo WooCommerce/Shopify)

Para que el envío funcione, configura en `.env` el SMTP:

- `SMTP_HOST` (o `MAIL_HOST`)
- `SMTP_PORT` (opcional, por defecto 587)
- `SMTP_USER` (o `MAIL_USER`)
- `SMTP_PASSWORD` o `SMTP_PASS` (o `MAIL_PASSWORD`)
- `SMTP_FROM` (opcional, remitente)

Si no hay SMTP configurado, el Excel se descarga igual y en consola se avisa de que no se envió el correo.

### Otras variables

- `HEFAME_EXCEL_TEMPLATE_PATH`: ruta completa al .xlsx si no está en `templates/PLANTILLA TRANSFER DIRECTO CRM.xlsx`.
- `HEFAME_MAIL_TO`: destinatario del correo (por defecto `p.lara@gemavip.com`).
