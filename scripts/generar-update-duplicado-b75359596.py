#!/usr/bin/env python3
"""
Genera SQL UPDATE para el cliente duplicado B75359596.
Lee UPDATE_B75359596.xlsx (generado por preparar-excel-contactos.py)
y produce un script SQL para actualizar el cliente existente.

Ejecutar: python scripts/generar-update-duplicado-b75359596.py
"""
import pandas as pd
from pathlib import Path

EXCEL_UPDATE = Path(__file__).parent.parent / "UPDATE_B75359596.xlsx"
# O en la carpeta CRM
EXCEL_UPDATE_ALT = Path.home() / "iCloudDrive" / "01 FARMADESCANSO SL" / "04 PROVEEDORES" / "01 GEMAVIP" / "CRM" / "UPDATE_B75359596.xlsx"

# Mapeo columna Excel -> columna BD (por nombre o patron)
def mapear_columnas(df):
    """Devuelve [(col_excel, col_bd), ...] excluyendo import_fila, accion_import."""
    mapeo = [
        ("Id_Cial", "cli_com_id"),
        ("DNI_CIF", "cli_dni_cif"),
        ("Nombre_Razon_Social", "cli_nombre_razon_social"),
        ("cli_direccion", "cli_direccion"),
        ("Direccion", "cli_direccion"),
        ("Direcci", "cli_direccion"),
        ("Poblacion", "cli_poblacion"),
        ("Poblaci", "cli_poblacion"),
        ("CodigoPostal", "cli_codigo_postal"),
        ("C_digo postal", "cli_codigo_postal"),
        ("Telefono", "cli_telefono"),
        ("Tel_fono", "cli_telefono"),
        ("cli_movil", "cli_movil"),
        ("Email", "cli_email"),
        ("cli_prov_id", "cli_prov_id"),
        ("cli_pais_id", "cli_pais_id"),
        ("cli_idiom_id", "cli_idiom_id"),
        ("cli_mon_id", "cli_mon_id"),
        ("cli_tipc_id", "cli_tipc_id"),
        ("cli_formp_id", "cli_formp_id"),
        ("Dto. %", "cli_dto"),
        ("IBAN", "cli_iban"),
        ("Swift", "cli_swift"),
        ("cli_modelo_347", "cli_modelo_347"),
        ("cli_creado_holded", "cli_creado_holded"),
        ("cli_referencia", "cli_referencia"),
        ("cli_regimen", "cli_regimen"),
        ("cli_ref_mandato", "cli_ref_mandato"),
        ("cli_tags", "cli_tags"),
        ("cli_cuenta_ventas", "cli_cuenta_ventas"),
        ("cli_cuenta_compras", "cli_cuenta_compras"),
        ("cli_visibilidad_portal", "cli_visibilidad_portal"),
        ("Tipo de contacto", "cli_tipo_contacto"),
    ]
    result = []
    usados_bd = set()
    cols = [c for c in df.columns if c not in ("import_fila", "accion_import")]
    for exc_col, bd_col in mapeo:
        if bd_col in usados_bd:
            continue
        for c in cols:
            if c == exc_col or exc_col in c:
                result.append((c, bd_col))
                usados_bd.add(bd_col)
                break
    return result

def escapar_sql(val):
    if pd.isna(val) or (isinstance(val, str) and val.strip() == ""):
        return "NULL"
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        if isinstance(val, float) and val != int(val):
            return str(val)
        return str(int(val)) if val == int(val) else str(val)
    s = str(val).replace("\\", "\\\\").replace("'", "''")
    return f"'{s}'"

def main():
    ruta = EXCEL_UPDATE if EXCEL_UPDATE.exists() else EXCEL_UPDATE_ALT
    if not ruta.exists():
        print(f"No se encuentra {EXCEL_UPDATE} ni {EXCEL_UPDATE_ALT}")
        print("Ejecuta primero: python scripts/preparar-excel-contactos.py")
        return
    df = pd.read_excel(ruta)
    if len(df) == 0:
        print("El archivo no tiene filas")
        return
    row = df.iloc[0]
    mapeo = mapear_columnas(df)
    sets = []
    for exc_col, bd_col in mapeo:
        val = row[exc_col]
        sets.append(f"  `{bd_col}` = {escapar_sql(val)}")
    sets_str = ",\n".join(sets)
    sql = f"""-- UPDATE cliente duplicado B75359596 (generado automaticamente)
UPDATE `clientes` SET
{sets_str}
WHERE `cli_dni_cif` = 'B75359596';
"""
    out = Path(__file__).parent / "update-cliente-b75359596.sql"
    with open(out, "w", encoding="utf-8") as f:
        f.write(sql)
    print(f"SQL generado: {out}")

if __name__ == "__main__":
    main()
