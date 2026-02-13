# Plantilla Excel para exportar pedidos

Para que la exportación a Excel use vuestra plantilla **"PLANTILLA TRANSFER DIRECTO CRM.xlsx"**:

1. Copiad el fichero a esta carpeta con el nombre exacto:
   ```
   PLANTILLA TRANSFER DIRECTO CRM.xlsx
   ```

2. La aplicación rellenará automáticamente:
   - **E1**: Nº pedido, fecha, entrega, Nº pedido cliente, Nº asociado Hefame (si aplica)
   - **A7**: Bloque CLIENTE (nombre, CIF, dirección, etc.)
   - **E7**: Bloque DIRECCIÓN DE ENVÍO
   - **Desde fila 15**: Líneas del pedido (Código, Concepto, PVL, Unds, Dto, Subtotal, IVA, Total)
   - **Después de las líneas**: BASE IMPONIBLE, IVA, TOTAL (y DTO PEDIDO si aplica)

Si vuestra plantilla usa otras celdas, podéis definirlas con variables de entorno:

- `PEDIDO_EXCEL_TEMPLATE_PATH`: ruta completa al .xlsx (opcional)
- `PEDIDO_TEMPLATE_PEDIDO_CELL`: celda para datos del pedido (por defecto E1)
- `PEDIDO_TEMPLATE_CLIENTE_CELL`: celda para cliente (por defecto A7)
- `PEDIDO_TEMPLATE_DIRECCION_CELL`: celda para dirección envío (por defecto E7)
- `PEDIDO_TEMPLATE_TABLA_FILA_INICIO`: primera fila de datos de líneas (por defecto 15)
- `PEDIDO_TEMPLATE_TABLA_MARGEN_TOTALES`: filas entre última línea y totales (por defecto 2)
