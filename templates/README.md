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

### Variable de entorno

- `HEFAME_EXCEL_TEMPLATE_PATH`: ruta completa al .xlsx si no está en `templates/PLANTILLA TRANSFER DIRECTO CRM.xlsx`.
