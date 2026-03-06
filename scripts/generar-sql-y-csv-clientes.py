#!/usr/bin/env python3
"""
Genera CSV y SQL INSERT desde el Excel preparado (SOLO_INSERT).
Para subir los datos manualmente en phpMyAdmin:
  - Importar CSV: Importar > Elegir archivo clientes-importar.csv
  - O ejecutar SQL: Copiar contenido de clientes-importar.sql

Esquema migrado: cli_com_id, cli_dni_cif, cli_direccion, etc.

Uso: python scripts/generar-sql-y-csv-clientes.py [ruta_excel]
"""
import csv
import sys
from pathlib import Path

import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
CRM_DIR = Path.home() / "iCloudDrive" / "01 FARMADESCANSO SL" / "04 PROVEEDORES" / "01 GEMAVIP" / "CRM"
EXCEL_INSERT = CRM_DIR / "GEMAVIP ESPAÑA SL_ - Contactos_SOLO_INSERT.xlsx"
EXCEL_UPDATE = CRM_DIR / "UPDATE_B75359596.xlsx"

# Excel -> BD (esquema migrado cli_*)
MAP_COLS = [
    ("Id_Cial", "cli_com_id"),
    ("DNI_CIF", "cli_dni_cif"),
    ("Nombre_Razon_Social", "cli_nombre_razon_social"),
    ("cli_direccion", "cli_direccion"),
    ("Direccion", "cli_direccion"),
    ("Direcci", "cli_direccion"),
    ("Poblaci", "cli_poblacion"),
    ("Poblacion", "cli_poblacion"),
    ("CodigoPostal", "cli_codigo_postal"),
    ("C_digo postal", "cli_codigo_postal"),
    ("Código postal", "cli_codigo_postal"),
    ("Telefono", "cli_telefono"),
    ("Tel_fono", "cli_telefono"),
    ("Teléfono", "cli_telefono"),
    ("cli_movil", "cli_movil"),
    ("Email", "cli_email"),
    ("cli_prov_id", "cli_prov_id"),
    ("cli_pais_id", "cli_pais_id"),
    ("cli_idiom_id", "cli_idiom_id"),
    ("cli_mon_id", "cli_mon_id"),
    ("cli_tipc_id", "cli_tipc_id"),
    ("cli_formp_id", "cli_formp_id"),
    ("Dto. %", "cli_dto"),
    ("IBAN", "cli_IBAN"),
    ("Swift", "cli_Swift"),
    ("cli_modelo_347", "cli_Modelo_347"),
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


def mapear_columnas(df):
    """Devuelve [(col_excel, col_bd), ...]."""
    result = []
    usados_bd = set()
    cols = [c for c in df.columns if c not in ("import_fila", "accion_import")]
    for exc_col, bd_col in MAP_COLS:
        if bd_col in usados_bd:
            continue
        for c in cols:
            if c == exc_col or exc_col in c:
                result.append((c, bd_col))
                usados_bd.add(bd_col)
                break
    return result


def escapar_sql(val, bd_col=None):
    if pd.isna(val) or (isinstance(val, str) and val.strip() == ""):
        return "NULL"
    # cli_creado_holded: solo datetime valido (YYYY-MM-DD HH:MM:SS)
    if bd_col == "cli_creado_holded":
        try:
            dt = pd.to_datetime(val)
            return f"'{dt.strftime('%Y-%m-%d %H:%M:%S')}'"
        except (ValueError, TypeError):
            return "NULL"
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        if isinstance(val, float) and val != int(val):
            return str(val)
        return str(int(val))
    s = str(val).replace("\\", "\\\\").replace("'", "''")
    return f"'{s}'"


def main():
    excel_path = Path(sys.argv[1]) if len(sys.argv) >= 2 else EXCEL_INSERT
    if not excel_path.exists():
        print(f"Error: No se encuentra {excel_path}")
        print("Ejecuta primero: python scripts/preparar-excel-contactos.py")
        sys.exit(1)

    print(f"Leyendo {excel_path}...")
    df = pd.read_excel(excel_path)
    mapeo = mapear_columnas(df)
    if not mapeo:
        print("Error: No se encontraron columnas para mapear")
        sys.exit(1)

    cols_bd = [bd for _, bd in mapeo]
    salida_dir = SCRIPT_DIR / "salida-importar"
    salida_dir.mkdir(exist_ok=True)

    # 1. CSV
    csv_path = salida_dir / "clientes-importar.csv"
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow(cols_bd)
        for _, row in df.iterrows():
            vals = []
            for exc_col, _ in mapeo:
                v = row.get(exc_col)
                if pd.isna(v) or (isinstance(v, str) and v.strip() == ""):
                    vals.append("")
                else:
                    vals.append(str(v))
            writer.writerow(vals)
    print(f"CSV generado: {csv_path}")

    # 2. SQL INSERT
    sql_path = salida_dir / "clientes-importar.sql"
    cols_sql = ", ".join(f"`{c}`" for c in cols_bd)
    lines = [
        "-- INSERT clientes desde Holded (esquema migrado cli_*)",
        f"-- Ejecutar en phpMyAdmin > crm_gemavip > SQL",
        "",
    ]
    for i, row in df.iterrows():
        vals = [escapar_sql(row.get(exc_col), bd_col) for exc_col, bd_col in mapeo]
        values_sql = ", ".join(vals)
        lines.append(f"INSERT INTO `clientes` ({cols_sql}) VALUES ({values_sql});")
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"SQL generado: {sql_path} ({len(df)} INSERT)")

    # 3. UPDATE duplicado B75359596
    if EXCEL_UPDATE.exists():
        df_up = pd.read_excel(EXCEL_UPDATE)
        if len(df_up) > 0:
            row = df_up.iloc[0]
            sets = [f"`{bd}` = {escapar_sql(row.get(exc), bd)}" for exc, bd in mapeo]
            sql_up = f"UPDATE `clientes` SET {', '.join(sets)} WHERE `cli_dni_cif` = 'B75359596';"
            update_path = salida_dir / "update-b75359596.sql"
            with open(update_path, "w", encoding="utf-8") as f:
                f.write(sql_up)
            print(f"UPDATE duplicado: {update_path}")

    print("\nListo. Sube clientes-importar.sql en phpMyAdmin > Importar > Elegir archivo.")

if __name__ == "__main__":
    main()
