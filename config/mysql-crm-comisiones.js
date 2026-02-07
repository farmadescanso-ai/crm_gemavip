// Métodos CRUD para el sistema de comisiones
// Este archivo contiene todos los métodos para gestionar presupuestos, comisiones y rapeles

const mysql = require('mysql2/promise');
require('dotenv').config();

class ComisionesCRM {
  constructor() {
    this.config = {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'farmadescanso',
      charset: 'utf8mb4',
      collation: 'utf8mb4_unicode_ci'
    };
    this.pool = null;
    this._cache = {
      articulosHasMarcaColumn: null,
      fijosMensualesMarcaHasPeriodoColumns: null,
      clientesNombreCol: null,
      comisionesDetalleTable: null,
      articulosTable: null,
      marcasTable: null
    };
  }

  async _getArticulosTable() {
    if (this._cache.articulosTable) return this._cache.articulosTable;
    try {
      if (await this.tableExists('articulos')) {
        this._cache.articulosTable = 'articulos';
        return this._cache.articulosTable;
      }
      if (await this.tableExists('Articulos')) {
        this._cache.articulosTable = 'Articulos';
        return this._cache.articulosTable;
      }
    } catch (_) {
      // ignore
    }
    this._cache.articulosTable = 'articulos';
    return this._cache.articulosTable;
  }

  async _getMarcasTable() {
    if (this._cache.marcasTable) return this._cache.marcasTable;
    try {
      if (await this.tableExists('marcas')) {
        this._cache.marcasTable = 'marcas';
        return this._cache.marcasTable;
      }
      if (await this.tableExists('Marcas')) {
        this._cache.marcasTable = 'Marcas';
        return this._cache.marcasTable;
      }
    } catch (_) {
      // ignore
    }
    this._cache.marcasTable = 'marcas';
    return this._cache.marcasTable;
  }

  _normalizeISODateOnly(value) {
    if (!value) return null;
    const s = String(value).trim();
    // Aceptar YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // Si viene con hora, cortar
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
    return s;
  }

  async _getComisionesDetalleTable() {
    if (this._cache.comisionesDetalleTable) return this._cache.comisionesDetalleTable;
    try {
      if (await this.tableExists('comisiones_detalle')) {
        this._cache.comisionesDetalleTable = 'comisiones_detalle';
        return this._cache.comisionesDetalleTable;
      }
      if (await this.tableExists('Comisiones_Detalle')) {
        this._cache.comisionesDetalleTable = 'Comisiones_Detalle';
        return this._cache.comisionesDetalleTable;
      }
    } catch (_) {
      // ignore y usar default
    }
    // Default (mejor esfuerzo). Si no existe, fallará y lo veremos en logs.
    this._cache.comisionesDetalleTable = 'comisiones_detalle';
    return this._cache.comisionesDetalleTable;
  }

  async connect() {
    if (!this.pool) {
      this.pool = mysql.createPool(this.config);
    }
    return this.pool;
  }

  async query(sql, params = []) {
    const pool = await this.connect();
    try {
      const [rows] = await pool.execute(sql, params);
      return rows;
    } catch (error) {
      console.error('❌ Error en query:', error.message);
      console.error('SQL:', sql);
      console.error('Params:', params);
      throw error;
    }
  }

  async execute(sql, params = []) {
    const pool = await this.connect();
    try {
      // Validar parámetros antes de ejecutar
      const hasUndefined = params.some((p, index) => {
        if (p === undefined) {
          console.error(`❌ [EXECUTE] Parámetro undefined en índice ${index}:`, { sql, params, index });
          return true;
        }
        return false;
      });
      
      if (hasUndefined) {
        throw new Error('Parámetros undefined detectados antes de ejecutar la consulta SQL');
      }
      
      console.log('🔍 [EXECUTE] Ejecutando SQL:', sql.substring(0, 200));
      console.log('🔍 [EXECUTE] Parámetros:', params.map((p, i) => `[${i}]: ${p} (${typeof p})`).join(', '));
      
      const [result] = await pool.execute(sql, params);
      
      console.log('✅ [EXECUTE] SQL ejecutado exitosamente');
      if (result.insertId) {
        console.log('✅ [EXECUTE] ID insertado:', result.insertId);
      }
      
      return result;
    } catch (error) {
      console.error('❌ [EXECUTE] Error en execute:', error.message);
      console.error('❌ [EXECUTE] SQL:', sql);
      console.error('❌ [EXECUTE] Parámetros:', params);
      console.error('❌ [EXECUTE] Tipos de parámetros:', params.map(p => typeof p));
      console.error('❌ [EXECUTE] Error completo:', {
        message: error.message,
        code: error.code,
        errno: error.errno,
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage
      });
      
      // Agregar información adicional al error
      const enhancedError = new Error(error.message);
      enhancedError.originalError = error;
      enhancedError.sql = sql;
      enhancedError.params = params;
      throw enhancedError;
    }
  }

  async hasArticulosMarcaColumn() {
    if (this._cache.articulosHasMarcaColumn !== null) {
      return this._cache.articulosHasMarcaColumn;
    }
    try {
      const rows = await this.query(
        `SELECT COUNT(*) as c
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'articulos'
           AND COLUMN_NAME = 'Marca'`
      );
      const has = Number(rows?.[0]?.c ?? 0) > 0;
      this._cache.articulosHasMarcaColumn = has;
      return has;
    } catch (e) {
      // Si falla la comprobación (permisos/compat), asumir que NO existe para evitar romper en MariaDB remoto.
      this._cache.articulosHasMarcaColumn = false;
      return false;
    }
  }

  // =====================================================
  // PRESUPUESTOS
  // =====================================================

  // =====================================================
  // PLANTILLAS / OBJETIVOS GEMAVIP (por canal + reparto por marca)
  // =====================================================

  async tableExists(tableName) {
    const rows = await this.query(`SHOW TABLES LIKE ?`, [tableName]);
    return Array.isArray(rows) && rows.length > 0;
  }

  async hasFijosMensualesMarcaPeriodoColumns() {
    if (this._cache.fijosMensualesMarcaHasPeriodoColumns !== null) {
      return this._cache.fijosMensualesMarcaHasPeriodoColumns;
    }
    try {
      // Evitar INFORMATION_SCHEMA (en algunos entornos falla por permisos).
      // Probe barato: intentar usar las columnas. Si existen, la query funciona.
      await this.query(
        'SELECT año, mes FROM fijos_mensuales_marca WHERE 1=0'
      );
      this._cache.fijosMensualesMarcaHasPeriodoColumns = true;
      return true;
    } catch (_) {
      // Si no hay permisos o falla, asumir que no existen para no romper
      this._cache.fijosMensualesMarcaHasPeriodoColumns = false;
      return false;
    }
  }

  async getConfigObjetivosVentaMensual({ plan = 'GEMAVIP', año }) {
    if (!año) throw new Error('año es requerido');
    const sql = `
      SELECT *
      FROM config_objetivos_venta_mensual
      WHERE plan = ?
        AND año = ?
      ORDER BY canal, mes
    `;
    return await this.query(sql, [plan, Number(año)]);
  }

  async upsertConfigObjetivoVentaMensual({ plan = 'GEMAVIP', año, mes, canal, importe_por_delegado, activo = 1, observaciones = null }) {
    if (!año || !mes || !canal) throw new Error('plan/año/mes/canal son requeridos');
    const sql = `
      INSERT INTO config_objetivos_venta_mensual
        (plan, año, mes, canal, importe_por_delegado, activo, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        importe_por_delegado = VALUES(importe_por_delegado),
        activo = VALUES(activo),
        observaciones = VALUES(observaciones)
    `;
    await this.execute(sql, [
      String(plan),
      Number(año),
      Number(mes),
      String(canal).toUpperCase(),
      Number(importe_por_delegado || 0),
      activo ? 1 : 0,
      observaciones
    ]);
    return true;
  }

  async getConfigRepartoPresupuestoMarca({ plan = 'GEMAVIP', año, canal }) {
    if (!año) throw new Error('año es requerido');
    let sql = `
      SELECT *
      FROM config_reparto_presupuesto_marca
      WHERE plan = ?
        AND año = ?
    `;
    const params = [String(plan), Number(año)];
    if (canal) {
      sql += ` AND canal = ?`;
      params.push(String(canal).toUpperCase());
    }
    sql += ` ORDER BY canal, marca`;
    return await this.query(sql, params);
  }

  async upsertConfigRepartoPresupuestoMarca({ plan = 'GEMAVIP', año, canal, marca, porcentaje, activo = 1, observaciones = null }) {
    if (!año || !canal || !marca) throw new Error('plan/año/canal/marca son requeridos');
    const sql = `
      INSERT INTO config_reparto_presupuesto_marca
        (plan, año, canal, marca, porcentaje, activo, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        porcentaje = VALUES(porcentaje),
        activo = VALUES(activo),
        observaciones = VALUES(observaciones)
    `;
    await this.execute(sql, [
      String(plan),
      Number(año),
      String(canal).toUpperCase(),
      String(marca).trim(),
      Number(porcentaje || 0),
      activo ? 1 : 0,
      observaciones
    ]);
    return true;
  }

  async getObjetivosMarcaMes(filters = {}) {
    let sql = `
      SELECT o.*,
             c.Nombre AS comercial_nombre
      FROM objetivos_marca_mes o
      LEFT JOIN comerciales c ON c.id = o.comercial_id
      WHERE 1=1
    `;
    const params = [];
    if (filters.comercial_id !== undefined && filters.comercial_id !== null && filters.comercial_id !== '') {
      sql += ' AND o.comercial_id = ?';
      params.push(Number(filters.comercial_id));
    }
    if (filters.año !== undefined && filters.año !== null && filters.año !== '') {
      sql += ' AND o.año = ?';
      params.push(Number(filters.año));
    }
    if (filters.mes !== undefined && filters.mes !== null && filters.mes !== '') {
      sql += ' AND o.mes = ?';
      params.push(Number(filters.mes));
    }
    if (filters.canal) {
      sql += ' AND o.canal = ?';
      params.push(String(filters.canal).toUpperCase());
    }
    if (filters.marca) {
      sql += ' AND o.marca = ?';
      params.push(String(filters.marca));
    }
    if (filters.activo !== undefined) {
      sql += ' AND o.activo = ?';
      params.push(filters.activo ? 1 : 0);
    }
    sql += ' ORDER BY o.año DESC, o.mes ASC, o.canal, o.marca';
    return await this.query(sql, params);
  }

  async upsertObjetivoMarcaMes({ comercial_id, marca, año, mes, canal, objetivo, porcentaje_marca, activo = 1, observaciones = null }) {
    if (!comercial_id || !marca || !año || !mes || !canal) {
      throw new Error('comercial_id/marca/año/mes/canal son requeridos');
    }
    const sql = `
      INSERT INTO objetivos_marca_mes
        (comercial_id, marca, año, mes, canal, objetivo, porcentaje_marca, activo, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        objetivo = VALUES(objetivo),
        porcentaje_marca = VALUES(porcentaje_marca),
        activo = VALUES(activo),
        observaciones = VALUES(observaciones)
    `;
    await this.execute(sql, [
      Number(comercial_id),
      String(marca).trim(),
      Number(año),
      Number(mes),
      String(canal).toUpperCase(),
      Number(objetivo || 0),
      Number(porcentaje_marca || 0),
      activo ? 1 : 0,
      observaciones
    ]);
    return true;
  }

  /**
   * Genera objetivos por marca/mes/canal para uno o varios comerciales, a partir de:
   * - config_objetivos_venta_mensual (importe por delegado)
   * - config_reparto_presupuesto_marca (porcentaje por marca)
   *
   * Regla enero 2026: solo aplica a comerciales con ID en eneroSoloIds.
   */
  async generarObjetivosMarcaMesDesdePlantilla({
    plan = 'GEMAVIP',
    año,
    comercialesIds = [],
    eneroSoloIds = [2, 3]
  }) {
    if (!año) throw new Error('año es requerido');

    const hasCfgMensual = await this.tableExists('config_objetivos_venta_mensual');
    const hasCfgReparto = await this.tableExists('config_reparto_presupuesto_marca');
    const hasObjetivos = await this.tableExists('objetivos_marca_mes');
    if (!hasCfgMensual || !hasCfgReparto || !hasObjetivos) {
      throw new Error('Faltan tablas GEMAVIP. Ejecuta scripts/crear-presupuesto-gemavip.sql');
    }

    const cfgMensual = await this.getConfigObjetivosVentaMensual({ plan, año });
    const cfgReparto = await this.getConfigRepartoPresupuestoMarca({ plan, año });

    // Indexar por canal+mes
    const mensualPorCanalMes = {};
    for (const row of cfgMensual) {
      const canal = String(row.canal || '').toUpperCase();
      const mes = Number(row.mes);
      mensualPorCanalMes[`${canal}:${mes}`] = Number(row.importe_por_delegado || 0);
    }

    // Indexar reparto por canal
    const repartoPorCanal = {};
    for (const row of cfgReparto) {
      if (!(row.activo === 1 || row.activo === true)) continue;
      const canal = String(row.canal || '').toUpperCase();
      if (!repartoPorCanal[canal]) repartoPorCanal[canal] = [];
      repartoPorCanal[canal].push({
        marca: String(row.marca || '').trim(),
        porcentaje: Number(row.porcentaje || 0)
      });
    }

    const canales = ['DIRECTA', 'MAYORISTA'];
    let upserts = 0;

    for (const comercialId of comercialesIds) {
      const cId = Number(comercialId);
      if (!Number.isFinite(cId) || cId <= 0) continue;

      for (const canal of canales) {
        const reparto = repartoPorCanal[canal] || [];
        // Si no hay reparto configurado, no generamos nada para ese canal.
        if (reparto.length === 0) continue;

        for (let mes = 1; mes <= 12; mes++) {
          // Regla de enero: solo IDs 2 y 3 (según tu indicación)
          if (Number(año) === 2026 && mes === 1 && !eneroSoloIds.includes(cId)) continue;

          const importeDelegado = mensualPorCanalMes[`${canal}:${mes}`] ?? 0;
          for (const r of reparto) {
            const objetivo = (importeDelegado * r.porcentaje) / 100;
            await this.upsertObjetivoMarcaMes({
              comercial_id: cId,
              marca: r.marca,
              año,
              mes,
              canal,
              objetivo,
              porcentaje_marca: r.porcentaje,
              activo: 1,
              observaciones: `Generado desde plantilla ${plan}`
            });
            upserts += 1;
          }
        }
      }
    }

    return { upserts };
  }

  /**
   * Obtener todos los presupuestos
   */
  async getPresupuestos(filters = {}) {
    try {
      const hasMarca = await this.hasArticulosMarcaColumn();
      let sql = `
        SELECT p.*, 
               c.Nombre as comercial_nombre,
               a.Nombre as articulo_nombre,
               a.SKU as articulo_sku,
               ${hasMarca ? 'a.Marca' : 'm.Nombre'} as articulo_marca
        FROM presupuestos p
        LEFT JOIN comerciales c ON p.comercial_id = c.id
        LEFT JOIN articulos a ON p.articulo_id = a.id
        LEFT JOIN marcas m ON m.id = a.Id_Marca
        WHERE 1=1
      `;
      const params = [];

      if (filters.comercial_id !== null && filters.comercial_id !== undefined) {
        sql += ' AND p.comercial_id = ?';
        params.push(Number(filters.comercial_id));
      }
      if (filters.articulo_id !== null && filters.articulo_id !== undefined) {
        sql += ' AND p.articulo_id = ?';
        params.push(Number(filters.articulo_id));
      }
      if (filters.año !== null && filters.año !== undefined) {
        sql += ' AND p.año = ?';
        params.push(Number(filters.año));
      }
      if (filters.mes !== undefined && filters.mes !== null && filters.mes !== '') {
        sql += ' AND p.mes = ?';
        params.push(filters.mes);
      }
      if (filters.activo !== undefined) {
        sql += ' AND p.activo = ?';
        params.push(filters.activo ? 1 : 0);
      }

      sql += ' ORDER BY p.año DESC, p.mes ASC, c.Nombre, a.Nombre';

      console.log('🔍 [PRESUPUESTOS] SQL:', sql);
      console.log('🔍 [PRESUPUESTOS] Params:', params);
      console.log('🔍 [PRESUPUESTOS] Filters:', filters);

      return await this.query(sql, params);
    } catch (error) {
      console.error('❌ Error obteniendo presupuestos:', error.message);
      throw error;
    }
  }

  /**
   * Obtener un presupuesto por ID
   */
  async getPresupuestoById(id) {
    try {
      const hasMarca = await this.hasArticulosMarcaColumn();
      const sql = `
        SELECT p.*, 
               c.Nombre as comercial_nombre,
               a.Nombre as articulo_nombre,
               a.SKU as articulo_sku,
               ${hasMarca ? 'a.Marca' : 'm.Nombre'} as articulo_marca
        FROM presupuestos p
        LEFT JOIN comerciales c ON p.comercial_id = c.id
        LEFT JOIN articulos a ON p.articulo_id = a.id
        LEFT JOIN marcas m ON m.id = a.Id_Marca
        WHERE p.id = ?
      `;
      const rows = await this.query(sql, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error('❌ Error obteniendo presupuesto:', error.message);
      throw error;
    }
  }

  /**
   * Crear un nuevo presupuesto (o actualizar si ya existe)
   */
  async createPresupuesto(presupuestoData) {
    try {
      console.log('💾 [PRESUPUESTO] createPresupuesto llamado con datos:', JSON.stringify(presupuestoData, null, 2));
      console.log('💾 [PRESUPUESTO] comercial_id:', presupuestoData.comercial_id, 'tipo:', typeof presupuestoData.comercial_id);
      console.log('💾 [PRESUPUESTO] articulo_id:', presupuestoData.articulo_id, 'tipo:', typeof presupuestoData.articulo_id);
      
      // Verificar que comercial_id existe antes de continuar
      const verificarComercial = await this.query(
        'SELECT id FROM comerciales WHERE id = ? LIMIT 1',
        [presupuestoData.comercial_id]
      );
      console.log('💾 [PRESUPUESTO] Verificación comercial en BD:', verificarComercial.length > 0 ? '✅ Existe' : '❌ NO existe');
      if (verificarComercial.length === 0) {
        throw new Error(`El comercial con ID ${presupuestoData.comercial_id} no existe en la base de datos`);
      }
      
      // Verificar que articulo_id existe antes de continuar
      const verificarArticulo = await this.query(
        'SELECT id FROM articulos WHERE id = ? LIMIT 1',
        [presupuestoData.articulo_id]
      );
      console.log('💾 [PRESUPUESTO] Verificación artículo en BD:', verificarArticulo.length > 0 ? '✅ Existe' : '❌ NO existe');
      if (verificarArticulo.length === 0) {
        throw new Error(`El artículo con ID ${presupuestoData.articulo_id} no existe en la base de datos`);
      }
      
      // Verificar si ya existe un presupuesto con la misma combinación de comercial_id, articulo_id y año
      // Asegurar que los valores sean números para la comparación
      const comercialIdForQuery = Number(presupuestoData.comercial_id);
      const articuloIdForQuery = Number(presupuestoData.articulo_id);
      const añoForQuery = Number(presupuestoData.año);
      
      console.log('💾 [PRESUPUESTO] Buscando duplicados con:', {
        comercial_id: comercialIdForQuery,
        articulo_id: articuloIdForQuery,
        año: añoForQuery
      });
      
      const existing = await this.query(
        'SELECT id FROM presupuestos WHERE comercial_id = ? AND articulo_id = ? AND año = ?',
        [comercialIdForQuery, articuloIdForQuery, añoForQuery]
      );
      console.log('💾 [PRESUPUESTO] Presupuesto existente encontrado:', existing.length > 0 ? `Sí (ID: ${existing[0].id})` : 'No');

      if (existing.length > 0) {
        // Si existe, NO actualizar automáticamente, lanzar un error
        const existingId = existing[0].id;
        console.log(`💾 [PRESUPUESTO] Presupuesto duplicado detectado (ID: ${existingId}).`);
        throw new Error(`Ya existe un presupuesto para este comercial (ID: ${comercialIdForQuery}), artículo (ID: ${articuloIdForQuery}) y año (${añoForQuery}). Presupuesto existente ID: ${existingId}`);
      }

      // Si no existe, crear un nuevo presupuesto
      // Asegurar que los IDs sean números enteros
      const comercialId = parseInt(presupuestoData.comercial_id);
      const articuloId = parseInt(presupuestoData.articulo_id);
      const año = parseInt(presupuestoData.año);
      
      // Verificar una vez más que los IDs son válidos antes de insertar
      if (isNaN(comercialId) || comercialId <= 0) {
        throw new Error(`comercial_id inválido: ${presupuestoData.comercial_id}`);
      }
      if (isNaN(articuloId) || articuloId <= 0) {
        throw new Error(`articulo_id inválido: ${presupuestoData.articulo_id}`);
      }
      if (isNaN(año) || año <= 0) {
        throw new Error(`año inválido: ${presupuestoData.año}`);
      }
      
      // VERIFICACIÓN FINAL justo antes del INSERT usando la misma conexión
      console.log('🔍 [PRESUPUESTO] Verificación final antes de INSERT...');
      const pool = await this.connect();
      const [comercialCheck] = await pool.execute('SELECT id FROM comerciales WHERE id = ?', [comercialId]);
      const [articuloCheck] = await pool.execute('SELECT id FROM articulos WHERE id = ?', [articuloId]);
      
      console.log('🔍 [PRESUPUESTO] Verificación final - Comercial:', comercialCheck.length > 0 ? `✅ Existe (ID: ${comercialCheck[0].id})` : `❌ NO existe (buscado: ${comercialId})`);
      console.log('🔍 [PRESUPUESTO] Verificación final - Artículo:', articuloCheck.length > 0 ? `✅ Existe (ID: ${articuloCheck[0].id})` : `❌ NO existe (buscado: ${articuloId})`);
      
      if (comercialCheck.length === 0) {
        throw new Error(`VERIFICACIÓN FINAL FALLIDA: El comercial con ID ${comercialId} no existe en la base de datos`);
      }
      if (articuloCheck.length === 0) {
        throw new Error(`VERIFICACIÓN FINAL FALLIDA: El artículo con ID ${articuloId} no existe en la base de datos`);
      }
      
      const sql = `
        INSERT INTO presupuestos 
        (comercial_id, articulo_id, año, mes, cantidad_presupuestada, importe_presupuestado, 
         porcentaje_comision, activo, observaciones, creado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        comercialId,  // Asegurar que es un número entero
        articuloId,   // Asegurar que es un número entero
        año,          // Asegurar que es un número entero
        presupuestoData.mes !== undefined && presupuestoData.mes !== null && presupuestoData.mes !== '' ? parseInt(presupuestoData.mes) : null,
        parseFloat(presupuestoData.cantidad_presupuestada) || 0,
        parseFloat(presupuestoData.importe_presupuestado) || 0,
        parseFloat(presupuestoData.porcentaje_comision) || 0,
        presupuestoData.activo !== undefined ? (presupuestoData.activo ? 1 : 0) : 1,
        presupuestoData.observaciones || null,
        presupuestoData.creado_por ? parseInt(presupuestoData.creado_por) : null
      ];
      
      console.log('💾 [PRESUPUESTO] Ejecutando INSERT con parámetros:');
      console.log('   comercial_id:', params[0], 'tipo:', typeof params[0], 'es número:', !isNaN(params[0]));
      console.log('   articulo_id:', params[1], 'tipo:', typeof params[1], 'es número:', !isNaN(params[1]));
      console.log('   año:', params[2], 'tipo:', typeof params[2], 'es número:', !isNaN(params[2]));
      console.log('   Parámetros completos:', params);
      console.log('   SQL completo:', sql.replace(/\?/g, (match, offset) => {
        const index = sql.substring(0, offset).split('?').length - 1;
        return params[index] !== null && params[index] !== undefined ? params[index] : 'NULL';
      }));

      const result = await this.execute(sql, params);
      const presupuestoCreado = { id: result.insertId, ...presupuestoData, actualizado: false };
      console.log('✅ [PRESUPUESTO] Presupuesto creado en BD con ID:', result.insertId);
      return presupuestoCreado;
    } catch (error) {
      console.error('❌ Error creando/actualizando presupuesto:', error.message);
      console.error('❌ Stack:', error.stack);
      console.error('❌ Datos que causaron el error:', JSON.stringify(presupuestoData, null, 2));
      
      // Agregar información adicional al error para debugging
      const errorInfo = {
        message: error.message,
        sqlState: error.sqlState || null,
        sqlMessage: error.sqlMessage || null,
        code: error.code || null,
        errno: error.errno || null,
        presupuestoData: presupuestoData
      };
      
      const enhancedError = new Error(error.message);
      enhancedError.originalError = error;
      enhancedError.errorInfo = errorInfo;
      throw enhancedError;
    }
  }

  /**
   * Actualizar un presupuesto
   */
  async updatePresupuesto(id, presupuestoData) {
    try {
      const updates = [];
      const params = [];

      if (presupuestoData.mes !== undefined) {
        updates.push('mes = ?');
        params.push(presupuestoData.mes !== undefined && presupuestoData.mes !== null && presupuestoData.mes !== '' ? parseInt(presupuestoData.mes) : null);
      }
      if (presupuestoData.cantidad_presupuestada !== undefined) {
        updates.push('cantidad_presupuestada = ?');
        params.push(presupuestoData.cantidad_presupuestada);
      }
      if (presupuestoData.importe_presupuestado !== undefined) {
        updates.push('importe_presupuestado = ?');
        params.push(presupuestoData.importe_presupuestado);
      }
      if (presupuestoData.porcentaje_comision !== undefined) {
        updates.push('porcentaje_comision = ?');
        params.push(presupuestoData.porcentaje_comision);
      }
      if (presupuestoData.activo !== undefined) {
        updates.push('activo = ?');
        params.push(presupuestoData.activo ? 1 : 0);
      }
      if (presupuestoData.observaciones !== undefined) {
        updates.push('observaciones = ?');
        params.push(presupuestoData.observaciones);
      }

      if (updates.length === 0) {
        throw new Error('No hay campos para actualizar');
      }

      params.push(id);
      const sql = `UPDATE presupuestos SET ${updates.join(', ')} WHERE id = ?`;
      await this.execute(sql, params);
      return { id, ...presupuestoData };
    } catch (error) {
      console.error('❌ Error actualizando presupuesto:', error.message);
      throw error;
    }
  }

  /**
   * Eliminar un presupuesto
   */
  async deletePresupuesto(id) {
    try {
      const sql = 'DELETE FROM presupuestos WHERE id = ?';
      await this.execute(sql, [id]);
      return { success: true };
    } catch (error) {
      console.error('❌ Error eliminando presupuesto:', error.message);
      throw error;
    }
  }

  // =====================================================
  // COMISIONES
  // =====================================================

  // =====================================================
  // ESTADO COMISIONES (tabla estadoComisiones)
  // =====================================================

  /**
   * Listar estados de comisiones (join con comisiones + comerciales)
   */
  async getEstadoComisiones(filters = {}) {
    try {
      let sql = `
        SELECT ec.*,
               c.comercial_id, c.mes, c.año,
               c.total_ventas, c.total_comision,
               co.Nombre AS comercial_nombre
        FROM estadoComisiones ec
        INNER JOIN comisiones c ON c.id = ec.comision_id
        LEFT JOIN comerciales co ON co.id = c.comercial_id
        WHERE 1=1
      `;
      const params = [];

      if (filters.comision_id) {
        sql += ' AND ec.comision_id = ?';
        params.push(filters.comision_id);
      }
      if (filters.estado) {
        sql += ' AND ec.estado = ?';
        params.push(filters.estado);
      }
      if (filters.comercial_id) {
        sql += ' AND c.comercial_id = ?';
        params.push(filters.comercial_id);
      }
      if (filters.mes) {
        sql += ' AND c.mes = ?';
        params.push(filters.mes);
      }
      if (filters.año) {
        sql += ' AND c.año = ?';
        params.push(filters.año);
      }

      sql += `
        ORDER BY
          co.Nombre ASC,
          c.año DESC,
          CASE
            WHEN c.mes IS NULL OR c.mes = 0 THEN 13
            ELSE c.mes
          END ASC,
          ec.fecha_estado DESC
      `;

      return await this.query(sql, params);
    } catch (error) {
      console.error('❌ Error obteniendo estadoComisiones:', error.message);
      throw error;
    }
  }

  /**
   * Obtener estado de comisión por ID (tabla estadoComisiones.id)
   */
  async getEstadoComisionById(id) {
    try {
      const rows = await this.query('SELECT * FROM estadoComisiones WHERE id = ? LIMIT 1', [id]);
      return rows[0] || null;
    } catch (error) {
      console.error('❌ Error obteniendo estadoComision:', error.message);
      throw error;
    }
  }

  /**
   * Crear/actualizar estado por comision_id (upsert)
   * - Si viene id: UPDATE por id
   * - Si no viene id: INSERT ... ON DUPLICATE KEY UPDATE por comision_id
   */
  async saveEstadoComision(data) {
    try {
      if (!data || data.comision_id === undefined || data.comision_id === null) {
        throw new Error('saveEstadoComision requiere comision_id');
      }
      const comisionId = Number(data.comision_id);
      if (!Number.isFinite(comisionId) || comisionId <= 0) {
        throw new Error(`comision_id inválido: ${data.comision_id}`);
      }

      const estado = (data.estado || 'Pendiente');
      const fechaEstado = data.fecha_estado || null;
      const actualizadoPor = data.actualizado_por ?? null;
      const notas = data.notas ?? null;

      if (data.id !== undefined && data.id !== null) {
        const id = Number(data.id);
        if (!Number.isFinite(id) || id <= 0) {
          throw new Error(`id inválido: ${data.id}`);
        }

        const updates = [];
        const params = [];
        if (data.comision_id !== undefined) {
          updates.push('comision_id = ?');
          params.push(comisionId);
        }
        if (data.estado !== undefined) {
          updates.push('estado = ?');
          params.push(estado);
        }
        if (data.fecha_estado !== undefined) {
          updates.push('fecha_estado = ?');
          params.push(fechaEstado || new Date());
        }
        if (data.actualizado_por !== undefined) {
          updates.push('actualizado_por = ?');
          params.push(actualizadoPor);
        }
        if (data.notas !== undefined) {
          updates.push('notas = ?');
          params.push(notas);
        }
        if (updates.length === 0) return { id };
        params.push(id);
        await this.execute(`UPDATE estadoComisiones SET ${updates.join(', ')} WHERE id = ?`, params);
        return { id, ...data };
      }

      const sql = `
        INSERT INTO estadoComisiones (comision_id, estado, fecha_estado, actualizado_por, notas)
        VALUES (?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?)
        ON DUPLICATE KEY UPDATE
          estado = VALUES(estado),
          fecha_estado = COALESCE(VALUES(fecha_estado), CURRENT_TIMESTAMP),
          actualizado_por = VALUES(actualizado_por),
          notas = VALUES(notas),
          actualizado_en = CURRENT_TIMESTAMP
      `;
      await this.execute(sql, [comisionId, estado, fechaEstado, actualizadoPor, notas]);

      // devolver el row actual
      const row = await this.query('SELECT * FROM estadoComisiones WHERE comision_id = ? LIMIT 1', [comisionId]);
      return row[0] || { comision_id: comisionId, estado };
    } catch (error) {
      console.error('❌ Error guardando estadoComision:', error.message);
      throw error;
    }
  }

  /**
   * Eliminar estadoComisiones por id (tabla estadoComisiones.id)
   */
  async deleteEstadoComision(id) {
    try {
      const sql = 'DELETE FROM estadoComisiones WHERE id = ?';
      await this.execute(sql, [id]);
      return { success: true };
    } catch (error) {
      console.error('❌ Error eliminando estadoComision:', error.message);
      throw error;
    }
  }

  /**
   * Obtener todas las comisiones
   */
  async getComisiones(filters = {}) {
    try {
      const cdTable = await this._getComisionesDetalleTable();

      const buildQuery = (marcasTable, articulosTable) => {
        let sql = `
        SELECT c.*,
               COALESCE(dv.total_ventas_detalle, 0) AS total_ventas_detalle,
               COALESCE(dv.comision_ventas_detalle, 0) AS comision_ventas_detalle,
               COALESCE(dv.detalles_venta_count, 0) AS detalles_venta_count,
               co.Nombre as comercial_nombre,
               co.Email as comercial_email
        FROM comisiones c
        LEFT JOIN (
          SELECT
            comision_id,
            SUM(COALESCE(importe_venta, 0)) AS total_ventas_detalle,
            SUM(COALESCE(importe_comision, 0)) AS comision_ventas_detalle,
            COUNT(*) AS detalles_venta_count
          FROM ${cdTable}
          WHERE (tipo_comision IS NULL OR tipo_comision = 'Venta')
          GROUP BY comision_id
        ) dv ON dv.comision_id = c.id
        LEFT JOIN comerciales co ON c.comercial_id = co.id
        WHERE 1=1
      `;
        const params = [];

        if (filters.comercial_id) {
          sql += ' AND c.comercial_id = ?';
          params.push(filters.comercial_id);
        }
        if (filters.mes) {
          sql += ' AND c.mes = ?';
          params.push(filters.mes);
        }
        if (filters.año) {
          sql += ' AND c.año = ?';
          params.push(filters.año);
        }
        if (filters.estado) {
          const est = String(filters.estado);
          // Compatibilidad: algunos registros históricos usan "Calculada/Pagada" (femenino)
          // mientras que en otras partes se usa "Calculado/Pagado".
          if (est === 'Pagado' || est === 'Pagada') {
            sql += " AND c.estado IN ('Pagado','Pagada')";
          } else if (est === 'Calculado' || est === 'Calculada') {
            sql += " AND c.estado IN ('Calculado','Calculada')";
          } else {
            sql += ' AND c.estado = ?';
            params.push(est);
          }
        }

        // Filtro por marca (usa detalle -> artículos -> marcas)
        if (filters.marca_id !== undefined && filters.marca_id !== null && filters.marca_id !== '') {
          const marcaId = Number(filters.marca_id);
          if (Number.isFinite(marcaId) && marcaId > 0) {
            sql += `
              AND EXISTS (
                SELECT 1
                FROM ${cdTable} cd2
                LEFT JOIN ${articulosTable} a2 ON (a2.id = cd2.articulo_id OR a2.Id = cd2.articulo_id)
                LEFT JOIN ${marcasTable} m2 ON (m2.id = a2.Id_Marca OR m2.Id = a2.Id_Marca)
                WHERE cd2.comision_id = c.id
                  AND (cd2.tipo_comision IS NULL OR cd2.tipo_comision = 'Venta')
                  AND m2.id = ?
              )
            `;
            params.push(marcaId);
          }
        }

      // Orden deseado en UI:
      // - Por comercial (A→Z)
      // - Por año (DESC)
      // - Por mes (enero→diciembre). Si mes es NULL/0 (comisión anual u otro), mandarlo al final.
      sql += `
        ORDER BY
          co.Nombre ASC,
          c.año DESC,
          CASE
            WHEN c.mes IS NULL OR c.mes = 0 THEN 13
            ELSE c.mes
          END ASC
      `;

        return { sql, params };
      };

      // Sin marca -> query directa (más rápida)
      if (filters.marca_id === undefined || filters.marca_id === null || filters.marca_id === '') {
        const { sql, params } = buildQuery(await this._getMarcasTable(), await this._getArticulosTable());
        return await this.query(sql, params);
      }

      // Con marca -> probar combinaciones por case (Linux puede ser case-sensitive en nombres de tabla)
      const combos = [
        { marcas: 'marcas', articulos: 'articulos' },
        { marcas: 'Marcas', articulos: 'articulos' },
        { marcas: 'marcas', articulos: 'Articulos' },
        { marcas: 'Marcas', articulos: 'Articulos' }
      ];

      let lastErr = null;
      for (const c of combos) {
        try {
          const { sql, params } = buildQuery(c.marcas, c.articulos);
          return await this.query(sql, params);
        } catch (e) {
          lastErr = e;
          const msg = String(e?.message || '').toLowerCase();
          // Si falla por tabla inexistente, intentamos la siguiente combinación.
          if (msg.includes("doesn't exist") || msg.includes('no such table')) continue;
          // Otros errores: no ocultarlos.
          throw e;
        }
      }
      throw lastErr || new Error('No se pudo aplicar el filtro por marca (tablas no encontradas)');
    } catch (error) {
      console.error('❌ Error obteniendo comisiones:', error.message);
      throw error;
    }
  }

  /**
   * Recibos de COMISIONES DE VENTAS pagadas, agrupados por comercial + día de pago.
   * Nota compatibilidad:
   * - Si existen columnas por concepto: usa fecha_pago_ventas / pagado_ventas_por
   * - Si no: usa fecha_pago / pagado_por (modo compatibilidad)
   */
  async getRecibosVentasPorComercialDia(filters = {}) {
    const cdTable = await this._getComisionesDetalleTable();
    const hasPagoConceptoCols = await this._hasComisionesPagoConceptoColumns();
    const fechaCol = hasPagoConceptoCols ? 'c.fecha_pago_ventas' : 'c.fecha_pago';
    const pagadoPorCol = hasPagoConceptoCols ? 'c.pagado_ventas_por' : 'c.pagado_por';

    const desde = this._normalizeISODateOnly(filters.desde);
    const hasta = this._normalizeISODateOnly(filters.hasta);

    let sql = `
      SELECT
        c.comercial_id,
        co.Nombre AS comercial_nombre,
        DATE(${fechaCol}) AS fecha_pago,
        COUNT(*) AS meses_pagados,
        SUM(CASE
          WHEN COALESCE(c.total_ventas, 0) > 0 THEN COALESCE(c.total_ventas, 0)
          ELSE COALESCE(dv.total_ventas_detalle, 0)
        END) AS base_total_ventas,
        SUM(CASE
          WHEN COALESCE(c.comision_ventas, 0) > 0 THEN COALESCE(c.comision_ventas, 0)
          ELSE COALESCE(dv.comision_ventas_detalle, 0)
        END) AS comision_total_ventas,
        GROUP_CONCAT(DISTINCT ${pagadoPorCol} SEPARATOR ', ') AS pagado_por
      FROM comisiones c
      LEFT JOIN (
        SELECT
          comision_id,
          SUM(COALESCE(importe_venta, 0)) AS total_ventas_detalle,
          SUM(COALESCE(importe_comision, 0)) AS comision_ventas_detalle
        FROM ${cdTable}
        WHERE (tipo_comision IS NULL OR tipo_comision = 'Venta')
        GROUP BY comision_id
      ) dv ON dv.comision_id = c.id
      LEFT JOIN comerciales co ON (c.comercial_id = co.id OR c.comercial_id = co.Id)
      WHERE ${fechaCol} IS NOT NULL
    `;
    const params = [];

    if (filters.comercial_id !== undefined && filters.comercial_id !== null && filters.comercial_id !== '') {
      sql += ' AND c.comercial_id = ?';
      params.push(Number(filters.comercial_id));
    }
    if (desde) {
      sql += ` AND DATE(${fechaCol}) >= ?`;
      params.push(desde);
    }
    if (hasta) {
      sql += ` AND DATE(${fechaCol}) <= ?`;
      params.push(hasta);
    }

    sql += `
      GROUP BY c.comercial_id, co.Nombre, DATE(${fechaCol})
      ORDER BY DATE(${fechaCol}) DESC, co.Nombre ASC
    `;

    return await this.query(sql, params);
  }

  /**
   * Detalle de un recibo de ventas (comercial + día).
   * Devuelve comisiones incluidas y el desglose de ventas por pedido/marca.
   */
  async getReciboVentasDetalle({ comercial_id, fecha_pago }) {
    const cdTable = await this._getComisionesDetalleTable();
    const hasPagoConceptoCols = await this._hasComisionesPagoConceptoColumns();
    const fechaCol = hasPagoConceptoCols ? 'c.fecha_pago_ventas' : 'c.fecha_pago';

    const fecha = this._normalizeISODateOnly(fecha_pago);
    if (!fecha) throw new Error('fecha_pago es requerida (YYYY-MM-DD)');

    const sql = `
      SELECT
        c.*,
        COALESCE(dv.total_ventas_detalle, 0) AS total_ventas_detalle,
        COALESCE(dv.comision_ventas_detalle, 0) AS comision_ventas_detalle,
        co.Nombre AS comercial_nombre,
        co.Email AS comercial_email
      FROM comisiones c
      LEFT JOIN (
        SELECT
          comision_id,
          SUM(COALESCE(importe_venta, 0)) AS total_ventas_detalle,
          SUM(COALESCE(importe_comision, 0)) AS comision_ventas_detalle
        FROM ${cdTable}
        WHERE (tipo_comision IS NULL OR tipo_comision = 'Venta')
        GROUP BY comision_id
      ) dv ON dv.comision_id = c.id
      LEFT JOIN comerciales co ON (c.comercial_id = co.id OR c.comercial_id = co.Id)
      WHERE c.comercial_id = ?
        AND ${fechaCol} IS NOT NULL
        AND DATE(${fechaCol}) = ?
      ORDER BY c.año DESC, c.mes ASC, c.id ASC
    `;

    const comisiones = await this.query(sql, [Number(comercial_id), fecha]);
    return comisiones;
  }

  /**
   * Obtener una comisión por ID
   */
  async getComisionById(id) {
    try {
      const cdTable = await this._getComisionesDetalleTable();
      const sql = `
        SELECT c.*,
               COALESCE(dv.total_ventas_detalle, 0) AS total_ventas_detalle,
               COALESCE(dv.comision_ventas_detalle, 0) AS comision_ventas_detalle,
               COALESCE(dv.detalles_venta_count, 0) AS detalles_venta_count,
               co.Nombre as comercial_nombre,
               co.Email as comercial_email
        FROM comisiones c
        LEFT JOIN (
          SELECT
            comision_id,
            SUM(COALESCE(importe_venta, 0)) AS total_ventas_detalle,
            SUM(COALESCE(importe_comision, 0)) AS comision_ventas_detalle,
            COUNT(*) AS detalles_venta_count
          FROM ${cdTable}
          WHERE (tipo_comision IS NULL OR tipo_comision = 'Venta')
          GROUP BY comision_id
        ) dv ON dv.comision_id = c.id
        LEFT JOIN comerciales co ON c.comercial_id = co.id
        WHERE c.id = ?
      `;
      const rows = await this.query(sql, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error('❌ Error obteniendo comisión:', error.message);
      throw error;
    }
  }

  /**
   * Crear o actualizar una comisión
   */
  async saveComision(comisionData) {
    try {
      // Detectar si existen columnas de pago por concepto (ventas/fijo) para no romper despliegues sin migración
      const hasPagoConceptoCols = await this._hasComisionesPagoConceptoColumns();

      // Si viene ID, actualizar directamente por ID (evita pasar undefined en el SELECT por clave compuesta)
      if (comisionData && comisionData.id !== undefined && comisionData.id !== null) {
        const id = Number(comisionData.id);
        if (!Number.isFinite(id) || id <= 0) {
          throw new Error(`ID de comisión inválido: ${comisionData.id}`);
        }

        const updates = [];
        const params = [];

        if (comisionData.fijo_mensual !== undefined) {
          updates.push('fijo_mensual = ?');
          params.push(comisionData.fijo_mensual);
        }
        if (comisionData.comision_ventas !== undefined) {
          updates.push('comision_ventas = ?');
          params.push(comisionData.comision_ventas);
        }
        if (comisionData.comision_presupuesto !== undefined) {
          updates.push('comision_presupuesto = ?');
          params.push(comisionData.comision_presupuesto);
        }
        if (comisionData.total_ventas !== undefined) {
          updates.push('total_ventas = ?');
          params.push(comisionData.total_ventas);
        }
        if (comisionData.total_comision !== undefined) {
          updates.push('total_comision = ?');
          params.push(comisionData.total_comision);
        }
        if (comisionData.estado !== undefined) {
          updates.push('estado = ?');
          params.push(comisionData.estado);
        }
        if (comisionData.fecha_pago !== undefined) {
          updates.push('fecha_pago = ?');
          // Normalizar vacío -> NULL (pero nunca undefined)
          params.push(comisionData.fecha_pago || null);
        }
        // Pagos separados por concepto (si la BD lo soporta)
        if (hasPagoConceptoCols) {
          if (comisionData.fecha_pago_ventas !== undefined) {
            updates.push('fecha_pago_ventas = ?');
            params.push(comisionData.fecha_pago_ventas || null);
          }
          if (comisionData.pagado_ventas_por !== undefined) {
            updates.push('pagado_ventas_por = ?');
            params.push(comisionData.pagado_ventas_por ?? null);
          }
          if (comisionData.fecha_pago_fijo !== undefined) {
            updates.push('fecha_pago_fijo = ?');
            params.push(comisionData.fecha_pago_fijo || null);
          }
          if (comisionData.pagado_fijo_por !== undefined) {
            updates.push('pagado_fijo_por = ?');
            params.push(comisionData.pagado_fijo_por ?? null);
          }
        }
        if (comisionData.observaciones !== undefined) {
          updates.push('observaciones = ?');
          params.push(comisionData.observaciones || null);
        }
        if (comisionData.calculado_por !== undefined) {
          updates.push('calculado_por = ?');
          params.push(comisionData.calculado_por ?? null);
        }
        if (comisionData.pagado_por !== undefined) {
          updates.push('pagado_por = ?');
          params.push(comisionData.pagado_por ?? null);
        }

        if (updates.length === 0) {
          return { id };
        }

        params.push(id);
        const sql = `UPDATE comisiones SET ${updates.join(', ')} WHERE id = ?`;
        await this.execute(sql, params);
        return { id, ...comisionData };
      }

      // Sin ID, se requiere clave compuesta para upsert (comercial_id, mes, año)
      if (
        !comisionData ||
        comisionData.comercial_id === undefined ||
        comisionData.mes === undefined ||
        comisionData.año === undefined
      ) {
        throw new Error('saveComision requiere id o (comercial_id, mes, año)');
      }

      // Verificar si ya existe
      const existing = await this.query(
        'SELECT id FROM comisiones WHERE comercial_id = ? AND mes = ? AND año = ?',
        [comisionData.comercial_id, comisionData.mes, comisionData.año]
      );

      if (existing.length > 0) {
        // Actualizar
        const updates = [];
        const params = [];

        if (comisionData.fijo_mensual !== undefined) {
          updates.push('fijo_mensual = ?');
          params.push(comisionData.fijo_mensual);
        }
        if (comisionData.comision_ventas !== undefined) {
          updates.push('comision_ventas = ?');
          params.push(comisionData.comision_ventas);
        }
        if (comisionData.comision_presupuesto !== undefined) {
          updates.push('comision_presupuesto = ?');
          params.push(comisionData.comision_presupuesto);
        }
        if (comisionData.total_ventas !== undefined) {
          updates.push('total_ventas = ?');
          params.push(comisionData.total_ventas);
        }
        if (comisionData.total_comision !== undefined) {
          updates.push('total_comision = ?');
          params.push(comisionData.total_comision);
        }
        if (comisionData.estado !== undefined) {
          updates.push('estado = ?');
          params.push(comisionData.estado);
        }
        if (comisionData.fecha_pago !== undefined) {
          updates.push('fecha_pago = ?');
          params.push(comisionData.fecha_pago);
        }
        // Pagos separados por concepto (si la BD lo soporta)
        if (hasPagoConceptoCols) {
          if (comisionData.fecha_pago_ventas !== undefined) {
            updates.push('fecha_pago_ventas = ?');
            params.push(comisionData.fecha_pago_ventas || null);
          }
          if (comisionData.pagado_ventas_por !== undefined) {
            updates.push('pagado_ventas_por = ?');
            params.push(comisionData.pagado_ventas_por ?? null);
          }
          if (comisionData.fecha_pago_fijo !== undefined) {
            updates.push('fecha_pago_fijo = ?');
            params.push(comisionData.fecha_pago_fijo || null);
          }
          if (comisionData.pagado_fijo_por !== undefined) {
            updates.push('pagado_fijo_por = ?');
            params.push(comisionData.pagado_fijo_por ?? null);
          }
        }
        if (comisionData.observaciones !== undefined) {
          updates.push('observaciones = ?');
          params.push(comisionData.observaciones);
        }
        if (comisionData.calculado_por !== undefined) {
          updates.push('calculado_por = ?');
          params.push(comisionData.calculado_por);
        }
        if (comisionData.pagado_por !== undefined) {
          updates.push('pagado_por = ?');
          params.push(comisionData.pagado_por);
        }

        if (updates.length > 0) {
          params.push(existing[0].id);
          const sql = `UPDATE comisiones SET ${updates.join(', ')} WHERE id = ?`;
          await this.execute(sql, params);
          return { id: existing[0].id, ...comisionData };
        }
        return { id: existing[0].id };
      } else {
        // Crear
        const sql = `
          INSERT INTO comisiones 
          (comercial_id, mes, año, fijo_mensual, comision_ventas, comision_presupuesto,
           total_ventas, total_comision, estado, fecha_pago, observaciones, calculado_por, pagado_por)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [
          comisionData.comercial_id,
          comisionData.mes,
          comisionData.año,
          comisionData.fijo_mensual || 0,
          comisionData.comision_ventas || 0,
          comisionData.comision_presupuesto || 0,
          comisionData.total_ventas || 0,
          comisionData.total_comision || 0,
          comisionData.estado || 'Pendiente',
          comisionData.fecha_pago || null,
          comisionData.observaciones || null,
          comisionData.calculado_por || null,
          comisionData.pagado_por || null
        ];

        const result = await this.execute(sql, params);
        return { id: result.insertId, ...comisionData };
      }
    } catch (error) {
      console.error('❌ Error guardando comisión:', error.message);
      throw error;
    }
  }

  /**
   * Detectar si la tabla `comisiones` tiene columnas para pago por concepto.
   * (Compatibilidad: en producción puede tardar en aplicarse el ALTER TABLE.)
   */
  async _hasComisionesPagoConceptoColumns() {
    this._cache = this._cache || {};
    if (this._cache.comisionesHasPagoConceptoColumns !== undefined) {
      return this._cache.comisionesHasPagoConceptoColumns;
    }
    try {
      await this.query('SELECT fecha_pago_ventas, fecha_pago_fijo FROM comisiones WHERE 1=0');
      this._cache.comisionesHasPagoConceptoColumns = true;
      return true;
    } catch (_) {
      this._cache.comisionesHasPagoConceptoColumns = false;
      return false;
    }
  }

  /**
   * Obtener detalle de una comisión
   */
  async getComisionDetalle(comisionId) {
    try {
      const cdTable = await this._getComisionesDetalleTable();
      const sql = `
        SELECT cd.*,
               p.NumPedido as pedido_numero,
               p.FechaPedido as pedido_fecha,
               a.Nombre as articulo_nombre,
               a.SKU as articulo_sku
        FROM ${cdTable} cd
        LEFT JOIN pedidos p ON cd.pedido_id = p.id
        LEFT JOIN articulos a ON cd.articulo_id = a.id
        WHERE cd.comision_id = ?
        ORDER BY cd.creado_en DESC
      `;
      return await this.query(sql, [comisionId]);
    } catch (error) {
      console.error('❌ Error obteniendo detalle de comisión:', error.message);
      throw error;
    }
  }

  async _getClienteNombreColumn() {
    if (this._cache.clientesNombreCol !== null) return this._cache.clientesNombreCol;
    try {
      const cols = await this.query('SHOW COLUMNS FROM clientes');
      const set = new Set((cols || []).map(r => String(r.Field || '').trim()));
      const pick = (candidates) => candidates.find(c => set.has(c)) || null;
      const col = pick([
        'Nombre_Razon_Social',
        'Nombre_Cial',
        'Nombre',
        'nombre',
        'RazonSocial',
        'Razon_Social'
      ]);
      this._cache.clientesNombreCol = col || 'Nombre';
      return this._cache.clientesNombreCol;
    } catch (_) {
      this._cache.clientesNombreCol = 'Nombre';
      return this._cache.clientesNombreCol;
    }
  }

  /**
   * Detalle para liquidación de comisiones de VENTAS, agregado por pedido y cliente.
   * Devuelve filas con: cliente, pedido, importe_venta_total, importe_comision_total.
   */
  async getComisionLiquidacionVentas(comisionId) {
    try {
      const cdTable = await this._getComisionesDetalleTable();
      const nombreCol = await this._getClienteNombreColumn();
      const clienteNombreExpr = `cl.\`${String(nombreCol).replace(/`/g, '')}\``;

      const sql = `
        SELECT
          p.Id_Cliente AS cliente_id,
          ${clienteNombreExpr} AS cliente_nombre,
          p.id AS pedido_id,
          p.NumPedido AS pedido_numero,
          p.FechaPedido AS pedido_fecha,
          p.EstadoPedido AS pedido_estado,
          SUM(cd.importe_venta) AS importe_venta,
          SUM(cd.importe_comision) AS importe_comision
        FROM ${cdTable} cd
        LEFT JOIN pedidos p ON cd.pedido_id = p.id
        LEFT JOIN clientes cl ON (cl.id = p.Id_Cliente OR cl.Id = p.Id_Cliente)
        WHERE cd.comision_id = ?
          AND (cd.tipo_comision IS NULL OR cd.tipo_comision = 'Venta')
          AND cd.pedido_id IS NOT NULL
        GROUP BY
          p.Id_Cliente,
          cliente_nombre,
          p.id,
          p.NumPedido,
          p.FechaPedido,
          p.EstadoPedido
        ORDER BY cliente_nombre ASC, p.FechaPedido ASC, p.id ASC
      `;

      return await this.query(sql, [Number(comisionId)]);
    } catch (error) {
      console.error('❌ Error obteniendo liquidación de comisión ventas:', error.message);
      throw error;
    }
  }

  /**
   * Detalle para liquidación de comisiones de VENTAS, agregado por pedido + marca (y cliente).
   * Devuelve filas con: cliente, pedido, marca, base_venta, comision_venta.
   */
  async getComisionLiquidacionVentasPedidoMarca(comisionId) {
    const cdTable = await this._getComisionesDetalleTable();
    const nombreCol = await this._getClienteNombreColumn();
    const clienteNombreExpr = `cl.\`${String(nombreCol).replace(/`/g, '')}\``;

    const run = async (marcasTable, articulosTable) => {
      const sql = `
        SELECT
          p.Id_Cliente AS cliente_id,
          ${clienteNombreExpr} AS cliente_nombre,
          p.id AS pedido_id,
          p.NumPedido AS pedido_numero,
          p.FechaPedido AS pedido_fecha,
          p.EstadoPedido AS pedido_estado,
          m.id AS marca_id,
          m.Nombre AS marca_nombre,
          SUM(cd.importe_venta) AS base_venta,
          SUM(cd.importe_comision) AS comision_ventas
        FROM ${cdTable} cd
        LEFT JOIN pedidos p ON cd.pedido_id = p.id
        LEFT JOIN clientes cl ON (cl.id = p.Id_Cliente OR cl.Id = p.Id_Cliente)
        LEFT JOIN ${articulosTable} a ON (a.id = cd.articulo_id OR a.Id = cd.articulo_id)
        LEFT JOIN ${marcasTable} m ON (m.id = a.Id_Marca OR m.Id = a.Id_Marca)
        WHERE cd.comision_id = ?
          AND (cd.tipo_comision IS NULL OR cd.tipo_comision = 'Venta')
          AND cd.pedido_id IS NOT NULL
        GROUP BY
          p.Id_Cliente,
          cliente_nombre,
          p.id,
          p.NumPedido,
          p.FechaPedido,
          p.EstadoPedido,
          m.id,
          m.Nombre
        ORDER BY cliente_nombre ASC, p.FechaPedido ASC, p.id ASC, m.Nombre ASC
      `;
      return await this.query(sql, [Number(comisionId)]);
    };

    try {
      return await run('marcas', 'articulos');
    } catch (e1) {
      try {
        return await run('Marcas', 'articulos');
      } catch (e2) {
        try {
          return await run('marcas', 'Articulos');
        } catch (e3) {
          return await run('Marcas', 'Articulos');
        }
      }
    }
  }

  /**
   * Eliminar todos los detalles de una comisión
   */
  async deleteComisionDetalleByComisionId(comisionId) {
    try {
      const cdTable = await this._getComisionesDetalleTable();
      const sql = `DELETE FROM ${cdTable} WHERE comision_id = ?`;
      await this.execute(sql, [comisionId]);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error eliminando detalles de comisión:', error.message);
      throw error;
    }
  }

  /**
   * Eliminar una comisión mensual por ID manteniendo integridad:
   * - Borra detalle (comisiones_detalle) primero (por si no hay FK cascade)
   * - Borra estadoComisiones (si existe) para no dejar huérfanos en instalaciones sin FK
   * - Borra la comisión
   */
  async deleteComisionById(comisionId) {
    const id = Number(comisionId);
    if (!Number.isFinite(id) || id <= 0) throw new Error('ID de comisión inválido');

    // 1) Detalle
    try {
      await this.deleteComisionDetalleByComisionId(id);
    } catch (e) {
      // no bloquear si la tabla no existe o hay case issues ya cubiertos por _getComisionesDetalleTable
      console.warn('⚠️ No se pudo borrar detalle (no crítico):', e.message);
    }

    // 2) estadoComisiones (si existe la tabla)
    try {
      await this.execute('DELETE FROM estadoComisiones WHERE comision_id = ?', [id]);
    } catch (e) {
      // En entornos sin la tabla aún, ignorar
      const msg = String(e?.message || '').toLowerCase();
      if (!msg.includes('doesn\'t exist') && !msg.includes('no such table')) {
        console.warn('⚠️ No se pudo borrar estadoComisiones (no crítico):', e.message);
      }
    }

    // 3) comisión
    const res = await this.execute('DELETE FROM comisiones WHERE id = ?', [id]);
    return { affectedRows: res?.affectedRows ?? 0 };
  }

  /**
   * Agregar detalle a una comisión
   */
  async addComisionDetalle(detalleData) {
    try {
      const cdTable = await this._getComisionesDetalleTable();
      const sql = `
        INSERT INTO ${cdTable} 
        (comision_id, pedido_id, articulo_id, cantidad, importe_venta, 
         porcentaje_comision, importe_comision, tipo_comision, observaciones)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        detalleData.comision_id,
        detalleData.pedido_id || null,
        detalleData.articulo_id || null,
        detalleData.cantidad || 0,
        detalleData.importe_venta || 0,
        detalleData.porcentaje_comision || 0,
        detalleData.importe_comision || 0,
        detalleData.tipo_comision || 'Venta',
        detalleData.observaciones || null
      ];

      const result = await this.execute(sql, params);
      return { id: result.insertId, ...detalleData };
    } catch (error) {
      console.error('❌ Error agregando detalle de comisión:', error.message);
      throw error;
    }
  }

  // =====================================================
  // RAPELES
  // =====================================================

  /**
   * Obtener todos los rapeles
   */
  async getRapeles(filters = {}) {
    try {
      let sql = `
        SELECT r.*, 
               c.Nombre as comercial_nombre,
               c.Email as comercial_email
        FROM rapeles r
        LEFT JOIN comerciales c ON r.comercial_id = c.id
        WHERE 1=1
      `;
      const params = [];

      if (filters.comercial_id) {
        sql += ' AND r.comercial_id = ?';
        params.push(filters.comercial_id);
      }
      if (filters.marca) {
        sql += ' AND r.marca = ?';
        params.push(filters.marca);
      }
      if (filters.trimestre) {
        sql += ' AND r.trimestre = ?';
        params.push(filters.trimestre);
      }
      if (filters.año) {
        sql += ' AND r.año = ?';
        params.push(filters.año);
      }
      if (filters.estado) {
        sql += ' AND r.estado = ?';
        params.push(filters.estado);
      }

      sql += ' ORDER BY r.año DESC, r.trimestre DESC, r.marca, c.Nombre';

      return await this.query(sql, params);
    } catch (error) {
      console.error('❌ Error obteniendo rapeles:', error.message);
      throw error;
    }
  }

  /**
   * Obtener un rapel por ID
   */
  async getRapelById(id) {
    try {
      const sql = `
        SELECT r.*, 
               c.Nombre as comercial_nombre,
               c.Email as comercial_email
        FROM rapeles r
        LEFT JOIN comerciales c ON r.comercial_id = c.id
        WHERE r.id = ?
      `;
      const rows = await this.query(sql, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error('❌ Error obteniendo rapel:', error.message);
      throw error;
    }
  }

  /**
   * Crear o actualizar un rapel
   */
  async saveRapel(rapelData) {
    try {
      // Si viene ID, actualizar directamente por ID (evita pasar undefined en el SELECT por clave compuesta)
      if (rapelData && rapelData.id !== undefined && rapelData.id !== null) {
        const id = Number(rapelData.id);
        if (!Number.isFinite(id) || id <= 0) {
          throw new Error(`ID de rapel inválido: ${rapelData.id}`);
        }

        const updates = [];
        const params = [];

        if (rapelData.ventas_trimestre !== undefined) {
          updates.push('ventas_trimestre = ?');
          params.push(rapelData.ventas_trimestre);
        }
        if (rapelData.objetivo_trimestre !== undefined) {
          updates.push('objetivo_trimestre = ?');
          params.push(rapelData.objetivo_trimestre);
        }
        if (rapelData.porcentaje_cumplimiento !== undefined) {
          updates.push('porcentaje_cumplimiento = ?');
          params.push(rapelData.porcentaje_cumplimiento);
        }
        if (rapelData.porcentaje_rapel !== undefined) {
          updates.push('porcentaje_rapel = ?');
          params.push(rapelData.porcentaje_rapel);
        }
        if (rapelData.importe_rapel !== undefined) {
          updates.push('importe_rapel = ?');
          params.push(rapelData.importe_rapel);
        }
        if (rapelData.estado !== undefined) {
          updates.push('estado = ?');
          params.push(rapelData.estado);
        }
        if (rapelData.fecha_pago !== undefined) {
          updates.push('fecha_pago = ?');
          params.push(rapelData.fecha_pago || null);
        }
        if (rapelData.observaciones !== undefined) {
          updates.push('observaciones = ?');
          params.push(rapelData.observaciones || null);
        }
        if (rapelData.calculado_por !== undefined) {
          updates.push('calculado_por = ?');
          params.push(rapelData.calculado_por ?? null);
        }
        if (rapelData.pagado_por !== undefined) {
          updates.push('pagado_por = ?');
          params.push(rapelData.pagado_por ?? null);
        }

        if (updates.length === 0) {
          return { id };
        }

        params.push(id);
        const sql = `UPDATE rapeles SET ${updates.join(', ')} WHERE id = ?`;
        await this.execute(sql, params);
        return { id, ...rapelData };
      }

      // Sin ID, se requiere clave compuesta para upsert (comercial_id, marca, trimestre, año)
      if (
        !rapelData ||
        rapelData.comercial_id === undefined ||
        rapelData.marca === undefined ||
        rapelData.trimestre === undefined ||
        rapelData.año === undefined
      ) {
        throw new Error('saveRapel requiere id o (comercial_id, marca, trimestre, año)');
      }

      // Verificar si ya existe
      const existing = await this.query(
        'SELECT id FROM rapeles WHERE comercial_id = ? AND marca = ? AND trimestre = ? AND año = ?',
        [rapelData.comercial_id, rapelData.marca, rapelData.trimestre, rapelData.año]
      );

      if (existing.length > 0) {
        // Actualizar
        const updates = [];
        const params = [];

        if (rapelData.ventas_trimestre !== undefined) {
          updates.push('ventas_trimestre = ?');
          params.push(rapelData.ventas_trimestre);
        }
        if (rapelData.objetivo_trimestre !== undefined) {
          updates.push('objetivo_trimestre = ?');
          params.push(rapelData.objetivo_trimestre);
        }
        if (rapelData.porcentaje_cumplimiento !== undefined) {
          updates.push('porcentaje_cumplimiento = ?');
          params.push(rapelData.porcentaje_cumplimiento);
        }
        if (rapelData.porcentaje_rapel !== undefined) {
          updates.push('porcentaje_rapel = ?');
          params.push(rapelData.porcentaje_rapel);
        }
        if (rapelData.importe_rapel !== undefined) {
          updates.push('importe_rapel = ?');
          params.push(rapelData.importe_rapel);
        }
        if (rapelData.estado !== undefined) {
          updates.push('estado = ?');
          params.push(rapelData.estado);
        }
        if (rapelData.fecha_pago !== undefined) {
          updates.push('fecha_pago = ?');
          params.push(rapelData.fecha_pago);
        }
        if (rapelData.observaciones !== undefined) {
          updates.push('observaciones = ?');
          params.push(rapelData.observaciones);
        }
        if (rapelData.calculado_por !== undefined) {
          updates.push('calculado_por = ?');
          params.push(rapelData.calculado_por);
        }
        if (rapelData.pagado_por !== undefined) {
          updates.push('pagado_por = ?');
          params.push(rapelData.pagado_por);
        }

        if (updates.length > 0) {
          params.push(existing[0].id);
          const sql = `UPDATE rapeles SET ${updates.join(', ')} WHERE id = ?`;
          await this.execute(sql, params);
          return { id: existing[0].id, ...rapelData };
        }
        return { id: existing[0].id };
      } else {
        // Crear
        const sql = `
          INSERT INTO rapeles 
          (comercial_id, marca, trimestre, año, ventas_trimestre, objetivo_trimestre,
           porcentaje_cumplimiento, porcentaje_rapel, importe_rapel, estado, fecha_pago, 
           observaciones, calculado_por, pagado_por)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [
          rapelData.comercial_id,
          rapelData.marca,
          rapelData.trimestre,
          rapelData.año,
          rapelData.ventas_trimestre || 0,
          rapelData.objetivo_trimestre || 0,
          rapelData.porcentaje_cumplimiento || 0,
          rapelData.porcentaje_rapel || 0,
          rapelData.importe_rapel || 0,
          rapelData.estado || 'Pendiente',
          rapelData.fecha_pago || null,
          rapelData.observaciones || null,
          rapelData.calculado_por || null,
          rapelData.pagado_por || null
        ];

        const result = await this.execute(sql, params);
        return { id: result.insertId, ...rapelData };
      }
    } catch (error) {
      console.error('❌ Error guardando rapel:', error.message);
      throw error;
    }
  }

  // =====================================================
  // CONFIGURACIÓN DE RAPELES
  // =====================================================

  /**
   * Obtener configuración de rapeles
   */
  async getRapelesConfiguracion(filters = {}) {
    try {
      let sql = 'SELECT * FROM rapeles_configuracion WHERE 1=1';
      const params = [];

      if (filters.marca) {
        sql += ' AND marca = ?';
        params.push(filters.marca);
      }
      if (filters.activo !== undefined) {
        sql += ' AND activo = ?';
        params.push(filters.activo ? 1 : 0);
      }

      sql += ' ORDER BY marca, porcentaje_cumplimiento_min';

      return await this.query(sql, params);
    } catch (error) {
      console.error('❌ Error obteniendo configuración de rapeles:', error.message);
      throw error;
    }
  }

  /**
   * Crear configuración de rapel
   */
  async createRapelConfiguracion(configData) {
    try {
      const sql = `
        INSERT INTO rapeles_configuracion 
        (marca, porcentaje_cumplimiento_min, porcentaje_cumplimiento_max, porcentaje_rapel, activo, observaciones)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      const params = [
        configData.marca,
        configData.porcentaje_cumplimiento_min,
        configData.porcentaje_cumplimiento_max,
        configData.porcentaje_rapel,
        configData.activo !== undefined ? (configData.activo ? 1 : 0) : 1,
        configData.observaciones || null
      ];

      const result = await this.execute(sql, params);
      return { id: result.insertId, ...configData };
    } catch (error) {
      console.error('❌ Error creando configuración de rapel:', error.message);
      throw error;
    }
  }

  /**
   * Actualizar configuración de rapel
   */
  async updateRapelConfiguracion(id, configData) {
    try {
      const updates = [];
      const params = [];

      if (configData.porcentaje_cumplimiento_min !== undefined) {
        updates.push('porcentaje_cumplimiento_min = ?');
        params.push(configData.porcentaje_cumplimiento_min);
      }
      if (configData.porcentaje_cumplimiento_max !== undefined) {
        updates.push('porcentaje_cumplimiento_max = ?');
        params.push(configData.porcentaje_cumplimiento_max);
      }
      if (configData.porcentaje_rapel !== undefined) {
        updates.push('porcentaje_rapel = ?');
        params.push(configData.porcentaje_rapel);
      }
      if (configData.activo !== undefined) {
        updates.push('activo = ?');
        params.push(configData.activo ? 1 : 0);
      }
      if (configData.observaciones !== undefined) {
        updates.push('observaciones = ?');
        params.push(configData.observaciones);
      }

      if (updates.length === 0) {
        throw new Error('No hay campos para actualizar');
      }

      params.push(id);
      const sql = `UPDATE rapeles_configuracion SET ${updates.join(', ')} WHERE id = ?`;
      await this.query(sql, params);
      return { id, ...configData };
    } catch (error) {
      console.error('❌ Error actualizando configuración de rapel:', error.message);
      throw error;
    }
  }

  /**
   * Eliminar configuración de rapel
   */
  async deleteRapelConfiguracion(id) {
    try {
      const sql = 'DELETE FROM rapeles_configuracion WHERE id = ?';
      await this.execute(sql, [id]);
      return { success: true };
    } catch (error) {
      console.error('❌ Error eliminando configuración de rapel:', error.message);
      throw error;
    }
  }

  // =====================================================
  // OBJETIVOS POR MARCA
  // =====================================================

  /**
   * Obtener objetivos por marca
   */
  async getObjetivosMarca(filters = {}) {
    try {
      // IMPORTANTE:
      // - En BD guardamos 1 fila por trimestre (trimestre 1..4) en `objetivos_marca.objetivo`
      // - La UI espera una fila agregada por (comercial_id, marca, año) con columnas:
      //   objetivo_anual, objetivo_trimestral_q1..q4
      let sql = `
        SELECT
          MIN(o.id) AS id,
          o.comercial_id,
          c.Nombre AS comercial_nombre,
          o.marca,
          o.año,
          SUM(o.objetivo) AS objetivo_anual,
          SUM(CASE WHEN o.trimestre = 1 THEN o.objetivo ELSE 0 END) AS objetivo_trimestral_q1,
          SUM(CASE WHEN o.trimestre = 2 THEN o.objetivo ELSE 0 END) AS objetivo_trimestral_q2,
          SUM(CASE WHEN o.trimestre = 3 THEN o.objetivo ELSE 0 END) AS objetivo_trimestral_q3,
          SUM(CASE WHEN o.trimestre = 4 THEN o.objetivo ELSE 0 END) AS objetivo_trimestral_q4,
          MAX(o.activo) AS activo,
          MAX(o.actualizado_en) AS actualizado_en,
          MAX(o.creado_en) AS creado_en,
          MAX(o.observaciones) AS observaciones
        FROM objetivos_marca o
        LEFT JOIN comerciales c ON o.comercial_id = c.id
        WHERE 1=1
      `;
      const params = [];

      // Asegurarse de que comercial_id no sea undefined ni null (solo números válidos)
      if (filters.comercial_id != null && filters.comercial_id !== undefined && !isNaN(filters.comercial_id)) {
        sql += ' AND o.comercial_id = ?';
        params.push(Number(filters.comercial_id));
      }
      // Asegurarse de que marca no sea undefined ni vacío
      if (filters.marca != null && filters.marca !== undefined && filters.marca !== '') {
        sql += ' AND o.marca = ?';
        params.push(String(filters.marca));
      }
      // Asegurarse de que trimestre no sea undefined ni null (solo números válidos)
      if (filters.trimestre != null && filters.trimestre !== undefined && !isNaN(filters.trimestre)) {
        sql += ' AND o.trimestre = ?';
        params.push(Number(filters.trimestre));
      }
      // Asegurarse de que año no sea undefined ni null (solo números válidos)
      if (filters.año != null && filters.año !== undefined && !isNaN(filters.año)) {
        sql += ' AND o.año = ?';
        params.push(Number(filters.año));
      }
      // Asegurarse de que activo no sea undefined
      if (filters.activo !== undefined && filters.activo !== null) {
        sql += ' AND o.activo = ?';
        params.push(filters.activo ? 1 : 0);
      }

      // Validación final: asegurarse de que ningún parámetro sea undefined
      const hasUndefined = params.some(p => p === undefined);
      if (hasUndefined) {
        console.error('❌ Error: Parámetros undefined detectados en getObjetivosMarca:', { filters, params });
        throw new Error('Parámetros undefined detectados en la consulta SQL');
      }

      sql += ' GROUP BY o.comercial_id, o.marca, o.año';
      sql += ' ORDER BY o.año DESC, o.marca, c.Nombre';

      return await this.query(sql, params);
    } catch (error) {
      console.error('❌ Error obteniendo objetivos por marca:', error.message);
      throw error;
    }
  }

  /**
   * Obtener objetivo por marca por ID
   */
  async getObjetivoMarcaById(id) {
    try {
      // El ID que viene de la UI es el MIN(id) del grupo.
      // Recuperar clave del grupo y devolver un objeto agregado compatible con la UI.
      const base = await this.query(
        'SELECT comercial_id, marca, año FROM objetivos_marca WHERE id = ? LIMIT 1',
        [Number(id)]
      );
      if (!base || base.length === 0) return null;

      const comercialId = Number(base[0].comercial_id);
      const marca = String(base[0].marca);
      const año = Number(base[0].año);

      const sql = `
        SELECT
          MIN(o.id) AS id,
          o.comercial_id,
          c.Nombre AS comercial_nombre,
          o.marca,
          o.año,
          SUM(o.objetivo) AS objetivo_anual,
          SUM(CASE WHEN o.trimestre = 1 THEN o.objetivo ELSE 0 END) AS objetivo_trimestral_q1,
          SUM(CASE WHEN o.trimestre = 2 THEN o.objetivo ELSE 0 END) AS objetivo_trimestral_q2,
          SUM(CASE WHEN o.trimestre = 3 THEN o.objetivo ELSE 0 END) AS objetivo_trimestral_q3,
          SUM(CASE WHEN o.trimestre = 4 THEN o.objetivo ELSE 0 END) AS objetivo_trimestral_q4,
          MAX(o.activo) AS activo,
          MAX(o.observaciones) AS observaciones
        FROM objetivos_marca o
        LEFT JOIN comerciales c ON o.comercial_id = c.id
        WHERE o.comercial_id = ?
          AND o.marca = ?
          AND o.año = ?
        GROUP BY o.comercial_id, o.marca, o.año
        LIMIT 1
      `;
      const rows = await this.query(sql, [comercialId, marca, año]);
      return rows[0] || null;
    } catch (error) {
      console.error('❌ Error obteniendo objetivo por marca:', error.message);
      throw error;
    }
  }

  /**
   * Actualizar un grupo de objetivos (Q1..Q4) por ID (MIN(id) del grupo)
   */
  async updateObjetivoMarcaById(id, data) {
    try {
      const base = await this.query(
        'SELECT comercial_id, marca, año FROM objetivos_marca WHERE id = ? LIMIT 1',
        [Number(id)]
      );
      if (!base || base.length === 0) {
        throw new Error('Objetivo no encontrado');
      }

      const comercial_id = Number(base[0].comercial_id);
      const marca = String(data.marca !== undefined ? data.marca : base[0].marca);
      const año = Number(data.año !== undefined ? data.año : base[0].año);

      // Normalizar objetivos
      const objetivoAnual = data.objetivo_anual !== undefined ? Number(data.objetivo_anual || 0) : null;
      let q1 = data.objetivo_trimestral_q1 !== undefined ? Number(data.objetivo_trimestral_q1 || 0) : null;
      let q2 = data.objetivo_trimestral_q2 !== undefined ? Number(data.objetivo_trimestral_q2 || 0) : null;
      let q3 = data.objetivo_trimestral_q3 !== undefined ? Number(data.objetivo_trimestral_q3 || 0) : null;
      let q4 = data.objetivo_trimestral_q4 !== undefined ? Number(data.objetivo_trimestral_q4 || 0) : null;

      // Si no vienen Qs, mantener los actuales
      if (q1 === null || q2 === null || q3 === null || q4 === null) {
        const actuales = await this.query(
          'SELECT trimestre, objetivo FROM objetivos_marca WHERE comercial_id = ? AND marca = ? AND año = ?',
          [comercial_id, String(base[0].marca), Number(base[0].año)]
        );
        const map = {};
        for (const r of (actuales || [])) map[Number(r.trimestre)] = Number(r.objetivo || 0);
        if (q1 === null) q1 = map[1] ?? 0;
        if (q2 === null) q2 = map[2] ?? 0;
        if (q3 === null) q3 = map[3] ?? 0;
        if (q4 === null) q4 = map[4] ?? 0;
      }

      const sumaQs = Number(q1 || 0) + Number(q2 || 0) + Number(q3 || 0) + Number(q4 || 0);
      if (sumaQs === 0 && objetivoAnual !== null && objetivoAnual > 0) {
        const porTrimestre = objetivoAnual / 4;
        q1 = porTrimestre; q2 = porTrimestre; q3 = porTrimestre; q4 = porTrimestre;
      }

      const activo = data.activo !== undefined ? (data.activo ? 1 : 0) : 1;
      const observaciones = data.observaciones !== undefined ? (data.observaciones || null) : null;

      // Si cambia marca/año, borrar el grupo antiguo y recrear en el nuevo (manteniendo trimestre)
      // Borrado grupo antiguo (por la marca/año originales del base)
      await this.execute(
        'DELETE FROM objetivos_marca WHERE comercial_id = ? AND marca = ? AND año = ?',
        [comercial_id, String(base[0].marca), Number(base[0].año)]
      );

      // Insertar/actualizar 4 trimestres
      const trimestres = [
        { trimestre: 1, objetivo: q1 },
        { trimestre: 2, objetivo: q2 },
        { trimestre: 3, objetivo: q3 },
        { trimestre: 4, objetivo: q4 }
      ];

      for (const t of trimestres) {
        await this.saveObjetivoMarca({
          comercial_id,
          marca,
          trimestre: t.trimestre,
          año,
          objetivo: Number(t.objetivo || 0),
          activo,
          observaciones
        });
      }

      // Devolver agregado actualizado
      const rows = await this.query(
        `
        SELECT
          MIN(o.id) AS id,
          o.comercial_id,
          c.Nombre AS comercial_nombre,
          o.marca,
          o.año,
          SUM(o.objetivo) AS objetivo_anual,
          SUM(CASE WHEN o.trimestre = 1 THEN o.objetivo ELSE 0 END) AS objetivo_trimestral_q1,
          SUM(CASE WHEN o.trimestre = 2 THEN o.objetivo ELSE 0 END) AS objetivo_trimestral_q2,
          SUM(CASE WHEN o.trimestre = 3 THEN o.objetivo ELSE 0 END) AS objetivo_trimestral_q3,
          SUM(CASE WHEN o.trimestre = 4 THEN o.objetivo ELSE 0 END) AS objetivo_trimestral_q4,
          MAX(o.activo) AS activo,
          MAX(o.observaciones) AS observaciones
        FROM objetivos_marca o
        LEFT JOIN comerciales c ON o.comercial_id = c.id
        WHERE o.comercial_id = ?
          AND o.marca = ?
          AND o.año = ?
        GROUP BY o.comercial_id, o.marca, o.año
        LIMIT 1
        `,
        [comercial_id, marca, año]
      );
      return rows[0] || { success: true };
    } catch (error) {
      console.error('❌ Error actualizando objetivo por marca (grupo):', error.message);
      throw error;
    }
  }

  /**
   * Eliminar un grupo de objetivos (Q1..Q4) por ID (MIN(id) del grupo)
   */
  async deleteObjetivoMarcaById(id) {
    try {
      const base = await this.query(
        'SELECT comercial_id, marca, año FROM objetivos_marca WHERE id = ? LIMIT 1',
        [Number(id)]
      );
      if (!base || base.length === 0) {
        return { success: true };
      }
      await this.execute(
        'DELETE FROM objetivos_marca WHERE comercial_id = ? AND marca = ? AND año = ?',
        [Number(base[0].comercial_id), String(base[0].marca), Number(base[0].año)]
      );
      return { success: true };
    } catch (error) {
      console.error('❌ Error eliminando objetivo por marca (grupo):', error.message);
      throw error;
    }
  }

  /**
   * Crear o actualizar objetivo por marca
   */
  async saveObjetivoMarca(objetivoData) {
    try {
      // Validar y normalizar valores requeridos
      if (objetivoData.comercial_id === null || objetivoData.comercial_id === undefined || isNaN(objetivoData.comercial_id)) {
        throw new Error('comercial_id es requerido y debe ser un número válido');
      }
      if (!objetivoData.marca || objetivoData.marca === '') {
        throw new Error('marca es requerida');
      }
      if (objetivoData.trimestre === null || objetivoData.trimestre === undefined || isNaN(objetivoData.trimestre)) {
        throw new Error('trimestre es requerido y debe ser un número válido (1-4)');
      }
      if (objetivoData.año === null || objetivoData.año === undefined || isNaN(objetivoData.año)) {
        throw new Error('año es requerido y debe ser un número válido');
      }

      const comercial_id = Number(objetivoData.comercial_id);
      const marca = String(objetivoData.marca);
      const trimestre = Number(objetivoData.trimestre);
      const año = Number(objetivoData.año);
      const objetivo = objetivoData.objetivo !== undefined && objetivoData.objetivo !== null ? Number(objetivoData.objetivo) : 0;
      const activo = objetivoData.activo !== undefined && objetivoData.activo !== null ? (objetivoData.activo ? 1 : 0) : 1;
      const observaciones = objetivoData.observaciones !== undefined && objetivoData.observaciones !== null && objetivoData.observaciones !== '' 
        ? String(objetivoData.observaciones) 
        : null;

      // Validar que los valores no sean NaN después de la conversión
      if (isNaN(comercial_id) || isNaN(trimestre) || isNaN(año)) {
        console.error('❌ Error: Valores NaN después de conversión:', { comercial_id, trimestre, año, objetivoData });
        throw new Error('Valores inválidos después de la conversión (NaN detectado)');
      }

      // Validar parámetros para la consulta SELECT (marca puede ser string vacío pero no null/undefined)
      const selectParams = [comercial_id, marca, trimestre, año];
      if (selectParams[0] === undefined || selectParams[0] === null || isNaN(selectParams[0]) ||
          selectParams[1] === undefined || selectParams[1] === null ||
          selectParams[2] === undefined || selectParams[2] === null || isNaN(selectParams[2]) ||
          selectParams[3] === undefined || selectParams[3] === null || isNaN(selectParams[3])) {
        console.error('❌ Error: Parámetros inválidos en SELECT:', { selectParams, objetivoData });
        throw new Error('Parámetros inválidos en la consulta SELECT');
      }

      const existing = await this.query(
        'SELECT id FROM objetivos_marca WHERE comercial_id = ? AND marca = ? AND trimestre = ? AND año = ?',
        selectParams
      );

      if (existing.length > 0) {
        const updates = [];
        const params = [];

        if (objetivoData.objetivo !== undefined) {
          updates.push('objetivo = ?');
          params.push(objetivo);
        }
        if (objetivoData.activo !== undefined) {
          updates.push('activo = ?');
          params.push(activo);
        }
        if (objetivoData.observaciones !== undefined) {
          updates.push('observaciones = ?');
          params.push(observaciones);
        }

        if (updates.length > 0) {
          params.push(existing[0].id);
          
          // Validación: asegurarse de que ningún parámetro sea undefined
          if (params.some(p => p === undefined)) {
            console.error('❌ Error: Parámetros undefined en UPDATE:', { updates, params, objetivoData });
            throw new Error('Parámetros undefined detectados en la consulta SQL UPDATE');
          }
          
          const sql = `UPDATE objetivos_marca SET ${updates.join(', ')} WHERE id = ?`;
          await this.execute(sql, params);
          return { id: existing[0].id, comercial_id, marca, trimestre, año, objetivo, activo, observaciones };
        }
        return { id: existing[0].id, comercial_id, marca, trimestre, año, objetivo, activo, observaciones };
      } else {
        const sql = `
          INSERT INTO objetivos_marca 
          (comercial_id, marca, trimestre, año, objetivo, activo, observaciones)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [comercial_id, marca, trimestre, año, objetivo, activo, observaciones];

        // Validación final: asegurarse de que ningún parámetro sea undefined o NaN
        if (params.some((p, i) => {
          if (p === undefined) return true;
          if (i < 4 && (p === null || (typeof p === 'number' && isNaN(p)))) return true; // primeros 4 son requeridos
          return false;
        })) {
          console.error('❌ Error: Parámetros inválidos detectados en INSERT:', { 
            objetivoData, 
            params,
            tipos: params.map(p => typeof p),
            valores: params
          });
          throw new Error('Parámetros inválidos detectados en la consulta SQL INSERT');
        }

        const result = await this.execute(sql, params);
        return { id: result.insertId, comercial_id, marca, trimestre, año, objetivo, activo, observaciones };
      }
    } catch (error) {
      console.error('❌ Error guardando objetivo por marca:', error.message);
      console.error('❌ Stack:', error.stack);
      console.error('❌ objetivoData recibido:', objetivoData);
      throw error;
    }
  }

  /**
   * Eliminar objetivo por marca
   */
  async deleteObjetivoMarca(id) {
    try {
      const sql = 'DELETE FROM objetivos_marca WHERE id = ?';
      await this.execute(sql, [id]);
      return { success: true };
    } catch (error) {
      console.error('❌ Error eliminando objetivo por marca:', error.message);
      throw error;
    }
  }

  // =====================================================
  // CONDICIONES ESPECIALES
  // =====================================================

  /**
   * Obtener condiciones especiales
   */
  async getCondicionesEspeciales(filters = {}) {
    try {
      let sql = `
        SELECT ce.*,
               c.Nombre as comercial_nombre,
               a.Nombre as articulo_nombre,
               a.SKU as articulo_sku
        FROM condiciones_especiales ce
        LEFT JOIN comerciales c ON ce.comercial_id = c.id
        LEFT JOIN articulos a ON ce.articulo_id = a.id
        WHERE 1=1
      `;
      const params = [];

      if (filters.comercial_id !== undefined) {
        if (filters.comercial_id === null) {
          sql += ' AND ce.comercial_id IS NULL';
        } else {
          sql += ' AND (ce.comercial_id = ? OR ce.comercial_id IS NULL)';
          params.push(filters.comercial_id);
        }
      }
      if (filters.articulo_id !== undefined) {
        if (filters.articulo_id === null) {
          sql += ' AND ce.articulo_id IS NULL';
        } else {
          sql += ' AND (ce.articulo_id = ? OR ce.articulo_id IS NULL)';
          params.push(filters.articulo_id);
        }
      }
      if (filters.activo !== undefined) {
        sql += ' AND ce.activo = ?';
        params.push(filters.activo ? 1 : 0);
      }

      sql += ' ORDER BY ce.comercial_id DESC, ce.articulo_id DESC, ce.creado_en DESC';

      return await this.query(sql, params);
    } catch (error) {
      console.error('❌ Error obteniendo condiciones especiales:', error.message);
      throw error;
    }
  }

  /**
   * Crear condición especial
   */
  async createCondicionEspecial(condicionData) {
    try {
      const sql = `
        INSERT INTO condiciones_especiales 
        (comercial_id, articulo_id, porcentaje_comision, descripcion, activo, fecha_inicio, fecha_fin)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        condicionData.comercial_id || null,
        condicionData.articulo_id || null,
        condicionData.porcentaje_comision,
        condicionData.descripcion || null,
        condicionData.activo !== undefined ? (condicionData.activo ? 1 : 0) : 1,
        condicionData.fecha_inicio || null,
        condicionData.fecha_fin || null
      ];

      const result = await this.execute(sql, params);
      return { id: result.insertId, ...condicionData };
    } catch (error) {
      console.error('❌ Error creando condición especial:', error.message);
      throw error;
    }
  }

  /**
   * Actualizar condición especial
   */
  async updateCondicionEspecial(id, condicionData) {
    try {
      const updates = [];
      const params = [];

      if (condicionData.porcentaje_comision !== undefined) {
        updates.push('porcentaje_comision = ?');
        params.push(condicionData.porcentaje_comision);
      }
      if (condicionData.descripcion !== undefined) {
        updates.push('descripcion = ?');
        params.push(condicionData.descripcion);
      }
      if (condicionData.activo !== undefined) {
        updates.push('activo = ?');
        params.push(condicionData.activo ? 1 : 0);
      }
      if (condicionData.fecha_inicio !== undefined) {
        updates.push('fecha_inicio = ?');
        params.push(condicionData.fecha_inicio);
      }
      if (condicionData.fecha_fin !== undefined) {
        updates.push('fecha_fin = ?');
        params.push(condicionData.fecha_fin);
      }

      if (updates.length === 0) {
        throw new Error('No hay campos para actualizar');
      }

      params.push(id);
      const sql = `UPDATE condiciones_especiales SET ${updates.join(', ')} WHERE id = ?`;
      await this.query(sql, params);
      return { id, ...condicionData };
    } catch (error) {
      console.error('❌ Error actualizando condición especial:', error.message);
      throw error;
    }
  }

  /**
   * Eliminar condición especial
   */
  async deleteCondicionEspecial(id) {
    try {
      const sql = 'DELETE FROM condiciones_especiales WHERE id = ?';
      await this.execute(sql, [id]);
      return { success: true };
    } catch (error) {
      console.error('❌ Error eliminando condición especial:', error.message);
      throw error;
    }
  }

  // =====================================================
  // FIJOS MENSUALES POR MARCA
  // =====================================================

  /**
   * Obtener fijos mensuales por comercial y marca
   */
  async getFijosMensualesMarca(filters = {}) {
    try {
      // Construir SQL con Marcas (mayúscula) - si falla, se manejará en el catch
      let sql = `
        SELECT fmm.*,
               c.Nombre as comercial_nombre,
               c.Email as comercial_email,
               m.Nombre as marca_nombre
        FROM fijos_mensuales_marca fmm
        LEFT JOIN comerciales c ON (fmm.comercial_id = c.id OR fmm.comercial_id = c.Id)
        LEFT JOIN marcas m ON (fmm.marca_id = m.id OR fmm.marca_id = m.Id)
        WHERE 1=1
      `;
      
      const params = [];

      if (filters.comercial_id) {
        sql += ' AND fmm.comercial_id = ?';
        params.push(filters.comercial_id);
      }
      if (filters.marca_id) {
        sql += ' AND fmm.marca_id = ?';
        params.push(filters.marca_id);
      }
      if (filters.activo !== undefined) {
        sql += ' AND fmm.activo = ?';
        params.push(filters.activo ? 1 : 0);
      }

      sql += ' ORDER BY COALESCE(c.Nombre, \'\'), COALESCE(m.Nombre, \'\')';

      const result = await this.query(sql, params);
      return Array.isArray(result) ? result : [];
    } catch (error) {
      console.error('❌ Error obteniendo fijos mensuales por marca:', error.message);
      console.error('Stack:', error.stack);
      
      // Intentar con marcas (minúscula) como fallback
      try {
        let sqlFallback = `
          SELECT fmm.*,
                 c.Nombre as comercial_nombre,
                 c.Email as comercial_email,
                 m.Nombre as marca_nombre
          FROM fijos_mensuales_marca fmm
          LEFT JOIN comerciales c ON (fmm.comercial_id = c.id OR fmm.comercial_id = c.Id)
          LEFT JOIN marcas m ON (fmm.marca_id = m.id OR fmm.marca_id = m.Id)
          WHERE 1=1
        `;
        
        const params = [];
        if (filters.comercial_id) {
          sqlFallback += ' AND fmm.comercial_id = ?';
          params.push(filters.comercial_id);
        }
        if (filters.marca_id) {
          sqlFallback += ' AND fmm.marca_id = ?';
          params.push(filters.marca_id);
        }
        if (filters.activo !== undefined) {
          sqlFallback += ' AND fmm.activo = ?';
          params.push(filters.activo ? 1 : 0);
        }
        sqlFallback += ' ORDER BY COALESCE(c.Nombre, \'\'), COALESCE(m.Nombre, \'\')';
        
        const result = await this.query(sqlFallback, params);
        return Array.isArray(result) ? result : [];
      } catch (fallbackError) {
        console.error('❌ Error en fallback de fijos mensuales:', fallbackError.message);
        // Devolver array vacío en lugar de lanzar error para evitar 500
        return [];
      }
    }
  }

  /**
   * Obtener fijos mensuales por marca para un periodo (año/mes) y/o comercial.
   * Se apoya en la tabla EXISTENTE `fijos_mensuales_marca`.
   * - Si existen columnas `año/mes`, usa el periodo y hace fallback al registro global (año=0, mes=0).
   * - Si NO existen columnas `año/mes`, hace fallback al comportamiento antiguo (sin periodo).
   */
  async getFijosMensualesMarcaPeriodo(filters = {}) {
    try {
      const hasPeriodoCols = await this.hasFijosMensualesMarcaPeriodoColumns();
      if (!hasPeriodoCols) {
        return await this.getFijosMensualesMarca({
          comercial_id: filters.comercial_id,
          marca_id: filters.marca_id,
          activo: filters.activo
        });
      }

      const año = filters.año !== undefined && filters.año !== null && filters.año !== '' ? Number(filters.año) : null;
      const mes = filters.mes !== undefined && filters.mes !== null && filters.mes !== '' ? Number(filters.mes) : null;

      // Traer registros del periodo y los globales (año=0, mes=0) para poder hacer fallback.
      // Luego mergeamos en JS priorizando el específico sobre el global.
      let sql = `
        SELECT fmm.*,
               c.Nombre as comercial_nombre,
               c.Email as comercial_email,
               m.Nombre as marca_nombre
        FROM fijos_mensuales_marca fmm
        LEFT JOIN comerciales c ON (fmm.comercial_id = c.id OR fmm.comercial_id = c.Id)
        LEFT JOIN marcas m ON (fmm.marca_id = m.id OR fmm.marca_id = m.Id)
        WHERE 1=1
      `;
      const params = [];

      if (filters.comercial_id !== undefined && filters.comercial_id !== null && filters.comercial_id !== '') {
        sql += ' AND fmm.comercial_id = ?';
        params.push(Number(filters.comercial_id));
      }
      if (filters.marca_id !== undefined && filters.marca_id !== null && filters.marca_id !== '') {
        sql += ' AND fmm.marca_id = ?';
        params.push(Number(filters.marca_id));
      }

      if (año !== null && mes !== null) {
        // Periodo o global
        sql += ' AND ((fmm.año = ? AND fmm.mes = ?) OR (fmm.año = 0 AND fmm.mes = 0))';
        params.push(año, mes);
      } else if (año !== null && mes === null) {
        // Si solo hay año, devolver ese año (todos los meses) + global
        sql += ' AND (fmm.año = ? OR (fmm.año = 0 AND fmm.mes = 0))';
        params.push(año);
      } else {
        // Sin filtro de periodo: devolver todo (incluye globales)
      }

      if (filters.activo !== undefined) {
        sql += ' AND fmm.activo = ?';
        params.push(filters.activo ? 1 : 0);
      }

      sql += ' ORDER BY COALESCE(c.Nombre, \'\'), fmm.año DESC, fmm.mes ASC, COALESCE(m.Nombre, \'\')';

      const rows = await this.query(sql, params);

      // Merge: clave comercial+marca. Si existe específico (año/mes), gana; si no, usar global (0/0).
      if (año !== null && mes !== null) {
        const byKey = new Map();
        for (const r of rows || []) {
          const key = `${r.comercial_id}:${r.marca_id}`;
          const isSpecific = Number(r.año) === año && Number(r.mes) === mes;
          const isGlobal = Number(r.año) === 0 && Number(r.mes) === 0;
          if (!byKey.has(key)) {
            byKey.set(key, r);
          } else {
            const cur = byKey.get(key);
            const curSpecific = Number(cur.año) === año && Number(cur.mes) === mes;
            if (!curSpecific && isSpecific) {
              byKey.set(key, r);
            } else if (!curSpecific && !isSpecific) {
              // Ambos no específicos: preferir global frente a otro residual
              const curGlobal = Number(cur.año) === 0 && Number(cur.mes) === 0;
              if (!curGlobal && isGlobal) byKey.set(key, r);
            }
          }
        }
        // Normalizar filas devueltas para que parezcan del periodo solicitado (en UI)
        return [...byKey.values()].map(r => ({
          ...r,
          año,
          mes
        }));
      }

      return rows;
    } catch (error) {
      // Si por cualquier razón la query con año/mes falla (p.ej. columnas aún no creadas),
      // caer al modo antiguo para no romper la pantalla.
      if (String(error?.message || '').toLowerCase().includes('unknown column')) {
        this._cache.fijosMensualesMarcaHasPeriodoColumns = false;
        return await this.getFijosMensualesMarca({
          comercial_id: filters.comercial_id,
          marca_id: filters.marca_id,
          activo: filters.activo
        });
      }
      console.error('❌ Error obteniendo fijos mensuales por periodo:', error.message);
      throw error;
    }
  }

  /**
   * Guardar/actualizar fijo mensual por marca + periodo (año/mes).
   * Se guarda en `fijos_mensuales_marca`:
   * - Si existen columnas `año/mes`, inserta (comercial_id, marca_id, año, mes)
   * - Si no, hace fallback al método antiguo (sin periodo).
   */
  async saveFijoMensualMarcaPeriodo(data) {
    const comercialId = data.comercial_id || data.comercialId;
    const marcaId = data.marca_id || data.marcaId;
    const año = data.año ?? data.ano ?? data.anio;
    const mes = data.mes;
    const importe = parseFloat(data.importe || 0);
    const activo = data.activo !== undefined ? (data.activo === true || data.activo === 1 || data.activo === 'true') : true;

    if (!comercialId || !marcaId || año === undefined || año === null || mes === undefined || mes === null) {
      throw new Error('comercial_id, marca_id, año y mes son requeridos');
    }
    if (!Number.isFinite(Number(mes)) || Number(mes) < 1 || Number(mes) > 12) {
      throw new Error('mes inválido (1-12)');
    }

    // Intentar guardar por periodo. Si aún no existen columnas, caer al método antiguo.
    try {
      const hasPeriodoCols = await this.hasFijosMensualesMarcaPeriodoColumns();
      if (!hasPeriodoCols) {
        return await this.saveFijoMensualMarca(data);
      }

      const sql = `
        INSERT INTO fijos_mensuales_marca
          (comercial_id, marca_id, año, mes, importe, activo)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          importe = VALUES(importe),
          activo = VALUES(activo),
          fecha_actualizacion = CURRENT_TIMESTAMP
      `;
      await this.execute(sql, [
        Number(comercialId),
        Number(marcaId),
        Number(año),
        Number(mes),
        Number.isFinite(importe) ? importe : 0,
        activo ? 1 : 0
      ]);
      return true;
    } catch (error) {
      if (String(error?.message || '').toLowerCase().includes('unknown column')) {
        this._cache.fijosMensualesMarcaHasPeriodoColumns = false;
        return await this.saveFijoMensualMarca(data);
      }
      throw error;
    }
  }

  /**
   * Desactivar (soft delete) un fijo mensual por marca + periodo.
   */
  async disableFijoMensualMarcaPeriodo({ comercial_id, marca_id, año, mes }) {
    const hasPeriodoCols = await this.hasFijosMensualesMarcaPeriodoColumns();
    if (!hasPeriodoCols) {
      // En tabla antigua no hay periodo: desactivar el registro por comercial+marca.
      const existente = await this.getFijoMensualMarca(comercial_id, marca_id);
      if (!existente || !existente.id) return { success: true };
      await this.execute('UPDATE fijos_mensuales_marca SET activo = 0, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = ?', [existente.id]);
      return { success: true };
    }

    await this.execute(
      `UPDATE fijos_mensuales_marca
       SET activo = 0, fecha_actualizacion = CURRENT_TIMESTAMP
       WHERE comercial_id = ? AND marca_id = ? AND año = ? AND mes = ?`,
      [Number(comercial_id), Number(marca_id), Number(año), Number(mes)]
    );
    return { success: true };
  }

  /**
   * Obtener fijo mensual por comercial y marca específicos
   */
  async getFijoMensualMarca(comercialId, marcaId) {
    try {
      const sql = `
        SELECT fmm.*,
               c.Nombre as comercial_nombre,
               m.Nombre as marca_nombre
        FROM fijos_mensuales_marca fmm
        LEFT JOIN comerciales c ON (fmm.comercial_id = c.id OR fmm.comercial_id = c.Id)
        LEFT JOIN marcas m ON (fmm.marca_id = m.id OR fmm.marca_id = m.Id)
        WHERE fmm.comercial_id = ? AND fmm.marca_id = ?
        LIMIT 1
      `;
      const rows = await this.query(sql, [comercialId, marcaId]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo fijo mensual por marca:', error.message);
      throw error;
    }
  }

  /**
   * Guardar o actualizar fijo mensual por marca
   */
  async saveFijoMensualMarca(data) {
    try {
      const comercialId = data.comercial_id || data.comercialId;
      const marcaId = data.marca_id || data.marcaId;
      const importe = parseFloat(data.importe || 0);
      const activo = data.activo !== undefined ? (data.activo === true || data.activo === 1 || data.activo === 'true') : true;

      if (!comercialId || !marcaId) {
        throw new Error('comercial_id y marca_id son requeridos');
      }

      // Verificar si ya existe
      const existente = await this.getFijoMensualMarca(comercialId, marcaId);

      if (existente && existente.id) {
        // Actualizar
        const sql = `
          UPDATE fijos_mensuales_marca
          SET importe = ?,
              activo = ?,
              fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        await this.execute(sql, [importe, activo ? 1 : 0, existente.id]);
        return await this.getFijoMensualMarca(comercialId, marcaId);
      } else {
        // Crear nuevo
        const sql = `
          INSERT INTO fijos_mensuales_marca (comercial_id, marca_id, importe, activo)
          VALUES (?, ?, ?, ?)
        `;
        const result = await this.execute(sql, [comercialId, marcaId, importe, activo ? 1 : 0]);
        return await this.getFijoMensualMarca(comercialId, marcaId);
      }
    } catch (error) {
      console.error('❌ Error guardando fijo mensual por marca:', error.message);
      throw error;
    }
  }

  /**
   * Eliminar fijo mensual por marca
   */
  async deleteFijoMensualMarca(id) {
    try {
      const sql = 'DELETE FROM fijos_mensuales_marca WHERE id = ?';
      await this.execute(sql, [id]);
      return { success: true };
    } catch (error) {
      console.error('❌ Error eliminando fijo mensual por marca:', error.message);
      throw error;
    }
  }

  // =====================================================
  // MÉTODOS PARA LEER CONFIGURACIONES DE COMISIONES
  // =====================================================

  /**
   * Obtener porcentaje de comisión por tipo de pedido desde configuración
   * @param {string} marca - Nombre de la marca (null para general)
   * @param {string} tipoPedido - Nombre del tipo de pedido (Transfer, Directo, Normal)
   * @param {number} año - Año para el que se aplica
   * @param {number|null} tipoPedidoId - ID real de tipos_pedidos (opcional, recomendado)
   * @returns {Promise<number>} Porcentaje de comisión
   */
  async getPorcentajeComision(marca, tipoPedido, año, tipoPedidoId = null) {
    try {
      // Normalizar tipo de pedido
      let nombreTipoBuscar = tipoPedido || 'Directo';
      if (typeof nombreTipoBuscar === 'string') {
        const tipoNormalizado = nombreTipoBuscar.toLowerCase().trim();
        if (tipoNormalizado.includes('transfer')) {
          nombreTipoBuscar = 'Transfer';
        } else if (tipoNormalizado.includes('directo') || tipoNormalizado === 'normal' || tipoNormalizado === '') {
          nombreTipoBuscar = 'Directo';
        }
      }

      // SIEMPRE buscar configuración específica de marca (OBLIGATORIO)
      if (!marca) {
        console.warn(`⚠️ [CONFIG] No se proporcionó marca para obtener porcentaje comisión (${nombreTipoBuscar}) en ${año}. No se aplicará comisión (0%) hasta configurar la marca.`);
        return null;
      }

      // Prioridad de búsqueda:
      // 1) marca + tipo_pedido_id + año exacto
      // 2) marca + nombre_tipo_pedido normalizado + año exacto
      // 3) marca + tipo_pedido_id + año_aplicable IS NULL
      // 4) marca + nombre_tipo_pedido + año_aplicable IS NULL
      // Nota: mantenemos nombre_tipo_pedido por compatibilidad, aunque ahora guardemos tipo_pedido_id.
      const marcaNorm = String(marca).toUpperCase();
      const tipoId = tipoPedidoId != null ? Number(tipoPedidoId) : null;

      const tryQueries = [];
      if (Number.isFinite(tipoId) && tipoId > 0) {
        tryQueries.push({
          sql: `
            SELECT porcentaje_comision
            FROM config_comisiones_tipo_pedido
            WHERE marca = ?
              AND tipo_pedido_id = ?
              AND año_aplicable = ?
              AND activo = 1
            LIMIT 1
          `,
          params: [marcaNorm, tipoId, Number(año)]
        });
      }
      tryQueries.push({
        sql: `
          SELECT porcentaje_comision
          FROM config_comisiones_tipo_pedido
          WHERE marca = ?
            AND nombre_tipo_pedido = ?
            AND año_aplicable = ?
            AND activo = 1
          LIMIT 1
        `,
        params: [marcaNorm, nombreTipoBuscar, Number(año)]
      });
      if (Number.isFinite(tipoId) && tipoId > 0) {
        tryQueries.push({
          sql: `
            SELECT porcentaje_comision
            FROM config_comisiones_tipo_pedido
            WHERE marca = ?
              AND tipo_pedido_id = ?
              AND año_aplicable IS NULL
              AND activo = 1
            LIMIT 1
          `,
          params: [marcaNorm, tipoId]
        });
      }
      tryQueries.push({
        sql: `
          SELECT porcentaje_comision
          FROM config_comisiones_tipo_pedido
          WHERE marca = ?
            AND nombre_tipo_pedido = ?
            AND año_aplicable IS NULL
            AND activo = 1
          LIMIT 1
        `,
        params: [marcaNorm, nombreTipoBuscar]
      });

      let rows = [];
      for (const q of tryQueries) {
        rows = await this.query(q.sql, q.params);
        if (rows && rows.length > 0) break;
      }
      
      if (rows && rows.length > 0) {
        return parseFloat(rows[0].porcentaje_comision);
      }

      // NO buscar configuración general - requerir marca específica
      console.warn(`⚠️ [CONFIG] No se encontró configuración para marca ${marca}, tipo ${nombreTipoBuscar} (ID: ${tipoPedidoId}) en ${año}. No se aplicará comisión (0%) hasta configurar.`);
      return null;
    } catch (error) {
      console.error(`❌ Error obteniendo porcentaje comisión: ${error.message}`);
      return null;
    }
  }

  /**
   * Obtener porcentaje de descuento de transporte desde configuración
   * @param {string} marca - Nombre de la marca (null para general)
   * @param {number} año - Año para el que se aplica
   * @returns {Promise<number>} Porcentaje de descuento (0 si está inactivo o no existe)
   */
  async getDescuentoTransporte(marca, año) {
    try {
      // SIEMPRE buscar configuración específica de marca (OBLIGATORIO)
      if (!marca) {
        console.warn(`⚠️ [CONFIG] No se proporcionó marca para obtener descuento transporte en ${año}, usando 0% por defecto`);
        return 0;
      }

      const sql = `
        SELECT porcentaje_descuento, activo
        FROM config_descuento_transporte
        WHERE marca = ?
        AND año_aplicable = ?
        LIMIT 1
      `;
      const rows = await this.query(sql, [marca.toUpperCase(), año]);

      if (rows && rows.length > 0) {
        // Si está inactivo, devolver 0
        if (rows[0].activo === 0 || rows[0].activo === false) {
          return 0;
        }
        return parseFloat(rows[0].porcentaje_descuento);
      }

      // NO buscar configuración general - requerir marca específica
      console.warn(`⚠️ [CONFIG] No se encontró configuración de descuento transporte para marca ${marca} en ${año}, usando 0% por defecto`);
      return 0;
    } catch (error) {
      console.error(`❌ Error obteniendo descuento transporte: ${error.message}`);
      return 0;
    }
  }

  /**
   * Obtener porcentaje de rappel por presupuesto desde configuración
   * @param {string} marca - Nombre de la marca (null para general)
   * @param {number} año - Año para el que se aplica
   * @returns {Promise<number>} Porcentaje de rappel
   */
  async getRappelPresupuesto(marca, año) {
    try {
      // Rappel presupuesto NO depende de marca, pero mantenemos consistencia
      // Buscar configuración (puede ser general o por marca)
      const sql = `
        SELECT porcentaje_rappel, activo
        FROM config_rappel_presupuesto
        WHERE (marca = ? OR marca IS NULL)
        AND año_aplicable = ?
        AND activo = 1
        ORDER BY marca IS NULL ASC
        LIMIT 1
      `;
      const rows = await this.query(sql, [marca ? marca.toUpperCase() : null, año]);

      if (rows && rows.length > 0) {
        return parseFloat(rows[0].porcentaje_rappel);
      }

      // Por defecto 1% (valor antiguo) si no hay configuración
      console.warn(`⚠️ [CONFIG] No se encontró configuración de rappel presupuesto para ${año}, usando 1% por defecto`);
      return 1;
    } catch (error) {
      console.error(`❌ Error obteniendo rappel presupuesto: ${error.message}`);
      return 1;
    }
  }

  /**
   * Obtener configuración de fijo mensual
   * @returns {Promise<Object>} Objeto con año_limite y porcentaje_minimo_ventas
   */
  async getConfigFijoMensual() {
    try {
      const sql = `
        SELECT año_limite, porcentaje_minimo_ventas, activo
        FROM config_fijo_mensual
        WHERE activo = 1
        ORDER BY año_limite DESC
        LIMIT 1
      `;
      const rows = await this.query(sql);

      if (rows && rows.length > 0) {
        return {
          año_limite: parseInt(rows[0].año_limite) || 2026,
          porcentaje_minimo_ventas: parseFloat(rows[0].porcentaje_minimo_ventas) || 25,
          activo: rows[0].activo === 1
        };
      }

      // Valores por defecto
      console.warn(`⚠️ [CONFIG] No se encontró configuración de fijo mensual, usando valores por defecto`);
      return {
        año_limite: 2026,
        porcentaje_minimo_ventas: 25,
        activo: true
      };
    } catch (error) {
      console.error(`❌ Error obteniendo config fijo mensual: ${error.message}`);
      return {
        año_limite: 2026,
        porcentaje_minimo_ventas: 25,
        activo: true
      };
    }
  }

  // =====================================================
  // MÉTODOS CRUD PARA CONFIG_COMISIONES_TIPO_PEDIDO
  // =====================================================

  async getConfigComisionesTipoPedido(filters = {}) {
    try {
      // Incluir nombre del tipo desde tipos_pedidos si existe
      let sql = `
        SELECT
          cctp.*,
          COALESCE(tp.Tipo, cctp.nombre_tipo_pedido) AS nombre_tipo_pedido
        FROM config_comisiones_tipo_pedido cctp
        LEFT JOIN tipos_pedidos tp ON tp.id = cctp.tipo_pedido_id
        WHERE 1=1
      `;
      const params = [];

      if (filters.marca !== undefined) {
        if (filters.marca === null) {
          sql += ' AND cctp.marca IS NULL';
        } else {
          sql += ' AND cctp.marca = ?';
          params.push(filters.marca);
        }
      }
      if (filters.tipo_pedido_id) {
        sql += ' AND cctp.tipo_pedido_id = ?';
        params.push(Number(filters.tipo_pedido_id));
      }
      if (filters.nombre_tipo_pedido) {
        sql += ' AND (cctp.nombre_tipo_pedido = ? OR tp.Tipo = ?)';
        params.push(filters.nombre_tipo_pedido);
        params.push(filters.nombre_tipo_pedido);
      }
      if (filters.año_aplicable) {
        sql += ' AND cctp.año_aplicable = ?';
        params.push(filters.año_aplicable);
      }
      if (filters.activo !== undefined) {
        sql += ' AND cctp.activo = ?';
        params.push(filters.activo ? 1 : 0);
      }

      sql += ' ORDER BY cctp.año_aplicable DESC, cctp.marca, nombre_tipo_pedido';
      return await this.query(sql, params);
    } catch (error) {
      console.error('❌ Error obteniendo config comisiones tipo pedido:', error.message);
      throw error;
    }
  }

  async getConfigComisionTipoPedidoById(id) {
    try {
      const sql = 'SELECT * FROM config_comisiones_tipo_pedido WHERE id = ?';
      const rows = await this.query(sql, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo config comisión tipo pedido:', error.message);
      throw error;
    }
  }

  async saveConfigComisionTipoPedido(data) {
    try {
      // Validar que marca no sea NULL (obligatorio)
      if (!data.marca || data.marca === null || data.marca === '') {
        throw new Error('La marca es obligatoria. Debe seleccionar una marca específica (GEMAVIP, YOUBELLE, etc.)');
      }

      // Resolver tipo_pedido_id (algunas BDs lo tienen NOT NULL)
      const ensureTipoPedidoId = async (nombre) => {
        const n = String(nombre || '').trim();
        if (!n) return null;
        // Exact match (case-insensitive)
        const rows = await this.query(
          'SELECT id, Tipo FROM tipos_pedidos WHERE UPPER(Tipo) = UPPER(?) LIMIT 1',
          [n]
        ).catch(() => []);
        if (rows && rows.length > 0) return Number(rows[0].id);
        // Fallback: LIKE (por si vienen nombres tipo "Transfer")
        const rowsLike = await this.query(
          'SELECT id, Tipo FROM tipos_pedidos WHERE Tipo LIKE ? ORDER BY id ASC LIMIT 1',
          [`%${n}%`]
        ).catch(() => []);
        if (rowsLike && rowsLike.length > 0) return Number(rowsLike[0].id);
        // Crear tipo si no existe (para evitar bloquear el CRUD)
        const result = await this.execute('INSERT INTO tipos_pedidos (Tipo) VALUES (?)', [n]);
        return Number(result.insertId);
      };

      let tipoPedidoId = null;
      if (data.tipo_pedido_id !== undefined && data.tipo_pedido_id !== null && data.tipo_pedido_id !== '') {
        tipoPedidoId = Number(data.tipo_pedido_id);
      }
      if (!tipoPedidoId || !Number.isFinite(tipoPedidoId) || tipoPedidoId <= 0) {
        tipoPedidoId = await ensureTipoPedidoId(data.nombre_tipo_pedido);
      }
      if (!tipoPedidoId || !Number.isFinite(tipoPedidoId) || tipoPedidoId <= 0) {
        throw new Error('No se pudo resolver tipo_pedido_id. Revisa la tabla tipos_pedidos.');
      }

      // Asegurar nombre_tipo_pedido (si no viene, resolver desde tipos_pedidos)
      if (!data.nombre_tipo_pedido || String(data.nombre_tipo_pedido).trim() === '') {
        try {
          const rows = await this.query('SELECT Tipo FROM tipos_pedidos WHERE id = ? LIMIT 1', [tipoPedidoId]);
          if (rows && rows.length > 0) {
            data.nombre_tipo_pedido = rows[0].Tipo;
          }
        } catch (_) { /* noop */ }
      }
      if (!data.nombre_tipo_pedido || String(data.nombre_tipo_pedido).trim() === '') {
        throw new Error('nombre_tipo_pedido es requerido');
      }

      if (data.id) {
        // UPDATE
        const updateFields = [];
        const params = [];
        
        if (data.marca !== undefined) {
          updateFields.push('marca = ?');
          params.push(data.marca.toUpperCase()); // Normalizar a mayúsculas
        }
        
        // Guardar siempre el tipo_pedido_id y el nombre (por compatibilidad con lógica existente)
        updateFields.push('tipo_pedido_id = ?');
        params.push(tipoPedidoId);

        if (data.nombre_tipo_pedido !== undefined) {
          updateFields.push('nombre_tipo_pedido = ?');
          params.push(data.nombre_tipo_pedido);
        }
        if (data.año_aplicable !== undefined) {
          updateFields.push('año_aplicable = ?');
          params.push(data.año_aplicable);
        }
        if (data.porcentaje_comision !== undefined) {
          updateFields.push('porcentaje_comision = ?');
          params.push(data.porcentaje_comision);
        }
        if (data.activo !== undefined) {
          updateFields.push('activo = ?');
          params.push(data.activo ? 1 : 0);
        }
        if (data.descripcion !== undefined) {
          updateFields.push('descripcion = ?');
          params.push(data.descripcion);
        }
        
        updateFields.push('actualizado_en = CURRENT_TIMESTAMP');
        params.push(data.id);
        
        const sql = `UPDATE config_comisiones_tipo_pedido SET ${updateFields.join(', ')} WHERE id = ?`;
        await this.execute(sql, params);
        return await this.getConfigComisionTipoPedidoById(data.id);
      } else {
        // INSERT
        const sql = `
          INSERT INTO config_comisiones_tipo_pedido 
          (marca, tipo_pedido_id, nombre_tipo_pedido, año_aplicable, porcentaje_comision, activo, descripcion, creado_en)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        const result = await this.execute(sql, [
          data.marca.toUpperCase(), // Normalizar a mayúsculas - OBLIGATORIO
          tipoPedidoId,
          data.nombre_tipo_pedido,
          data.año_aplicable,
          data.porcentaje_comision,
          data.activo !== undefined ? (data.activo ? 1 : 0) : 1,
          data.descripcion || null
        ]);
        return await this.getConfigComisionTipoPedidoById(result.insertId);
      }
    } catch (error) {
      console.error('❌ Error guardando config comisión tipo pedido:', error.message);
      throw error;
    }
  }

  async deleteConfigComisionTipoPedido(id) {
    try {
      const sql = 'DELETE FROM config_comisiones_tipo_pedido WHERE id = ?';
      await this.execute(sql, [id]);
      return { success: true };
    } catch (error) {
      console.error('❌ Error eliminando config comisión tipo pedido:', error.message);
      throw error;
    }
  }

  // =====================================================
  // MÉTODOS CRUD PARA CONFIG_RAPPEL_PRESUPUESTO
  // =====================================================

  async getConfigRappelPresupuesto(filters = {}) {
    try {
      let sql = 'SELECT * FROM config_rappel_presupuesto WHERE 1=1';
      const params = [];

      if (filters.marca !== undefined) {
        if (filters.marca === null) {
          sql += ' AND marca IS NULL';
        } else {
          sql += ' AND marca = ?';
          params.push(filters.marca);
        }
      }
      if (filters.año_aplicable) {
        sql += ' AND año_aplicable = ?';
        params.push(filters.año_aplicable);
      }
      if (filters.activo !== undefined) {
        sql += ' AND activo = ?';
        params.push(filters.activo ? 1 : 0);
      }

      sql += ' ORDER BY año_aplicable DESC, marca';
      return await this.query(sql, params);
    } catch (error) {
      console.error('❌ Error obteniendo config rappel presupuesto:', error.message);
      throw error;
    }
  }

  async getConfigRappelPresupuestoById(id) {
    try {
      const sql = 'SELECT * FROM config_rappel_presupuesto WHERE id = ?';
      const rows = await this.query(sql, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo config rappel presupuesto:', error.message);
      throw error;
    }
  }

  async saveConfigRappelPresupuesto(data) {
    try {
      if (data.id) {
        // UPDATE
        const updateFields = [];
        const params = [];
        
        if (data.marca !== undefined) {
          if (data.marca === null) {
            updateFields.push('marca = NULL');
          } else {
            updateFields.push('marca = ?');
            params.push(data.marca);
          }
        }
        if (data.año_aplicable !== undefined) {
          updateFields.push('año_aplicable = ?');
          params.push(data.año_aplicable);
        }
        if (data.porcentaje_rappel !== undefined) {
          updateFields.push('porcentaje_rappel = ?');
          params.push(data.porcentaje_rappel);
        }
        if (data.activo !== undefined) {
          updateFields.push('activo = ?');
          params.push(data.activo ? 1 : 0);
        }
        if (data.descripcion !== undefined) {
          updateFields.push('descripcion = ?');
          params.push(data.descripcion);
        }
        
        updateFields.push('actualizado_en = CURRENT_TIMESTAMP');
        params.push(data.id);
        
        const sql = `UPDATE config_rappel_presupuesto SET ${updateFields.join(', ')} WHERE id = ?`;
        await this.execute(sql, params);
        return await this.getConfigRappelPresupuestoById(data.id);
      } else {
        // INSERT
        const sql = `
          INSERT INTO config_rappel_presupuesto 
          (marca, año_aplicable, porcentaje_rappel, activo, descripcion, creado_en)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        const result = await this.execute(sql, [
          data.marca || null,
          data.año_aplicable,
          data.porcentaje_rappel,
          data.activo !== undefined ? (data.activo ? 1 : 0) : 1,
          data.descripcion || null
        ]);
        return await this.getConfigRappelPresupuestoById(result.insertId);
      }
    } catch (error) {
      console.error('❌ Error guardando config rappel presupuesto:', error.message);
      throw error;
    }
  }

  async deleteConfigRappelPresupuesto(id) {
    try {
      const sql = 'DELETE FROM config_rappel_presupuesto WHERE id = ?';
      await this.execute(sql, [id]);
      return { success: true };
    } catch (error) {
      console.error('❌ Error eliminando config rappel presupuesto:', error.message);
      throw error;
    }
  }

  // =====================================================
  // MÉTODOS CRUD PARA CONFIG_FIJO_MENSUAL
  // =====================================================

  async getConfigFijoMensualList(filters = {}) {
    try {
      let sql = 'SELECT * FROM config_fijo_mensual WHERE 1=1';
      const params = [];

      if (filters.activo !== undefined) {
        sql += ' AND activo = ?';
        params.push(filters.activo ? 1 : 0);
      }

      sql += ' ORDER BY año_limite DESC';
      return await this.query(sql, params);
    } catch (error) {
      console.error('❌ Error obteniendo config fijo mensual:', error.message);
      throw error;
    }
  }

  async getConfigFijoMensualById(id) {
    try {
      const sql = 'SELECT * FROM config_fijo_mensual WHERE id = ?';
      const rows = await this.query(sql, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo config fijo mensual:', error.message);
      throw error;
    }
  }

  async saveConfigFijoMensual(data) {
    try {
      if (data.id) {
        // UPDATE
        const updateFields = [];
        const params = [];
        
        if (data.año_limite !== undefined) {
          updateFields.push('año_limite = ?');
          params.push(data.año_limite);
        }
        if (data.porcentaje_minimo_ventas !== undefined) {
          updateFields.push('porcentaje_minimo_ventas = ?');
          params.push(data.porcentaje_minimo_ventas);
        }
        if (data.activo !== undefined) {
          updateFields.push('activo = ?');
          params.push(data.activo ? 1 : 0);
        }
        if (data.descripcion !== undefined) {
          updateFields.push('descripcion = ?');
          params.push(data.descripcion);
        }
        
        updateFields.push('actualizado_en = CURRENT_TIMESTAMP');
        params.push(data.id);
        
        const sql = `UPDATE config_fijo_mensual SET ${updateFields.join(', ')} WHERE id = ?`;
        await this.execute(sql, params);
        return await this.getConfigFijoMensualById(data.id);
      } else {
        // INSERT
        const sql = `
          INSERT INTO config_fijo_mensual 
          (año_limite, porcentaje_minimo_ventas, activo, descripcion, creado_en)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        const result = await this.execute(sql, [
          data.año_limite,
          data.porcentaje_minimo_ventas,
          data.activo !== undefined ? (data.activo ? 1 : 0) : 1,
          data.descripcion || null
        ]);
        return await this.getConfigFijoMensualById(result.insertId);
      }
    } catch (error) {
      console.error('❌ Error guardando config fijo mensual:', error.message);
      throw error;
    }
  }

  async deleteConfigFijoMensual(id) {
    try {
      const sql = 'DELETE FROM config_fijo_mensual WHERE id = ?';
      await this.execute(sql, [id]);
      return { success: true };
    } catch (error) {
      console.error('❌ Error eliminando config fijo mensual:', error.message);
      throw error;
    }
  }

  // =====================================================
  // MÉTODOS CRUD PARA CONFIG_DESCUENTO_TRANSPORTE
  // =====================================================

  async getConfigDescuentoTransporte(filters = {}) {
    try {
      let sql = 'SELECT * FROM config_descuento_transporte WHERE 1=1';
      const params = [];

      if (filters.marca !== undefined) {
        if (filters.marca === null) {
          sql += ' AND marca IS NULL';
        } else {
          sql += ' AND marca = ?';
          params.push(filters.marca);
        }
      }
      if (filters.año_aplicable) {
        sql += ' AND año_aplicable = ?';
        params.push(filters.año_aplicable);
      }
      if (filters.activo !== undefined) {
        sql += ' AND activo = ?';
        params.push(filters.activo ? 1 : 0);
      }

      sql += ' ORDER BY año_aplicable DESC, marca';
      return await this.query(sql, params);
    } catch (error) {
      console.error('❌ Error obteniendo config descuento transporte:', error.message);
      throw error;
    }
  }

  async getConfigDescuentoTransporteById(id) {
    try {
      const sql = 'SELECT * FROM config_descuento_transporte WHERE id = ?';
      const rows = await this.query(sql, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo config descuento transporte:', error.message);
      throw error;
    }
  }

  async saveConfigDescuentoTransporte(data) {
    try {
      // Validar que marca no sea NULL (obligatorio)
      if (!data.id && (!data.marca || data.marca === null || data.marca === '')) {
        throw new Error('La marca es obligatoria. Debe seleccionar una marca específica (GEMAVIP, YOUBELLE, etc.)');
      }

      if (data.id) {
        // UPDATE
        const updateFields = [];
        const params = [];
        
        if (data.marca !== undefined) {
          if (data.marca === null || data.marca === '') {
            throw new Error('La marca es obligatoria y no puede ser NULL');
          } else {
            updateFields.push('marca = ?');
            params.push(data.marca.toUpperCase()); // Normalizar a mayúsculas
          }
        }
        if (data.año_aplicable !== undefined) {
          updateFields.push('año_aplicable = ?');
          params.push(data.año_aplicable);
        }
        if (data.porcentaje_descuento !== undefined) {
          updateFields.push('porcentaje_descuento = ?');
          params.push(data.porcentaje_descuento);
        }
        if (data.activo !== undefined) {
          updateFields.push('activo = ?');
          params.push(data.activo ? 1 : 0);
        }
        if (data.descripcion !== undefined) {
          updateFields.push('descripcion = ?');
          params.push(data.descripcion);
        }
        
        updateFields.push('actualizado_en = CURRENT_TIMESTAMP');
        params.push(data.id);
        
        const sql = `UPDATE config_descuento_transporte SET ${updateFields.join(', ')} WHERE id = ?`;
        await this.execute(sql, params);
        return await this.getConfigDescuentoTransporteById(data.id);
      } else {
        // INSERT
        const sql = `
          INSERT INTO config_descuento_transporte 
          (marca, año_aplicable, porcentaje_descuento, activo, descripcion, creado_en)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        const result = await this.execute(sql, [
          data.marca.toUpperCase(), // Normalizar a mayúsculas - OBLIGATORIO
          data.año_aplicable,
          data.porcentaje_descuento,
          data.activo !== undefined ? (data.activo ? 1 : 0) : 1,
          data.descripcion || null
        ]);
        return await this.getConfigDescuentoTransporteById(result.insertId);
      }
    } catch (error) {
      console.error('❌ Error guardando config descuento transporte:', error.message);
      throw error;
    }
  }

  async deleteConfigDescuentoTransporte(id) {
    try {
      const sql = 'DELETE FROM config_descuento_transporte WHERE id = ?';
      await this.execute(sql, [id]);
      return { success: true };
    } catch (error) {
      console.error('❌ Error eliminando config descuento transporte:', error.message);
      throw error;
    }
  }
}

module.exports = new ComisionesCRM();

