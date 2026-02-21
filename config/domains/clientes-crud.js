/**
 * Dominio: Clientes - CRUD (updateCliente, createCliente)
 * Lógica de actualización y creación de clientes.
 * Se invoca con db como contexto (this).
 */
'use strict';

module.exports = {
  async updateCliente(id, payload) {
    try {
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

      const clienteActual = await this.getClienteById(id);
      const provinciaId = payload.Id_Provincia !== undefined ? payload.Id_Provincia : (clienteActual?.Id_Provincia || clienteActual?.id_Provincia);
      const paisId = payload.Id_Pais !== undefined ? payload.Id_Pais : (clienteActual?.Id_Pais || clienteActual?.id_Pais);

      try {
        const meta = await this._ensureClientesMeta();
        const colEstadoCliente = meta?.colEstadoCliente || null;
        if (colEstadoCliente) {
          const ids = await this._getEstadoClienteIds().catch(() => ({ potencial: 1, activo: 2, inactivo: 3 }));
          const dniToCheck = (payload.DNI_CIF !== undefined) ? payload.DNI_CIF : (clienteActual?.DNI_CIF);
          const dniValido = this._isValidDniCif(dniToCheck);
          const estadoReq = (payload.Id_EstdoCliente !== undefined && payload.Id_EstdoCliente !== null && String(payload.Id_EstdoCliente).trim() !== '')
            ? Number(payload.Id_EstdoCliente)
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

      if (payload.CodigoPostal && !payload.Id_Provincia) {
        try {
          const { obtenerProvinciaPorCodigoPostal } = require('../../scripts/asociar-provincia-por-codigo-postal');
          if (provincias && provincias.length > 0) {
            const provinciaIdFromCP = obtenerProvinciaPorCodigoPostal(payload.CodigoPostal, provincias);
            if (provinciaIdFromCP) {
              payload.Id_Provincia = provinciaIdFromCP;
              const provincia = provincias.find(p => p.id === provinciaIdFromCP);
              if (provincia && !payload.Id_Pais && !payload.Pais) {
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
        Activo: 'cli_activo'
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

      if (payload.CodigoPostal && !payload.Id_Provincia) {
        try {
          const { obtenerProvinciaPorCodigoPostal } = require('../../scripts/asociar-provincia-por-codigo-postal');
          if (provincias && provincias.length > 0) {
            const provinciaId = obtenerProvinciaPorCodigoPostal(payload.CodigoPostal, provincias);
            if (provinciaId) {
              payload.Id_Provincia = provinciaId;
              const provincia = provincias.find(p => p.id === provinciaId);
              if (provincia && !payload.Id_Pais && !payload.Pais) {
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
        Activo: 'cli_activo'
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

      const fields = Object.keys(mappedPayload).map(key => `\`${key}\``).join(', ');
      const placeholders = Object.keys(mappedPayload).map(() => '?').join(', ');
      const values = Object.values(mappedPayload);

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

      console.log(`✅ Cliente creado con ID: ${insertId}`);
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
