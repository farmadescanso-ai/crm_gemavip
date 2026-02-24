/**
 * Módulo de códigos postales y asignaciones comerciales para MySQL CRM.
 * CRUD códigos postales, asignaciones comerciales-códigos postales-marcas.
 * Se asigna al prototipo de MySQLCRM con Object.assign.
 */
'use strict';

module.exports = {
  async _getCodigosPostalesTableName() {
    this._cache = this._cache || {};
    if (this._cache.codigosPostalesTableName !== undefined) return this._cache.codigosPostalesTableName;
    try {
      const rows = await this.query(
        `SELECT table_name AS name
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND LOWER(table_name) = 'codigos_postales'
         ORDER BY (table_name = 'codigos_postales') DESC, table_name ASC
         LIMIT 1`
      );
      const name = rows?.[0]?.name || null;
      this._cache.codigosPostalesTableName = name;
      return name;
    } catch (_) {
      this._cache.codigosPostalesTableName = null;
      return null;
    }
  },

  async _getAsignacionesCpMarcasTableName() {
    this._cache = this._cache || {};
    if (this._cache.asignacionesCpMarcasTableName !== undefined) return this._cache.asignacionesCpMarcasTableName;
    try {
      const rows = await this.query(
        `SELECT table_name AS name
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND LOWER(table_name) = 'comerciales_codigos_postales_marcas'
         ORDER BY (table_name = 'comerciales_codigos_postales_marcas') DESC, table_name ASC
         LIMIT 1`
      );
      const name = rows?.[0]?.name || null;
      this._cache.asignacionesCpMarcasTableName = name;
      return name;
    } catch (_) {
      this._cache.asignacionesCpMarcasTableName = null;
      return null;
    }
  },

  async _getComercialesTableName() {
    this._cache = this._cache || {};
    if (this._cache.comercialesTableName !== undefined) return this._cache.comercialesTableName;
    try {
      const rows = await this.query(
        `SELECT table_name AS name
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND LOWER(table_name) = 'comerciales'
         ORDER BY (table_name = 'comerciales') DESC, table_name ASC
         LIMIT 1`
      );
      const name = rows?.[0]?.name || 'Comerciales';
      this._cache.comercialesTableName = name;
      return name;
    } catch (_) {
      this._cache.comercialesTableName = 'Comerciales';
      return 'Comerciales';
    }
  },

  async _getMarcasTableName() {
    this._cache = this._cache || {};
    if (this._cache.marcasTableName !== undefined) return this._cache.marcasTableName;
    try {
      const rows = await this.query(
        `SELECT table_name AS name
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND LOWER(table_name) = 'marcas'
         ORDER BY (table_name = 'marcas') DESC, table_name ASC
         LIMIT 1`
      );
      const name = rows?.[0]?.name || 'Marcas';
      this._cache.marcasTableName = name;
      return name;
    } catch (_) {
      this._cache.marcasTableName = 'Marcas';
      return 'Marcas';
    }
  },

  async getCodigosPostales(filtros = {}) {
    try {
      const codigosPostalesTable = await this._getCodigosPostalesTableName();
      if (!codigosPostalesTable) {
        console.warn('⚠️ [CODIGOS-POSTALES] La tabla de códigos postales no existe (Codigos_Postales/codigos_postales).');
        return [];
      }

      let sql = `
        SELECT cp.*, p.Nombre AS NombreProvincia, p.Codigo AS CodigoProvincia
        FROM ${codigosPostalesTable} cp
        LEFT JOIN provincias p ON (cp.Id_Provincia = p.id OR cp.Id_Provincia = p.Id)
        WHERE 1=1
      `;
      const params = [];

      if (filtros.codigoPostal) {
        sql += ' AND cp.CodigoPostal LIKE ?';
        params.push(`%${filtros.codigoPostal}%`);
      }
      if (filtros.localidad) {
        sql += ' AND cp.Localidad LIKE ?';
        params.push(`%${filtros.localidad}%`);
      }
      if (filtros.provincia) {
        sql += ' AND cp.Provincia LIKE ?';
        params.push(`%${filtros.provincia}%`);
      }
      if (filtros.idProvincia) {
        sql += ' AND cp.Id_Provincia = ?';
        params.push(filtros.idProvincia);
      }
      if (filtros.activo !== undefined) {
        sql += ' AND cp.Activo = ?';
        params.push(filtros.activo ? 1 : 0);
      }

      sql += ' ORDER BY cp.Provincia, cp.Localidad, cp.CodigoPostal';

      if (filtros.limit) {
        sql += ' LIMIT ?';
        params.push(filtros.limit);
        if (filtros.offset) {
          sql += ' OFFSET ?';
          params.push(filtros.offset);
        }
      }

      const rows = await this.query(sql, params);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo códigos postales:', error.message);
      throw error;
    }
  },

  async getCodigoPostalById(id) {
    try {
      const codigosPostalesTable = await this._getCodigosPostalesTableName();
      if (!codigosPostalesTable) return null;
      const sql = `
        SELECT cp.*, p.Nombre AS NombreProvincia, p.Codigo AS CodigoProvincia
        FROM ${codigosPostalesTable} cp
        LEFT JOIN provincias p ON (cp.Id_Provincia = p.id OR cp.Id_Provincia = p.Id)
        WHERE cp.id = ?
      `;
      const rows = await this.query(sql, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo código postal por ID:', error.message);
      throw error;
    }
  },

  async createCodigoPostal(data) {
    try {
      const cpTableRows = await this.query(
        `SELECT table_name AS name
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND LOWER(table_name) = 'codigos_postales'
         LIMIT 1`
      );
      const codigosPostalesTable = cpTableRows?.[0]?.name;
      if (!codigosPostalesTable) {
        throw new Error('La tabla de códigos postales no existe (Codigos_Postales/codigos_postales).');
      }

      const sql = `
        INSERT INTO ${codigosPostalesTable}
        (CodigoPostal, Localidad, Provincia, Id_Provincia, ComunidadAutonoma, Latitud, Longitud, Activo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        data.CodigoPostal,
        data.Localidad,
        data.Provincia,
        data.Id_Provincia || null,
        data.ComunidadAutonoma || null,
        data.Latitud || null,
        data.Longitud || null,
        data.Activo !== undefined ? (data.Activo ? 1 : 0) : 1
      ];

      const result = await this.query(sql, params);
      return {
        success: true,
        insertId: result.insertId,
        affectedRows: result.affectedRows
      };
    } catch (error) {
      console.error('❌ Error creando código postal:', error.message);
      throw error;
    }
  },

  async updateCodigoPostal(id, data) {
    try {
      const codigosPostalesTable = await this._getCodigosPostalesTableName();
      if (!codigosPostalesTable) {
        throw new Error('La tabla de códigos postales no existe (Codigos_Postales/codigos_postales).');
      }
      const campos = [];
      const params = [];

      if (data.CodigoPostal !== undefined) {
        campos.push('CodigoPostal = ?');
        params.push(data.CodigoPostal);
      }
      if (data.Localidad !== undefined) {
        campos.push('Localidad = ?');
        params.push(data.Localidad);
      }
      if (data.Provincia !== undefined) {
        campos.push('Provincia = ?');
        params.push(data.Provincia);
      }
      if (data.Id_Provincia !== undefined) {
        campos.push('Id_Provincia = ?');
        params.push(data.Id_Provincia);
      }
      if (data.ComunidadAutonoma !== undefined) {
        campos.push('ComunidadAutonoma = ?');
        params.push(data.ComunidadAutonoma);
      }
      if (data.Latitud !== undefined) {
        campos.push('Latitud = ?');
        params.push(data.Latitud);
      }
      if (data.Longitud !== undefined) {
        campos.push('Longitud = ?');
        params.push(data.Longitud);
      }
      if (data.Activo !== undefined) {
        campos.push('Activo = ?');
        params.push(data.Activo ? 1 : 0);
      }

      if (campos.length === 0) {
        return { success: true, affectedRows: 0 };
      }

      params.push(id);
      const sql = `UPDATE ${codigosPostalesTable} SET ${campos.join(', ')} WHERE id = ?`;
      const result = await this.query(sql, params);

      return {
        success: true,
        affectedRows: result.affectedRows,
        changedRows: result.changedRows
      };
    } catch (error) {
      console.error('❌ Error actualizando código postal:', error.message);
      throw error;
    }
  },

  async deleteCodigoPostal(id) {
    try {
      const codigosPostalesTable = await this._getCodigosPostalesTableName();
      if (!codigosPostalesTable) {
        throw new Error('La tabla de códigos postales no existe (Codigos_Postales/codigos_postales).');
      }
      const sql = `DELETE FROM ${codigosPostalesTable} WHERE id = ?`;
      const result = await this.query(sql, [id]);
      return {
        success: true,
        affectedRows: result.affectedRows
      };
    } catch (error) {
      console.error('❌ Error eliminando código postal:', error.message);
      throw error;
    }
  },

  async getAsignaciones(filtros = {}) {
    try {
      const asignacionesTable = await this._getAsignacionesCpMarcasTableName();
      if (!asignacionesTable) {
        console.warn('⚠️ [ASIGNACIONES] La tabla de asignaciones no existe (Comerciales_Codigos_Postales_Marcas/comerciales_codigos_postales_marcas).');
        return [];
      }
      const codigosPostalesTable = await this._getCodigosPostalesTableName();
      if (!codigosPostalesTable) {
        console.warn('⚠️ [ASIGNACIONES] La tabla de códigos postales no existe (Codigos_Postales/codigos_postales).');
        return [];
      }
      const comercialesTable = await this._getComercialesTableName();
      const marcasTable = await this._getMarcasTableName();

      let sql = `
        SELECT 
          ccp.id,
          ccp.Id_Comercial,
          ccp.Id_CodigoPostal,
          ccp.Id_Marca,
          ccp.FechaInicio,
          ccp.FechaFin,
          ccp.Activo,
          ccp.Prioridad,
          ccp.Observaciones,
          ccp.CreadoPor,
          ccp.CreadoEn,
          ccp.ActualizadoEn,
          c.Nombre AS NombreComercial,
          c.Email AS EmailComercial,
          cp.CodigoPostal,
          cp.Localidad,
          cp.Provincia,
          m.Nombre AS NombreMarca,
          COALESCE(
            (SELECT cl.Poblacion 
             FROM Clientes cl 
             WHERE (cl.Id_CodigoPostal = cp.id OR cl.CodigoPostal = cp.CodigoPostal)
               AND cl.Poblacion IS NOT NULL 
               AND cl.Poblacion != ''
             GROUP BY cl.Poblacion 
             ORDER BY COUNT(*) DESC 
             LIMIT 1),
            cp.Localidad
          ) AS Poblacion,
          COALESCE(cp.NumClientes, 0) AS NumClientes
        FROM ${asignacionesTable} ccp
        INNER JOIN ${comercialesTable} c ON (ccp.Id_Comercial = c.id OR ccp.Id_Comercial = c.Id)
        INNER JOIN ${codigosPostalesTable} cp ON (ccp.Id_CodigoPostal = cp.id OR ccp.Id_CodigoPostal = cp.Id)
        INNER JOIN ${marcasTable} m ON (ccp.Id_Marca = m.id OR ccp.Id_Marca = m.Id)
        WHERE 1=1
      `;
      const params = [];

      if (filtros.idComercial) {
        sql += ' AND ccp.Id_Comercial = ?';
        params.push(filtros.idComercial);
      }
      if (filtros.idCodigoPostal) {
        sql += ' AND ccp.Id_CodigoPostal = ?';
        params.push(filtros.idCodigoPostal);
      }
      if (filtros.idMarca) {
        sql += ' AND ccp.Id_Marca = ?';
        params.push(filtros.idMarca);
      }
      if (filtros.idProvincia) {
        sql += ' AND cp.Id_Provincia = ?';
        params.push(filtros.idProvincia);
      }
      if (filtros.provincia) {
        sql += ' AND cp.Provincia = ?';
        params.push(filtros.provincia);
      }
      if (filtros.activo !== undefined) {
        sql += ' AND ccp.Activo = ?';
        params.push(filtros.activo ? 1 : 0);
      }
      if (filtros.soloActivos === true) {
        sql += ' AND ccp.Activo = 1 AND (ccp.FechaFin IS NULL OR ccp.FechaFin >= CURDATE())';
      }

      sql += ' ORDER BY cp.Provincia, cp.Localidad, m.Nombre, ccp.Prioridad DESC';

      if (filtros.limit) {
        sql += ' LIMIT ?';
        params.push(filtros.limit);
        if (filtros.offset) {
          sql += ' OFFSET ?';
          params.push(filtros.offset);
        }
      }

      const rows = await this.query(sql, params);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('❌ [ASIGNACIONES] Error obteniendo asignaciones:', error.message);
      return [];
    }
  },

  async getAsignacionById(id) {
    try {
      const asignacionesTable = await this._getAsignacionesCpMarcasTableName();
      const codigosPostalesTable = await this._getCodigosPostalesTableName();
      const comercialesTable = await this._getComercialesTableName();
      const marcasTable = await this._getMarcasTableName();
      if (!asignacionesTable || !codigosPostalesTable) return null;
      const sql = `
        SELECT 
          ccp.*,
          c.Nombre AS NombreComercial,
          c.Email AS EmailComercial,
          cp.CodigoPostal,
          cp.Localidad,
          cp.Provincia,
          m.Nombre AS NombreMarca
        FROM ${asignacionesTable} ccp
        INNER JOIN ${comercialesTable} c ON (ccp.Id_Comercial = c.id OR ccp.Id_Comercial = c.Id)
        INNER JOIN ${codigosPostalesTable} cp ON (ccp.Id_CodigoPostal = cp.id OR ccp.Id_CodigoPostal = cp.Id)
        INNER JOIN ${marcasTable} m ON (ccp.Id_Marca = m.id OR ccp.Id_Marca = m.Id)
        WHERE ccp.id = ?
      `;
      const rows = await this.query(sql, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo asignación por ID:', error.message);
      throw error;
    }
  },

  async createAsignacion(data) {
    try {
      if (!data || !data.Id_Comercial) {
        throw new Error('Id_Comercial es obligatorio');
      }
      if (!data.Id_CodigoPostal) {
        throw new Error('Id_CodigoPostal es obligatorio');
      }
      if (!data.Id_Marca) {
        throw new Error('Id_Marca es obligatorio');
      }

      const asignacionesTable = await this._getAsignacionesCpMarcasTableName();
      if (!asignacionesTable) {
        throw new Error('La tabla de asignaciones no existe (Comerciales_Codigos_Postales_Marcas/comerciales_codigos_postales_marcas). Ejecuta `scripts/crear-tabla-codigos-postales.sql` en la BD correcta.');
      }

      const sql = `
        INSERT INTO ${asignacionesTable} 
        (Id_Comercial, Id_CodigoPostal, Id_Marca, FechaInicio, FechaFin, Activo, Prioridad, Observaciones, CreadoPor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        data.Id_Comercial,
        data.Id_CodigoPostal,
        data.Id_Marca,
        data.FechaInicio || null,
        data.FechaFin || null,
        data.Activo !== undefined ? (data.Activo ? 1 : 0) : 1,
        data.Prioridad || 0,
        data.Observaciones || null,
        data.CreadoPor || null
      ];

      const result = await this.query(sql, params);
      return {
        success: true,
        insertId: result.insertId,
        affectedRows: result.affectedRows
      };
    } catch (error) {
      console.error('❌ Error creando asignación:', error.message);
      throw error;
    }
  },

  async updateAsignacion(id, data) {
    try {
      const asignacionesTable = await this._getAsignacionesCpMarcasTableName();
      if (!asignacionesTable) {
        throw new Error('La tabla de asignaciones no existe (Comerciales_Codigos_Postales_Marcas/comerciales_codigos_postales_marcas).');
      }
      const campos = [];
      const params = [];

      if (data.Id_Comercial !== undefined) {
        campos.push('Id_Comercial = ?');
        params.push(data.Id_Comercial);
      }
      if (data.Id_CodigoPostal !== undefined) {
        campos.push('Id_CodigoPostal = ?');
        params.push(data.Id_CodigoPostal);
      }
      if (data.Id_Marca !== undefined) {
        campos.push('Id_Marca = ?');
        params.push(data.Id_Marca);
      }
      if (data.FechaInicio !== undefined) {
        campos.push('FechaInicio = ?');
        params.push(data.FechaInicio);
      }
      if (data.FechaFin !== undefined) {
        campos.push('FechaFin = ?');
        params.push(data.FechaFin);
      }
      if (data.Activo !== undefined) {
        campos.push('Activo = ?');
        params.push(data.Activo ? 1 : 0);
      }
      if (data.Prioridad !== undefined) {
        campos.push('Prioridad = ?');
        params.push(data.Prioridad);
      }
      if (data.Observaciones !== undefined) {
        campos.push('Observaciones = ?');
        params.push(data.Observaciones);
      }

      if (campos.length === 0) {
        return { success: true, affectedRows: 0 };
      }

      params.push(id);
      const sql = `UPDATE ${asignacionesTable} SET ${campos.join(', ')} WHERE id = ?`;
      const result = await this.query(sql, params);

      return {
        success: true,
        affectedRows: result.affectedRows,
        changedRows: result.changedRows
      };
    } catch (error) {
      console.error('❌ Error actualizando asignación:', error.message);
      throw error;
    }
  },

  async deleteAsignacion(id) {
    try {
      const asignacionesTable = await this._getAsignacionesCpMarcasTableName();
      if (!asignacionesTable) {
        throw new Error('La tabla de asignaciones no existe (Comerciales_Codigos_Postales_Marcas/comerciales_codigos_postales_marcas).');
      }
      const sql = `DELETE FROM ${asignacionesTable} WHERE id = ?`;
      const result = await this.query(sql, [id]);
      return {
        success: true,
        affectedRows: result.affectedRows
      };
    } catch (error) {
      console.error('❌ Error eliminando asignación:', error.message);
      throw error;
    }
  },

  async createAsignacionesMasivas(data) {
    if (!this.connected && !this.pool) await this.connect();
    const connection = await this.pool.getConnection();
    const asignacionesTable = await this._getAsignacionesCpMarcasTableName();
    const codigosPostalesTable = await this._getCodigosPostalesTableName();
    const clientesTable = await this._resolveTableNameCaseInsensitive('clientes');

    try {
      await connection.beginTransaction();

      const {
        Id_Comercial,
        Ids_CodigosPostales = [],
        Id_Marca = null,
        FechaInicio = null,
        FechaFin = null,
        Prioridad = 0,
        Activo = true,
        Observaciones = null,
        CreadoPor = null,
        ActualizarClientes = true
      } = data;

      if (!Id_Comercial || !Ids_CodigosPostales || Ids_CodigosPostales.length === 0) {
        throw new Error('Id_Comercial e Ids_CodigosPostales son obligatorios');
      }

      let marcas = [];
      if (Id_Marca === null || Id_Marca === '') {
        let hasActivoColumn = false;
        try {
          const [columns] = await this.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
              AND TABLE_NAME = 'Marcas' 
              AND COLUMN_NAME = 'Activo'
          `);
          hasActivoColumn = columns && columns.length > 0;
        } catch (e) {
          console.warn('⚠️ [ASIGNACIONES-MASIVAS] No se pudo verificar la columna Activo en Marcas:', e.message);
        }

        const sqlMarcas = hasActivoColumn
          ? 'SELECT id FROM Marcas WHERE Activo = 1'
          : 'SELECT id FROM Marcas';
        const marcasResult = await this.query(sqlMarcas);
        marcas = marcasResult.map(m => m.id);
      } else {
        marcas = [Id_Marca];
      }

      const asignacionesCreadas = [];
      const asignacionesExistentes = [];
      const errores = [];

      for (const Id_CodigoPostal of Ids_CodigosPostales) {
        for (const marcaId of marcas) {
          try {
            const existe = await this.query(
              `SELECT id FROM ${asignacionesTable} 
               WHERE Id_Comercial = ? AND Id_CodigoPostal = ? AND Id_Marca = ? 
               AND (FechaInicio IS NULL OR FechaInicio = ?)`,
              [Id_Comercial, Id_CodigoPostal, marcaId, FechaInicio]
            );

            if (existe && existe.length > 0) {
              asignacionesExistentes.push({
                Id_CodigoPostal,
                Id_Marca: marcaId
              });
              continue;
            }

            const result = await this.query(
              `INSERT INTO ${asignacionesTable} 
               (Id_Comercial, Id_CodigoPostal, Id_Marca, FechaInicio, FechaFin, Activo, Prioridad, Observaciones, CreadoPor)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                Id_Comercial,
                Id_CodigoPostal,
                marcaId,
                FechaInicio,
                FechaFin,
                Activo ? 1 : 0,
                Prioridad,
                Observaciones,
                CreadoPor
              ]
            );

            asignacionesCreadas.push({
              id: result.insertId,
              Id_CodigoPostal,
              Id_Marca: marcaId
            });
          } catch (error) {
            errores.push({
              Id_CodigoPostal,
              Id_Marca: marcaId,
              error: error.message
            });
          }
        }
      }

      let clientesActualizados = 0;
      if (ActualizarClientes && asignacionesCreadas.length > 0 && codigosPostalesTable) {
        const codigosPostalesUnicos = [...new Set(asignacionesCreadas.map(a => a.Id_CodigoPostal))];

        if (codigosPostalesUnicos.length > 0) {
          const placeholders = codigosPostalesUnicos.map(() => '?').join(',');
          const prioridadPlaceholders = codigosPostalesUnicos.map(() => '?').join(',');
          const prioridadResult = await this.query(
            `SELECT MAX(Prioridad) as maxPrioridad 
             FROM ${asignacionesTable} 
             WHERE Id_Comercial = ? 
               AND Id_CodigoPostal IN (${prioridadPlaceholders})
               AND Activo = 1
               AND (FechaFin IS NULL OR FechaFin >= CURDATE())
               AND (FechaInicio IS NULL OR FechaInicio <= CURDATE())`,
            [Id_Comercial, ...codigosPostalesUnicos]
          );

          const prioridadComercial = prioridadResult[0]?.maxPrioridad || Prioridad || 0;

          const codigosPostalesTexto = await this.query(
            `SELECT CodigoPostal FROM ${codigosPostalesTable} WHERE id IN (${placeholders})`,
            codigosPostalesUnicos
          );
          const codigosPostalesArray = codigosPostalesTexto.map(cp => cp.CodigoPostal);
          const codigosPostalesPlaceholders = codigosPostalesArray.map(() => '?').join(',');

          const updateResult = await this.query(
            `UPDATE ${clientesTable} c
             LEFT JOIN ${codigosPostalesTable} cp ON c.Id_CodigoPostal = cp.id
             SET c.Id_Cial = ?
             WHERE (
               (c.Id_CodigoPostal IN (${placeholders}))
               OR (c.Id_CodigoPostal IS NULL AND c.CodigoPostal IN (${codigosPostalesPlaceholders}))
             )
               AND (
                 c.Id_Cial IS NULL 
                 OR c.Id_Cial = 0
                 OR ? > COALESCE((
                   SELECT MAX(ccp2.Prioridad)
                   FROM ${asignacionesTable} ccp2
                   INNER JOIN ${codigosPostalesTable} cp2 ON ccp2.Id_CodigoPostal = cp2.id
                   WHERE (cp2.id = c.Id_CodigoPostal OR cp2.CodigoPostal = c.CodigoPostal)
                     AND ccp2.Id_Comercial = c.Id_Cial
                     AND ccp2.Activo = 1
                     AND (ccp2.FechaFin IS NULL OR ccp2.FechaFin >= CURDATE())
                     AND (ccp2.FechaInicio IS NULL OR ccp2.FechaInicio <= CURDATE())
                 ), -1)
               )`,
            [Id_Comercial, ...codigosPostalesUnicos, ...codigosPostalesArray, prioridadComercial]
          );

          clientesActualizados = updateResult.affectedRows || 0;
        }
      }

      await connection.commit();

      return {
        success: true,
        asignacionesCreadas: asignacionesCreadas.length,
        asignacionesExistentes: asignacionesExistentes.length,
        clientesActualizados,
        errores: errores.length,
        detalles: {
          asignacionesCreadas,
          asignacionesExistentes,
          errores
        }
      };
    } catch (error) {
      await connection.rollback();
      console.error('❌ Error creando asignaciones masivas:', error.message);
      throw error;
    } finally {
      connection.release();
    }
  },

  async createAsignacionesPorProvincia(data) {
    try {
      const {
        Id_Comercial,
        Id_Provincia,
        Id_Marca = null,
        FechaInicio = null,
        FechaFin = null,
        Prioridad = 0,
        Activo = true,
        Observaciones = null,
        CreadoPor = null,
        ActualizarClientes = true
      } = data;

      if (!Id_Comercial || !Id_Provincia) {
        throw new Error('Id_Comercial e Id_Provincia son obligatorios');
      }

      const codigosPostalesTable = await this._getCodigosPostalesTableName();
      if (!codigosPostalesTable) {
        throw new Error('La tabla de códigos postales no existe.');
      }

      let sql = `
        SELECT id FROM ${codigosPostalesTable} 
        WHERE Activo = 1
      `;
      const params = [];

      if (typeof Id_Provincia === 'number' || /^\d+$/.test(Id_Provincia)) {
        sql += ' AND Id_Provincia = ?';
        params.push(parseInt(Id_Provincia));
      } else {
        sql += ' AND Provincia = ?';
        params.push(Id_Provincia);
      }

      const codigosPostales = await this.query(sql, params);

      if (!codigosPostales || codigosPostales.length === 0) {
        throw new Error(`No se encontraron códigos postales para la provincia: ${Id_Provincia}`);
      }

      const Ids_CodigosPostales = codigosPostales.map(cp => cp.id);

      return await this.createAsignacionesMasivas({
        Id_Comercial,
        Ids_CodigosPostales,
        Id_Marca,
        FechaInicio,
        FechaFin,
        Prioridad,
        Activo,
        Observaciones,
        CreadoPor,
        ActualizarClientes
      });
    } catch (error) {
      console.error('❌ Error creando asignaciones por provincia:', error.message);
      throw error;
    }
  }
};
