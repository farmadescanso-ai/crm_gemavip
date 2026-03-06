/**
 * Dominio: Clientes - CRUD (updateCliente, createCliente)
 * Lógica de actualización y creación de clientes.
 * Se invoca con db como contexto (this).
 */
'use strict';

const { debug } = require('../../lib/logger');
const { normalizeTelefonoForDB } = require('../../lib/telefono-utils');

const MAX_CODIGO_POSTAL_LENGTH = 8;

const CP_ESPANA_REGEX = /^[0-5][0-9]{4}$/;

function isProvinciaEspanola(provincia) {
  if (!provincia) return false;
  const cod = String(provincia.prov_codigo_pais ?? provincia.CodigoPais ?? provincia.codigo_pais ?? '').trim().toUpperCase();
  return cod === 'ES';
}

function isCpEspanol(cp) {
  if (!cp || typeof cp !== 'string') return false;
  const limpio = String(cp).trim().replace(/\s/g, '');
  return CP_ESPANA_REGEX.test(limpio);
}

function normalizePayloadTelefonos(payload) {
  const telCols = ['cli_telefono', 'cli_movil', 'Telefono', 'Movil'];
  for (const col of telCols) {
    if (payload[col] != null && String(payload[col]).trim()) {
      const norm = normalizeTelefonoForDB(payload[col]);
      payload[col] = norm;
    }
  }
}

function normalizePayloadCodigoPostal(payload) {
  const cpCols = ['cli_codigo_postal', 'CodigoPostal', 'codigo_postal'];
  for (const col of cpCols) {
    if (payload[col] != null && payload[col] !== '') {
      const raw = String(payload[col]).trim().replace(/\s+/g, ' ').trim();
      if (raw) {
        payload[col] = raw.slice(0, MAX_CODIGO_POSTAL_LENGTH);
      }
    }
  }
}

async function aplicarNormalizacionEspanaCliente(db, payload, { clienteActual, provincias }) {
  const cp = String(payload.cli_codigo_postal ?? payload.CodigoPostal ?? payload.codigo_postal ?? clienteActual?.cli_codigo_postal ?? clienteActual?.CodigoPostal ?? '').trim();
  const provId = payload.cli_prov_id ?? payload.Id_Provincia ?? payload.id_provincia ?? clienteActual?.cli_prov_id ?? clienteActual?.Id_Provincia;
  const poblacion = String(payload.cli_poblacion ?? payload.Poblacion ?? payload.poblacion ?? clienteActual?.cli_poblacion ?? clienteActual?.Poblacion ?? '').trim();

  const provincia = provId && provincias?.length
    ? provincias.find((p) => Number(p?.prov_id ?? p?.id ?? p?.Id ?? 0) === Number(provId))
    : null;
  const provinciaEspanola = isProvinciaEspanola(provincia);
  const cpEspanol = isCpEspanol(cp);

  if (provinciaEspanola || cpEspanol) {
    const espana = await db.getPaisByCodigoISO?.('ES').catch(() => null);
    if (espana) {
      const espanaId = espana.pais_id ?? espana.id ?? espana.Id;
      payload.cli_pais_id = espanaId;
      payload.Id_Pais = espanaId;
      payload.CodPais = 'ES';
      payload.Pais = espana.pais_nombre ?? espana.Nombre_pais ?? espana.Nombre ?? 'España';
    }
  }

  if (!cp && provinciaEspanola && poblacion && db.getCodigosPostales) {
    try {
      const cps = await db.getCodigosPostales({ idProvincia: provId, localidad: poblacion, limit: 1 });
      const cpRow = cps?.[0];
      const cpCol = cpRow?.codpos_CodigoPostal ?? cpRow?.CodigoPostal ?? cpRow?.codigo_postal;
      if (cpCol) {
        const cpVal = String(cpCol).trim().slice(0, MAX_CODIGO_POSTAL_LENGTH);
        payload.cli_codigo_postal = cpVal;
        payload.CodigoPostal = cpVal;
        payload.codigo_postal = cpVal;
      }
    } catch (_) {}
  }
}

module.exports = {
  async updateCliente(id, payload) {
    try {
      normalizePayloadTelefonos(payload);
      normalizePayloadCodigoPostal(payload);

      if (payload.Tarifa !== undefined) {
        const raw = payload.Tarifa;
        if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
          payload.Tarifa = 0;
        } else {
          const n = Number.parseInt(String(raw).trim(), 10);
          payload.Tarifa = Number.isFinite(n) ? n : 0;
        }
      }

      if (payload.OK_KO !== undefined && payload.OK_KO !== null) {
        const estado = payload.OK_KO;
        if (typeof estado === 'string') {
          const estadoLower = estado.toLowerCase().trim();
          if (!['activo', 'inactivo', 'ok', 'ko', '1', '0', 'true', 'false'].includes(estadoLower)) {
            throw new Error(`El campo Estado (OK_KO) solo puede ser "Activo" o "Inactivo". Valor recibido: "${estado}"`);
          }
          payload.OK_KO = (estadoLower === 'activo' || estadoLower === 'ok' || estadoLower === 'true' || estadoLower === '1') ? 1 : 0;
        } else if (typeof estado === 'number') {
          if (estado !== 0 && estado !== 1) {
            throw new Error(`El campo Estado (OK_KO) solo puede ser 1 (Activo) o 0 (Inactivo). Valor recibido: ${estado}`);
          }
          payload.OK_KO = estado;
        } else if (typeof estado === 'boolean') {
          payload.OK_KO = estado ? 1 : 0;
        } else {
          throw new Error(`El campo Estado (OK_KO) tiene un formato inválido. Valor recibido: ${estado} (tipo: ${typeof estado})`);
        }
      }

      const provincias = await this.getProvincias();
      const paises = await this.getPaises();

      const clienteActual = await this.getClienteById(id);
      await aplicarNormalizacionEspanaCliente(this, payload, { clienteActual, provincias });

      if (payload.Id_Pais !== undefined) {
        try {
          const pais = await this.getPaisById(payload.Id_Pais);
          if (pais) {
            const { normalizeTitleCaseES } = require('../../utils/normalize-utf8');
            payload.CodPais = pais.Id_pais;
            payload.Pais = normalizeTitleCaseES(pais.Nombre_pais || '');
          }
        } catch (error) {
          console.warn('⚠️  No se pudo obtener país por ID:', error.message);
        }
      }
      const efectivoPaisId = payload.cli_pais_id ?? payload.Id_Pais ?? clienteActual?.cli_pais_id ?? clienteActual?.Id_Pais;
      if (efectivoPaisId) {
        try {
          const pais = await this.getPaisById(efectivoPaisId);
          if (pais) {
            const codigoPais = String(pais.pais_codigo ?? pais.Id_pais ?? pais.id_pais ?? '').trim().toUpperCase();
            if (codigoPais === 'ES') {
              const cp = String(payload.cli_codigo_postal ?? payload.CodigoPostal ?? payload.codigo_postal ?? clienteActual?.cli_codigo_postal ?? clienteActual?.CodigoPostal ?? '').trim().replace(/\s/g, '');
              if (cp && !/^[0-9]{5}$/.test(cp)) {
                throw new Error('El código postal de España debe tener exactamente 5 dígitos numéricos.');
              }
            }
          }
        } catch (error) {
          if (error.message && error.message.includes('código postal')) throw error;
        }
      }
      const provinciaId = payload.Id_Provincia !== undefined ? payload.Id_Provincia : (clienteActual?.Id_Provincia || clienteActual?.id_Provincia);
      const paisId = payload.Id_Pais !== undefined ? payload.Id_Pais : (clienteActual?.Id_Pais || clienteActual?.id_Pais);

      // Preservar cli_com_id cuando es NOT NULL y el payload envía vacío o null
      const metaEarly = await this._ensureClientesMeta().catch(() => null);
      const colComercial = metaEarly?.colComercial || 'cli_com_id';
      const payloadComercial = payload[colComercial] ?? payload.cli_com_id ?? payload.Id_Cial;
      const currentComercial = clienteActual?.[colComercial] ?? clienteActual?.cli_com_id ?? clienteActual?.Id_Cial;
      if ((payloadComercial === null || payloadComercial === undefined || payloadComercial === '') && (currentComercial != null && currentComercial !== '')) {
        const val = Number(currentComercial) || currentComercial;
        payload[colComercial] = val;
        payload.cli_com_id = val;
      }

      try {
        const meta = await this._ensureClientesMeta();
        const colEstadoCliente = meta?.colEstadoCliente || null;
        if (colEstadoCliente) {
          const ids = await this._getEstadoClienteIds().catch(() => ({ potencial: 1, activo: 2, inactivo: 3 }));
          const dniToCheck = (payload.DNI_CIF !== undefined) ? payload.DNI_CIF : (clienteActual?.DNI_CIF);
          const dniValido = this._isValidDniCif(dniToCheck);
          const estadoFromPayload = payload.Id_EstdoCliente ?? payload[colEstadoCliente] ?? null;
          const estadoReq = (estadoFromPayload !== undefined && estadoFromPayload !== null && String(estadoFromPayload).trim() !== '')
            ? Number(estadoFromPayload)
            : null;
          const okKoToCheck = (payload.OK_KO !== undefined) ? payload.OK_KO : (clienteActual?.OK_KO);
          const esInactivoPorOkKo = (estadoReq === null) && (
            okKoToCheck === 0 || okKoToCheck === '0' || okKoToCheck === false ||
            (typeof okKoToCheck === 'string' && okKoToCheck.toUpperCase().trim() === 'KO')
          );
          let estadoFinal;
          if (estadoReq === ids.inactivo || esInactivoPorOkKo) {
            estadoFinal = ids.inactivo;
          } else if (estadoReq === ids.potencial) {
            estadoFinal = ids.potencial;
          } else if (estadoReq === ids.activo) {
            estadoFinal = dniValido ? ids.activo : ids.potencial;
          } else {
            estadoFinal = dniValido ? ids.activo : ids.potencial;
          }
          payload.Id_EstdoCliente = estadoFinal;
          payload[colEstadoCliente] = estadoFinal;
          payload.OK_KO = (estadoFinal === ids.inactivo) ? 0 : 1;
        }
      } catch (e) {
        console.warn('⚠️  [UPDATE] No se pudo calcular Id_EstdoCliente:', e?.message || e);
      }

      if (payload.CodigoPostal && (provinciaId || paisId)) {
        try {
          const { validarCodigoPostalProvinciaPais } = require('../../scripts/validar-codigo-postal-provincia-pais');
          const validacion = validarCodigoPostalProvinciaPais(payload.CodigoPostal, provinciaId, paisId, provincias, paises);
          if (!validacion.valido) throw new Error(validacion.error);
        } catch (error) {
          if (error.code === 'MODULE_NOT_FOUND' || (error.message && error.message.includes('Cannot find module'))) {
            // Módulo opcional
          } else {
            throw new Error(`Error de validación: ${error.message}`);
          }
        }
      }

      const cpVal = payload.cli_codigo_postal ?? payload.CodigoPostal ?? payload.codigo_postal ?? '';
      const provVal = payload.cli_prov_id ?? payload.Id_Provincia ?? payload.id_provincia;
      if (cpVal && (provVal === undefined || provVal === null || provVal === '')) {
        try {
          const { obtenerProvinciaPorCodigoPostal } = require('../../scripts/asociar-provincia-por-codigo-postal');
          if (provincias && provincias.length > 0) {
            const provinciaIdFromCP = obtenerProvinciaPorCodigoPostal(String(cpVal).trim(), provincias);
            if (provinciaIdFromCP) {
              payload.cli_prov_id = payload.Id_Provincia = provinciaIdFromCP;
              const provincia = provincias.find(p => (p?.id ?? p?.Id ?? p?.prov_id) == provinciaIdFromCP);
              if (provincia && (payload.cli_pais_id ?? payload.Id_Pais ?? payload.Pais) == null) {
                const pais = await this.getPaisByCodigoISO(provincia.CodigoPais);
                if (pais) {
                  payload.Id_Pais = pais.id;
                  payload.Pais = pais.Nombre_pais;
                  payload.CodPais = pais.Id_pais;
                } else {
                  payload.Pais = provincia.Pais;
                  payload.CodPais = provincia.CodigoPais;
                }
              }
            }
          }
        } catch (error) {
          if (error.code === 'MODULE_NOT_FOUND' || (error.message && error.message.includes('Cannot find module'))) {
            // Módulo opcional
          } else {
            console.warn('⚠️  No se pudo asociar provincia por código postal:', error.message);
          }
        }
      }

      const metaUpdate = await this._ensureClientesMeta().catch(() => null);
      if (!metaUpdate?.colTipoContacto && payload.TipoContacto !== undefined) delete payload.TipoContacto;
      if (payload.TipoContacto !== undefined && payload.TipoContacto !== null) {
        const t = String(payload.TipoContacto).trim();
        payload.TipoContacto = (t === 'Empresa' || t === 'Persona' || t === 'Otros') ? t : null;
      }

      try {
        const colsList = metaUpdate?.cols || [];
        const hasIdCodigoPostal = colsList.some((c) => String(c || '').toLowerCase() === 'id_codigopostal');
        if (hasIdCodigoPostal && payload.CodigoPostal !== undefined) {
          const cpRaw = String(payload.CodigoPostal ?? '').trim();
          if (!cpRaw) {
            payload.Id_CodigoPostal = null;
          } else if (payload.Id_CodigoPostal === undefined) {
            const codigosPostalesTable = await this._getCodigosPostalesTableName();
            if (codigosPostalesTable) {
              const cpLimpio = cpRaw.replace(/\s+/g, '');
              const rows = await this.query(`SELECT id FROM ${codigosPostalesTable} WHERE CodigoPostal = ? LIMIT 1`, [cpLimpio]).catch(() => []);
              if (rows && rows.length > 0) {
                payload.Id_CodigoPostal = rows[0].id;
              } else {
                const provinciaPick = provinciaId ? (provincias || []).find((p) => Number(p?.id ?? p?.Id ?? 0) === Number(provinciaId)) : null;
                const provinciaNombre = provinciaPick?.Nombre ?? provinciaPick?.nombre ?? null;
                const localidad = (payload.Poblacion !== undefined) ? payload.Poblacion : (clienteActual?.Poblacion ?? null);
                const creado = await this.createCodigoPostal({
                  CodigoPostal: cpLimpio,
                  Localidad: localidad || null,
                  Provincia: provinciaNombre || null,
                  Id_Provincia: provinciaId || null,
                  Activo: 1
                }).catch(() => null);
                if (creado?.insertId) {
                  payload.Id_CodigoPostal = creado.insertId;
                } else {
                  const retry = await this.query(`SELECT id FROM ${codigosPostalesTable} WHERE CodigoPostal = ? LIMIT 1`, [cpLimpio]).catch(() => []);
                  if (retry && retry.length > 0) payload.Id_CodigoPostal = retry[0].id;
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn('⚠️  [UPDATE] No se pudo resolver Id_CodigoPostal:', e?.message || e);
      }

      const fields = [];
      const values = [];
      const colsList = metaUpdate?.cols || [];
      const legacyToCol = {
        Nombre_Razon_Social: metaUpdate?.colNombreRazonSocial || 'cli_nombre_razon_social',
        Nombre_Cial: 'cli_nombre_cial',
        Id_Cial: metaUpdate?.colComercial || 'cli_com_id',
        Id_Provincia: metaUpdate?.colProvincia || 'cli_prov_id',
        Id_TipoCliente: metaUpdate?.colTipoCliente || 'cli_tipc_id',
        Id_EstdoCliente: metaUpdate?.colEstadoCliente || 'cli_estcli_id',
        Id_Pais: 'cli_pais_id',
        Id_FormaPago: 'cli_formp_id',
        Id_Idioma: 'cli_idiom_id',
        Id_Moneda: 'cli_mon_id',
        Id_Tarifa: 'cli_tarcli_id',
        Id_CodigoPostal: 'cli_codp_id',
        DNI_CIF: 'cli_dni_cif',
        Direccion: 'cli_direccion',
        Poblacion: 'cli_poblacion',
        CodigoPostal: 'cli_codigo_postal',
        Movil: 'cli_movil',
        Email: 'cli_email',
        Telefono: 'cli_telefono',
        TipoContacto: metaUpdate?.colTipoContacto || 'cli_tipo_contacto',
        Observaciones: metaUpdate?.colObservaciones,
        OK_KO: 'cli_ok_ko',
        Tarifa: 'cli_tarifa_legacy',
        Dto: 'cli_dto',
        TipoCliente: 'cli_tipo_cliente_txt',
        Activo: 'cli_activo',
        Id_Cliente_Relacionado: 'cli_Id_cliente_relacionado',
        cli_Id_cliente_relacionado: 'cli_Id_cliente_relacionado',
        CuentaContable: 'cli_cuenta_contable',
        cli_cuenta_contable: 'cli_cuenta_contable',
        RE: 'cli_re',
        cli_re: 'cli_re',
        Banco: 'cli_banco',
        cli_banco: 'cli_banco',
        Swift: 'cli_swift',
        cli_swift: 'cli_swift',
        IBAN: 'cli_iban',
        cli_iban: 'cli_iban',
        Modelo_347: 'cli_modelo_347',
        cli_modelo_347: 'cli_modelo_347',
        NumeroFarmacia: 'cli_numero_farmacia',
        cli_numero_farmacia: 'cli_numero_farmacia',
        NomContacto: 'NomContacto',
        Web: 'Web',
        MotivoBaja: 'MotivoBaja',
        FechaBaja: 'FechaBaja',
        // Campos Holded
        cli_creado_holded: 'cli_creado_holded',
        cli_referencia: 'cli_referencia',
        cli_regimen: 'cli_regimen',
        cli_ref_mandato: 'cli_ref_mandato',
        cli_tags: 'cli_tags',
        cli_cuenta_ventas: 'cli_cuenta_ventas',
        cli_cuenta_compras: 'cli_cuenta_compras',
        cli_visibilidad_portal: 'cli_visibilidad_portal'
      };
      const pickColName = (key) => {
        const mapped = legacyToCol[key];
        if (mapped && (!colsList.length || colsList.some(c => c.toLowerCase() === mapped.toLowerCase()))) return mapped;
        if (key === 'Observaciones' && metaUpdate?.colObservaciones) return metaUpdate.colObservaciones;
        if (!colsList.length) return key;
        const keyLower = String(key).toLowerCase();
        const found = colsList.find(c => c.toLowerCase() === keyLower);
        return found || null;
      };

      for (const [key, value] of Object.entries(payload)) {
        if (value === undefined) continue;
        const colName = pickColName(key);
        if (!colName) continue;
        const inTable = !colsList.length || colsList.some(c => c.toLowerCase() === colName.toLowerCase());
        if (!inTable) continue;
        fields.push(`\`${colName}\` = ?`);
        values.push(value === null ? null : value);
      }

      if (fields.length === 0) return { affectedRows: 0 };

      values.push(id);
      const tClientes = metaUpdate?.tClientes || await this._resolveTableNameCaseInsensitive('clientes');
      const pk = metaUpdate?.pk || 'Id';
      const sql = `UPDATE \`${tClientes}\` SET ${fields.join(', ')} WHERE \`${pk}\` = ?`;
      await this.query(sql, values);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando cliente:', error.message);
      throw error;
    }
  },

  async createCliente(payload) {
    try {
      normalizePayloadTelefonos(payload);
      normalizePayloadCodigoPostal(payload);

      if (payload.Tarifa === undefined || payload.Tarifa === null || (typeof payload.Tarifa === 'string' && payload.Tarifa.trim() === '')) {
        payload.Tarifa = 0;
      } else {
        const n = Number.parseInt(String(payload.Tarifa).trim(), 10);
        payload.Tarifa = Number.isFinite(n) ? n : 0;
      }

      if (payload.OK_KO !== undefined && payload.OK_KO !== null) {
        const estado = payload.OK_KO;
        if (typeof estado === 'string') {
          const estadoLower = estado.toLowerCase().trim();
          if (!['activo', 'inactivo', 'ok', 'ko', '1', '0', 'true', 'false'].includes(estadoLower)) {
            throw new Error(`El campo Estado (OK_KO) solo puede ser "Activo" o "Inactivo". Valor recibido: "${estado}"`);
          }
          payload.OK_KO = (estadoLower === 'activo' || estadoLower === 'ok' || estadoLower === 'true' || estadoLower === '1') ? 1 : 0;
        } else if (typeof estado === 'number') {
          if (estado !== 0 && estado !== 1) {
            throw new Error(`El campo Estado (OK_KO) solo puede ser 1 (Activo) o 0 (Inactivo). Valor recibido: ${estado}`);
          }
          payload.OK_KO = estado;
        } else if (typeof estado === 'boolean') {
          payload.OK_KO = estado ? 1 : 0;
        } else {
          throw new Error(`El campo Estado (OK_KO) tiene un formato inválido. Valor recibido: ${estado} (tipo: ${typeof estado})`);
        }
      } else {
        payload.OK_KO = 1;
      }

      if (payload.DNI_CIF !== undefined && payload.DNI_CIF !== null) {
        const dniValue = String(payload.DNI_CIF).trim();
        if (dniValue === '' || dniValue.toLowerCase() === 'pendiente') {
          payload.DNI_CIF = 'Pendiente';
        }
      }

      const meta = await this._ensureClientesMeta().catch(() => null);
      const colEstadoCliente = meta?.colEstadoCliente || null;
      if (colEstadoCliente) {
        const ids = await this._getEstadoClienteIds().catch(() => ({ potencial: 1, activo: 2, inactivo: 3 }));
        const dniToCheck = payload.DNI_CIF;
        const dniValido = this._isValidDniCif(dniToCheck);
        const okKo = payload.OK_KO;
        const esInactivo = (okKo === 0 || okKo === '0' || okKo === false);
        const estadoReq = payload.Id_EstdoCliente !== undefined && payload.Id_EstdoCliente !== null && String(payload.Id_EstdoCliente).trim() !== ''
          ? Number(payload.Id_EstdoCliente)
          : null;
        let estadoFinal;
        if (estadoReq === ids.inactivo || esInactivo) {
          estadoFinal = ids.inactivo;
        } else if (estadoReq === ids.potencial) {
          estadoFinal = ids.potencial;
        } else if (estadoReq === ids.activo) {
          estadoFinal = dniValido ? ids.activo : ids.potencial;
        } else {
          estadoFinal = dniValido ? ids.activo : ids.potencial;
        }
        payload.Id_EstdoCliente = estadoFinal;
        payload.OK_KO = (estadoFinal === ids.inactivo) ? 0 : 1;
      }

      if (!payload.Id_Pais) {
        const espana = await this.getPaisByCodigoISO('ES');
        if (espana) {
          payload.Id_Pais = espana.id;
          payload.CodPais = espana.Id_pais;
          payload.Pais = espana.Nombre_pais;
        }
      }

      const provincias = await this.getProvincias();
      const paises = await this.getPaises();

      await aplicarNormalizacionEspanaCliente(this, payload, { clienteActual: null, provincias });

      if (payload.Id_Pais !== undefined) {
        try {
          const pais = await this.getPaisById(payload.Id_Pais);
          if (pais) {
            const { normalizeTitleCaseES } = require('../../utils/normalize-utf8');
            payload.CodPais = pais.Id_pais;
            payload.Pais = normalizeTitleCaseES(pais.Nombre_pais || '');
            const codigoPais = String(pais.pais_codigo ?? pais.Id_pais ?? pais.id_pais ?? '').trim().toUpperCase();
            if (codigoPais === 'ES') {
              const cp = String(payload.cli_codigo_postal ?? payload.CodigoPostal ?? payload.codigo_postal ?? '').trim().replace(/\s/g, '');
              if (cp && !/^[0-9]{5}$/.test(cp)) {
                throw new Error('El código postal de España debe tener exactamente 5 dígitos numéricos.');
              }
            }
          }
        } catch (error) {
          if (error.message && error.message.includes('código postal')) throw error;
          console.warn('⚠️  No se pudo obtener país por ID:', error.message);
        }
      }

      if (payload.CodigoPostal && (payload.Id_Provincia || payload.Id_Pais)) {
        try {
          const { validarCodigoPostalProvinciaPais } = require('../../scripts/validar-codigo-postal-provincia-pais');
          const validacion = validarCodigoPostalProvinciaPais(payload.CodigoPostal, payload.Id_Provincia, payload.Id_Pais, provincias, paises);
          if (!validacion.valido) throw new Error(validacion.error);
        } catch (error) {
          if (error.code === 'MODULE_NOT_FOUND' || (error.message && error.message.includes('Cannot find module'))) {
            // Módulo opcional
          } else {
            throw new Error(`Error de validación: ${error.message}`);
          }
        }
      }

      const cpValCreate = payload.cli_codigo_postal ?? payload.CodigoPostal ?? payload.codigo_postal ?? '';
      const provValCreate = payload.cli_prov_id ?? payload.Id_Provincia ?? payload.id_provincia;
      if (cpValCreate && (provValCreate === undefined || provValCreate === null || provValCreate === '')) {
        try {
          const { obtenerProvinciaPorCodigoPostal } = require('../../scripts/asociar-provincia-por-codigo-postal');
          if (provincias && provincias.length > 0) {
            const provinciaId = obtenerProvinciaPorCodigoPostal(String(cpValCreate).trim(), provincias);
            if (provinciaId) {
              payload.cli_prov_id = payload.Id_Provincia = provinciaId;
              const provincia = provincias.find(p => (p?.id ?? p?.Id ?? p?.prov_id) == provinciaId);
              if (provincia && (payload.cli_pais_id ?? payload.Id_Pais ?? payload.Pais) == null) {
                const pais = await this.getPaisByCodigoISO(provincia.CodigoPais);
                if (pais) {
                  payload.Id_Pais = pais.id;
                  payload.Pais = pais.Nombre_pais;
                  payload.CodPais = pais.Id_pais;
                } else {
                  payload.Pais = provincia.Pais;
                  payload.CodPais = provincia.CodigoPais;
                }
              }
            }
          }
        } catch (error) {
          if (error.code === 'MODULE_NOT_FOUND' || (error.message && error.message.includes('Cannot find module'))) {
            // Módulo opcional
          } else {
            console.warn('⚠️  No se pudo asociar provincia por código postal:', error.message);
          }
        }
      }

      try {
        const colsList = Array.isArray(meta?.cols) ? meta.cols : [];
        const hasIdCodigoPostal = colsList.some((c) => String(c || '').toLowerCase() === 'id_codigopostal');
        if (hasIdCodigoPostal && payload.CodigoPostal && payload.Id_CodigoPostal === undefined) {
          const codigosPostalesTable = await this._getCodigosPostalesTableName();
          if (codigosPostalesTable) {
            const cpLimpio = String(payload.CodigoPostal || '').trim().replace(/\s+/g, '');
            if (cpLimpio) {
              const rows = await this.query(`SELECT id FROM ${codigosPostalesTable} WHERE CodigoPostal = ? LIMIT 1`, [cpLimpio]).catch(() => []);
              if (rows && rows.length > 0) {
                payload.Id_CodigoPostal = rows[0].id;
              } else {
                const provinciaPick = payload.Id_Provincia ? (provincias || []).find((p) => Number(p?.id ?? p?.Id ?? 0) === Number(payload.Id_Provincia)) : null;
                const provinciaNombre = provinciaPick?.Nombre ?? provinciaPick?.nombre ?? null;
                const creado = await this.createCodigoPostal({
                  CodigoPostal: cpLimpio,
                  Localidad: payload.Poblacion || null,
                  Provincia: provinciaNombre || null,
                  Id_Provincia: payload.Id_Provincia || null,
                  Activo: 1
                }).catch(() => null);
                if (creado?.insertId) {
                  payload.Id_CodigoPostal = creado.insertId;
                } else {
                  const retry = await this.query(`SELECT id FROM ${codigosPostalesTable} WHERE CodigoPostal = ? LIMIT 1`, [cpLimpio]).catch(() => []);
                  if (retry && retry.length > 0) payload.Id_CodigoPostal = retry[0].id;
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn('⚠️  [CREATE] No se pudo resolver Id_CodigoPostal:', e?.message || e);
      }

      if (!meta?.colTipoContacto && payload.TipoContacto !== undefined) delete payload.TipoContacto;
      if (payload.TipoContacto !== undefined && payload.TipoContacto !== null) {
        const t = String(payload.TipoContacto).trim();
        payload.TipoContacto = (t === 'Empresa' || t === 'Persona' || t === 'Otros') ? t : null;
      }

      const legacyToColCreate = {
        Nombre_Razon_Social: meta?.colNombreRazonSocial || 'cli_nombre_razon_social',
        Nombre_Cial: 'cli_nombre_cial',
        Id_Cial: meta?.colComercial || 'cli_com_id',
        Id_Provincia: meta?.colProvincia || 'cli_prov_id',
        Id_TipoCliente: meta?.colTipoCliente || 'cli_tipc_id',
        Id_EstdoCliente: meta?.colEstadoCliente || 'cli_estcli_id',
        Id_Pais: 'cli_pais_id',
        Id_FormaPago: 'cli_formp_id',
        Id_Idioma: 'cli_idiom_id',
        Id_Moneda: 'cli_mon_id',
        Id_Tarifa: 'cli_tarcli_id',
        Id_CodigoPostal: 'cli_codp_id',
        DNI_CIF: 'cli_dni_cif',
        Direccion: 'cli_direccion',
        Poblacion: 'cli_poblacion',
        CodigoPostal: 'cli_codigo_postal',
        Movil: 'cli_movil',
        Email: 'cli_email',
        Telefono: 'cli_telefono',
        TipoContacto: meta?.colTipoContacto || 'cli_tipo_contacto',
        Observaciones: meta?.colObservaciones,
        OK_KO: 'cli_ok_ko',
        Tarifa: 'cli_tarifa_legacy',
        Dto: 'cli_dto',
        TipoCliente: 'cli_tipo_cliente_txt',
        Activo: 'cli_activo',
        Id_Cliente_Relacionado: 'cli_Id_cliente_relacionado',
        cli_Id_cliente_relacionado: 'cli_Id_cliente_relacionado',
        CuentaContable: 'cli_cuenta_contable',
        cli_cuenta_contable: 'cli_cuenta_contable',
        RE: 'cli_re',
        cli_re: 'cli_re',
        Banco: 'cli_banco',
        cli_banco: 'cli_banco',
        Swift: 'cli_swift',
        cli_swift: 'cli_swift',
        IBAN: 'cli_iban',
        cli_iban: 'cli_iban',
        Modelo_347: 'cli_modelo_347',
        cli_modelo_347: 'cli_modelo_347',
        NumeroFarmacia: 'cli_numero_farmacia',
        cli_numero_farmacia: 'cli_numero_farmacia',
        NomContacto: 'NomContacto',
        Web: 'Web',
        MotivoBaja: 'MotivoBaja',
        FechaBaja: 'FechaBaja',
        // Campos Holded
        cli_creado_holded: 'cli_creado_holded',
        cli_referencia: 'cli_referencia',
        cli_regimen: 'cli_regimen',
        cli_ref_mandato: 'cli_ref_mandato',
        cli_tags: 'cli_tags',
        cli_cuenta_ventas: 'cli_cuenta_ventas',
        cli_cuenta_compras: 'cli_cuenta_compras',
        cli_visibilidad_portal: 'cli_visibilidad_portal'
      };
      const colsListCreate = meta?.cols || [];
      const mappedPayload = {};
      for (const [key, value] of Object.entries(payload)) {
        if (value === undefined) continue;
        const col = legacyToColCreate[key] || (colsListCreate.some(c => c.toLowerCase() === String(key).toLowerCase()) ? key : null);
        if (col && (colsListCreate.length === 0 || colsListCreate.some(c => c.toLowerCase() === col.toLowerCase()))) {
          mappedPayload[col] = value === null ? null : value;
        }
      }

      const keys = this._filterPayloadKeys(mappedPayload);
      const fields = keys.map(key => `\`${key}\``).join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map(key => mappedPayload[key]);

      if (!this.connected && !this.pool) {
        await this.connect();
      }

      const tClientes = await this._resolveTableNameCaseInsensitive('clientes');
      const sql = `INSERT INTO \`${tClientes}\` (${fields}) VALUES (${placeholders})`;
      const [result] = await this.pool.execute(sql, values);
      const insertId = result.insertId;

      if (!insertId) {
        console.error('❌ No se pudo obtener insertId del resultado:', result);
        throw new Error('No se pudo obtener el ID del cliente creado');
      }

      debug('✅ Cliente creado con ID:', insertId);
      return {
        insertId: insertId,
        Id: insertId,
        id: insertId
      };
    } catch (error) {
      console.error('❌ Error creando cliente:', error.message);
      throw error;
    }
  }
};
