/**
 * Mapeo estático de columnas por tabla (auditoría: Metadata Discovery Overhead).
 * Evita SHOW COLUMNS / information_schema en cada request (crítico en Vercel serverless).
 * Basado en crm_gemavip.sql con prefijos por tabla.
 *
 * Si USE_STATIC_SCHEMA=0 o la tabla no está mapeada, se usa _getColumns dinámico (fallback).
 */
'use strict';

const SCHEMA_COLUMNS = {
  agenda: ['ag_id', 'ag_nombre', 'ag_apellidos', 'ag_cargo', 'ag_especialidad', 'ag_tipcar_id', 'ag_esp_id', 'ag_empresa', 'ag_email', 'ag_movil', 'ag_telefono', 'ag_extension', 'ag_notas', 'ag_activo', 'ag_creado_en', 'ag_actualizado_en'],
  agenda_especialidades: ['agesp_id', 'agesp_nombre', 'agesp_activo', 'agesp_creado_en', 'agesp_actualizado_en'],
  agenda_roles: ['agrol_id', 'agrol_nombre', 'agrol_activo', 'agrol_creado_en', 'agrol_actualizado_en'],
  articulos: ['art_id', 'art_sku', 'art_codigo_interno', 'art_nombre', 'art_presentacion', 'art_unidades_caja', 'art_largo_unidad', 'art_ancho_unidad', 'art_alto_unidad', 'art_kg_unidad', 'art_largo_caja', 'art_alto_caja', 'art_ancho_caja', 'art_peso_kg_Caja', 'art_cajas_palet', 'art_pvl', 'art_iva', 'art_imagen', 'art_mar_id', 'art_ean13', 'art_activo'],
  clientes: ['cli_id', 'cli_com_id', 'cli_dni_cif', 'cli_nombre_razon_social', 'cli_nombre_cial', 'cli_numero_farmacia', 'cli_direccion', 'cli_poblacion', 'cli_codigo_postal', 'cli_movil', 'cli_email', 'cli_tipo_cliente_txt', 'cli_tipc_id', 'cli_esp_id', 'cli_CodPais', 'cli_Pais', 'cli_Idioma', 'cli_idiom_id', 'cli_Moneda', 'cli_mon_id', 'cli_NomContacto', 'cli_tarifa_legacy', 'cli_formp_id', 'cli_dto', 'cli_CuentaContable', 'cli_RE', 'cli_Banco', 'cli_Swift', 'cli_IBAN', 'cli_Modelo_347', 'cli_prov_id', 'cli_codp_id', 'cli_telefono', 'cli_Web', 'cli_pais_id', 'cli_ok_ko', 'cli_estcli_id', 'cli_activo', 'cli_creado_holded', 'cli_referencia', 'cli_Id_Holded', 'cli_holded_sync_hash', 'cli_regimen', 'cli_ref_mandato', 'cli_tags', 'cli_cuenta_ventas', 'cli_cuenta_compras', 'cli_visibilidad_portal', 'cli_FechaBaja', 'cli_MotivoBaja', 'cli_tipo_contacto', 'cli_Id_cliente_relacionado', 'cli_regfis_id'],
  clientes_contactos: ['clicont_id', 'clicont_cli_id', 'clicont_ag_id', 'clicont_rol', 'clicont_es_principal', 'clicont_notas', 'clicont_vigente_desde', 'clicont_vigente_hasta', 'clicont_motivo_baja', 'clicont_creado_en', 'clicont_actualizado_en'],
  clientes_cooperativas: ['detco_id', 'detco_Id_Cooperativa', 'detco_Id_Cliente', 'detco_NumAsociado'],
  codigos_postales: ['codpos_id', 'codpos_CodigoPostal', 'codpos_Localidad', 'codpos_Provincia', 'codpos_Id_Provincia', 'codpos_ComunidadAutonoma', 'codpos_Latitud', 'codpos_Longitud', 'codpos_Activo', 'codpos_CreadoEn', 'codpos_ActualizadoEn', 'codpos_NumClientes', 'codpos_regfis_id'],
  direccionesEnvio: ['direnv_id', 'direnv_cli_id', 'direnv_ag_id', 'direnv_alias', 'direnv_nombre_destinatario', 'direnv_direccion', 'direnv_direccion2', 'direnv_poblacion', 'direnv_codigo_postal', 'direnv_prov_id', 'direnv_codp_id', 'direnv_pais_id', 'direnv_pais', 'direnv_telefono', 'direnv_movil', 'direnv_email', 'direnv_observaciones', 'direnv_es_principal', 'direnv_activa', 'direnv_creado_en', 'direnv_actualizado_en'],
  comerciales: ['com_id', 'com_nombre', 'com_email', 'com_dni', 'com_password', 'com_roll', 'com_fijo_mensual', 'com_movil', 'com_direccion', 'com_codp_id', 'com_poblacion', 'com_codigo_postal', 'com_prov_id', 'com_teams_access_token', 'com_teams_refresh_token', 'com_teams_email', 'com_teams_token_expires_at', 'com_meet_access_token', 'com_meet_refresh_token', 'com_meet_email', 'com_meet_token_expires_at', 'com_plataforma_reunion_preferida'],
  comerciales_codigos_postales_marcas: ['comdod_id', 'comdod_Id_Comercial', 'comdod_Id_CodigoPostal', 'comdod_Id_Marca', 'comdod_FechaInicio', 'comdod_FechaFin', 'comdod_Activo', 'comdod_Prioridad', 'comdod_Observaciones', 'comdod_CreadoPor', 'comdod_CreadoEn', 'comdod_ActualizadoEn'],
  cooperativas: ['coop_id', 'coop_nombre', 'coop_email', 'coop_telefono', 'coop_contacto'],
  especialidades: ['esp_id', 'esp_nombre', 'esp_observaciones'],
  estdoClientes: ['estcli_id', 'estcli_nombre'],
  formas_pago: ['formp_id', 'formp_nombre', 'formp_dias'],
  gruposCompras: ['grucom_id', 'grucom_Nombre', 'grucom_CIF', 'grucom_Email', 'grucom_Telefono', 'grucom_Contacto', 'grucom_Direccion', 'grucom_Poblacion', 'grucom_CodigoPostal', 'grucom_Provincia', 'grucom_Pais', 'grucom_Observaciones', 'grucom_Activo', 'grucom_CreadoEn', 'grucom_ActualizadoEn'],
  idiomas: ['idiom_id', 'idiom_codigo', 'idiom_nombre'],
  marcas: ['mar_id', 'mar_nombre', 'mar_activo'],
  notificaciones: ['notif_id', 'notif_tipo', 'notif_ag_id', 'notif_com_id', 'notif_estado', 'notif_com_admin_id', 'notif_fecha_creacion', 'notif_fecha_resolucion', 'notif_notas', 'notif_ped_id', 'notif_id_pedido'],
  paises: ['pais_id', 'pais_codigo', 'pais_nombre'],
  pedidos: ['ped_id', 'ped_com_id', 'ped_cli_id', 'ped_direnv_id', 'ped_formp_id', 'ped_tipp_id', 'ped_tarcli_id', 'ped_Serie', 'ped_numero', 'ped_fecha', 'ped_FechaEntrega', 'ped_estado_txt', 'ped_estped_id', 'ped_Id_EstadoPedido', 'ped_total', 'ped_base', 'ped_iva', 'ped_dto', 'ped_descuento', 'ped_id_holded', 'ped_regfis_id'],
  pedidos_articulos: ['pedart_id', 'pedart_ped_id', 'pedart_art_id', 'pedart_articulo_txt', 'pedart_numero', 'pedart_cantidad', 'pedart_pvp', 'pedart_dto', 'pedart_subtotal', 'pedart_DtoTotal', 'pedart_iva'],
  provincias: ['prov_id', 'prov_nombre', 'prov_codigo', 'prov_pais', 'prov_codigo_pais'],
  tarifasClientes: ['tarcli_id', 'tarcli_nombre', 'tarcli_activo'],
  tarifasClientes_precios: ['tarclip_id', 'tarclip_tarcli_id', 'tarclip_art_id', 'tarclip_precio'],
  tipos_clientes: ['tipc_id', 'tipc_tipo'],
  tipos_pedidos: ['tipp_id', 'tipp_tipo', 'tipp_activo'],
  visitas: ['vis_id', 'vis_cli_id', 'vis_com_id', 'vis_centp_id', 'vis_presc_id', 'vis_ruta_id', 'vis_tipo', 'vis_fecha', 'vis_hora', 'vis_hora_final', 'vis_estado', 'vis_notas', 'Id_Comercial', 'Hora_Final'],
  ventas_hefame: ['venhef_id', 'venhef_material_codigo', 'venhef_material_descripcion', 'venhef_provincia_codigo', 'venhef_provincia_nombre', 'venhef_mes', 'venhef_anio', 'venhef_cantidad', 'venhef_origen_archivo', 'venhef_created_at', 'venhef_updated_at'],
  regimenes_fiscales: ['regfis_id', 'regfis_codigo', 'regfis_nombre', 'regfis_nombre_corto', 'regfis_pais_codigo', 'regfis_activo', 'regfis_creado_en'],
  tipos_impuesto: ['timp_id', 'timp_regfis_id', 'timp_codigo', 'timp_nombre', 'timp_porcentaje', 'timp_es_defecto', 'timp_activo'],
  equivalencias_impuesto: ['eqimp_id', 'eqimp_timp_origen_id', 'eqimp_timp_destino_id'],
  estados_visita: ['estvis_id', 'estvis_nombre', 'estvis_activo'],
  tiposcargorol: ['tipcar_id', 'tipcar_nombre', 'tipcar_activo'],
  centros_prescriptores: ['cent_id', 'cent_nombre', 'cent_direccion', 'cent_poblacion', 'cent_codigo_postal', 'cent_prov_id', 'cent_telefono', 'cent_activo'],
  bancos: ['banco_id', 'banco_nombre', 'banco_entidad', 'banco_swift_bic', 'banco_fecha_alta']
};

const USE_STATIC = process.env.USE_STATIC_SCHEMA !== '0';

function getColumns(tableName) {
  if (!USE_STATIC) return null;
  const key = String(tableName || '').trim();
  if (SCHEMA_COLUMNS[key]) return SCHEMA_COLUMNS[key];
  const keyLower = key.toLowerCase();
  for (const k of Object.keys(SCHEMA_COLUMNS)) {
    if (k.toLowerCase() === keyLower) return SCHEMA_COLUMNS[k];
  }
  return null;
}

function hasStaticSchema(tableName) {
  return USE_STATIC && !!getColumns(tableName);
}

module.exports = { getColumns, hasStaticSchema, SCHEMA_COLUMNS };
