# Mappings para importación Excel → clientes

Estos CSV mapean valores de texto del Excel (Holded) a IDs de la BD.

## Obtener mappings reales desde tu BD

Ejecuta desde la raíz del proyecto (con .env configurado y acceso a la BD):

```bash
node scripts/export-catalogos-para-mappings.js
```

Esto sobrescribirá los CSV con los IDs reales de tu base de datos.

## Archivos por defecto

Si no puedes conectar a la BD, se usan mappings por defecto. **Verifica que los IDs coincidan con tu BD** antes de importar. Si no, exporta desde phpMyAdmin las tablas `provincias`, `paises`, `idiomas`, `monedas`, `tipos_clientes`, `formas_pago` y ajusta los CSV manualmente.
