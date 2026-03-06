#!/usr/bin/env python3
"""
Prepara el Excel de contactos Holded para importar en tabla clientes.
Resuelve las discrepancias críticas:
  1. Añade Id_Cial = 26 (comercial por defecto)
  2. DNI_CIF vacío → "Pendiente"
  3. Nombre vacío → "Pendiente Revisar"
  4. Móvil: normalizar (quitar espacios/tabs) y truncar a 13 caracteres
  5. Lookups: Provincia, País, Idioma, Moneda, TipoCliente, FormaPago (texto → ID)

Antes de ejecutar, exporta los catálogos de la BD:
  node scripts/export-catalogos-para-mappings.js

Uso: python preparar-excel-contactos.py [ruta_excel]
"""
import pandas as pd
import sys
import csv
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
MAPPINGS_DIR = SCRIPT_DIR / "mappings"

# Normalización de nombres de provincia (Excel Holded puede tener variantes)
PROVINCIA_NORMALIZAR = {
    "barcellona": "Barcelona",
    "provincia di jaén": "Jaén",
    "provincia di jaan": "Jaén",
    "provincia di alicante": "Alicante",
    "alicante/alacant": "Alicante",
    "la coruña": "A Coruña",
    "las palmas": "Las Palmas",
}

def cargar_mapping(nombre, col_clave, col_valor="id"):
    """Carga CSV de mappings y devuelve dict {clave_normalizada: valor}."""
    ruta = MAPPINGS_DIR / f"{nombre}.csv"
    if not ruta.exists():
        return {}
    d = {}
    with open(ruta, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            k = str(row.get(col_clave, "")).strip()
            if k:
                v = row.get(col_valor, "")
                try:
                    d[k.lower()] = int(v) if v else None
                except (ValueError, TypeError):
                    d[k.lower()] = None
    return d

def cargar_mapping_paises():
    """Países: lookup por codigo o nombre."""
    ruta = MAPPINGS_DIR / "paises.csv"
    if not ruta.exists():
        return {}
    d = {}
    with open(ruta, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            vid = row.get("id", "")
            try:
                id_val = int(vid) if vid else None
            except (ValueError, TypeError):
                id_val = None
            for k in [row.get("codigo", ""), row.get("nombre", "")]:
                k = str(k).strip()
                if k:
                    d[k.lower()] = id_val
    return d

def cargar_mapping_monedas():
    """Monedas: lookup por codigo o nombre."""
    ruta = MAPPINGS_DIR / "monedas.csv"
    if not ruta.exists():
        return {}
    d = {}
    with open(ruta, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            vid = row.get("id", "")
            try:
                id_val = int(vid) if vid else None
            except (ValueError, TypeError):
                id_val = None
            for k in [row.get("codigo", ""), row.get("nombre", "")]:
                k = str(k).strip()
                if k:
                    d[k.lower()] = id_val
    return d

def buscar_excel():
    """Busca el Excel en rutas conocidas si no se especifica ruta."""
    rutas = [
        Path.home() / "iCloudDrive" / "01 FARMADESCANSO SL" / "04 PROVEEDORES" / "01 GEMAVIP" / "CRM" / "GEMAVIP ESPAÑA SL_ - Contactos.xlsx",
        Path.home() / "Downloads" / "GEMAVIP ESPAÑA SL_ - Contactos.xlsx",
        Path.home() / "Downloads" / "GEMAVIP ESPAÑA SL - Contactos.xlsx",
    ]
    for f in rutas:
        if f.exists():
            return f
    # Fallback: buscar en iCloudDrive y Downloads
    for base in [Path.home() / "iCloudDrive", Path.home() / "Downloads"]:
        if base.exists():
            for f in base.rglob("*GEMAVIP*Contactos*.xlsx"):
                return f
    return None

def main():
    if len(sys.argv) >= 2:
        excel_original = Path(sys.argv[1])
    else:
        excel_original = buscar_excel()
        if not excel_original:
            excel_original = Path.home() / "iCloudDrive" / "01 FARMADESCANSO SL" / "04 PROVEEDORES" / "01 GEMAVIP" / "CRM" / "GEMAVIP ESPAÑA SL_ - Contactos.xlsx"

    if not excel_original.exists():
        print(f"Error: No se encuentra el archivo: {excel_original}")
        print("Uso: python preparar-excel-contactos.py <ruta_al_excel>")
        sys.exit(1)

    excel_salida = excel_original.parent / (excel_original.stem + " PREPARADO.xlsx")

    # Leer con cabecera en fila 4 (índice 3)
    df = pd.read_excel(excel_original, header=3)
    total = len(df)

    # 1. Añadir import_fila (ID secuencial 1..N para referencia, no es cli_id)
    df.insert(0, "import_fila", range(1, total + 1))

    # 2. Añadir Id_Cial = 26
    df.insert(1, "Id_Cial", 26)
    print(f"1. Id_Cial: añadida columna con valor 26 para las {total} filas")

    # 3. DNI_CIF (columna ID en Excel = CIF/NIF, no es cli_id) vacío → "Pendiente"
    col_id = "ID" if "ID" in df.columns else None
    if col_id:
        vacios = df[col_id].isna() | (df[col_id].astype(str).str.strip() == "")
        n_vacios = vacios.sum()
        df[col_id] = df[col_id].fillna("Pendiente")
        df.loc[df[col_id].astype(str).str.strip() == "", col_id] = "Pendiente"
        print(f"2. DNI_CIF: {n_vacios} vacíos rellenados con 'Pendiente'")
    else:
        print("2. DNI_CIF: columna 'ID' no encontrada")

    # 4. Nombre vacío → "Pendiente Revisar"
    col_nombre = "Nombre" if "Nombre" in df.columns else None
    if col_nombre:
        vacios_nom = df[col_nombre].isna() | (df[col_nombre].astype(str).str.strip() == "")
        n_vacios_nom = vacios_nom.sum()
        df[col_nombre] = df[col_nombre].fillna("Pendiente Revisar")
        df.loc[df[col_nombre].astype(str).str.strip() == "", col_nombre] = "Pendiente Revisar"
        print(f"3. Nombre: {n_vacios_nom} vacíos rellenados con 'Pendiente Revisar'")
    else:
        print("3. Nombre: columna 'Nombre' no encontrada")

    # 5. Móvil: normalizar y truncar a 13 caracteres (límite BD)
    col_movil = next((c for c in df.columns if "vil" in c.lower() or c == "Movil"), None)
    if col_movil:
        def normalizar_movil(val):
            if pd.isna(val) or str(val).strip() == "":
                return ""
            s = str(val).replace("\t", "").replace(" ", "").strip()
            return s[:13] if len(s) > 13 else s
        antes = (df[col_movil].astype(str).str.len() > 13).sum()
        df[col_movil] = df[col_movil].apply(normalizar_movil)
        if antes > 0:
            print(f"4. Móvil: {antes} registros normalizados y truncados a 13 caracteres")
        else:
            print(f"4. Móvil: normalizado (espacios/tabs eliminados)")
    else:
        print("4. Móvil: columna no encontrada")

    # 6. Lookups: Provincia, País, Idioma, Moneda, Tipo, F.Pago (texto → ID)
    map_prov = cargar_mapping("provincias", "nombre")
    map_pais = cargar_mapping_paises()
    map_idiom = cargar_mapping("idiomas", "nombre")
    map_moneda = cargar_mapping_monedas()
    map_tipo = cargar_mapping("tipos_clientes", "tipo")
    map_formp = cargar_mapping("formas_pago", "nombre")

    def lookup_provincia(val):
        if pd.isna(val) or str(val).strip() == "":
            return None
        s = str(val).strip().lower()
        s = PROVINCIA_NORMALIZAR.get(s, s).lower()
        # Quitar prefijos "provincia di/de "
        for pref in ("provincia di ", "provincia de ", "provincia "):
            if s.startswith(pref):
                s = s[len(pref):].strip()
        return map_prov.get(s) or map_prov.get(str(val).strip().lower())

    def lookup_pais(val):
        if pd.isna(val) or str(val).strip() == "":
            return None
        return map_pais.get(str(val).strip().lower())

    def lookup_simple(val, m):
        if pd.isna(val) or str(val).strip() == "":
            return None
        return m.get(str(val).strip().lower())

    n_lookups = 0
    if "Provincia" in df.columns and map_prov:
        df["cli_prov_id"] = df["Provincia"].apply(lookup_provincia)
        n_lookups += 1
    if "País" in df.columns and map_pais:
        df["cli_pais_id"] = df["País"].apply(lookup_pais)
        n_lookups += 1
    if "Código país" in df.columns and map_pais and "cli_pais_id" not in df.columns:
        df["cli_pais_id"] = df["Código país"].apply(lookup_pais)
        n_lookups += 1
    if "Idioma" in df.columns and map_idiom:
        df["cli_idiom_id"] = df["Idioma"].apply(lambda v: lookup_simple(v, map_idiom))
        n_lookups += 1
    if "Moneda" in df.columns and map_moneda:
        df["cli_mon_id"] = df["Moneda"].apply(lambda v: lookup_simple(v, map_moneda))
        n_lookups += 1
    if "Tipo" in df.columns and map_tipo:
        df["cli_tipc_id"] = df["Tipo"].apply(lambda v: lookup_simple(v, map_tipo))
        n_lookups += 1
    if "F.Pago" in df.columns and map_formp:
        df["cli_formp_id"] = df["F.Pago"].apply(lambda v: lookup_simple(v, map_formp))
        n_lookups += 1

    if n_lookups > 0:
        print(f"5. Lookups: {n_lookups} columnas resueltas (Provincia, País, Idioma, Moneda, Tipo, F.Pago)")
        print("   (Si los IDs no coinciden con tu BD, ejecuta: node scripts/export-catalogos-para-mappings.js)")
    else:
        if not MAPPINGS_DIR.exists() or not list(MAPPINGS_DIR.glob("*.csv")):
            print("5. Lookups: no hay mappings. Ejecuta: node scripts/export-catalogos-para-mappings.js")
        else:
            print("5. Lookups: no se encontraron columnas para mapear")

    # 6b. Acumula en modelo 347: Si->1, No->0 (default 1)
    col_347 = next((c for c in df.columns if "347" in c and "acumula" in c.lower()), None)
    if col_347 is None:
        col_347 = next((c for c in df.columns if "modelo" in c.lower() and "347" in c), None)
    if col_347:
        def map_modelo_347(val):
            if pd.isna(val) or str(val).strip() == "":
                return 1  # default BD
            s = str(val).strip().lower()
            if s in ("no", "0", "false", "n"):
                return 0
            return 1  # Sí, sí, true, 1, etc.
        df[col_347] = df[col_347].apply(map_modelo_347)
        print("5b. Modelo 347: Si->1, No->0 mapeado")

    # 7. Duplicado B75359596: marcar para UPDATE (actualizar cliente existente)
    DNI_DUPLICADO = "B75359596"
    col_dni = "DNI_CIF" if "DNI_CIF" in df.columns else ("ID" if "ID" in df.columns else None)
    if col_dni:
        df["accion_import"] = df[col_dni].apply(
            lambda v: "UPDATE" if str(v).strip().upper() == DNI_DUPLICADO.upper() else "INSERT"
        )
        n_update = (df["accion_import"] == "UPDATE").sum()
        if n_update > 0:
            print(f"7. Duplicado {DNI_DUPLICADO}: {n_update} fila(s) marcada(s) para UPDATE (no INSERT)")

    # 8. Renombrar columnas Excel -> columnas BD (clientes + nuevas Holded)
    rename_map = {
        "Nombre": "Nombre_Razon_Social",
        "ID": "DNI_CIF",
        "Móvil": "cli_movil",
        "Creado": "cli_creado_holded",
        "Referencia": "cli_referencia",
        "Régimen": "cli_regimen",
        "Regimen": "cli_regimen",  # por si encoding
        "Ref. mandato": "cli_ref_mandato",
        "Tags": "cli_tags",
        "Cuenta de ventas": "cli_cuenta_ventas",
        "Cuenta de compras": "cli_cuenta_compras",
        "Visibilidad Portal": "cli_visibilidad_portal",
        "Acumula en modelo 347": "cli_modelo_347",
    }
    to_rename = {k: v for k, v in rename_map.items() if k in df.columns}
    df = df.rename(columns=to_rename)
    if to_rename:
        print(f"8. Columnas: {len(to_rename)} renombradas para coincidir con BD")

    # Dirección de entrega: se importa en direccionesEnvio (cada cliente puede tener varias)

    # Guardar
    df.to_excel(excel_salida, index=False)
    print(f"\nArchivo guardado: {excel_salida}")

    # Guardar archivo solo INSERT (excluir duplicado para importar sin conflicto)
    if "accion_import" in df.columns:
        df_insert = df[df["accion_import"] == "INSERT"].drop(columns=["accion_import"])
        df_update = df[df["accion_import"] == "UPDATE"]
        excel_insert = excel_salida.parent / (excel_salida.stem.replace(" PREPARADO", "") + "_SOLO_INSERT.xlsx")
        df_insert.to_excel(excel_insert, index=False)
        print(f"Archivo solo INSERT (sin duplicado): {excel_insert}")
        if len(df_update) > 0:
            excel_update = excel_salida.parent / "UPDATE_B75359596.xlsx"
            df_update.to_excel(excel_update, index=False)
            print(f"Datos duplicado para UPDATE: {excel_update}")

if __name__ == "__main__":
    main()
