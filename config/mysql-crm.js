const mysql = require('mysql2/promise');
const tiposVisitaFallback = require('./tipos-visita.json');
const estadosVisitaFallback = require('./estados-visita.json');
const domains = require('./domains');
const clientesModule = require('./mysql-crm-clientes');

class MySQLCRM {
  constructor() {
    // Configuración de conexión MySQL directa
    // Base de datos remota: crm_gemavip (Easypanel)
    // phpMyAdmin: https://farmadescanso-sql-crm-farmadescanso-phpmyadmin.6f4r35.easypanel.host/
    
    this.config = {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      // En Vercel, si DB_NAME no está configurada, por defecto usamos la BD del CRM
      // (evita que apunte a otra BD por error y no veas cambios en phpMyAdmin).
      database: process.env.DB_NAME || (process.env.VERCEL ? 'crm_gemavip' : 'crm_gemavip'),
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: 10000 // 10 segundos para conectar
    };

    // Debug: Log de configuración (solo en producción para diagnosticar)
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      console.log('🔍 [DB CONFIG] DB_HOST:', this.config.host);
      console.log('🔍 [DB CONFIG] DB_PORT:', this.config.port);
      console.log('🔍 [DB CONFIG] DB_NAME:', this.config.database);
      console.log('🔍 [DB CONFIG] DB_USER:', this.config.user);
    }

    this.pool = null;
    this.connected = false;
    this._schemaEnsured = false;
    this._visitasIndexesEnsured = false;
    this._visitasSchemaEnsured = false;
    this._clientesIndexesEnsured = false;
    this._pedidosIndexesEnsured = false;
    this._pedidosArticulosIndexesEnsured = false;
    this._pedidosSchemaEnsured = false;
    this._contactosIndexesEnsured = false;
    this._direccionesEnvioIndexesEnsured = false;
    this._estadosVisitaEnsured = false;
    // Cache interno para metadatos de tablas/columnas (útil en serverless)
    this._metaCache = {};
  }

  _pickCIFromColumns(cols, cands) {
    const colsArr = (cols || []).map(c => String(c || '').trim()).filter(Boolean);
    const colsLower = new Set(colsArr.map(c => c.toLowerCase()));
    for (const cand of (cands || [])) {
      const cl = String(cand).toLowerCase();
      if (colsLower.has(cl)) {
        const idx = colsArr.findIndex(c => c.toLowerCase() === cl);
        return idx >= 0 ? colsArr[idx] : cand;
      }
    }
    return null;
  }

  async _getColumns(tableName) {
    const key = String(tableName || '').trim();
    if (!key) return [];

    if (!this._metaCache.columns) this._metaCache.columns = {};
    if (this._metaCache.columns[key]) return this._metaCache.columns[key];

    try {
      const rows = await this.query(`SHOW COLUMNS FROM \`${key}\``);
      const cols = (Array.isArray(rows) ? rows : [])
        .map(r => String(r.Field || r.field || '').trim())
        .filter(Boolean);
      this._metaCache.columns[key] = cols;
      return cols;
    } catch (_) {
      // Fallback cuando SHOW COLUMNS no está permitido
      try {
        const r = await this.queryWithFields(`SELECT * FROM \`${key}\` LIMIT 0`);
        const fields = Array.isArray(r?.fields) ? r.fields : [];
        const cols = fields
          .map((f) => String(f?.name || '').trim())
          .filter(Boolean);
        this._metaCache.columns[key] = cols;
        return cols;
      } catch (_) {
        return [];
      }
    }
  }

  /** Invalida la caché de columnas (para tests o migraciones). Opcional: tabla concreta si se pasa. */
  _clearColumnsCache(tableName) {
    if (!this._metaCache.columns) return;
    if (tableName) delete this._metaCache.columns[String(tableName).trim()];
    else this._metaCache.columns = {};
  }

  async _ensureVisitasMeta() {
    if (this._metaCache?.visitasMeta) return this._metaCache.visitasMeta;

    const tVisitas = await this._resolveTableNameCaseInsensitive('visitas');
    const cols = await this._getColumns(tVisitas);
    const colsLower = new Set(cols.map(c => c.toLowerCase()));

    const pickCI = (cands) => {
      for (const cand of (cands || [])) {
        const cl = String(cand).toLowerCase();
        if (colsLower.has(cl)) {
          const idx = cols.findIndex(c => c.toLowerCase() === cl);
          return idx >= 0 ? cols[idx] : cand;
        }
      }
      return null;
    };

    // Heurística: si no encontramos una columna exacta, intenta deducirla por nombre.
    // Preferir columnas con "id", pero si no hay, aceptar columnas que contengan la keyword.
    const guessColByKeywords = (keywords) => {
      const keys = (keywords || []).map(k => String(k || '').toLowerCase()).filter(Boolean);
      if (!keys.length) return null;
      const withId = (cols || []).find((c) => {
        const cl = String(c || '').toLowerCase();
        return keys.some(k => cl.includes(k)) && (cl.includes('id') || cl.startsWith('id_') || cl.startsWith('id'));
      });
      if (withId) return withId;
      const any = (cols || []).find((c) => {
        const cl = String(c || '').toLowerCase();
        return keys.some(k => cl.includes(k));
      });
      return any || null;
    };

    const meta = {
      table: tVisitas,
      pk: pickCI(['vis_id', 'Id', 'id']) || 'vis_id',
      colComercial: pickCI([
        'vis_com_id',
        'Id_Cial',
        'id_cial',
        'IdCial',
        'idCial',
        'CialId',
        'cialId',
        'ComercialId',
        'comercialId',
        'Comercial_id',
        'comercial_id',
        'Id_Comercial',
        'id_Comercial',
        'id_comercial'
      ]),
      colCliente: pickCI(['vis_cli_id', 'ClienteId', 'clienteId', 'Id_Cliente', 'id_cliente', 'Cliente_id', 'cliente_id', 'FarmaciaClienteId', 'farmaciaClienteId']),
      colFecha: pickCI(['vis_fecha', 'Fecha', 'fecha', 'FechaVisita', 'fechaVisita', 'Fecha_Visita', 'fecha_visita', 'Fecha_Visita', 'fechaVisita']),
      colHora: pickCI(['vis_hora', 'Hora', 'hora', 'Hora_Visita', 'hora_visita']),
      colHoraFinal: pickCI(['vis_hora_final', 'Hora_Final', 'hora_final', 'HoraFinal', 'horaFinal', 'Hora_Fin', 'hora_fin', 'HoraFin', 'horaFin']),
      colTipo: pickCI([
        'vis_tipo',
        'TipoVisita',
        'tipoVisita',
        'Tipo_Visita',
        'tipo_visita',
        'Tipo',
        'tipo',
        'Id_TipoVisita',
        'id_tipovisita',
        'Id_Tipo_Visita',
        'id_tipo_visita',
        'TipoVisitaId',
        'Tipo_VisitaId',
        'tipoVisitaId'
      ]),
      colEstado: pickCI(['vis_estado', 'Estado', 'estado', 'EstadoVisita', 'estadoVisita', 'Estado_Visita', 'estado_visita']),
      colNotas: pickCI(['vis_notas', 'Notas', 'notas', 'Observaciones', 'observaciones', 'Comentarios', 'comentarios', 'Mensaje', 'mensaje'])
    };

    // Fallback por heurística si no se detecta por lista cerrada (evita quedarse sin filtro en prod).
    if (!meta.colComercial) {
      meta.colComercial = guessColByKeywords(['comercial', 'cial']);
    }
    if (!meta.colCliente) {
      meta.colCliente = guessColByKeywords(['cliente', 'farmacia']);
    }
    if (!meta.colFecha) {
      meta.colFecha = guessColByKeywords(['fecha']);
    }
    if (!meta.colHora) {
      meta.colHora = guessColByKeywords(['hora']);
    }
    if (!meta.colHoraFinal) {
      meta.colHoraFinal = guessColByKeywords(['hora_final', 'horafinal']);
    }
    if (!meta.colTipo) {
      meta.colTipo = guessColByKeywords(['tipo']);
    }
    if (!meta.colEstado) {
      meta.colEstado = guessColByKeywords(['estado']);
    }

    // Guardar columnas para debug/fallbacks
    meta._cols = cols;

    this._metaCache.visitasMeta = meta;
    return meta;
  }

  _buildVisitasOwnerWhere(meta, user, alias = 'v') {
    const cols = Array.isArray(meta?._cols) ? meta._cols : [];
    const candCols = [];
    if (meta?.colComercial) candCols.push(meta.colComercial);
    for (const c of cols) {
      const cl = String(c || '').toLowerCase();
      if (cl.includes('comercial') || cl.includes('cial')) candCols.push(c);
    }
    // unique + cap
    const uniqCols = Array.from(new Set(candCols.map(String))).filter(Boolean).slice(0, 6);

    const uIdNum = Number(user?.id);
    const uId = Number.isFinite(uIdNum) && uIdNum > 0 ? uIdNum : (user?.id !== undefined && user?.id !== null ? String(user.id).trim() : '');
    const uEmail = user?.email ? String(user.email).trim() : '';
    const uNombre = user?.nombre ? String(user.nombre).trim() : '';
    const haveAny = Boolean(uId || uEmail || uNombre);
    if (!haveAny || !uniqCols.length) return { clause: null, params: [] };

    const params = [];
    const ors = [];
    for (const col of uniqCols) {
      const per = [];
      if (uId) {
        per.push(`${alias}.\`${col}\` = ?`);
        params.push(uId);
      }
      if (uEmail) {
        per.push(`LOWER(COALESCE(CONCAT(${alias}.\`${col}\`,''),'')) = LOWER(?)`);
        params.push(uEmail);
      }
      if (uNombre) {
        per.push(`LOWER(COALESCE(CONCAT(${alias}.\`${col}\`,''),'')) = LOWER(?)`);
        params.push(uNombre);
      }
      if (per.length) ors.push(`(${per.join(' OR ')})`);
    }
    if (!ors.length) return { clause: null, params: [] };
    return { clause: `(${ors.join(' OR ')})`, params };
  }

  async getTiposVisita() {
    try {
      // cache
      if (this._metaCache?.tiposVisita) return this._metaCache.tiposVisita;

      const candidates = [
        'tipos_visitas',
        'tipos_visita',
        'tipo_visitas',
        'tipo_visita',
        'visitas_tipos',
        'tipos_visitas_catalogo'
      ];

      let table = null;
      let colsRows = [];
      for (const base of candidates) {
        const t = await this._resolveTableNameCaseInsensitive(base);
        try {
          colsRows = await this.query(`SHOW COLUMNS FROM \`${t}\``);
          if (Array.isArray(colsRows) && colsRows.length) {
            table = t;
            break;
          }
        } catch (_) {
          // probar siguiente
        }
      }

      if (!table) {
        const fallback = Array.isArray(tiposVisitaFallback) ? tiposVisitaFallback : [];
        this._metaCache.tiposVisita = fallback;
        return fallback;
      }

      const cols = (Array.isArray(colsRows) ? colsRows : [])
        .map(r => String(r.Field || '').trim())
        .filter(Boolean);
      const colsLower = new Set(cols.map(c => c.toLowerCase()));
      const pickCI = (cands) => {
        for (const cand of (cands || [])) {
          const cl = String(cand).toLowerCase();
          if (colsLower.has(cl)) {
            const idx = cols.findIndex(c => c.toLowerCase() === cl);
            return idx >= 0 ? cols[idx] : cand;
          }
        }
        return null;
      };

      const idCol = pickCI(['Id', 'id']) || cols[0];
      const nameCol = pickCI(['Nombre', 'nombre', 'Tipo', 'tipo', 'Descripcion', 'descripcion', 'Name', 'name']) || cols[1] || cols[0];
      const activeCol = pickCI(['Activo', 'activo', 'Enabled', 'enabled', 'Activa', 'activa']);

      let sql = `SELECT \`${idCol}\` AS id, \`${nameCol}\` AS nombre FROM \`${table}\``;
      const params = [];
      if (activeCol) {
        sql += ` WHERE \`${activeCol}\` = 1`;
      }
      sql += ` ORDER BY \`${nameCol}\` ASC LIMIT 200`;

      const rows = await this.query(sql, params);
      const tipos = (rows || [])
        .map(r => ({ id: r.id, nombre: r.nombre }))
        .filter(r => r?.nombre !== null && r?.nombre !== undefined && String(r.nombre).trim() !== '');

      // Si la tabla existe pero está vacía, usar fallback de fichero.
      if (!tipos.length) {
        const fallback = Array.isArray(tiposVisitaFallback) ? tiposVisitaFallback : [];
        this._metaCache.tiposVisita = fallback;
        return fallback;
      }

      this._metaCache.tiposVisita = tipos;
      return tipos;
    } catch (e) {
      console.warn('⚠️ Error obteniendo tipos de visita:', e?.message || e);
      return Array.isArray(tiposVisitaFallback) ? tiposVisitaFallback : [];
    }
  }

  async ensureEstadosVisitaCatalog() {
    if (this._estadosVisitaEnsured) return;
    this._estadosVisitaEnsured = true;

    // Best-effort: no romper la app si no hay permisos para CREATE/INSERT en producción
    try {
      if (!this.pool) return;

      // Crear tabla catálogo si no existe
      await this.query(`
        CREATE TABLE IF NOT EXISTS \`estados_visita\` (
          id INT NOT NULL AUTO_INCREMENT,
          nombre VARCHAR(80) NOT NULL,
          activo TINYINT(1) NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_estados_visita_nombre (nombre)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // Estados por defecto + estados reales existentes en la tabla visitas (si hay columna estado)
      const base = Array.isArray(estadosVisitaFallback) ? estadosVisitaFallback : [];
      const normalized = new Set(
        base
          .map((x) => (typeof x === 'string' ? x : x?.nombre))
          .map((s) => String(s || '').trim())
          .filter(Boolean)
      );

      try {
        const meta = await this._ensureVisitasMeta();
        if (meta?.table && meta?.colEstado) {
          const rows = await this.query(
            `SELECT DISTINCT TRIM(COALESCE(CONCAT(v.\`${meta.colEstado}\`,''),'')) AS nombre
             FROM \`${meta.table}\` v
             WHERE v.\`${meta.colEstado}\` IS NOT NULL AND TRIM(COALESCE(CONCAT(v.\`${meta.colEstado}\`,''),'')) != ''
             LIMIT 500`
          ).catch(() => []);

          for (const r of rows || []) {
            const s = String(r?.nombre || '').trim();
            if (s) normalized.add(s);
          }
        }
      } catch (_) {
        // ignore
      }

      const values = Array.from(normalized).slice(0, 200);
      for (const nombre of values) {
        await this.query('INSERT IGNORE INTO `estados_visita` (nombre, activo) VALUES (?, 1)', [nombre]);
      }

      // invalidar cache para que se vea al momento
      if (this._metaCache) delete this._metaCache.estadosVisita;
    } catch (e) {
      console.warn('⚠️ [CATALOGO] No se pudo asegurar estados_visita:', e?.message || e);
    }
  }

  async getEstadosVisita() {
    try {
      if (this._metaCache?.estadosVisita) return this._metaCache.estadosVisita;

      const candidates = [
        'estados_visita',
        'estados_visitas',
        'visitas_estados',
        'estados_visita_catalogo'
      ];

      let table = null;
      let colsRows = [];
      for (const base of candidates) {
        const t = await this._resolveTableNameCaseInsensitive(base);
        try {
          colsRows = await this.query(`SHOW COLUMNS FROM \`${t}\``);
          if (Array.isArray(colsRows) && colsRows.length) {
            table = t;
            break;
          }
        } catch (_) {
          // probar siguiente
        }
      }

      if (!table) {
        const fallback = (Array.isArray(estadosVisitaFallback) ? estadosVisitaFallback : [])
          .map((x, idx) => (typeof x === 'string' ? { id: idx + 1, nombre: x } : x))
          .filter((x) => x?.nombre);
        this._metaCache.estadosVisita = fallback;
        return fallback;
      }

      const cols = (Array.isArray(colsRows) ? colsRows : [])
        .map((r) => String(r.Field || '').trim())
        .filter(Boolean);
      const colsLower = new Set(cols.map((c) => c.toLowerCase()));
      const pickCI = (cands) => {
        for (const cand of (cands || [])) {
          const cl = String(cand).toLowerCase();
          if (colsLower.has(cl)) {
            const idx = cols.findIndex((c) => c.toLowerCase() === cl);
            return idx >= 0 ? cols[idx] : cand;
          }
        }
        return null;
      };

      const idCol = pickCI(['Id', 'id']) || cols[0];
      const nameCol = pickCI(['Nombre', 'nombre', 'Estado', 'estado', 'Name', 'name']) || cols[1] || cols[0];
      const activeCol = pickCI(['Activo', 'activo', 'Enabled', 'enabled', 'Activa', 'activa']);

      let sql = `SELECT \`${idCol}\` AS id, \`${nameCol}\` AS nombre FROM \`${table}\``;
      const params = [];
      if (activeCol) sql += ` WHERE \`${activeCol}\` = 1`;
      sql += ` ORDER BY \`${nameCol}\` ASC LIMIT 200`;

      const rows = await this.query(sql, params);
      const estados = (rows || [])
        .map((r) => ({ id: r.id, nombre: r.nombre }))
        .filter((r) => r?.nombre !== null && r?.nombre !== undefined && String(r.nombre).trim() !== '');

      // Si existe tabla pero está vacía, usar fallback
      if (!estados.length) {
        const fallback = (Array.isArray(estadosVisitaFallback) ? estadosVisitaFallback : [])
          .map((x, idx) => (typeof x === 'string' ? { id: idx + 1, nombre: x } : x))
          .filter((x) => x?.nombre);
        this._metaCache.estadosVisita = fallback;
        return fallback;
      }

      this._metaCache.estadosVisita = estados;
      return estados;
    } catch (e) {
      const fallback = (Array.isArray(estadosVisitaFallback) ? estadosVisitaFallback : [])
        .map((x, idx) => (typeof x === 'string' ? { id: idx + 1, nombre: x } : x))
        .filter((x) => x?.nombre);
      return fallback;
    }
  }

  async ensureVisitasIndexes() {
    if (this._visitasIndexesEnsured) return;
    this._visitasIndexesEnsured = true;

    try {
      if (!this.pool) return;
      const meta = await this._ensureVisitasMeta();
      const t = meta.table;
      const idxRows = await this.query(`SHOW INDEX FROM \`${t}\``).catch(() => []);
      const existing = new Set((idxRows || []).map(r => String(r.Key_name || r.key_name || '').trim()).filter(Boolean));

      const createIfMissing = async (name, cols) => {
        if (!name || existing.has(name)) return;
        const colsSql = (cols || []).filter(Boolean).map(c => `\`${c}\``).join(', ');
        if (!colsSql) return;
        await this.query(`CREATE INDEX \`${name}\` ON \`${t}\` (${colsSql})`);
        existing.add(name);
        console.log(`✅ [INDEX] Creado ${name} en ${t} (${colsSql})`);
      };

      await createIfMissing('idx_visitas_fecha', [meta.colFecha]);
      await createIfMissing('idx_visitas_comercial', [meta.colComercial]);
      await createIfMissing('idx_visitas_cliente', [meta.colCliente]);
      await createIfMissing('idx_visitas_comercial_fecha', [meta.colComercial, meta.colFecha]);
    } catch (e) {
      // No romper si no hay permisos de ALTER/INDEX
      console.warn('⚠️ [INDEX] No se pudieron asegurar índices en visitas:', e?.message || e);
    }
  }

  async ensureVisitasSchema() {
    if (this._visitasSchemaEnsured) return;
    this._visitasSchemaEnsured = true;

    try {
      if (!this.pool) return;

      const tVisitas = await this._resolveTableNameCaseInsensitive('visitas');
      const cols = await this._getColumns(tVisitas);
      const colsLower = new Set((cols || []).map((c) => String(c || '').toLowerCase()));

      const hasColCI = (name) => colsLower.has(String(name || '').toLowerCase());

      // 1) Añadir Id_Comercial si no existe
      if (!hasColCI('Id_Comercial')) {
        try {
          await this.query(`ALTER TABLE \`${tVisitas}\` ADD COLUMN \`Id_Comercial\` INT NULL`);
          console.log(`✅ [SCHEMA] Añadida columna Id_Comercial en ${tVisitas}`);
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir Id_Comercial en visitas:', e?.message || e);
        }
      }

      // 1b) Añadir Hora_Final si no existe (duración por defecto +30m)
      if (!hasColCI('Hora_Final')) {
        try {
          await this.query(`ALTER TABLE \`${tVisitas}\` ADD COLUMN \`Hora_Final\` TIME NULL`);
          console.log(`✅ [SCHEMA] Añadida columna Hora_Final en ${tVisitas}`);
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir Hora_Final en visitas:', e?.message || e);
        }
      }

      // Refrescar columnas/meta
      if (this._metaCache) delete this._metaCache.visitasMeta;
      const meta = await this._ensureVisitasMeta();

      // Backfill Hora_Final: si es null o 00:00:00, sumar 30m a Hora
      if (meta?.colHora && (meta?.colHoraFinal || hasColCI('hora_final'))) {
        const colHoraFinal = meta.colHoraFinal || 'Hora_Final';
        try {
          await this.query(
            `UPDATE \`${meta.table}\` SET \`${colHoraFinal}\` = ADDTIME(\`${meta.colHora}\`, '00:30:00') WHERE (\`${colHoraFinal}\` IS NULL OR \`${colHoraFinal}\` = '00:00:00') AND \`${meta.colHora}\` IS NOT NULL`
          );
        } catch (_) {
          // ignore
        }
      }

      // 2) Backfill best-effort desde columnas legacy si existen
      if (meta?.colComercial && String(meta.colComercial).toLowerCase() === 'id_comercial') {
        const legacyCandidates = [
          'Id_Cial',
          'id_cial',
          'IdCial',
          'idCial',
          'ComercialId',
          'comercialId',
          'Comercial_id',
          'comercial_id',
          'Id_Comercial',
          'id_comercial'
        ];
        const legacy = legacyCandidates.find((c) => hasColCI(c) && String(c).toLowerCase() !== 'id_comercial');
        if (legacy) {
          try {
            await this.query(
              `UPDATE \`${meta.table}\` SET \`Id_Comercial\` = \`${legacy}\` WHERE \`Id_Comercial\` IS NULL AND \`${legacy}\` IS NOT NULL`
            );
            console.log(`✅ [SCHEMA] Backfill Id_Comercial desde ${legacy}`);
          } catch (e) {
            console.warn('⚠️ [SCHEMA] No se pudo hacer backfill Id_Comercial:', e?.message || e);
          }
        }
      }

      // 3) Índices recomendados para consultas por comercial/fecha
      try {
        const idxRows = await this.query(`SHOW INDEX FROM \`${meta.table}\``).catch(() => []);
        const existing = new Set((idxRows || []).map((r) => String(r.Key_name || r.key_name || '').trim()).filter(Boolean));
        const createIfMissing = async (name, colsToUse) => {
          if (!name || existing.has(name)) return;
          const colsSql = (colsToUse || []).filter(Boolean).map((c) => `\`${c}\``).join(', ');
          if (!colsSql) return;
          await this.query(`CREATE INDEX \`${name}\` ON \`${meta.table}\` (${colsSql})`);
          existing.add(name);
        };
        await createIfMissing('idx_visitas_id_comercial', [meta.colComercial || 'Id_Comercial']);
        await createIfMissing('idx_visitas_id_comercial_fecha', [meta.colComercial || 'Id_Comercial', meta.colFecha]);
      } catch (e) {
        console.warn('⚠️ [INDEX] No se pudieron crear índices para Id_Comercial:', e?.message || e);
      }

      // 4) Foreign key best-effort hacia comerciales
      try {
        const comMeta = await this._ensureComercialesMeta().catch(() => null);
        if (comMeta?.table && comMeta?.pk && (meta.colComercial || hasColCI('Id_Comercial'))) {
          // comprobar si ya existe FK
          const fkName = 'fk_visitas_comercial';
          try {
            await this.query(
              `ALTER TABLE \`${meta.table}\` ADD CONSTRAINT \`${fkName}\` FOREIGN KEY (\`${meta.colComercial || 'Id_Comercial'}\`) REFERENCES \`${comMeta.table}\`(\`${comMeta.pk}\`) ON DELETE SET NULL ON UPDATE CASCADE`
            );
            console.log(`✅ [FK] Creada ${fkName}`);
          } catch (e) {
            // Si ya existe o no hay permisos, no romper
            const msg = String(e?.message || e);
            if (!msg.toLowerCase().includes('duplicate') && !msg.toLowerCase().includes('already') && !msg.toLowerCase().includes('exists')) {
              console.warn('⚠️ [FK] No se pudo crear FK visitas->comerciales:', e?.message || e);
            }
          }
        }
      } catch (_) {
        // ignore
      }
    } catch (e) {
      console.warn('⚠️ [SCHEMA] No se pudo asegurar esquema de visitas:', e?.message || e);
    }
  }

  async _ensurePedidosMeta() {
    if (this._metaCache?.pedidosMeta) return this._metaCache.pedidosMeta;

    const tPedidos = await this._resolveTableNameCaseInsensitive('pedidos');
    const cols = await this._getColumns(tPedidos);
    const pickCI = (cands) => this._pickCIFromColumns(cols, cands);

    const pk = pickCI(['ped_id', 'Id', 'id']) || 'ped_id';
    const colComercial = pickCI([
      'ped_com_id',
      'Id_Cial',
      'id_cial',
      'Comercial_id',
      'comercial_id',
      'ComercialId',
      'comercialId',
      'Id_Comercial',
      'id_comercial'
    ]);
    const colCliente = pickCI([
      'ped_cli_id',
      'Id_Cliente',
      'id_cliente',
      'Cliente_id',
      'cliente_id',
      'ClienteId',
      'clienteId'
    ]);
    const colFecha = pickCI([
      'ped_fecha',
      'FechaPedido',
      'Fecha_Pedido',
      'Fecha',
      'fecha',
      'created_at',
      'CreatedAt'
    ]);
    const colNumPedido = pickCI([
      'ped_numero',
      'NumPedido',
      'Numero_Pedido',
      'numero_pedido',
      'Número_Pedido',
      'Número Pedido',
      'NumeroPedido',
      'numeroPedido'
    ]);

    const colEstado = pickCI(['ped_estado_txt', 'EstadoPedido', 'estado_pedido', 'Estado', 'estado']);
    const colEstadoId = pickCI(['ped_estped_id', 'Id_EstadoPedido', 'id_estado_pedido', 'EstadoPedidoId', 'estado_pedido_id']);
    const meta = { tPedidos, pk, colComercial, colCliente, colFecha, colNumPedido, colEstado, colEstadoId };
    this._metaCache.pedidosMeta = meta;
    return meta;
  }

  async _ensurePedidosArticulosMeta() {
    if (this._metaCache?.pedidosArticulosMeta) return this._metaCache.pedidosArticulosMeta;

    const t = await this._resolveTableNameCaseInsensitive('pedidos_articulos');
    const cols = await this._getColumns(t);
    const pickCI = (cands) => this._pickCIFromColumns(cols, cands);

    const pk = pickCI(['pedart_id', 'Id', 'id']) || 'pedart_id';
    const colNumPedido = pickCI(['pedart_numero', 'NumPedido', 'numPedido', 'NumeroPedido', 'numeroPedido', 'Numero_Pedido', 'Número_Pedido', 'Número Pedido']);
    const colPedidoId = pickCI(['pedart_ped_id', 'PedidoId', 'pedidoId', 'Id_Pedido', 'id_pedido', 'pedido_id', 'IdPedido', 'idPedido']);
    const colPedidoIdNum = pickCI(['pedart_ped_id', 'Id_NumPedido', 'id_numpedido', 'id_num_pedido', 'PedidoIdNum', 'pedidoIdNum', 'IdNumPedido', 'idNumPedido']);
    const colArticulo = pickCI(['pedart_art_id', 'Id_Articulo', 'id_articulo', 'ArticuloId', 'articuloId', 'IdArticulo', 'idArticulo']);

    const meta = { table: t, pk, colNumPedido, colPedidoId, colPedidoIdNum, colArticulo };
    this._metaCache.pedidosArticulosMeta = meta;
    return meta;
  }

  async _ensureDescuentosPedidoMeta() {
    if (this._metaCache?.descuentosPedidoMeta) return this._metaCache.descuentosPedidoMeta;

    const t = await this._resolveTableNameCaseInsensitive('descuentos_pedido');
    const cols = await this._getColumns(t).catch(() => []);
    const pickCI = (cands) => this._pickCIFromColumns(cols, cands);

    const pk = pickCI(['descped_id', 'id', 'Id']) || 'descped_id';
    const colDesde = pickCI(['descped_importe_desde', 'importe_desde', 'Importe_Desde', 'ImporteDesde', 'desde', 'importe_min', 'min']);
    const colHasta = pickCI(['descped_importe_hasta', 'importe_hasta', 'Importe_Hasta', 'ImporteHasta', 'hasta', 'importe_max', 'max']);
    const colDto = pickCI(['descped_pct', 'dto_pct', 'DtoPct', 'dto', 'Dto', 'porcentaje', 'Porcentaje']);
    const colActivo = pickCI(['descped_activo', 'activo', 'Activo']) || 'descped_activo';
    const colOrden = pickCI(['descped_orden', 'orden', 'Orden', 'prioridad', 'Prioridad']) || 'descped_orden';

    const meta = { table: t, pk, colDesde, colHasta, colDto, colActivo, colOrden };
    this._metaCache.descuentosPedidoMeta = meta;
    return meta;
  }

  // =====================================================
  // ESTADOS DE PEDIDO (catálogo)
  // =====================================================
  async _ensureEstadosPedidoMeta() {
    if (this._metaCache?.estadosPedidoMeta) return this._metaCache.estadosPedidoMeta;
    const table = await this._resolveTableNameCaseInsensitive('estados_pedido');
    const cols = await this._getColumns(table).catch(() => []);
    const pick = (cands) => this._pickCIFromColumns(cols, cands);
    const pk = pick(['estped_id', 'id', 'Id']) || 'estped_id';
    const colCodigo = pick(['estped_codigo', 'codigo', 'Codigo', 'code']) || 'estped_codigo';
    const colNombre = pick(['estped_nombre', 'nombre', 'Nombre', 'name']) || 'estped_nombre';
    const colColor = pick(['estped_color', 'color', 'Color']) || 'estped_color';
    const colActivo = pick(['estped_activo', 'activo', 'Activo']) || 'estped_activo';
    const colOrden = pick(['estped_orden', 'orden', 'Orden']) || 'estped_orden';
    const meta = { table, pk, colCodigo, colNombre, colColor, colActivo, colOrden, cols };
    this._metaCache.estadosPedidoMeta = meta;
    return meta;
  }

  async ensureEstadosPedidoTable() {
    // Best-effort: crear tabla y seeds si no existe. No romper si no hay permisos.
    try {
      await this.query(`
        CREATE TABLE IF NOT EXISTS \`estados_pedido\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`codigo\` VARCHAR(32) NOT NULL,
          \`nombre\` VARCHAR(64) NOT NULL,
          \`color\` ENUM('ok','info','warn','danger') NOT NULL DEFAULT 'info',
          \`activo\` TINYINT(1) NOT NULL DEFAULT 1,
          \`orden\` INT NOT NULL DEFAULT 0,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uq_estados_pedido_codigo\` (\`codigo\`),
          KEY \`idx_estados_pedido_activo_orden\` (\`activo\`, \`orden\`, \`nombre\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      // Seed (idempotente por UNIQUE(codigo))
      await this.query(
        `
          INSERT INTO \`estados_pedido\` (\`codigo\`, \`nombre\`, \`color\`, \`activo\`, \`orden\`)
          VALUES
            ('pendiente', 'Pendiente', 'warn', 1, 10),
            ('aprobado',  'Aprobado',  'ok',   1, 20),
            ('entregado', 'Entregado', 'info', 1, 25),
            ('pagado',    'Pagado',    'ok',   1, 30),
            ('denegado',  'Denegado',  'danger', 1, 40)
          ON DUPLICATE KEY UPDATE
            \`nombre\`=VALUES(\`nombre\`),
            \`color\`=VALUES(\`color\`),
            \`activo\`=VALUES(\`activo\`),
            \`orden\`=VALUES(\`orden\`)
        `
      );
      await this._ensureEstadosPedidoMeta().catch(() => null);
      return true;
    } catch (e) {
      console.warn('⚠️ [SCHEMA] No se pudo asegurar estados_pedido:', e?.message || e);
      return false;
    }
  }

  async getEstadosPedidoActivos() {
    await this.ensureEstadosPedidoTable();
    try {
      const meta = await this._ensureEstadosPedidoMeta().catch(() => null);
      if (!meta?.table) return [];
      const sql = `
        SELECT
          \`${meta.pk}\` AS id,
          \`${meta.colCodigo}\` AS codigo,
          \`${meta.colNombre}\` AS nombre,
          \`${meta.colColor}\` AS color,
          \`${meta.colOrden}\` AS orden
        FROM \`${meta.table}\`
        WHERE \`${meta.colActivo}\` = 1
        ORDER BY \`${meta.colOrden}\` ASC, \`${meta.colNombre}\` ASC
      `;
      const rows = await this.query(sql).catch(() => []);
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }

  async getEstadoPedidoIdByCodigo(codigo) {
    const code = String(codigo || '').trim().toLowerCase();
    if (!code) return null;
    await this.ensureEstadosPedidoTable();
    try {
      const meta = await this._ensureEstadosPedidoMeta().catch(() => null);
      if (!meta?.table) return null;
      const rows = await this.query(
        `SELECT \`${meta.pk}\` AS id FROM \`${meta.table}\` WHERE LOWER(TRIM(\`${meta.colCodigo}\`)) = ? LIMIT 1`,
        [code]
      );
      const id = rows?.[0]?.id;
      const n = Number(id);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch (_) {
      return null;
    }
  }

  async getEstadoPedidoById(id) {
    const n = Number.parseInt(String(id ?? '').trim(), 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    await this.ensureEstadosPedidoTable();
    try {
      const meta = await this._ensureEstadosPedidoMeta().catch(() => null);
      if (!meta?.table) return null;
      const rows = await this.query(`SELECT * FROM \`${meta.table}\` WHERE \`${meta.pk}\` = ? LIMIT 1`, [n]);
      return rows?.[0] ?? null;
    } catch (_) {
      return null;
    }
  }

  async getDescuentosPedidoActivos(conn = null) {
    // Devuelve tramos activos ordenados por "orden" y por importe_desde ascendente.
    // Cada tramo se evalúa como: subtotal >= desde && (hasta IS NULL || subtotal < hasta)
    try {
      const meta = await this._ensureDescuentosPedidoMeta();
      if (!meta?.table || !meta.colDesde || !meta.colDto) return [];

      const selectCols = [
        meta.colDesde ? `\`${meta.colDesde}\` AS importe_desde` : null,
        meta.colHasta ? `\`${meta.colHasta}\` AS importe_hasta` : 'NULL AS importe_hasta',
        meta.colDto ? `\`${meta.colDto}\` AS dto_pct` : null,
        meta.colOrden ? `\`${meta.colOrden}\` AS orden` : '0 AS orden'
      ].filter(Boolean);

      const where = meta.colActivo ? `WHERE \`${meta.colActivo}\` = 1` : '';
      const orderBy = `ORDER BY orden ASC, importe_desde ASC`;
      const sql = `SELECT ${selectCols.join(', ')} FROM \`${meta.table}\` ${where} ${orderBy}`;

      let rows = [];
      if (conn) {
        const [r] = await conn.execute(sql);
        rows = r;
      } else {
        rows = await this.query(sql).catch(() => []);
      }
      const out = [];
      for (const row of (rows || [])) {
        const desde = Number(String(row.importe_desde ?? '').replace(',', '.'));
        const hastaRaw = row.importe_hasta;
        const hasta =
          hastaRaw === null || hastaRaw === undefined || String(hastaRaw).trim() === ''
            ? null
            : Number(String(hastaRaw).replace(',', '.'));
        const dto = Number(String(row.dto_pct ?? '').replace(',', '.'));
        if (!Number.isFinite(desde)) continue;
        if (hasta !== null && !Number.isFinite(hasta)) continue;
        if (!Number.isFinite(dto)) continue;
        out.push({ importe_desde: desde, importe_hasta: hasta, dto_pct: dto, orden: Number(row.orden || 0) || 0 });
      }
      return out;
    } catch (_) {
      return [];
    }
  }

  async getDtoPedidoPctForSubtotal(subtotal, conn = null) {
    const x = Number(subtotal);
    if (!Number.isFinite(x) || x <= 0) return 0;
    const tramos = await this.getDescuentosPedidoActivos(conn);
    for (const t of (tramos || [])) {
      const desde = Number(t.importe_desde);
      const hasta = t.importe_hasta === null || t.importe_hasta === undefined ? null : Number(t.importe_hasta);
      if (!Number.isFinite(desde)) continue;
      if (x >= desde && (hasta === null || (!Number.isNaN(hasta) && x < hasta))) {
        const dto = Number(t.dto_pct);
        return Number.isFinite(dto) ? Math.max(0, Math.min(100, dto)) : 0;
      }
    }
    return 0;
  }

  // ===========================
  // DESCUENTOS PEDIDO (Admin CRUD)
  // ===========================
  async getDescuentosPedidoAdmin() {
    // Devuelve todos los tramos (activos e inactivos) para administración.
    try {
      const meta = await this._ensureDescuentosPedidoMeta();
      if (!meta?.table) return null;
      const cols = await this._getColumns(meta.table).catch(() => []);
      if (!Array.isArray(cols) || cols.length === 0) return null;
      const pickCI = (cands) => this._pickCIFromColumns(cols, cands);
      const pk = meta.pk || pickCI(['id', 'Id']) || 'id';
      const colDesde = meta.colDesde || pickCI(['importe_desde']);
      const colHasta = meta.colHasta || pickCI(['importe_hasta']);
      const colDto = meta.colDto || pickCI(['dto_pct']);
      const colActivo = meta.colActivo || pickCI(['activo']);
      const colOrden = meta.colOrden || pickCI(['orden']);
      const colUpdatedAt = pickCI(['updated_at', 'UpdatedAt', 'Actualizado', 'actualizado', 'FechaActualizacion', 'fecha_actualizacion']);

      const selectCols = [
        `\`${pk}\` AS id`,
        colDesde ? `\`${colDesde}\` AS importe_desde` : '0 AS importe_desde',
        colHasta ? `\`${colHasta}\` AS importe_hasta` : 'NULL AS importe_hasta',
        colDto ? `\`${colDto}\` AS dto_pct` : '0 AS dto_pct',
        colActivo ? `\`${colActivo}\` AS activo` : '1 AS activo',
        colOrden ? `\`${colOrden}\` AS orden` : '0 AS orden',
        colUpdatedAt ? `\`${colUpdatedAt}\` AS updated_at` : 'NULL AS updated_at'
      ];
      const sql = `SELECT ${selectCols.join(', ')} FROM \`${meta.table}\` ORDER BY orden ASC, importe_desde ASC`;
      const rows = await this.query(sql).catch(() => null);
      return rows;
    } catch (_) {
      return null;
    }
  }

  async getDescuentoPedidoById(id) {
    try {
      const idNum = Number(id);
      if (!Number.isFinite(idNum) || idNum <= 0) return null;
      const meta = await this._ensureDescuentosPedidoMeta();
      if (!meta?.table) return null;
      const sql = `SELECT * FROM \`${meta.table}\` WHERE \`${meta.pk}\` = ? LIMIT 1`;
      const rows = await this.query(sql, [idNum]).catch(() => []);
      return rows && rows[0] ? rows[0] : null;
    } catch (_) {
      return null;
    }
  }

  async createDescuentoPedido(payload) {
    const meta = await this._ensureDescuentosPedidoMeta();
    if (!meta?.table) throw new Error('Tabla descuentos_pedido no disponible');
    const data = payload && typeof payload === 'object' ? payload : {};
    const cols = await this._getColumns(meta.table).catch(() => []);
    const colsLower = new Map((cols || []).map((c) => [String(c).toLowerCase(), c]));
    const put = (key, value) => {
      const real = colsLower.get(String(key).toLowerCase());
      if (real) out[real] = value;
    };
    const out = {};
    put('importe_desde', data.importe_desde);
    put('importe_hasta', data.importe_hasta);
    put('dto_pct', data.dto_pct);
    put('activo', data.activo ?? 1);
    put('orden', data.orden ?? 0);
    const keys = Object.keys(out);
    if (!keys.length) throw new Error('Payload vacío');
    const fields = keys.map((c) => `\`${c}\``).join(', ');
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map((c) => out[c]);
    const sql = `INSERT INTO \`${meta.table}\` (${fields}) VALUES (${placeholders})`;
    return await this.query(sql, values);
  }

  async updateDescuentoPedido(id, payload) {
    const meta = await this._ensureDescuentosPedidoMeta();
    if (!meta?.table) throw new Error('Tabla descuentos_pedido no disponible');
    const idNum = Number(id);
    if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('ID no válido');
    const data = payload && typeof payload === 'object' ? payload : {};
    const cols = await this._getColumns(meta.table).catch(() => []);
    const colsLower = new Map((cols || []).map((c) => [String(c).toLowerCase(), c]));
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      const real = colsLower.get(String(k).toLowerCase());
      if (!real) continue;
      if (String(real).toLowerCase() === String(meta.pk).toLowerCase()) continue;
      out[real] = v;
    }
    const keys = Object.keys(out);
    if (!keys.length) return { affectedRows: 0 };
    const fields = keys.map((c) => `\`${c}\` = ?`).join(', ');
    const values = keys.map((c) => out[c]);
    values.push(idNum);
    const sql = `UPDATE \`${meta.table}\` SET ${fields} WHERE \`${meta.pk}\` = ?`;
    return await this.query(sql, values);
  }

  async toggleDescuentoPedidoActivo(id) {
    const meta = await this._ensureDescuentosPedidoMeta();
    if (!meta?.table) throw new Error('Tabla descuentos_pedido no disponible');
    const idNum = Number(id);
    if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('ID no válido');
    const item = await this.getDescuentoPedidoById(idNum);
    if (!item) throw new Error('No encontrado');
    const cols = await this._getColumns(meta.table).catch(() => []);
    const pickCI = (cands) => this._pickCIFromColumns(cols, cands);
    const colActivo = meta.colActivo || pickCI(['activo', 'Activo']) || 'activo';
    const cur = Number(item[colActivo] ?? item.activo ?? 0) === 1 ? 1 : 0;
    const next = cur ? 0 : 1;
    const sql = `UPDATE \`${meta.table}\` SET \`${colActivo}\` = ? WHERE \`${meta.pk}\` = ?`;
    return await this.query(sql, [next, idNum]);
  }

  async deleteDescuentoPedido(id) {
    const meta = await this._ensureDescuentosPedidoMeta();
    if (!meta?.table) throw new Error('Tabla descuentos_pedido no disponible');
    const idNum = Number(id);
    if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('ID no válido');
    const sql = `DELETE FROM \`${meta.table}\` WHERE \`${meta.pk}\` = ?`;
    return await this.query(sql, [idNum]);
  }

  // ===========================
  // VARIABLES DEL SISTEMA (Admin)
  // ===========================
  async ensureVariablesSistemaTable() {
    // Best-effort: crear tabla si no existe. Si no hay permisos, no romper.
    try {
      await this.query(`
        CREATE TABLE IF NOT EXISTS \`variables_sistema\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`clave\` VARCHAR(120) NOT NULL,
          \`valor\` TEXT NULL,
          \`descripcion\` VARCHAR(255) NULL,
          \`updated_by\` VARCHAR(180) NULL,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uq_variables_sistema_clave\` (\`clave\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      return true;
    } catch (e) {
      console.warn('⚠️ [SCHEMA] No se pudo asegurar variables_sistema:', e?.message || e);
      return false;
    }
  }

  async _ensureVariablesSistemaMeta() {
    if (this._metaCache?.variablesSistemaMeta) return this._metaCache.variablesSistemaMeta;
    let table = null;
    try {
      table = await this._resolveTableNameCaseInsensitive('variables_sistema');
    } catch (_) {
      table = 'variables_sistema';
    }
    const cols = await this._getColumns(table).catch(() => []);
    const pick = (cands) => this._pickCIFromColumns(cols, cands);
    const pk = pick(['id', 'Id']) || 'id';
    const colClave = pick(['clave', 'Clave', 'key', 'Key']) || 'clave';
    const colValor = pick(['valor', 'Valor', 'value', 'Value']) || 'valor';
    const colDescripcion = pick(['descripcion', 'Descripción', 'Descripcion', 'description', 'Description']) || 'descripcion';
    const colUpdatedAt = pick(['updated_at', 'UpdatedAt', 'actualizado', 'Actualizado']) || 'updated_at';
    const colUpdatedBy = pick(['updated_by', 'UpdatedBy', 'actualizado_por', 'ActualizadoPor']) || 'updated_by';
    const meta = { table, pk, colClave, colValor, colDescripcion, colUpdatedAt, colUpdatedBy };
    this._metaCache.variablesSistemaMeta = meta;
    return meta;
  }

  async getVariablesSistemaAdmin() {
    await this.ensureVariablesSistemaTable();
    try {
      const meta = await this._ensureVariablesSistemaMeta().catch(() => null);
      if (!meta?.table) return null;
      const rows = await this.query(
        `
          SELECT
            \`${meta.pk}\` AS id,
            \`${meta.colClave}\` AS clave,
            \`${meta.colValor}\` AS valor,
            \`${meta.colDescripcion}\` AS descripcion,
            \`${meta.colUpdatedBy}\` AS updated_by,
            \`${meta.colUpdatedAt}\` AS updated_at
          FROM \`${meta.table}\`
          ORDER BY \`${meta.colClave}\` ASC
        `
      ).catch(() => null);
      return rows;
    } catch (_) {
      return null;
    }
  }

  async getVariableSistema(clave) {
    const key = String(clave || '').trim();
    if (!key) return null;
    await this.ensureVariablesSistemaTable();
    try {
      const meta = await this._ensureVariablesSistemaMeta().catch(() => null);
      if (!meta?.table) return null;
      const rows = await this.query(
        `SELECT \`${meta.colValor}\` AS valor FROM \`${meta.table}\` WHERE \`${meta.colClave}\` = ? LIMIT 1`,
        [key]
      ).catch(() => []);
      const val = rows?.[0]?.valor;
      if (val === null || val === undefined) return null;
      const s = String(val).trim();
      return s ? s : null;
    } catch (_) {
      return null;
    }
  }

  async upsertVariableSistema(clave, valor, { descripcion = null, updatedBy = null } = {}) {
    const key = String(clave || '').trim();
    if (!key) throw new Error('Clave no válida');
    await this.ensureVariablesSistemaTable();
    const meta = await this._ensureVariablesSistemaMeta().catch(() => null);
    if (!meta?.table) throw new Error('Tabla variables_sistema no disponible');

    const val = (valor === null || valor === undefined) ? null : String(valor);
    const desc = (descripcion === null || descripcion === undefined) ? null : String(descripcion);
    const by = (updatedBy === null || updatedBy === undefined) ? null : String(updatedBy);

    // Upsert compatible con MySQL (UNIQUE(clave))
    return await this.query(
      `
        INSERT INTO \`${meta.table}\` (\`${meta.colClave}\`, \`${meta.colValor}\`, \`${meta.colDescripcion}\`, \`${meta.colUpdatedBy}\`)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          \`${meta.colValor}\` = VALUES(\`${meta.colValor}\`),
          \`${meta.colDescripcion}\` = VALUES(\`${meta.colDescripcion}\`),
          \`${meta.colUpdatedBy}\` = VALUES(\`${meta.colUpdatedBy}\`)
      `,
      [key, val, desc, by]
    );
  }

  async _ensureDireccionesEnvioMeta() {
    if (this._metaCache?.direccionesEnvioMeta) return this._metaCache.direccionesEnvioMeta;

    const candidates = [
      'direccionesEnvio',
      'direcciones_envio',
      'direcciones_envios',
      'direccionesDeEnvio',
      'direcciones_de_envio',
      'clientes_direcciones_envio',
      'clientes_direccionesEnvio'
    ];

    let t = null;
    let cols = [];
    for (const base of candidates) {
      const tt = await this._resolveTableNameCaseInsensitive(base);
      const cc = await this._getColumns(tt);
      if (Array.isArray(cc) && cc.length) {
        t = tt;
        cols = cc;
        break;
      }
    }

    const pickCI = (cands) => this._pickCIFromColumns(cols, cands);
    const pk = pickCI(['direnv_id', 'id', 'Id']) || 'direnv_id';
    const colCliente = pickCI(['direnv_cli_id', 'Id_Cliente', 'id_cliente', 'ClienteId', 'clienteId', 'cliente_id']);
    const colActiva = pickCI(['direnv_activa', 'Activa', 'activa', 'Activo', 'activo']);
    const colPrincipal = pickCI(['direnv_es_principal', 'Es_Principal', 'es_principal', 'EsPrincipal', 'esPrincipal', 'Principal', 'principal']);
    const colContacto = pickCI(['direnv_ag_id', 'Id_Contacto', 'id_contacto', 'ContactoId', 'contactoId', 'contacto_id']);

    const meta = { table: t, pk, colCliente, colActiva, colPrincipal, colContacto, _cols: cols };
    this._metaCache.direccionesEnvioMeta = meta;
    return meta;
  }

  async ensurePedidosIndexes() {
    if (this._pedidosIndexesEnsured) return;
    this._pedidosIndexesEnsured = true;

    try {
      if (!this.pool) return;
      const { tPedidos, pk, colComercial, colCliente, colFecha, colNumPedido } = await this._ensurePedidosMeta();
      const cols = await this._getColumns(tPedidos);
      const colsSet = new Set(cols);
      const hasCol = (c) => c && colsSet.has(c);

      const idxRows = await this.query(`SHOW INDEX FROM \`${tPedidos}\``).catch(() => []);
      const existing = new Set((idxRows || []).map(r => String(r.Key_name || r.key_name || '').trim()).filter(Boolean));

      const createIfMissing = async (name, colsToUse) => {
        if (!name || existing.has(name)) return;
        const cleanCols = (colsToUse || []).filter(hasCol);
        if (!cleanCols.length) return;
        const colsSql = cleanCols.map(c => `\`${c}\``).join(', ');
        await this.query(`CREATE INDEX \`${name}\` ON \`${tPedidos}\` (${colsSql})`);
        existing.add(name);
        console.log(`✅ [INDEX] Creado ${name} en ${tPedidos} (${colsSql})`);
      };

      // Filtros + EXISTS/ORDER BY en clientes (conVentas / último pedido)
      await createIfMissing('idx_pedidos_cliente', [colCliente]);
      await createIfMissing('idx_pedidos_comercial', [colComercial]);
      await createIfMissing('idx_pedidos_fecha', [colFecha]);
      await createIfMissing('idx_pedidos_cliente_fecha', [colCliente, colFecha]);
      await createIfMissing('idx_pedidos_comercial_fecha', [colComercial, colFecha]);

      // Para getNextNumeroPedido y búsquedas por número
      await createIfMissing('idx_pedidos_num_pedido', [colNumPedido]);

      if (hasCol(pk)) {
        await createIfMissing('idx_pedidos_pk', [pk]);
      }
    } catch (e) {
      console.warn('⚠️ [INDEX] No se pudieron asegurar índices en pedidos:', e?.message || e);
    }
  }

  async ensurePedidosArticulosIndexes() {
    if (this._pedidosArticulosIndexesEnsured) return;
    this._pedidosArticulosIndexesEnsured = true;

    try {
      if (!this.pool) return;
      const meta = await this._ensurePedidosArticulosMeta();
      const t = meta.table;
      const cols = await this._getColumns(t);
      const colsSet = new Set(cols);
      const hasCol = (c) => c && colsSet.has(c);

      const idxRows = await this.query(`SHOW INDEX FROM \`${t}\``).catch(() => []);
      const existing = new Set((idxRows || []).map(r => String(r.Key_name || r.key_name || '').trim()).filter(Boolean));

      const createIfMissing = async (name, colsToUse) => {
        if (!name || existing.has(name)) return;
        const cleanCols = (colsToUse || []).filter(hasCol);
        if (!cleanCols.length) return;
        const colsSql = cleanCols.map(c => `\`${c}\``).join(', ');
        await this.query(`CREATE INDEX \`${name}\` ON \`${t}\` (${colsSql})`);
        existing.add(name);
        console.log(`✅ [INDEX] Creado ${name} en ${t} (${colsSql})`);
      };

      await createIfMissing('idx_pedidos_articulos_num_pedido', [meta.colNumPedido]);
      await createIfMissing('idx_pedidos_articulos_pedido_id', [meta.colPedidoId]);
      await createIfMissing('idx_pedidos_articulos_id_num_pedido', [meta.colPedidoIdNum]);
      await createIfMissing('idx_pedidos_articulos_articulo', [meta.colArticulo]);
      await createIfMissing('idx_pedidos_articulos_num_articulo', [meta.colNumPedido, meta.colArticulo]);

      if (hasCol(meta.pk)) {
        await createIfMissing('idx_pedidos_articulos_pk', [meta.pk]);
      }
    } catch (e) {
      console.warn('⚠️ [INDEX] No se pudieron asegurar índices en pedidos_articulos:', e?.message || e);
    }
  }

  async ensureContactosIndexes() {
    if (this._contactosIndexesEnsured) return;
    this._contactosIndexesEnsured = true;

    try {
      if (!this.pool) return;
      const t = await this._resolveAgendaTableName();
      const cols = await this._getColumns(t);
      const colsSet = new Set(cols);
      const hasCol = (c) => c && colsSet.has(c);

      const idxRows = await this.query(`SHOW INDEX FROM \`${t}\``).catch(() => []);
      const existing = new Set((idxRows || []).map(r => String(r.Key_name || r.key_name || '').trim()).filter(Boolean));

      // Compatibilidad: si la tabla se renombró desde `contactos`, los índices pueden conservar nombres legacy.
      // Tratarlos como equivalentes evita duplicar índices iguales con nombres distintos.
      for (const [newName, oldName] of [
        ['idx_agenda_activo_apellidos_nombre', 'idx_contactos_activo_apellidos_nombre'],
        ['ft_agenda_busqueda', 'ft_contactos_busqueda']
      ]) {
        if (existing.has(oldName)) existing.add(newName);
        if (existing.has(newName)) existing.add(oldName);
      }

      const createIfMissing = async (name, colsToUse, kind = 'INDEX') => {
        if (!name || existing.has(name)) return;
        const cleanCols = (colsToUse || []).filter(hasCol);
        if (!cleanCols.length) return;
        const colsSql = cleanCols.map(c => `\`${c}\``).join(', ');
        const stmt =
          kind === 'FULLTEXT'
            ? `CREATE FULLTEXT INDEX \`${name}\` ON \`${t}\` (${colsSql})`
            : `CREATE INDEX \`${name}\` ON \`${t}\` (${colsSql})`;
        await this.query(stmt);
        existing.add(name);
        console.log(`✅ [INDEX] Creado ${name} en ${t} (${colsSql})`);
      };

      await createIfMissing('idx_agenda_activo_apellidos_nombre', ['Activo', 'Apellidos', 'Nombre']);
      await createIfMissing('ft_agenda_busqueda', ['Nombre', 'Apellidos', 'Empresa', 'Email', 'Movil', 'Telefono'], 'FULLTEXT');
    } catch (e) {
      console.warn('⚠️ [INDEX] No se pudieron asegurar índices en contactos:', e?.message || e);
    }
  }

  async ensureDireccionesEnvioIndexes() {
    if (this._direccionesEnvioIndexesEnsured) return;
    this._direccionesEnvioIndexesEnsured = true;

    try {
      if (!this.pool) return;
      const meta = await this._ensureDireccionesEnvioMeta();
      if (!meta?.table) return;

      const t = meta.table;
      const cols = await this._getColumns(t);
      const colsSet = new Set(cols);
      const hasCol = (c) => c && colsSet.has(c);

      const idxRows = await this.query(`SHOW INDEX FROM \`${t}\``).catch(() => []);
      const existing = new Set((idxRows || []).map(r => String(r.Key_name || r.key_name || '').trim()).filter(Boolean));

      const createIfMissing = async (name, colsToUse) => {
        if (!name || existing.has(name)) return;
        const cleanCols = (colsToUse || []).filter(hasCol);
        if (!cleanCols.length) return;
        const colsSql = cleanCols.map(c => `\`${c}\``).join(', ');
        await this.query(`CREATE INDEX \`${name}\` ON \`${t}\` (${colsSql})`);
        existing.add(name);
        console.log(`✅ [INDEX] Creado ${name} en ${t} (${colsSql})`);
      };

      // Lecturas típicas: por cliente + filtros Activa/Principal
      await createIfMissing('idx_direnvio_cliente', [meta.colCliente]);
      await createIfMissing('idx_direnvio_cliente_activa', [meta.colCliente, meta.colActiva]);
      await createIfMissing('idx_direnvio_cliente_activa_principal', [meta.colCliente, meta.colActiva, meta.colPrincipal]);

      if (hasCol(meta.pk)) {
        await createIfMissing('idx_direnvio_pk', [meta.pk]);
      }
    } catch (e) {
      console.warn('⚠️ [INDEX] No se pudieron asegurar índices en direcciones de envío:', e?.message || e);
    }
  }

  async _ensureComercialesMeta() {
    if (this._metaCache?.comercialesMeta) return this._metaCache.comercialesMeta;
    const t = await this._resolveTableNameCaseInsensitive('comerciales');
    const cols = await this._getColumns(t);
    const pickCI = (cands) => this._pickCIFromColumns(cols, cands);
    const pk = pickCI(['com_id', 'id', 'Id']) || 'com_id';
    const colNombre = pickCI(['com_nombre', 'Nombre', 'nombre']) || 'com_nombre';
    const meta = { table: t, pk, colNombre };
    this._metaCache.comercialesMeta = meta;
    return meta;
  }

  /**
   * Reporte de integridad referencial (best-effort).
   * No modifica datos. Útil para detectar huérfanos y relaciones rotas.
   */
  async getIntegrityReport() {
    const report = {
      ok: true,
      generatedAt: new Date().toISOString(),
      database: this.config?.database || null,
      checks: []
    };

    const add = (item) => report.checks.push(item);
    const runCount = async (name, sql, params = []) => {
      try {
        const rows = await this.query(sql, params);
        const n = Number(rows?.[0]?.n ?? rows?.[0]?.N ?? 0);
        add({ name, ok: true, n });
      } catch (e) {
        add({ name, ok: false, error: e?.message || String(e) });
      }
    };

    // Metas principales
    const clientes = await this._ensureClientesMeta().catch(() => null);
    const pedidos = await this._ensurePedidosMeta().catch(() => null);
    const visitas = await this._ensureVisitasMeta().catch(() => null);
    const comerciales = await this._ensureComercialesMeta().catch(() => null);
    const pedArt = await this._ensurePedidosArticulosMeta().catch(() => null);

    // Tablas catálogos (si existen)
    const tProvincias = await this._resolveTableNameCaseInsensitive('provincias').catch(() => null);
    const tTiposClientes = await this._resolveTableNameCaseInsensitive('tipos_clientes').catch(() => null);
    const tEstadosClientes = await this._resolveTableNameCaseInsensitive('estdoClientes').catch(() => null);
    const tArticulos = await this._resolveTableNameCaseInsensitive('articulos').catch(() => null);

    // clientes -> provincias / tipos_clientes / estdoClientes / comerciales
    if (clientes?.tClientes) {
      const colProv = clientes.colProvincia || 'cli_prov_id';
      const colTipC = clientes.colTipoCliente || 'cli_tipc_id';
      const provPk = 'prov_id';
      const tipcPk = 'tipc_id';
      await runCount(
        'clientes_orfanos_provincia',
        `SELECT COUNT(*) AS n
         FROM \`${clientes.tClientes}\` c
         LEFT JOIN \`${tProvincias || 'provincias'}\` p ON c.\`${colProv}\` = p.\`${provPk}\`
         WHERE c.\`${colProv}\` IS NOT NULL AND c.\`${colProv}\` != 0 AND p.\`${provPk}\` IS NULL`
      );
      await runCount(
        'clientes_orfanos_tipo_cliente',
        `SELECT COUNT(*) AS n
         FROM \`${clientes.tClientes}\` c
         LEFT JOIN \`${tTiposClientes || 'tipos_clientes'}\` tc ON c.\`${colTipC}\` = tc.\`${tipcPk}\`
         WHERE c.\`${colTipC}\` IS NOT NULL AND c.\`${colTipC}\` != 0 AND tc.\`${tipcPk}\` IS NULL`
      );
      if (clientes.colEstadoCliente) {
        await runCount(
          'clientes_orfanos_estado_cliente',
          `SELECT COUNT(*) AS n
           FROM \`${clientes.tClientes}\` c
           LEFT JOIN \`${tEstadosClientes || 'estdoClientes'}\` ec ON c.\`${clientes.colEstadoCliente}\` = ec.estcli_id
           WHERE c.\`${clientes.colEstadoCliente}\` IS NOT NULL AND c.\`${clientes.colEstadoCliente}\` != 0 AND ec.estcli_id IS NULL`
        );
      }
      if (clientes.colComercial && comerciales?.table && comerciales?.pk) {
        await runCount(
          'clientes_orfanos_comercial',
          `SELECT COUNT(*) AS n
           FROM \`${clientes.tClientes}\` c
           LEFT JOIN \`${comerciales.table}\` co ON c.\`${clientes.colComercial}\` = co.\`${comerciales.pk}\`
           WHERE c.\`${clientes.colComercial}\` IS NOT NULL AND c.\`${clientes.colComercial}\` != 0 AND co.\`${comerciales.pk}\` IS NULL`
        );
      }
    }

    // pedidos -> clientes / comerciales
    if (pedidos?.tPedidos) {
      if (pedidos.colCliente && clientes?.tClientes) {
        await runCount(
          'pedidos_orfanos_cliente',
          `SELECT COUNT(*) AS n
           FROM \`${pedidos.tPedidos}\` p
           LEFT JOIN \`${clientes.tClientes}\` c ON p.\`${pedidos.colCliente}\` = c.\`${clientes.pk}\`
           WHERE p.\`${pedidos.colCliente}\` IS NOT NULL AND p.\`${pedidos.colCliente}\` != 0 AND c.\`${clientes.pk}\` IS NULL`
        );
      }
      if (pedidos.colComercial && comerciales?.table) {
        await runCount(
          'pedidos_orfanos_comercial',
          `SELECT COUNT(*) AS n
           FROM \`${pedidos.tPedidos}\` p
           LEFT JOIN \`${comerciales.table}\` co ON p.\`${pedidos.colComercial}\` = co.\`${comerciales.pk}\`
           WHERE p.\`${pedidos.colComercial}\` IS NOT NULL AND p.\`${pedidos.colComercial}\` != 0 AND co.\`${comerciales.pk}\` IS NULL`
        );
      }
    }

    // visitas -> clientes / comerciales
    if (visitas?.table) {
      if (visitas.colCliente && clientes?.tClientes) {
        await runCount(
          'visitas_orfanos_cliente',
          `SELECT COUNT(*) AS n
           FROM \`${visitas.table}\` v
           LEFT JOIN \`${clientes.tClientes}\` c ON v.\`${visitas.colCliente}\` = c.\`${clientes.pk}\`
           WHERE v.\`${visitas.colCliente}\` IS NOT NULL AND v.\`${visitas.colCliente}\` != 0 AND c.\`${clientes.pk}\` IS NULL`
        );
      }
      if (visitas.colComercial && comerciales?.table) {
        await runCount(
          'visitas_orfanos_comercial',
          `SELECT COUNT(*) AS n
           FROM \`${visitas.table}\` v
           LEFT JOIN \`${comerciales.table}\` co ON v.\`${visitas.colComercial}\` = co.\`${comerciales.pk}\`
           WHERE v.\`${visitas.colComercial}\` IS NOT NULL AND v.\`${visitas.colComercial}\` != 0 AND co.\`${comerciales.pk}\` IS NULL`
        );
      }
    }

    // pedidos_articulos -> pedidos (por NumPedido) / articulos
    if (pedArt?.table) {
      if (pedArt.colNumPedido && pedidos?.tPedidos && pedidos.colNumPedido) {
        await runCount(
          'pedidos_articulos_orfanos_pedido_num',
          `SELECT COUNT(*) AS n
           FROM \`${pedArt.table}\` pa
           LEFT JOIN \`${pedidos.tPedidos}\` p ON pa.\`${pedArt.colNumPedido}\` = p.\`${pedidos.colNumPedido}\`
           WHERE pa.\`${pedArt.colNumPedido}\` IS NOT NULL AND TRIM(CONCAT(pa.\`${pedArt.colNumPedido}\`,'')) != '' AND p.\`${pedidos.colNumPedido}\` IS NULL`
        );
      }
      if (pedArt.colArticulo && tArticulos) {
        await runCount(
          'pedidos_articulos_orfanos_articulo',
          `SELECT COUNT(*) AS n
           FROM \`${pedArt.table}\` pa
           LEFT JOIN \`${tArticulos}\` a ON pa.\`${pedArt.colArticulo}\` = a.art_id
           WHERE pa.\`${pedArt.colArticulo}\` IS NOT NULL AND pa.\`${pedArt.colArticulo}\` != 0 AND a.art_id IS NULL`
        );
      }
    }

    // clientes_contactos (M:N) -> clientes / agenda(contactos legacy)
    try {
      const tClientesContactos = await this._resolveTableNameCaseInsensitive('clientes_contactos').catch(() => null);
      if (tClientesContactos) {
        const ccCols = await this._getColumns(tClientesContactos).catch(() => []);
        if (ccCols && ccCols.length) {
          const colCliente = this._pickCIFromColumns(ccCols, ['clicont_cli_id', 'Id_Cliente', 'id_cliente', 'ClienteId', 'clienteId', 'cliente_id']);
          const colContacto = this._pickCIFromColumns(ccCols, ['clicont_ag_id', 'Id_Contacto', 'id_contacto', 'ContactoId', 'contactoId', 'contacto_id']);

          const tAgenda = await this._resolveAgendaTableName().catch(() => null);
          let agendaPk = 'Id';
          if (tAgenda) {
            const aCols = await this._getColumns(tAgenda).catch(() => []);
            agendaPk = this._pickCIFromColumns(aCols, ['ag_id', 'Id', 'id']) || 'ag_id';
          }

          if (colCliente && clientes?.tClientes) {
            await runCount(
              'clientes_contactos_orfanos_cliente',
              `SELECT COUNT(*) AS n
               FROM \`${tClientesContactos}\` cc
               LEFT JOIN \`${clientes.tClientes}\` c ON cc.\`${colCliente}\` = c.\`${clientes.pk}\`
               WHERE cc.\`${colCliente}\` IS NOT NULL AND cc.\`${colCliente}\` != 0 AND c.\`${clientes.pk}\` IS NULL`
            );
          }

          if (colContacto && tAgenda) {
            await runCount(
              'clientes_contactos_orfanos_agenda',
              `SELECT COUNT(*) AS n
               FROM \`${tClientesContactos}\` cc
               LEFT JOIN \`${tAgenda}\` a ON cc.\`${colContacto}\` = a.\`${agendaPk}\`
               WHERE cc.\`${colContacto}\` IS NOT NULL AND cc.\`${colContacto}\` != 0 AND a.\`${agendaPk}\` IS NULL`
            );
          }
        }
      }
    } catch (e) {
      add({ name: 'clientes_contactos_orfanos_check', ok: false, error: e?.message || String(e) });
    }

    return report;
  }

  // Resolver nombre real de tabla sin depender de information_schema (puede estar restringido en hosting).
  // Útil en MySQL/MariaDB sobre Linux donde los nombres pueden ser case-sensitive (p.ej. `Clientes` vs `clientes`).
  async _resolveTableNameCaseInsensitive(baseName) {
    this._cache = this._cache || {};
    const base = String(baseName || '').trim();
    if (!base) return baseName;

    const cacheKey = `tableName:${base}`;
    if (this._cache[cacheKey] !== undefined) return this._cache[cacheKey];

    const cap = base.charAt(0).toUpperCase() + base.slice(1);
    const upper = base.toUpperCase();
    const candidates = Array.from(new Set([base, cap, upper].filter(Boolean)));

    // Probar con SHOW COLUMNS (no requiere information_schema en muchos setups).
    for (const cand of candidates) {
      try {
        await this.query(`SHOW COLUMNS FROM \`${cand}\``);
        this._cache[cacheKey] = cand;
        return cand;
      } catch (_) {
        // seguir probando
      }
    }

    // Fallback: si SHOW COLUMNS está restringido pero SELECT está permitido, probar con SELECT LIMIT 0.
    for (const cand of candidates) {
      try {
        await this.queryWithFields(`SELECT * FROM \`${cand}\` LIMIT 0`);
        this._cache[cacheKey] = cand;
        return cand;
      } catch (_) {
        // seguir probando
      }
    }

    // Fallback: usar el nombre base tal cual.
    this._cache[cacheKey] = base;
    return base;
  }

  /**
   * Resolver la tabla `agenda` (nuevo nombre) con fallback a `contactos` (legacy).
   * Permite desplegar el cambio sin cortar servicio mientras se ejecuta el RENAME TABLE en la BD.
   */
  async _resolveAgendaTableName() {
    const tryResolveAndProbe = async (base) => {
      const t = await this._resolveTableNameCaseInsensitive(base);
      // Probar lectura mínima para detectar tabla inexistente / permisos.
      await this.query(`SELECT 1 FROM \`${t}\` LIMIT 1`);
      return t;
    };

    try {
      return await tryResolveAndProbe('agenda');
    } catch (_e) {
      return await tryResolveAndProbe('contactos');
    }
  }

  async _getFormasPagoTableName() {
    this._cache = this._cache || {};
    if (this._cache.formasPagoTableName !== undefined) return this._cache.formasPagoTableName;
    try {
      const rows = await this.query(
        `SELECT table_name AS name
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND LOWER(table_name) = 'formas_pago'
         ORDER BY (table_name = 'formas_pago') DESC, table_name ASC
         LIMIT 1`
      );
      const name = rows?.[0]?.name || null;
      this._cache.formasPagoTableName = name;
      return name;
    } catch (_) {
      this._cache.formasPagoTableName = null;
      return null;
    }
  }

  async ensureComercialesReunionesNullable() {
    // Ejecutar solo una vez por ciclo de vida (importante en serverless).
    if (this._schemaEnsured) return;
    this._schemaEnsured = true;

    try {
      if (!this.pool) return;
      const dbName = this.config.database;
      const columnas = [
        'teams_access_token',
        'teams_refresh_token',
        'teams_email',
        'teams_token_expires_at',
        'meet_access_token',
        'meet_refresh_token',
        'meet_email',
        'meet_token_expires_at'
      ];

      const placeholders = columnas.map(() => '?').join(', ');
      const [rows] = await this.pool.query(
        `
          SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ?
            AND TABLE_NAME = 'comerciales'
            AND COLUMN_NAME IN (${placeholders})
        `,
        [dbName, ...columnas]
      );

      if (!rows || rows.length === 0) return;

      const cambios = [];
      for (const r of rows) {
        if (r && r.IS_NULLABLE === 'NO' && r.COLUMN_NAME && r.COLUMN_TYPE) {
          // Mantener el tipo existente y solo cambiar a NULL.
          cambios.push(`MODIFY \`${r.COLUMN_NAME}\` ${r.COLUMN_TYPE} NULL`);
        }
      }

      if (cambios.length === 0) return;

      const sql = `ALTER TABLE \`comerciales\` ${cambios.join(', ')}`;
      await this.pool.query(sql);
      console.log(`✅ [SCHEMA] Columnas de reuniones en 'comerciales' ahora permiten NULL: ${cambios.length}`);
    } catch (error) {
      // No romper la app si no hay permisos de ALTER en producción.
      console.warn('⚠️ [SCHEMA] No se pudo asegurar NULL en campos de reuniones:', error.message);
    }
  }

  async connect() {
    // En entornos serverless (Vercel), este módulo puede vivir entre invocaciones.
    // Si ya estamos conectados, reutilizar el pool.
    if (this.pool && this.connected) {
      return true;
    }
    
    try {
      // Si existe un pool previo pero no está marcado como conectado (p.ej. fallo anterior),
      // cerrarlo para evitar quedar en un estado inconsistente.
      if (this.pool && !this.connected) {
        try {
          await this.pool.end();
        } catch (_) {
          // Ignorar errores al cerrar pool previo
        } finally {
          this.pool = null;
        }
      }

      this.pool = mysql.createPool(this.config);
      
      // Configurar UTF-8 para todas las conexiones
      const connection = await this.pool.getConnection();
      // Establecer UTF-8 explícitamente para esta conexión
      await connection.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
      await connection.query("SET CHARACTER SET utf8mb4");
      await connection.query("SET character_set_connection=utf8mb4");
      await connection.query("SET character_set_client=utf8mb4");
      await connection.query("SET character_set_results=utf8mb4");
      // Asegurar zona horaria Madrid/España para que NOW()/CURRENT_TIMESTAMP se graben en ese huso.
      // Si el servidor no tiene tablas de zona horaria cargadas, puede fallar; en ese caso lo dejamos en default.
      try {
        await connection.query("SET time_zone = 'Europe/Madrid'");
      } catch (tzErr) {
        console.warn('⚠️ [DB TZ] No se pudo establecer time_zone=Europe/Madrid. Usando zona horaria por defecto del servidor.', tzErr?.message || tzErr);
      }
      await connection.ping();
      connection.release();
      
      this.connected = true;
      console.log('✅ Conectado a MySQL correctamente');
      console.log(`📊 Base de datos: ${this.config.database}`);
      console.log(`🌐 Host: ${this.config.host}:${this.config.port}`);
      console.log('✅ UTF-8 configurado: utf8mb4_unicode_ci');

      // Asegurar compatibilidad de esquema (evita errores tipo "Column 'meet_email' cannot be null").
      await this.ensureComercialesReunionesNullable();
      // Índices recomendados para rendimiento del CRM (best-effort)
      // Schema/relaciones (best-effort)
      await this.ensureVisitasSchema();
      await this.ensureVisitasIndexes();
      // Catálogos (best-effort)
      await this.ensureEstadosVisitaCatalog();
      await this.ensureClientesIndexes();
      await this.ensurePedidosSchema();
      await this.ensurePedidosIndexes();
      await this.ensurePedidosArticulosIndexes();
      await this.ensureContactosIndexes();
      await this.ensureDireccionesEnvioIndexes();
      return true;
    } catch (error) {
      console.error('❌ Error conectando a MySQL:', error.message);
      console.error(`🔍 [DEBUG] Intentando conectar a: ${this.config.host}:${this.config.port}`);
      console.error(`🔍 [DEBUG] Base de datos: ${this.config.database}`);
      
      // Evitar quedar con un pool creado a medias si la conexión falló (muy importante en serverless)
      if (this.pool) {
        try {
          await this.pool.end();
        } catch (_) {
          // ignore
        } finally {
          this.pool = null;
          this.connected = false;
        }
      }
      throw error;
    }
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      this.connected = false;
      console.log('🔌 Desconectado de MySQL');
    }
  }

  // Método helper para ejecutar consultas
  async query(sql, params = []) {
    // En serverless es posible quedar con flags inconsistentes entre invocaciones.
    // Asegurar siempre que existe pool + estado conectado antes de pedir getConnection().
    if (!this.connected || !this.pool) {
      await this.connect();
    }
    
    try {
      // Obtener una conexión del pool
      const connection = await this.pool.getConnection();
      
      try {
        // Establecer UTF-8 para esta consulta específica
        await connection.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
        await connection.query("SET CHARACTER SET utf8mb4");
        await connection.query("SET character_set_connection=utf8mb4");
        await connection.query("SET character_set_client=utf8mb4");
        await connection.query("SET character_set_results=utf8mb4");
        // Zona horaria para esta sesión (Madrid/España)
        try {
          await connection.query("SET time_zone = 'Europe/Madrid'");
        } catch (_) {
          // no romper consultas si el servidor no lo soporta
        }
        
        // Sin parámetros usar query() (protocolo simple) para evitar "Incorrect arguments to mysqld_stmt_execute" con execute()
        const hasParams = Array.isArray(params) && params.length > 0;
        const result = await Promise.race([
          hasParams ? connection.execute(sql, params) : connection.query(sql),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout en consulta SQL después de 15 segundos: ${sql.substring(0, 100)}...`)), 15000)
          )
        ]);

        // Para UPDATE, INSERT, DELETE, execute/query devuelve [rows, fields]
        // Para SELECT, rows contiene los resultados
        // Para UPDATE/INSERT/DELETE, necesitamos el ResultSetHeader que está en result[0]
        // pero execute devuelve [rows, fields] donde rows es el ResultSetHeader para UPDATE
        const [rows, fields] = result;
        
        // Si es un UPDATE/INSERT/DELETE, devolver el ResultSetHeader completo
        // Si es un SELECT, devolver solo los rows
        if (sql.trim().toUpperCase().startsWith('UPDATE') || 
            sql.trim().toUpperCase().startsWith('INSERT') || 
            sql.trim().toUpperCase().startsWith('DELETE')) {
          return rows; // rows es el ResultSetHeader para UPDATE/INSERT/DELETE
        }
        
        return rows; // Para SELECT, rows contiene los resultados
      } finally {
        // Liberar la conexión de vuelta al pool
        connection.release();
      }
    } catch (error) {
      console.error('❌ Error en consulta SQL:', error.message);
      console.error('SQL:', sql);
      console.error('Params:', params);
      throw error;
    }
  }

  // Igual que query(), pero también devuelve metadata de campos.
  // Útil cuando SHOW COLUMNS está restringido pero SELECT está permitido.
  async queryWithFields(sql, params = []) {
    if (!this.connected || !this.pool) {
      await this.connect();
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
      await connection.query("SET CHARACTER SET utf8mb4");
      await connection.query("SET character_set_connection=utf8mb4");
      await connection.query("SET character_set_client=utf8mb4");
      await connection.query("SET character_set_results=utf8mb4");
      try {
        await connection.query("SET time_zone = 'Europe/Madrid'");
      } catch (_) {
        // ignore
      }

      const result = await Promise.race([
        connection.execute(sql, params),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout en consulta SQL después de 15 segundos: ${sql.substring(0, 100)}...`)), 15000)
        )
      ]);
      const [rows, fields] = result;
      return { rows, fields };
    } finally {
      connection.release();
    }
  }

  // COMERCIALES (delegado a domains/comerciales.js)
  async getComerciales() {
    return domains.comerciales.getComerciales.apply(this, arguments);
  }
  async getComercialByEmail(email) {
    return domains.comerciales.getComercialByEmail.apply(this, arguments);
  }
  async getComercialById(id) {
    return domains.comerciales.getComercialById.apply(this, arguments);
  }
  /**
   * Obtiene el ID del comercial a partir del texto "Comercial asignado":
   * formato "Nombre · Email" (ej. "Farmadescanso 2021 SL · pedidos@farmadescanso.com").
   * Extrae el email (parte tras " · ") y busca el comercial por email.
   * @param {string} displayStr - Texto en formato "Nombre · Email" o solo email
   * @returns {Promise<number|null>} - id del comercial o null
   */
  async getComercialIdFromDisplayString(displayStr) {
    return domains.comerciales.getComercialIdFromDisplayString.apply(this, arguments);
  }
  /**
   * Obtiene el ID del comercial "pool" (ej. Paco Lara) por nombre.
   * Nombre configurable con COMERCIAL_POOL_NAME (default "Paco Lara").
   */
  async getComercialIdPool() {
    return domains.comerciales.getComercialIdPool.apply(this, arguments);
  }
  async createComercial(payload) {
    return domains.comerciales.createComercial.apply(this, arguments);
  }
  async updateComercial(id, payload) {
    return domains.comerciales.updateComercial.apply(this, arguments);
  }
  async deleteComercial(id) {
    return domains.comerciales.deleteComercial.apply(this, arguments);
  }

  // ARTÍCULOS (delegado a domains/articulos.js)
  async getArticulos(options = {}) {
    return domains.articulos.getArticulos.apply(this, arguments);
  }
  async getArticuloById(id) {
    return domains.articulos.getArticuloById.apply(this, arguments);
  }
  async getArticulosByCategoria(categoria) {
    return domains.articulos.getArticulosByCategoria.apply(this, arguments);
  }
  async updateArticulo(id, payload) {
    return domains.articulos.updateArticulo.apply(this, arguments);
  }
  async createArticulo(payload) {
    return domains.articulos.createArticulo.apply(this, arguments);
  }
  async deleteArticulo(id) {
    return domains.articulos.deleteArticulo.apply(this, arguments);
  }
  async toggleArticuloOkKo(id, value) {
    try {
      // Convertir valor a 1 (activo) o 0 (inactivo)
      // value puede ser: 'Activo'/'Inactivo', 'OK'/'KO', true/false, 1/0
      let activoValue = 1; // Por defecto activo
      
      if (typeof value === 'string') {
        const valLower = value.toLowerCase();
        activoValue = (valLower === 'activo' || valLower === 'ok' || valLower === 'true' || valLower === '1') ? 1 : 0;
      } else if (typeof value === 'boolean') {
        activoValue = value ? 1 : 0;
      } else if (typeof value === 'number') {
        activoValue = value ? 1 : 0;
      }
      
      const tArt = await this._resolveTableNameCaseInsensitive('articulos');
      const aCols = await this._getColumns(tArt).catch(() => []);
      const aPk = this._pickCIFromColumns(aCols, ['art_id', 'id', 'Id']) || 'art_id';
      const colActivo = this._pickCIFromColumns(aCols, ['art_activo', 'Activo', 'activo']) || 'art_activo';
      const sql = `UPDATE \`${tArt}\` SET \`${colActivo}\` = ? WHERE \`${aPk}\` = ?`;
      await this.query(sql, [activoValue, id]);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando Activo de artículo:', error.message);
      throw error;
    }
  }

  // CLIENTES (parcialmente delegado a domains/clientes.js)
  async getClientes(comercialId = null) {
    return domains.clientes.getClientes.apply(this, arguments);
  }

  async getClientesOptimizado(filters = {}) {
    return domains.clientes.getClientesOptimizado.apply(this, arguments);
  }

  async getClientesOptimizadoPaged(filters = {}, options = {}) {
    return domains.clientes.getClientesOptimizadoPaged.apply(this, arguments);
  }

  /**
   * Conteo para paginación con los mismos filtros que getClientesOptimizadoPaged.
   */
  async countClientesOptimizado(filters = {}) {
    return domains.clientes.countClientesOptimizado.apply(this, arguments);
  }

  async getClientesCount() {
    return domains.clientes.getClientesCount.apply(this, arguments);
  }
  async getClientesEstadisticas() {
    return domains.clientes.getClientesEstadisticas.apply(this, arguments);
  }
  async getClienteById(id) {
    return domains.clientes.getClienteById.apply(this, arguments);
  }
  async canComercialEditCliente(clienteId, userId) {
    return domains.clientes.canComercialEditCliente.apply(this, arguments);
  }
  async isContactoAsignadoAPoolOSinAsignar(clienteId) {
    return domains.clientes.isContactoAsignadoAPoolOSinAsignar.apply(this, arguments);
  }
  async findPosiblesDuplicadosClientes({ dniCif, nombre, nombreCial } = {}, { limit = 6, userId = null, isAdmin = false } = {}) {
    return domains.clientes.findPosiblesDuplicadosClientes.apply(this, arguments);
  }
  async getClientesByComercial(comercialId) {
    return domains.clientes.getClientesByComercial.apply(this, arguments);
  }
  async getClientesByCodigoPostal(idCodigoPostal) {
    return domains.clientes.getClientesByCodigoPostal.apply(this, arguments);
  }

  // ---------- Notificaciones (solicitudes de asignación de contactos) ----------
  async _ensureNotificacionesTable() {
    try {
      await this.query(`
        CREATE TABLE IF NOT EXISTS \`notificaciones\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`tipo\` VARCHAR(64) NOT NULL DEFAULT 'asignacion_contacto',
          \`id_contacto\` INT NOT NULL,
          \`id_pedido\` INT NULL,
          \`id_comercial_solicitante\` INT NOT NULL,
          \`estado\` ENUM('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'pendiente',
          \`id_admin_resolvio\` INT NULL,
          \`fecha_creacion\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`fecha_resolucion\` DATETIME NULL,
          \`notas\` VARCHAR(500) NULL,
          PRIMARY KEY (\`id\`),
          KEY \`idx_notif_estado\` (\`estado\`),
          KEY \`idx_notif_contacto\` (\`id_contacto\`),
          KEY \`idx_notif_pedido\` (\`id_pedido\`),
          KEY \`idx_notif_comercial\` (\`id_comercial_solicitante\`),
          KEY \`idx_notif_tipo_estado\` (\`tipo\`, \`estado\`, \`fecha_creacion\`),
          KEY \`idx_notif_fecha_creacion\` (\`fecha_creacion\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // Si la tabla existía sin la columna id_pedido/índices, intentar añadirlos (best-effort).
      try {
        const cols = await this._getColumns('notificaciones').catch(() => []);
        const colsLower = new Set((cols || []).map((c) => String(c).toLowerCase()));
        if (!colsLower.has('id_pedido')) {
          try { await this.query('ALTER TABLE `notificaciones` ADD COLUMN `id_pedido` INT NULL'); } catch (_) {}
        }
        // Índices: ignorar errores si ya existen.
        try { await this.query('ALTER TABLE `notificaciones` ADD KEY `idx_notif_pedido` (`id_pedido`)'); } catch (_) {}
        try { await this.query('ALTER TABLE `notificaciones` ADD KEY `idx_notif_tipo_estado` (`tipo`, `estado`, `fecha_creacion`)'); } catch (_) {}
      } catch (_) {}
      return true;
    } catch (e) {
      console.warn('⚠️ [NOTIF] No se pudo crear tabla notificaciones:', e?.message);
      return false;
    }
  }

  async createSolicitudAsignacion(idContacto, idComercialSolicitante) {
    await this._ensureNotificacionesTable();
    try {
      const r = await this.query(
        'INSERT INTO `notificaciones` (tipo, id_contacto, id_pedido, id_comercial_solicitante, estado) VALUES (?, ?, ?, ?, ?)',
        ['asignacion_contacto', idContacto, null, idComercialSolicitante, 'pendiente']
      );
      return r?.insertId ?? r?.affectedRows ?? null;
    } catch (_e) {
      // Compat si no hay permisos para ALTER y falta id_pedido
      const r = await this.query(
        'INSERT INTO `notificaciones` (tipo, id_contacto, id_comercial_solicitante, estado) VALUES (?, ?, ?, ?)',
        ['asignacion_contacto', idContacto, idComercialSolicitante, 'pendiente']
      );
      return r?.insertId ?? r?.affectedRows ?? null;
    }
  }

  async getNotificacionesPendientesCount() {
    try {
      await this._ensureNotificacionesTable();
      const rows = await this.query('SELECT COUNT(*) AS n FROM `notificaciones` WHERE estado = \'pendiente\'');
      if (!rows) return 0;
      const first = Array.isArray(rows) ? rows[0] : rows;
      const n = first?.n ?? first?.N ?? (Array.isArray(first) ? first[0] : 0);
      return Number(n ?? 0);
    } catch (_) {
      return 0;
    }
  }

  /**
   * Obtiene nombres de comerciales por lista de IDs. Devuelve Map(id -> nombre).
   */
  async _getComercialesNombresByIds(ids) {
    const map = {};
    if (!ids || ids.length === 0) return map;
    const uniq = [...new Set(ids.filter((id) => id != null && id !== ''))];
    if (uniq.length === 0) return map;
    try {
      const meta = await this._ensureComercialesMeta();
      const placeholders = uniq.map(() => '?').join(',');
      const sql = `SELECT \`${meta.pk}\` AS id, \`${meta.colNombre || 'com_nombre'}\` AS nombre FROM \`${meta.table}\` WHERE \`${meta.pk}\` IN (${placeholders})`;
      const rows = await this.query(sql, uniq);
      const list = Array.isArray(rows) ? rows : [];
      list.forEach((r) => {
        const id = r.id ?? r.Id;
        const nombre = r.nombre ?? r.Nombre ?? '';
        if (id != null) map[Number(id)] = nombre;
      });
    } catch (e) {
      console.warn('⚠️ [NOTIF] No se pudieron cargar nombres de comerciales:', e?.message);
    }
    return map;
  }

  /**
   * Obtiene Nº de pedido (colNumPedido) por lista de IDs. Devuelve Map(id -> NumPedido).
   */
  async _getPedidosNumsByIds(ids) {
    const map = {};
    if (!ids || ids.length === 0) return map;
    const uniq = [...new Set(ids.filter((id) => id != null && id !== ''))]
      .map((x) => Number.parseInt(String(x).trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (uniq.length === 0) return map;
    try {
      const meta = await this._ensurePedidosMeta().catch(() => null);
      if (!meta?.tPedidos) return map;
      const cols = await this._getColumns(meta.tPedidos).catch(() => []);
      const pick = (cands) => this._pickCIFromColumns(cols, cands);
      const pk = meta.pk || pick(['Id', 'id']) || 'Id';
      const colNum = meta.colNumPedido || pick(['NumPedido', 'NumeroPedido', 'Numero_Pedido', 'num_pedido']);
      if (!colNum) return map;
      const placeholders = uniq.map(() => '?').join(',');
      const sql = `SELECT \`${pk}\` AS id, \`${colNum}\` AS num FROM \`${meta.tPedidos}\` WHERE \`${pk}\` IN (${placeholders})`;
      const rows = await this.query(sql, uniq);
      const list = Array.isArray(rows) ? rows : [];
      list.forEach((r) => {
        const id = Number(r.id ?? r.Id);
        const num = r.num ?? r.NumPedido ?? r.NumeroPedido ?? null;
        if (Number.isFinite(id)) map[id] = (num != null ? String(num).trim() : null);
      });
    } catch (e) {
      console.warn('⚠️ [NOTIF] No se pudieron cargar nº de pedido:', e?.message);
    }
    return map;
  }

  async getNotificaciones(limit = 50, offset = 0) {
    const l = Math.max(1, Math.min(100, Number(limit)));
    const o = Math.max(0, Number(offset));
    await this._ensureNotificacionesTable();
    try {
      const cols = await this._getColumns('notificaciones').catch(() => []);
      const colsLower = new Set((cols || []).map((c) => String(c).toLowerCase()));
      const hasPedido = colsLower.has('id_pedido');
      const sql = `SELECT id, tipo, id_contacto, ${hasPedido ? 'id_pedido' : 'NULL AS id_pedido'}, id_comercial_solicitante, estado, id_admin_resolvio, fecha_creacion, fecha_resolucion, notas FROM \`notificaciones\` ORDER BY fecha_creacion DESC LIMIT ${l} OFFSET ${o}`;
      const rows = await this.query(sql);
      const list = Array.isArray(rows) ? rows : (rows && typeof rows === 'object' && !rows.insertId ? [rows] : []);
      const items = list.map((n) => ({
        id: n.id,
        tipo: n.tipo,
        id_contacto: n.id_contacto,
        id_pedido: n.id_pedido ?? null,
        pedido_num: null,
        id_comercial_solicitante: n.id_comercial_solicitante,
        estado: n.estado,
        id_admin_resolvio: n.id_admin_resolvio,
        fecha_creacion: n.fecha_creacion,
        fecha_resolucion: n.fecha_resolucion,
        notas: n.notas,
        contacto_nombre: null,
        comercial_nombre: null
      }));
      if (items.length === 0) return items;
      const contactIds = items.map((x) => x.id_contacto).filter(Boolean);
      const comercialIds = items.map((x) => x.id_comercial_solicitante).filter(Boolean);
      const pedidoIds = items
        .map((x) => x.id_pedido)
        .filter(Boolean)
        .map((v) => Number.parseInt(String(v).trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);

      const [nombresContactos, nombresComerciales, numsPedido] = await Promise.all([
        this._getClientesNombresByIds(contactIds),
        this._getComercialesNombresByIds(comercialIds),
        this._getPedidosNumsByIds(pedidoIds)
      ]);
      items.forEach((n) => {
        n.contacto_nombre = nombresContactos[Number(n.id_contacto)] ?? null;
        n.comercial_nombre = nombresComerciales[Number(n.id_comercial_solicitante)] ?? null;
        const pid = Number.parseInt(String(n.id_pedido ?? '').trim(), 10);
        n.pedido_num = Number.isFinite(pid) && pid > 0 ? (numsPedido[pid] ?? null) : null;
      });
      return items;
    } catch (e) {
      console.error('❌ Error listando notificaciones:', e?.message);
      return [];
    }
  }

  async getNotificacionesForComercial(idComercial, limit = 50, offset = 0) {
    const cid = Number.parseInt(String(idComercial ?? '').trim(), 10);
    if (!Number.isFinite(cid) || cid <= 0) return [];
    const l = Math.max(1, Math.min(100, Number(limit)));
    const o = Math.max(0, Number(offset));
    await this._ensureNotificacionesTable();
    try {
      const cols = await this._getColumns('notificaciones').catch(() => []);
      const colsLower = new Set((cols || []).map((c) => String(c).toLowerCase()));
      const hasPedido = colsLower.has('id_pedido');
      const sql = `SELECT id, tipo, id_contacto, ${hasPedido ? 'id_pedido' : 'NULL AS id_pedido'}, id_comercial_solicitante, estado, id_admin_resolvio, fecha_creacion, fecha_resolucion, notas
        FROM \`notificaciones\`
        WHERE id_comercial_solicitante = ?
        ORDER BY fecha_creacion DESC
        LIMIT ${l} OFFSET ${o}`;
      const rows = await this.query(sql, [cid]);
      const list = Array.isArray(rows) ? rows : [];
      const items = list.map((n) => ({
        id: n.id,
        tipo: n.tipo,
        id_contacto: n.id_contacto,
        id_pedido: n.id_pedido ?? null,
        pedido_num: null,
        id_comercial_solicitante: n.id_comercial_solicitante,
        estado: n.estado,
        id_admin_resolvio: n.id_admin_resolvio,
        fecha_creacion: n.fecha_creacion,
        fecha_resolucion: n.fecha_resolucion,
        notas: n.notas,
        contacto_nombre: null,
        comercial_nombre: null
      }));
      if (!items.length) return items;
      const contactIds = items.map((x) => x.id_contacto).filter(Boolean);
      const pedidoIds = items
        .map((x) => x.id_pedido)
        .filter(Boolean)
        .map((v) => Number.parseInt(String(v).trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      const [nombresContactos, numsPedido] = await Promise.all([
        this._getClientesNombresByIds(contactIds),
        this._getPedidosNumsByIds(pedidoIds)
      ]);
      items.forEach((n) => {
        n.contacto_nombre = nombresContactos[Number(n.id_contacto)] ?? null;
        const pid = Number.parseInt(String(n.id_pedido ?? '').trim(), 10);
        n.pedido_num = Number.isFinite(pid) && pid > 0 ? (numsPedido[pid] ?? null) : null;
      });
      return items;
    } catch (e) {
      console.error('❌ Error listando notificaciones comercial:', e?.message);
      return [];
    }
  }

  async getNotificacionesForComercialCount(idComercial) {
    const cid = Number.parseInt(String(idComercial ?? '').trim(), 10);
    if (!Number.isFinite(cid) || cid <= 0) return 0;
    await this._ensureNotificacionesTable();
    try {
      const rows = await this.query('SELECT COUNT(*) AS n FROM `notificaciones` WHERE id_comercial_solicitante = ?', [cid]);
      const first = Array.isArray(rows) ? rows[0] : rows;
      return Number(first?.n ?? 0) || 0;
    } catch (_) {
      return 0;
    }
  }

  async resolverSolicitudAsignacion(idNotif, idAdmin, aprobar) {
    await this._ensureNotificacionesTable();
    const rows = await this.query('SELECT * FROM `notificaciones` WHERE id = ? AND estado = ?', [idNotif, 'pendiente']);
    if (!rows?.length) return { ok: false, message: 'Notificación no encontrada o ya resuelta' };
    const notif = rows[0];
    const ahora = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await this.query(
      'UPDATE `notificaciones` SET estado = ?, id_admin_resolvio = ?, fecha_resolucion = ? WHERE id = ?',
      [aprobar ? 'aprobada' : 'rechazada', idAdmin, ahora, idNotif]
    );
    if (String(notif.tipo || '').toLowerCase() === 'pedido_especial') {
      // Resolver pedido especial: marcar en pedidos como aprobado/rechazado y dejar trazabilidad.
      let resolvedPid = null;
      let resolvedPedidoNum = null;
      let resolvedClienteNombre = null;
      let resolvedComercialEmail = null;
      try {
        await this.ensurePedidosSchema();
        const meta = await this._ensurePedidosMeta();
        const cols = await this._getColumns(meta.tPedidos).catch(() => []);
        const pick = (cands) => this._pickCIFromColumns(cols, cands);
        const pk = meta.pk;
        const colEsEspecial = pick(['EsEspecial', 'es_especial', 'PedidoEspecial', 'pedido_especial']);
        const colEstado = pick(['EspecialEstado', 'especial_estado', 'EstadoEspecial', 'estado_especial']);
        const colEstadoTxtPedido = meta.colEstado || pick(['EstadoPedido', 'estado_pedido', 'Estado', 'estado']);
        const colEstadoIdPedido = meta.colEstadoId || pick(['Id_EstadoPedido', 'id_estado_pedido', 'EstadoPedidoId', 'estado_pedido_id']);
        const colFechaRes = pick(['EspecialFechaResolucion', 'especial_fecha_resolucion', 'FechaResolucionEspecial', 'fecha_resolucion_especial']);
        const colIdAdmin = pick(['EspecialIdAdminResolvio', 'especial_id_admin_resolvio', 'IdAdminResolvioEspecial', 'id_admin_resolvio_especial']);
        const colNotas = pick(['EspecialNotas', 'especial_notas', 'NotasEspecial', 'notas_especial']);
        const colNumPedido = meta.colNumPedido || pick(['NumPedido', 'NumeroPedido', 'Numero_Pedido', 'num_pedido']);
        let pid = Number.parseInt(String(notif.id_pedido ?? '').trim(), 10);
        if (!Number.isFinite(pid) || pid <= 0) {
          const m = String(notif.notas || '').match(/pedidoId\s*=\s*(\d+)/i);
          if (m && m[1]) pid = Number.parseInt(m[1], 10);
        }
        if (Number.isFinite(pid) && pid > 0) {
          resolvedPid = pid;
          const upd = {};
          if (colEsEspecial) upd[colEsEspecial] = 1;
          if (colEstado) upd[colEstado] = aprobar ? 'aprobado' : 'rechazado';
          if (colFechaRes) upd[colFechaRes] = ahora;
          if (colIdAdmin) upd[colIdAdmin] = idAdmin;
          if (colNotas) upd[colNotas] = `Resuelto ${aprobar ? 'APROBADO' : 'RECHAZADO'} (notif #${notif.id})`;
          // Requisito: si se deniega un pedido especial, el estado del pedido debe quedar "Denegado" (rojo).
          if (!aprobar) {
            if (colEstadoTxtPedido) upd[colEstadoTxtPedido] = 'Denegado';
            if (colEstadoIdPedido) {
              const denId = await this.getEstadoPedidoIdByCodigo('denegado').catch(() => null);
              if (denId) upd[colEstadoIdPedido] = denId;
            }
          }
          const keys = Object.keys(upd);
          if (keys.length) {
            const fields = keys.map((c) => `\`${c}\` = ?`).join(', ');
            const values = keys.map((c) => upd[c]);
            values.push(pid);
            await this.query(`UPDATE \`${meta.tPedidos}\` SET ${fields} WHERE \`${pk}\` = ?`, values);
          }

          // Obtener NumPedido para mostrar/notificar
          try {
            if (colNumPedido) {
              const rowsP = await this.query(
                `SELECT \`${colNumPedido}\` AS num FROM \`${meta.tPedidos}\` WHERE \`${pk}\` = ? LIMIT 1`,
                [pid]
              );
              const rowP = Array.isArray(rowsP) && rowsP.length ? rowsP[0] : null;
              resolvedPedidoNum = rowP?.num != null ? String(rowP.num).trim() : null;
            }
          } catch (_) {}
        }
      } catch (_) {}
      // Enriquecer para que la capa HTTP pueda notificar (email/in-app)
      try {
        const clienteId = Number.parseInt(String(notif.id_contacto ?? '').trim(), 10);
        if (Number.isFinite(clienteId) && clienteId > 0) {
          const nombres = await this._getClientesNombresByIds([clienteId]).catch(() => ({}));
          resolvedClienteNombre = nombres[clienteId] ?? null;
        }
      } catch (_) {}
      try {
        const cid = Number.parseInt(String(notif.id_comercial_solicitante ?? '').trim(), 10);
        if (Number.isFinite(cid) && cid > 0) {
          const com = await this.getComercialById(cid).catch(() => null);
          resolvedComercialEmail = com?.Email ?? com?.email ?? null;
        }
      } catch (_) {}

      return {
        ok: true,
        tipo: 'pedido_especial',
        decision: aprobar ? 'aprobada' : 'rechazada',
        id_pedido: resolvedPid,
        num_pedido: resolvedPedidoNum,
        cliente_nombre: resolvedClienteNombre,
        comercial_email: resolvedComercialEmail,
        id_comercial_solicitante: notif.id_comercial_solicitante
      };
    }

    if (aprobar) {
      const { tClientes, pk, colComercial } = await this._ensureClientesMeta();
      if (colComercial && tClientes) {
        await this.query(`UPDATE \`${tClientes}\` SET \`${colComercial}\` = ? WHERE \`${pk}\` = ?`, [notif.id_comercial_solicitante, notif.id_contacto]);
      }
    }
    return { ok: true };
  }

  async moverClienteAPapelera(clienteId, eliminadoPor) {
    return domains.clientes.moverClienteAPapelera.apply(this, arguments);
  }

  async updateCliente(id, payload) {
    return domains.clientesCrud.updateCliente.apply(this, arguments);
  }

  async createCliente(payload) {
    return domains.clientesCrud.createCliente.apply(this, arguments);
  }

  async toggleClienteOkKo(id, value) {
    return domains.clientes.toggleClienteOkKo.apply(this, arguments);
  }

  // COOPERATIVAS
  async getCooperativas() {
    try {
      // En algunos entornos (MariaDB/Linux) la PK puede ser `id` en lugar de `Id`.
      try {
        const rows = await this.query('SELECT * FROM cooperativas ORDER BY Id ASC');
        return rows;
      } catch (e1) {
        const rows = await this.query('SELECT * FROM cooperativas ORDER BY id ASC');
        return rows;
      }
    } catch (error) {
      console.error('❌ Error obteniendo cooperativas:', error.message);
      return [];
    }
  }

  async getCooperativaById(id) {
    try {
      try {
        const rows = await this.query('SELECT * FROM cooperativas WHERE Id = ? LIMIT 1', [id]);
        return rows.length > 0 ? rows[0] : null;
      } catch (e1) {
        const rows = await this.query('SELECT * FROM cooperativas WHERE id = ? LIMIT 1', [id]);
        return rows.length > 0 ? rows[0] : null;
      }
    } catch (error) {
      console.error('❌ Error obteniendo cooperativa por ID:', error.message);
      return null;
    }
  }

  // ============================================================
  // GRUPOS DE COMPRAS (CRUD + relación con clientes)
  // ============================================================

  async getGruposCompras() {
    try {
      const t = await this._resolveTableNameCaseInsensitive('gruposCompras');
      const rows = await this.query(`SELECT * FROM \`${t}\` ORDER BY id ASC`).catch(async () => {
        // fallback por si la PK está como Id en algún entorno
        return await this.query(`SELECT * FROM \`${t}\` ORDER BY Id ASC`);
      });
      return rows || [];
    } catch (error) {
      console.error('❌ Error obteniendo gruposCompras:', error.message);
      return [];
    }
  }

  async getGrupoComprasById(id) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('gruposCompras');
      try {
        const rows = await this.query(`SELECT * FROM \`${t}\` WHERE id = ? LIMIT 1`, [id]);
        return rows?.[0] || null;
      } catch (_) {
        const rows = await this.query(`SELECT * FROM \`${t}\` WHERE Id = ? LIMIT 1`, [id]);
        return rows?.[0] || null;
      }
    } catch (error) {
      console.error('❌ Error obteniendo grupoCompras por ID:', error.message);
      return null;
    }
  }

  async createGrupoCompras(payload) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('gruposCompras');
      const fields = Object.keys(payload).map(k => `\`${k}\``).join(', ');
      const placeholders = Object.keys(payload).map(() => '?').join(', ');
      const values = Object.values(payload);
      const sql = `INSERT INTO \`${t}\` (${fields}) VALUES (${placeholders})`;
      const result = await this.query(sql, values);
      return { insertId: result.insertId || result.insertId };
    } catch (error) {
      console.error('❌ Error creando grupoCompras:', error.message);
      throw error;
    }
  }

  async updateGrupoCompras(id, payload) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('gruposCompras');
      const fields = Object.keys(payload).map(k => `\`${k}\` = ?`).join(', ');
      const values = Object.values(payload);
      values.push(id);
      const sql = `UPDATE \`${t}\` SET ${fields} WHERE id = ?`;
      try {
        await this.query(sql, values);
      } catch (_) {
        const sql2 = `UPDATE \`${t}\` SET ${fields} WHERE Id = ?`;
        await this.query(sql2, values);
      }
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando grupoCompras:', error.message);
      throw error;
    }
  }

  async deleteGrupoCompras(id) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('gruposCompras');
      try {
        await this.query(`DELETE FROM \`${t}\` WHERE id = ?`, [id]);
      } catch (_) {
        await this.query(`DELETE FROM \`${t}\` WHERE Id = ?`, [id]);
      }
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error eliminando grupoCompras:', error.message);
      throw error;
    }
  }

  async createCooperativa(nombre, extra = {}) {
    try {
      const payload = { Nombre: nombre, ...extra };
      const fields = Object.keys(payload).map(key => `\`${key}\``).join(', ');
      const placeholders = Object.keys(payload).map(() => '?').join(', ');
      const values = Object.values(payload);
      
      const sql = `INSERT INTO cooperativas (${fields}) VALUES (${placeholders})`;
      const result = await this.query(sql, values);
      return { insertId: result.insertId || result.insertId };
    } catch (error) {
      console.error('❌ Error creando cooperativa:', error.message);
      throw error;
    }
  }

  async updateCooperativa(id, payload) {
    try {
      const fields = Object.keys(payload).map(key => `\`${key}\` = ?`).join(', ');
      const values = Object.values(payload);
      values.push(id);
      
      try {
        const sql = `UPDATE cooperativas SET ${fields} WHERE Id = ?`;
        await this.query(sql, values);
      } catch (e1) {
        const sql = `UPDATE cooperativas SET ${fields} WHERE id = ?`;
        await this.query(sql, values);
      }
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando cooperativa:', error.message);
      throw error;
    }
  }

  async deleteCooperativa(id) {
    try {
      try {
        await this.query('DELETE FROM cooperativas WHERE Id = ?', [id]);
      } catch (e1) {
        await this.query('DELETE FROM cooperativas WHERE id = ?', [id]);
      }
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error eliminando cooperativa:', error.message);
      throw error;
    }
  }

  // FORMAS_PAGO
  async getFormasPago() {
    try {
      const table = await this._getFormasPagoTableName();
      if (!table) {
        console.warn('⚠️ [FORMAS-PAGO] La tabla de formas de pago no existe (formas_pago/Formas_Pago).');
        return [];
      }

      let rows = [];
      try {
        rows = await this.query(`SELECT * FROM ${table} ORDER BY id ASC`);
      } catch (e1) {
        // Algunas instalaciones pueden usar Id en vez de id
        rows = await this.query(`SELECT * FROM ${table} ORDER BY Id ASC`).catch(() => []);
      }
      // Normalizar etiqueta para vistas (cliente-editar usa "Nombre" en algunos sitios)
      return (rows || []).map(r => ({
        ...r,
        id: r?.id ?? r?.Id ?? r?.ID ?? null,
        Nombre: r?.Nombre ?? r?.FormaPago ?? r?.formaPago ?? r?.nombre ?? null
      }));
    } catch (error) {
      console.error('❌ Error obteniendo formas de pago:', error.message);
      return [];
    }
  }

  async getFormaPagoById(id) {
    try {
      const table = await this._getFormasPagoTableName();
      if (!table) return null;
      let rows;
      try {
        rows = await this.query(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`, [id]);
      } catch (e1) {
        rows = await this.query(`SELECT * FROM ${table} WHERE Id = ? LIMIT 1`, [id]);
      }
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo forma de pago por ID:', error.message);
      return null;
    }
  }

  async getFormaPagoByNombre(nombre) {
    try {
      const table = await this._getFormasPagoTableName();
      if (!table) return null;
      const sql = `SELECT * FROM ${table} WHERE FormaPago = ? OR FormaPago LIKE ? LIMIT 1`;
      const nombreExacto = nombre.trim();
      const nombreLike = `%${nombreExacto}%`;
      const rows = await this.query(sql, [nombreExacto, nombreLike]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo forma de pago por nombre:', error.message);
      return null;
    }
  }

  async createFormaPago(payload) {
    try {
      const table = await this._getFormasPagoTableName();
      if (!table) throw new Error('La tabla de formas de pago no existe (formas_pago/Formas_Pago).');
      const fields = Object.keys(payload).map(key => `\`${key}\``).join(', ');
      const placeholders = Object.keys(payload).map(() => '?').join(', ');
      const values = Object.values(payload);
      
      const sql = `INSERT INTO ${table} (${fields}) VALUES (${placeholders})`;
      const result = await this.query(sql, values);
      return { insertId: result.insertId || result.insertId };
    } catch (error) {
      console.error('❌ Error creando forma de pago:', error.message);
      throw error;
    }
  }

  async updateFormaPago(id, payload) {
    try {
      const table = await this._getFormasPagoTableName();
      if (!table) throw new Error('La tabla de formas de pago no existe (formas_pago/Formas_Pago).');
      const fields = Object.keys(payload).map(key => `\`${key}\` = ?`).join(', ');
      const values = Object.values(payload);
      values.push(id);
      
      try {
        const sql = `UPDATE ${table} SET ${fields} WHERE id = ?`;
        await this.query(sql, values);
      } catch (e1) {
        const sql = `UPDATE ${table} SET ${fields} WHERE Id = ?`;
        await this.query(sql, values);
      }
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando forma de pago:', error.message);
      throw error;
    }
  }

  async deleteFormaPago(id) {
    try {
      const table = await this._getFormasPagoTableName();
      if (!table) throw new Error('La tabla de formas de pago no existe (formas_pago/Formas_Pago).');
      try {
        await this.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
      } catch (e1) {
        await this.query(`DELETE FROM ${table} WHERE Id = ?`, [id]);
      }
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error eliminando forma de pago:', error.message);
      throw error;
    }
  }

  async getTiposPedido() {
    try {
      const table = await this._resolveTableNameCaseInsensitive('tipos_pedidos').catch(() => null)
        || await this._resolveTableNameCaseInsensitive('tipos_pedido').catch(() => null);
      if (!table) return [];
      const cols = await this._getColumns(table).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['id', 'Id']) || 'id';
      const colNombre = this._pickCIFromColumns(cols, ['Tipo', 'tipo', 'Nombre', 'nombre']) || 'Tipo';
      let rows = [];
      try {
        rows = await this.query(`SELECT * FROM \`${table}\` ORDER BY \`${pk}\` ASC`);
      } catch (e1) {
        rows = await this.query(`SELECT * FROM \`${table}\` ORDER BY Id ASC`).catch(() => []);
      }
      return (rows || []).map((r) => ({
        ...r,
        id: r?.id ?? r?.Id ?? r?.ID ?? null,
        Nombre: r?.[colNombre] ?? r?.Tipo ?? r?.tipo ?? r?.Nombre ?? r?.nombre ?? ''
      }));
    } catch (error) {
      console.error('❌ Error obteniendo tipos de pedido:', error.message);
      return [];
    }
  }

  // ESPECIALIDADES
  async getEspecialidades() {
    try {
      const sql = 'SELECT * FROM especialidades ORDER BY id ASC';
      const rows = await this.query(sql);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo especialidades:', error.message);
      return [];
    }
  }

  async getEspecialidadById(id) {
    try {
      const sql = 'SELECT * FROM especialidades WHERE id = ? LIMIT 1';
      const rows = await this.query(sql, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo especialidad por ID:', error.message);
      return null;
    }
  }

  async createEspecialidad(payload) {
    try {
      const fields = Object.keys(payload).map(key => `\`${key}\``).join(', ');
      const placeholders = Object.keys(payload).map(() => '?').join(', ');
      const values = Object.values(payload);
      
      const sql = `INSERT INTO especialidades (${fields}) VALUES (${placeholders})`;
      const result = await this.query(sql, values);
      return { insertId: result.insertId || result.insertId };
    } catch (error) {
      console.error('❌ Error creando especialidad:', error.message);
      throw error;
    }
  }

  async updateEspecialidad(id, payload) {
    try {
      const fields = Object.keys(payload).map(key => `\`${key}\` = ?`).join(', ');
      const values = Object.values(payload);
      values.push(id);
      
      const sql = `UPDATE especialidades SET ${fields} WHERE id = ?`;
      await this.query(sql, values);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando especialidad:', error.message);
      throw error;
    }
  }

  async deleteEspecialidad(id) {
    try {
      const sql = 'DELETE FROM especialidades WHERE id = ?';
      await this.query(sql, [id]);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error eliminando especialidad:', error.message);
      throw error;
    }
  }

  // PROVINCIAS
  async getProvincias(filtroPais = null) {
    try {
      let sql = 'SELECT * FROM provincias';
      const params = [];
      
      if (filtroPais) {
        sql += ' WHERE CodigoPais = ?';
        params.push(filtroPais);
      }
      
      sql += ' ORDER BY Nombre ASC';
      const rows = await this.query(sql, params);
      // Normalizar texto para evitar mojibake en vistas (tildes/ñ)
      try {
        const { normalizeUTF8, normalizeTitleCaseES } = require('../utils/normalize-utf8');
        return (rows || []).map(r => ({
          ...r,
          // Provincias: TitleCase + utf8
          Nombre: normalizeTitleCaseES(r.Nombre || ''),
          Pais: normalizeTitleCaseES(r.Pais || '')
        }));
      } catch (_) {
        // fallback: devolver tal cual
      }
      console.log(`✅ [PROVINCIAS] Obtenidas ${rows.length} provincias${filtroPais ? ' de ' + filtroPais : ''}`);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo provincias:', error.message);
      return [];
    }
  }

  async getProvinciaById(id) {
    try {
      const sql = 'SELECT * FROM provincias WHERE id = ? LIMIT 1';
      const rows = await this.query(sql, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo provincia por ID:', error.message);
      return null;
    }
  }

  async getProvinciaByCodigo(codigo) {
    try {
      const sql = 'SELECT * FROM provincias WHERE Codigo = ? LIMIT 1';
      const rows = await this.query(sql, [codigo]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo provincia por código:', error.message);
      return null;
    }
  }

  // PAÍSES
  async getPaises() {
    try {
      const sql = 'SELECT * FROM paises ORDER BY Nombre_pais ASC';
      const rows = await this.query(sql);
      try {
        const { normalizeTitleCaseES } = require('../utils/normalize-utf8');
        return (rows || []).map(r => ({
          ...r,
          Nombre_pais: normalizeTitleCaseES(r.Nombre_pais || '')
        }));
      } catch (_) {
        return rows;
      }
    } catch (error) {
      console.error('❌ Error obteniendo países:', error.message);
      return [];
    }
  }

  async getPaisById(id) {
    try {
      const sql = 'SELECT * FROM paises WHERE id = ? LIMIT 1';
      const rows = await this.query(sql, [id]);
      const row = rows.length > 0 ? rows[0] : null;
      if (!row) return null;
      try {
        const { normalizeTitleCaseES } = require('../utils/normalize-utf8');
        return { ...row, Nombre_pais: normalizeTitleCaseES(row.Nombre_pais || '') };
      } catch (_) {
        return row;
      }
    } catch (error) {
      console.error('❌ Error obteniendo país por ID:', error.message);
      return null;
    }
  }

  async getPaisByCodigoISO(codigoISO) {
    try {
      const sql = 'SELECT * FROM paises WHERE Id_pais = ? LIMIT 1';
      const rows = await this.query(sql, [codigoISO]);
      const row = rows.length > 0 ? rows[0] : null;
      if (!row) return null;
      try {
        const { normalizeTitleCaseES } = require('../utils/normalize-utf8');
        return { ...row, Nombre_pais: normalizeTitleCaseES(row.Nombre_pais || '') };
      } catch (_) {
        return row;
      }
    } catch (error) {
      console.error('❌ Error obteniendo país por código ISO:', error.message);
      return null;
    }
  }

  // PEDIDOS
  async getNextNumeroPedido() {
    try {
      // Obtener el año actual (últimos 2 dígitos)
      const year = new Date().getFullYear().toString().slice(-2);
      const yearPrefix = `P${year}`;
      
      // Buscar todos los pedidos del año actual (que empiecen con P25, P26, etc.)
      // Extraer solo los últimos 4 dígitos (la secuencia) de cada número de pedido
      const sql = `
        SELECT 
          ped_numero AS NumPedido,
          CAST(SUBSTRING(ped_numero, 4) AS UNSIGNED) as secuencia
        FROM pedidos 
        WHERE ped_numero LIKE ?
        ORDER BY secuencia DESC
        LIMIT 1
      `;
      
      const rows = await this.query(sql, [`${yearPrefix}%`]);
      
      let maxSecuencia = 0;
      if (rows.length > 0 && rows[0].secuencia) {
        maxSecuencia = parseInt(rows[0].secuencia, 10) || 0;
      }
      
      // Generar el siguiente número: P25 + 4 dígitos (0001, 0002, etc.)
      const nextSecuencia = (maxSecuencia + 1).toString().padStart(4, '0');
      const nextNumero = `${yearPrefix}${nextSecuencia}`;
      
      console.log(`📝 [NUMERO PEDIDO] Año: ${year}, Máxima secuencia encontrada: ${maxSecuencia}, Siguiente: ${nextNumero}`);
      
      return nextNumero;
    } catch (error) {
      console.error('❌ Error obteniendo siguiente número de pedido:', error.message);
      const year = new Date().getFullYear().toString().slice(-2);
      return `P${year}0001`;
    }
  }

  // PEDIDOS (delegado a domains/pedidos.js)
  async getPedidos(comercialId = null) {
    return domains.pedidos.getPedidos.apply(this, arguments);
  }
  async getPedidosPaged(filters = {}, options = {}) {
    return domains.pedidos.getPedidosPaged.apply(this, arguments);
  }
  async countPedidos(filters = {}) {
    return domains.pedidos.countPedidos.apply(this, arguments);
  }
  async getPedidosByComercial(comercialId) {
    return domains.pedidos.getPedidosByComercial.apply(this, arguments);
  }
  async getPedidosByCliente(clienteId) {
    return domains.pedidos.getPedidosByCliente.apply(this, arguments);
  }
  async getPedidoById(id) {
    return domains.pedidos.getPedidoById.apply(this, arguments);
  }
  async _enrichPedidoWithEstado(pedidoRow) {
    const p = pedidoRow && typeof pedidoRow === 'object' ? pedidoRow : null;
    if (!p) return pedidoRow;
    try {
      const meta = await this._ensurePedidosMeta().catch(() => null);
      const { pk, colComercial, colCliente, colFecha, colNumPedido, colEstado, colEstadoId } = meta || {};

      // Aliases BD normalizada → legacy (vistas esperan Id_Cliente, Id_Cial, etc.)
      const alias = (col, legacy) => {
        if (col && p[col] !== undefined && (p[legacy] === undefined || p[legacy] === null)) p[legacy] = p[col];
      };
      if (pk) {
        alias(pk, 'Id');
        alias(pk, 'id');
      }
      alias(colCliente, 'Id_Cliente');
      alias(colComercial, 'Id_Cial');
      alias(colFecha, 'FechaPedido');
      alias(colFecha, 'Fecha');
      alias(colNumPedido, 'NumPedido');
      alias(colEstado, 'EstadoPedido');
      alias(colEstado, 'Estado');
      alias(colEstadoId, 'Id_EstadoPedido');
      // Otras columnas comunes (ped_* → legacy)
      const extraAliases = [
        ['ped_direnv_id', 'Id_DireccionEnvio'],
        ['ped_formp_id', 'Id_FormaPago'],
        ['ped_tipp_id', 'Id_TipoPedido'],
        ['ped_tarcli_id', 'Id_Tarifa'],
        ['ped_total', 'TotalPedido'],
        ['ped_base', 'BaseImponible'],
        ['ped_iva', 'TotalIva'],
        ['ped_dto', 'Dto'],
        ['ped_descuento', 'Descuento'],
        ['ped_observaciones', 'Observaciones'],
        ['ped_num_asoc_hefame', 'NumAsociadoHefame'],
        ['ped_es_especial', 'EsEspecial'],
        ['ped_especial_estado', 'EspecialEstado'],
        ['ped_num_pedido_cliente', 'NumPedidoCliente'],
        ['ped_fecha_entrega', 'FechaEntrega']
      ];
      for (const [col, legacy] of extraAliases) {
        if (p[col] !== undefined && (p[legacy] === undefined || p[legacy] === null)) p[legacy] = p[col];
      }

      const colEstadoIdMeta = colEstadoId || meta?.colEstadoId;
      const colEstadoTxt = colEstado || meta?.colEstado;
      if (!colEstadoIdMeta && !colEstadoTxt) return p;

      const rawId = colEstadoIdMeta ? p[colEstadoIdMeta] : (p.Id_EstadoPedido ?? p.id_estado_pedido ?? null);
      let estadoId = Number.parseInt(String(rawId ?? '').trim(), 10);
      if (!Number.isFinite(estadoId) || estadoId <= 0) estadoId = null;

      if (!estadoId && colEstadoTxt) {
        const txt = String(p[colEstadoTxt] ?? p.EstadoPedido ?? p.Estado ?? '').trim().toLowerCase();
        if (txt) estadoId = await this.getEstadoPedidoIdByCodigo(txt).catch(() => null);
      }

      if (!estadoId) return p;
      const estado = await this.getEstadoPedidoById(estadoId).catch(() => null);
      if (!estado) return p;

      const eMeta = await this._ensureEstadosPedidoMeta().catch(() => null);
      const nombre = eMeta?.colNombre ? estado[eMeta.colNombre] : (estado.nombre ?? null);
      const color = eMeta?.colColor ? estado[eMeta.colColor] : (estado.color ?? null);

      if (nombre) p.EstadoPedido = String(nombre);
      if (color) p.EstadoColor = String(color);
      p.Id_EstadoPedido = estadoId;
      return p;
    } catch (_) {
      return pedidoRow;
    }
  }

  async getPedidosArticulos() {
    return domains.pedidos.getPedidosArticulos.apply(this, arguments);
  }
  async getArticulosByPedido(pedidoId) {
    return domains.pedidos.getArticulosByPedido.apply(this, arguments);
  }
  async updatePedido(id, payload) {
    return domains.pedidos.updatePedido.apply(this, arguments);
  }
  async ensurePedidosSchema() {
    // Best-effort: añadir columnas que usa la UI si faltan (sin romper producción si no hay permisos).
    if (this._pedidosSchemaEnsured) return;
    this._pedidosSchemaEnsured = true;
    try {
      if (!this.connected || !this.pool) await this.connect();
      const { tPedidos } = await this._ensurePedidosMeta();
      const cols = await this._getColumns(tPedidos).catch(() => []);
      const colsLower = new Set((cols || []).map((c) => String(c).toLowerCase()));

      // Nuevo: referencia del pedido del cliente
      if (!colsLower.has('numpedidocliente') && !colsLower.has('num_pedido_cliente')) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`NumPedidoCliente\` VARCHAR(255) NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.NumPedidoCliente");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.NumPedidoCliente:', e.message);
        }
      }

      // Nuevo: descuento general del pedido (porcentaje) aplicado sobre la base antes del IVA.
      // Usamos `Dto` porque el motor ya lo detecta por metadatos y lo usa en cálculos.
      const hasDto =
        colsLower.has('dto') ||
        colsLower.has('descuento') ||
        colsLower.has('descuentopedido') ||
        colsLower.has('porcentajedescuento') ||
        colsLower.has('porcentaje_descuento');
      if (!hasDto) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`Dto\` DECIMAL(5,2) NULL DEFAULT 0`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.Dto");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.Dto:', e.message);
        }
      }

      // Nº asociado Hefame (Transfer Hefame): snapshot en el pedido para informes/integraciones
      const hasNumAsociadoHefame =
        colsLower.has('numasociadohefame') ||
        colsLower.has('num_asociado_hefame') ||
        colsLower.has('numasociado_hefame');
      if (!hasNumAsociadoHefame) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`NumAsociadoHefame\` VARCHAR(50) NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.NumAsociadoHefame");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.NumAsociadoHefame:', e.message);
        }
      }

      // Pedido especial: permite descuentos manuales y requiere aprobación de admin
      const hasEsEspecial =
        colsLower.has('esespecial') ||
        colsLower.has('es_especial') ||
        colsLower.has('pedidoespecial') ||
        colsLower.has('pedido_especial');
      if (!hasEsEspecial) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`EsEspecial\` TINYINT(1) NOT NULL DEFAULT 0`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.EsEspecial");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.EsEspecial:', e.message);
        }
      }

      const hasEspecialEstado =
        colsLower.has('especialestado') ||
        colsLower.has('especial_estado') ||
        colsLower.has('estadoespecial') ||
        colsLower.has('estado_especial');
      if (!hasEspecialEstado) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`EspecialEstado\` VARCHAR(16) NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.EspecialEstado");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.EspecialEstado:', e.message);
        }
      }

      const hasEspecialNotas =
        colsLower.has('especialnotas') ||
        colsLower.has('especial_notas') ||
        colsLower.has('notasespecial') ||
        colsLower.has('notas_especial');
      if (!hasEspecialNotas) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`EspecialNotas\` VARCHAR(500) NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.EspecialNotas");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.EspecialNotas:', e.message);
        }
      }

      const hasEspecialFechaSolicitud =
        colsLower.has('especialfechasolicitud') ||
        colsLower.has('especial_fecha_solicitud') ||
        colsLower.has('fechasolicitudespecial') ||
        colsLower.has('fecha_solicitud_especial');
      if (!hasEspecialFechaSolicitud) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`EspecialFechaSolicitud\` DATETIME NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.EspecialFechaSolicitud");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.EspecialFechaSolicitud:', e.message);
        }
      }

      const hasEspecialFechaResolucion =
        colsLower.has('especialfecharesolucion') ||
        colsLower.has('especial_fecha_resolucion') ||
        colsLower.has('fecharesolucionespecial') ||
        colsLower.has('fecha_resolucion_especial');
      if (!hasEspecialFechaResolucion) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`EspecialFechaResolucion\` DATETIME NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.EspecialFechaResolucion");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.EspecialFechaResolucion:', e.message);
        }
      }

      const hasEspecialIdAdmin =
        colsLower.has('especialidadadminresolvio') ||
        colsLower.has('especial_id_admin_resolvio') ||
        colsLower.has('idadminresolviospecial') ||
        colsLower.has('id_admin_resolvio_especial');
      if (!hasEspecialIdAdmin) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`EspecialIdAdminResolvio\` INT NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.EspecialIdAdminResolvio");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.EspecialIdAdminResolvio:', e.message);
        }
      }

      // Estado normalizado (FK a estados_pedido)
      const hasEstadoId =
        colsLower.has('id_estadopedido') ||
        colsLower.has('id_estado_pedido') ||
        colsLower.has('estadopedidoid') ||
        colsLower.has('estado_pedido_id');
      if (!hasEstadoId) {
        try {
          await this.query(`ALTER TABLE \`${tPedidos}\` ADD COLUMN \`Id_EstadoPedido\` INT NULL`);
          console.log("✅ [SCHEMA] Añadida columna pedidos.Id_EstadoPedido");
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir pedidos.Id_EstadoPedido:', e.message);
        }
      }
      // Índice best-effort
      try {
        const idxRows = await this.query(`SHOW INDEX FROM \`${tPedidos}\``).catch(() => []);
        const existing = new Set((idxRows || []).map((r) => String(r.Key_name || r.key_name || '').trim()).filter(Boolean));
        if (!existing.has('idx_pedidos_estado_pedido')) {
          await this.query(`CREATE INDEX \`idx_pedidos_estado_pedido\` ON \`${tPedidos}\` (\`Id_EstadoPedido\`)`);
        }
      } catch (_) {}

      // FK best-effort: pedidos.Id_EstadoPedido -> estados_pedido.id
      try {
        await this.ensureEstadosPedidoTable();
        const fkName = 'fk_pedidos_estado_pedido';
        try {
          await this.query(
            `ALTER TABLE \`${tPedidos}\` ADD CONSTRAINT \`${fkName}\` FOREIGN KEY (\`Id_EstadoPedido\`) REFERENCES \`estados_pedido\`(\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT`
          );
          console.log(`✅ [FK] Creada ${fkName}`);
        } catch (e) {
          const msg = String(e?.message || e);
          if (!msg.toLowerCase().includes('duplicate') && !msg.toLowerCase().includes('already') && !msg.toLowerCase().includes('exists')) {
            // no romper si no hay permisos o hay datos incompatibles
          }
        }
      } catch (_) {}
    } catch (e) {
      console.warn('⚠️ [SCHEMA] No se pudo asegurar esquema de pedidos:', e?.message || e);
    }
  }

  async getPreciosArticulosParaTarifa(tarifaId, articuloIds) {
    // Devuelve { [Id_Articulo]: precioUnitario } con fallback a PVL.
    const tId = Number.parseInt(String(tarifaId ?? '').trim(), 10);
    const ids = (Array.isArray(articuloIds) ? articuloIds : [])
      .map((x) => Number.parseInt(String(x ?? '').trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 200);
    if (!Number.isFinite(tId) || tId < 0 || ids.length === 0) return {};

    if (!this.connected && !this.pool) await this.connect();

    // Validar tarifa activa/vigente (best-effort). Si no lo es, caer a PVL (tarifa 0).
    let effectiveTarifaId = tId;
    if (tId > 0) {
      try {
        const tTar = await this._resolveTableNameCaseInsensitive('tarifasClientes');
        const tarCols = await this._getColumns(tTar).catch(() => []);
        const pickTar = (cands) => this._pickCIFromColumns(tarCols, cands);
        const tarPk = pickTar(['Id', 'id']) || 'Id';
        const colActiva = pickTar(['Activa', 'activa']);
        const colInicio = pickTar(['FechaInicio', 'fecha_inicio', 'Fecha_Inicio', 'inicio']);
        const colFin = pickTar(['FechaFin', 'fecha_fin', 'Fecha_Fin', 'fin']);

        const [tRows] = await this.pool.query(`SELECT * FROM \`${tTar}\` WHERE \`${tarPk}\` = ? LIMIT 1`, [tId]);
        const row = (tRows && tRows[0]) ? tRows[0] : null;
        if (row) {
          const activaRaw = colActiva ? row[colActiva] : 1;
          const activa =
            activaRaw === 1 || activaRaw === '1' || activaRaw === true ||
            (typeof activaRaw === 'string' && ['ok', 'si', 'sí', 'true'].includes(activaRaw.trim().toLowerCase()));

          const now = new Date();
          const start = colInicio && row[colInicio] ? new Date(row[colInicio]) : null;
          const end = colFin && row[colFin] ? new Date(row[colFin]) : null;
          const inRange = (!start || now >= start) && (!end || now <= end);
          if (!(activa && inRange)) effectiveTarifaId = 0;
        }
      } catch (_) {
        // Si no podemos validar, no rompemos: usamos la tarifa solicitada.
        effectiveTarifaId = tId;
      }
    }

    // 1) Tabla de precios por tarifa
    let preciosTarifa = new Map();
    let preciosPVL = new Map();
    try {
      const tTP = await this._resolveTableNameCaseInsensitive('tarifasClientes_precios');
      const tpCols = await this._getColumns(tTP).catch(() => []);
      const pickTP = (cands) => this._pickCIFromColumns(tpCols, cands);
      const cTar = pickTP(['Id_Tarifa', 'id_tarifa', 'TarifaId', 'tarifa_id']) || 'Id_Tarifa';
      const cArt = pickTP(['Id_Articulo', 'id_articulo', 'ArticuloId', 'articulo_id']) || 'Id_Articulo';
      const cPrecio = pickTP(['Precio', 'precio', 'PrecioUnitario', 'precio_unitario', 'PVL', 'pvl']) || 'Precio';

      const inPlaceholders = ids.map(() => '?').join(', ');
      const sql = `
        SELECT \`${cTar}\` AS Id_Tarifa, \`${cArt}\` AS Id_Articulo, \`${cPrecio}\` AS Precio
        FROM \`${tTP}\`
        WHERE \`${cTar}\` IN (?, 0) AND \`${cArt}\` IN (${inPlaceholders})
      `;
      const rows = await this.query(sql, [effectiveTarifaId, ...ids]).catch(() => []);
      for (const r of (rows || [])) {
        const aid = Number.parseInt(String(r.Id_Articulo ?? '').trim(), 10);
        const tid = Number.parseInt(String(r.Id_Tarifa ?? '').trim(), 10);
        const precio = Number(String(r.Precio ?? '').replace(',', '.'));
        if (!Number.isFinite(aid) || aid <= 0 || !Number.isFinite(precio)) continue;
        if (tid === effectiveTarifaId) preciosTarifa.set(aid, precio);
        if (tid === 0) preciosPVL.set(aid, precio);
      }
    } catch (_) {
      // ignorar
    }

    // 2) Fallback PVL de artículos
    let articulosPVL = new Map();
    try {
      const tArt = await this._resolveTableNameCaseInsensitive('articulos');
      const aCols = await this._getColumns(tArt).catch(() => []);
      const pickA = (cands) => this._pickCIFromColumns(aCols, cands);
      const aPk = pickA(['id', 'Id']) || 'id';
      const cPVL = pickA(['PVL', 'pvl', 'Precio', 'precio']) || 'PVL';
      const inPlaceholders = ids.map(() => '?').join(', ');
      const rows = await this.query(
        `SELECT \`${aPk}\` AS Id, \`${cPVL}\` AS PVL FROM \`${tArt}\` WHERE \`${aPk}\` IN (${inPlaceholders})`,
        ids
      ).catch(() => []);
      for (const r of (rows || [])) {
        const aid = Number.parseInt(String(r.Id ?? '').trim(), 10);
        const pvl = Number(String(r.PVL ?? '').replace(',', '.'));
        if (!Number.isFinite(aid) || aid <= 0) continue;
        if (Number.isFinite(pvl)) articulosPVL.set(aid, pvl);
      }
    } catch (_) {
      // ignorar
    }

    const out = {};
    for (const aid of ids) {
      const precio =
        preciosTarifa.has(aid) ? preciosTarifa.get(aid)
        : preciosPVL.has(aid) ? preciosPVL.get(aid)
        : articulosPVL.has(aid) ? articulosPVL.get(aid)
        : undefined;
      if (precio !== undefined) out[String(aid)] = precio;
    }
    return out;
  }

  async updatePedidoWithLineas(id, pedidoPayload, lineasPayload, options = {}) {
    // Actualiza cabecera + reemplaza líneas en una transacción, manteniendo el mismo ID.
    try {
      const idNum = Number(id);
      if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('ID no válido');
      if (!Array.isArray(lineasPayload)) throw new Error('Lineas no válidas (debe ser array)');
      if (pedidoPayload && typeof pedidoPayload !== 'object') throw new Error('Pedido no válido');

      if (!this.connected && !this.pool) await this.connect();

      const pedidosMeta = await this._ensurePedidosMeta();
      const paMeta = await this._ensurePedidosArticulosMeta();

      const tPedidos = pedidosMeta.tPedidos;
      const pk = pedidosMeta.pk;
      const colClientePedido = pedidosMeta.colCliente;
      const colNumPedido = pedidosMeta.colNumPedido;

      const pedidosCols = await this._getColumns(tPedidos).catch(() => []);
      const pedidosColsLower = new Map((pedidosCols || []).map((c) => [String(c).toLowerCase(), c]));
      const pickPedidoCol = (cands) => this._pickCIFromColumns(pedidosCols, cands);
      const colTarifaId = pickPedidoCol(['Id_Tarifa', 'id_tarifa', 'TarifaId', 'tarifa_id']);
      const colTarifaLegacy = pickPedidoCol(['Tarifa', 'tarifa']);
      const colDtoPedido = pickPedidoCol(['Dto', 'DTO', 'Descuento', 'DescuentoPedido', 'PorcentajeDescuento', 'porcentaje_descuento']);
      const colEstadoTxt = pickPedidoCol(['EstadoPedido', 'estado_pedido', 'Estado', 'estado']);
      const colEstadoId = pickPedidoCol(['Id_EstadoPedido', 'id_estado_pedido', 'EstadoPedidoId', 'estado_pedido_id']);
      const colEsEspecial = pickPedidoCol(['EsEspecial', 'es_especial', 'PedidoEspecial', 'pedido_especial']);
      const colEspecialEstado = pickPedidoCol(['EspecialEstado', 'especial_estado', 'EstadoEspecial', 'estado_especial']);
      const colEspecialNotas = pickPedidoCol(['EspecialNotas', 'especial_notas', 'NotasEspecial', 'notas_especial']);
      const colEspecialFechaSolicitud = pickPedidoCol(['EspecialFechaSolicitud', 'especial_fecha_solicitud', 'FechaSolicitudEspecial', 'fecha_solicitud_especial']);
      const colEspecialFechaResolucion = pickPedidoCol(['EspecialFechaResolucion', 'especial_fecha_resolucion', 'FechaResolucionEspecial', 'fecha_resolucion_especial']);
      const colEspecialIdAdminResolvio = pickPedidoCol(['EspecialIdAdminResolvio', 'especial_id_admin_resolvio', 'IdAdminResolvioEspecial', 'id_admin_resolvio_especial']);
      const colDirEnvio = pickPedidoCol([
        'Id_DireccionEnvio',
        'id_direccionenvio',
        'id_direccion_envio',
        'DireccionEnvioId',
        'direccion_envio_id',
        'IdDireccionEnvio',
        'idDireccionEnvio'
      ]);
      const colTipoPedido = pickPedidoCol(['Id_TipoPedido', 'id_tipo_pedido', 'TipoPedidoId']);

      const colTotalPedido = pickPedidoCol(['TotalPedido', 'Total_Pedido', 'total_pedido', 'Total', 'total', 'ImporteTotal', 'importe_total', 'Importe', 'importe']);
      const colBasePedido = pickPedidoCol(['BaseImponible', 'base_imponible', 'Subtotal', 'subtotal', 'Neto', 'neto', 'ImporteNeto', 'importe_neto']);
      const colIvaPedido = pickPedidoCol(['TotalIva', 'total_iva', 'TotalIVA', 'IvaTotal', 'iva_total', 'ImporteIVA', 'importe_iva']);
      const colDescuentoPedido = pickPedidoCol(['TotalDescuento', 'total_descuento', 'DescuentoTotal', 'descuento_total', 'ImporteDescuento', 'importe_descuento']);

      const paCols = await this._getColumns(paMeta.table).catch(() => []);
      const paColsLower = new Map((paCols || []).map((c) => [String(c).toLowerCase(), c]));
      const pickPaCol = (cands) => this._pickCIFromColumns(paCols, cands);

      const colQty = pickPaCol(['Cantidad', 'cantidad', 'Unidades', 'unidades', 'Uds', 'uds', 'Cant', 'cant']);
      const colPrecioUnit = pickPaCol(['PrecioUnitario', 'precio_unitario', 'Precio', 'precio', 'PVP', 'pvp', 'PVL', 'pvl', 'PCP', 'pcp']);
      const colDtoLinea = pickPaCol(['DtoLinea', 'dtoLinea', 'dto_linea', 'Dto', 'dto', 'DTO', 'Descuento', 'descuento']);
      // Algunas instalaciones guardan además el nombre del artículo en texto (NOT NULL)
      const colArticuloTxt = pickPaCol(['Articulo', 'articulo', 'NombreArticulo', 'nombre_articulo']);
      const colIvaPctLinea = pickPaCol(['PorcIVA', 'porc_iva', 'PorcentajeIVA', 'porcentaje_iva', 'IVA', 'iva', 'TipoIVA', 'tipo_iva']);
      const colBaseLinea = pickPaCol(['Base', 'base', 'BaseImponible', 'base_imponible', 'Subtotal', 'subtotal', 'Importe', 'importe', 'Neto', 'neto']);
      const colIvaImporteLinea = pickPaCol(['ImporteIVA', 'importe_iva', 'IvaImporte', 'iva_importe', 'TotalIVA', 'total_iva']);
      const colTotalLinea = pickPaCol(['Total', 'total', 'TotalLinea', 'total_linea', 'ImporteTotal', 'importe_total', 'Bruto', 'bruto']);

      // Mapeo payload legacy → columna BD (post-migración)
      const pedidoLegacyToCol = {
        Id_Cial: 'ped_com_id', Id_Cliente: 'ped_cli_id', Id_DireccionEnvio: 'ped_direnv_id',
        Id_FormaPago: 'ped_formp_id', Id_TipoPedido: 'ped_tipp_id', Id_Tarifa: 'ped_tarcli_id',
        Id_EstadoPedido: 'ped_estped_id', NumPedido: 'ped_numero', FechaPedido: 'ped_fecha',
        EstadoPedido: 'ped_estado_txt', TotalPedido: 'ped_total', BaseImponible: 'ped_base',
        TotalIva: 'ped_iva', TotalDescuento: 'ped_descuento', Dto: 'ped_dto',
        NumPedidoCliente: 'ped_num_pedido_cliente', NumAsociadoHefame: 'ped_num_asoc_hefame',
        FechaEntrega: 'ped_fecha_entrega', Observaciones: 'ped_observaciones',
        EsEspecial: 'ped_es_especial', EspecialEstado: 'ped_especial_estado',
        EspecialFechaSolicitud: 'ped_especial_fecha_solicitud'
      };

      // Preparar update cabecera filtrado
      const filteredPedido = {};
      const pedidoInput = pedidoPayload && typeof pedidoPayload === 'object' ? pedidoPayload : {};
      for (const [k, v] of Object.entries(pedidoInput)) {
        const mappedKey = pedidoLegacyToCol[k] || k;
        const real = pedidosColsLower.get(String(mappedKey).toLowerCase()) || pedidosColsLower.get(String(k).toLowerCase());
        if (real && String(real).toLowerCase() !== String(pk).toLowerCase()) filteredPedido[real] = v;
      }

      // Calcular NumPedido final (si aplica) para enlazar líneas por número cuando exista
      const numPedidoFromPayload =
        colNumPedido && Object.prototype.hasOwnProperty.call(filteredPedido, colNumPedido) && String(filteredPedido[colNumPedido] ?? '').trim()
          ? String(filteredPedido[colNumPedido]).trim()
          : null;

      const conn = await this.pool.getConnection();
      try {
        try { await conn.query("SET time_zone = 'Europe/Madrid'"); } catch (_) {}
        await conn.beginTransaction();

        // Leer pedido actual (dentro de la transacción)
        const selectCols = Array.from(
          new Set(
            [
              pk,
              colNumPedido,
              colClientePedido,
              colDirEnvio,
              colTarifaId,
              colTarifaLegacy,
              colDtoPedido,
              colTipoPedido,
              colEstadoTxt,
              colEstadoId,
              colEsEspecial,
              colEspecialEstado,
              colEspecialNotas,
              colEspecialFechaSolicitud,
              colEspecialFechaResolucion,
              colEspecialIdAdminResolvio
            ].filter(Boolean)
          )
        );
        const selectSql = `SELECT ${selectCols.map((c) => `\`${c}\``).join(', ')} FROM \`${tPedidos}\` WHERE \`${pk}\` = ? LIMIT 1`;
        const [rows] = await conn.execute(selectSql, [idNum]);
        if (!rows || rows.length === 0) throw new Error('Pedido no encontrado');
        const current = rows[0];

        // Normalizar estado por catálogo si viene en payload (best-effort)
        try {
          await this.ensureEstadosPedidoTable();
          // Si viene Id_EstadoPedido, rellenar texto (EstadoPedido/Estado) con el nombre
          if (colEstadoId && Object.prototype.hasOwnProperty.call(filteredPedido, colEstadoId)) {
            const n = Number.parseInt(String(filteredPedido[colEstadoId] ?? '').trim(), 10);
            if (Number.isFinite(n) && n > 0) {
              const est = await this.getEstadoPedidoById(n).catch(() => null);
              const eMeta = await this._ensureEstadosPedidoMeta().catch(() => null);
              const nombre = eMeta?.colNombre && est ? est[eMeta.colNombre] : (est?.nombre ?? null);
              if (nombre && colEstadoTxt && !Object.prototype.hasOwnProperty.call(filteredPedido, colEstadoTxt)) {
                filteredPedido[colEstadoTxt] = String(nombre);
              }
            }
          }
          // Si viene texto pero no FK, intentar mapear a FK
          if (colEstadoTxt && Object.prototype.hasOwnProperty.call(filteredPedido, colEstadoTxt) && colEstadoId && !Object.prototype.hasOwnProperty.call(filteredPedido, colEstadoId)) {
            const code = String(filteredPedido[colEstadoTxt] ?? '').trim().toLowerCase();
            if (code) {
              const idEstado = await this.getEstadoPedidoIdByCodigo(code).catch(() => null);
              if (idEstado) filteredPedido[colEstadoId] = idEstado;
            }
          }
        } catch (_) {}

        const finalNumPedido = numPedidoFromPayload || (colNumPedido ? (current[colNumPedido] ? String(current[colNumPedido]).trim() : null) : null);

        // Integridad: si el pedido tiene Id_DireccionEnvio, debe pertenecer al Id_Cliente final.
        const finalClienteId =
          (colClientePedido && Object.prototype.hasOwnProperty.call(filteredPedido, colClientePedido))
            ? Number(filteredPedido[colClientePedido] || 0)
            : (colClientePedido ? Number(current[colClientePedido] || 0) : 0);

        if (colDirEnvio) {
          const dirRaw =
            Object.prototype.hasOwnProperty.call(filteredPedido, colDirEnvio) ? filteredPedido[colDirEnvio] : (current[colDirEnvio] ?? null);
          const dirId = Number.parseInt(String(dirRaw ?? '').trim(), 10);
          const hasDir = Number.isFinite(dirId) && dirId > 0;
          const hasCliente = Number.isFinite(finalClienteId) && finalClienteId > 0;
          if (hasDir && hasCliente) {
            const dMeta = await this._ensureDireccionesEnvioMeta().catch(() => null);
            if (dMeta?.table && dMeta?.colCliente) {
              const where = [`\`${dMeta.pk}\` = ?`, `\`${dMeta.colCliente}\` = ?`];
              const params = [dirId, finalClienteId];
              if (dMeta.colActiva) {
                where.push(`\`${dMeta.colActiva}\` = 1`);
              }
              const [dRows] = await conn.execute(
                `SELECT \`${dMeta.pk}\` AS id FROM \`${dMeta.table}\` WHERE ${where.join(' AND ')} LIMIT 1`,
                params
              );
              if (!dRows || dRows.length === 0) {
                throw new Error('La dirección de envío no pertenece al cliente seleccionado (o está inactiva).');
              }
            }
          }
        }

        const tarifaIdRaw =
          (colTarifaId && Object.prototype.hasOwnProperty.call(filteredPedido, colTarifaId)) ? filteredPedido[colTarifaId]
          : (colTarifaLegacy && Object.prototype.hasOwnProperty.call(filteredPedido, colTarifaLegacy)) ? filteredPedido[colTarifaLegacy]
          : (colTarifaId ? current[colTarifaId] : (colTarifaLegacy ? current[colTarifaLegacy] : null));
        const tarifaId = Number.parseInt(String(tarifaIdRaw ?? '').trim(), 10);
        const hasTarifaId = Number.isFinite(tarifaId) && tarifaId > 0;

        // Dto pedido se calcula automáticamente a partir de la tabla descuentos_pedido (sobre Subtotal),
        // por lo que NO lo leemos del payload ni del pedido actual para cálculos.

        // Resolver tarifa activa (tarifasClientes) + vigencia (best-effort).
        // Si no está activa o está fuera de rango, hacemos fallback a PVL (Id=0).
        let effectiveTarifaId = 0;
        let tarifaInfo = null;
        if (hasTarifaId) {
          try {
            const tTar = await this._resolveTableNameCaseInsensitive('tarifasClientes');
            const tarCols = await this._getColumns(tTar).catch(() => []);
            const pickTar = (cands) => this._pickCIFromColumns(tarCols, cands);
            const tarPk = pickTar(['Id', 'id']) || 'Id';
            const colActiva = pickTar(['Activa', 'activa']);
            const colInicio = pickTar(['FechaInicio', 'fecha_inicio', 'Fecha_Inicio', 'inicio']);
            const colFin = pickTar(['FechaFin', 'fecha_fin', 'Fecha_Fin', 'fin']);

            const [tRows] = await conn.execute(`SELECT * FROM \`${tTar}\` WHERE \`${tarPk}\` = ? LIMIT 1`, [tarifaId]);
            const row = (tRows && tRows[0]) ? tRows[0] : null;
            if (row) {
              const activaRaw = colActiva ? row[colActiva] : 1;
              const activa =
                activaRaw === 1 || activaRaw === '1' || activaRaw === true ||
                (typeof activaRaw === 'string' && ['ok', 'si', 'sí', 'true'].includes(activaRaw.trim().toLowerCase()));

              const now = new Date();
              const start = colInicio && row[colInicio] ? new Date(row[colInicio]) : null;
              const end = colFin && row[colFin] ? new Date(row[colFin]) : null;
              const inRange = (!start || now >= start) && (!end || now <= end);

              if (activa && inRange) {
                effectiveTarifaId = tarifaId;
                tarifaInfo = row;
              }
            }
          } catch (_) {
            effectiveTarifaId = 0;
            tarifaInfo = null;
          }
        }

        // ¿Pedido Transfer? (no se valora: PVL=0, dto informativo 5% por defecto)
        let isTransfer = false;
        const tarifaNombre = (tarifaInfo && String(tarifaInfo.NombreTarifa ?? tarifaInfo.Nombre ?? tarifaInfo.nombre ?? '').trim()) || '';
        if (tarifaNombre.toLowerCase().includes('transfer')) isTransfer = true;
        if (!isTransfer && colTipoPedido) {
          const idTipoPedido =
            Number(filteredPedido[colTipoPedido] ?? current[colTipoPedido] ?? 0) ||
            Number(pedidoInput.Id_TipoPedido ?? pedidoInput.id_tipo_pedido ?? 0);
          if (Number.isFinite(idTipoPedido) && idTipoPedido > 0) {
            try {
              const tTipos = await this._resolveTableNameCaseInsensitive('tipos_pedidos').catch(() => null)
                || await this._resolveTableNameCaseInsensitive('tipos_pedido').catch(() => null);
              if (tTipos) {
                const tipCols = await this._getColumns(tTipos).catch(() => []);
                const tipPk = this._pickCIFromColumns(tipCols, ['id', 'Id']) || 'id';
                const tipNombre = this._pickCIFromColumns(tipCols, ['Tipo', 'tipo', 'Nombre', 'nombre']);
                const [tipoRows] = await conn.execute(`SELECT \`${tipNombre || 'Tipo'}\` AS Tipo FROM \`${tTipos}\` WHERE \`${tipPk}\` = ? LIMIT 1`, [idTipoPedido]);
                const tipoNombre = tipoRows?.[0]?.Tipo ?? '';
                if (String(tipoNombre).toLowerCase().includes('transfer')) isTransfer = true;
              }
            } catch (_) {}
          }
        }

        // Prefetch artículos necesarios (best-effort)
        const articuloIds = new Set();
        for (const lineaRaw of lineasPayload) {
          const linea = lineaRaw && typeof lineaRaw === 'object' ? lineaRaw : {};
          const idArt =
            (paMeta.colArticulo && linea[paMeta.colArticulo] !== undefined) ? linea[paMeta.colArticulo]
            : (linea.Id_Articulo ?? linea.id_articulo ?? linea.ArticuloId ?? linea.articuloId);
          const n = Number.parseInt(String(idArt ?? '').trim(), 10);
          if (Number.isFinite(n) && n > 0) articuloIds.add(n);
        }
        let articulosById = new Map();
        let artPk = 'id';
        let tArt = null;
        try {
          if (paMeta.colArticulo && articuloIds.size > 0) {
            tArt = await this._resolveTableNameCaseInsensitive('articulos');
            const artCols = await this._getColumns(tArt).catch(() => []);
            artPk = this._pickCIFromColumns(artCols, ['id', 'Id']) || 'id';
            const idsArr = Array.from(articuloIds);
            const ph = idsArr.map(() => '?').join(', ');
            const [aRows] = await conn.execute(`SELECT * FROM \`${tArt}\` WHERE \`${artPk}\` IN (${ph})`, idsArr);
            articulosById = new Map((aRows || []).map((a) => [Number(a[artPk]), a]));
          }
        } catch (_) {
          articulosById = new Map();
        }

        const getNum = (v, d = 0) => {
          const n = (typeof v === 'number') ? v : Number.parseFloat(String(v ?? '').replace(',', '.'));
          return Number.isFinite(n) ? n : d;
        };
        const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
        const clampPct = (n) => Math.max(0, Math.min(100, Number(n) || 0));

        // Pedido especial: descuentos manuales (no aplicar tabla descuentos_pedido)
        const isEspecial = colEsEspecial
          ? (Number(filteredPedido[colEsEspecial] ?? current[colEsEspecial] ?? 0) === 1)
          : false;

        // Prefetch precios por tarifa/Artículo desde `tarifasClientes_precios`
        const preciosTarifa = new Map(); // Id_Articulo -> Precio para la tarifa efectiva
        const preciosPVL = new Map(); // Id_Articulo -> Precio PVL (Id_Tarifa=0)
        try {
          if (articuloIds.size > 0) {
            const tTP = await this._resolveTableNameCaseInsensitive('tarifasClientes_precios');
            const tpCols = await this._getColumns(tTP).catch(() => []);
            const pickTP = (cands) => this._pickCIFromColumns(tpCols, cands);
            const cTar = pickTP(['Id_Tarifa', 'id_tarifa', 'TarifaId', 'tarifa_id']) || 'Id_Tarifa';
            const cArt = pickTP(['Id_Articulo', 'id_articulo', 'ArticuloId', 'articulo_id']) || 'Id_Articulo';
            const cPrecio = pickTP(['Precio', 'precio', 'PVP', 'pvp', 'PVL', 'pvl']) || 'Precio';

            const idsArr = Array.from(articuloIds);
            const ph = idsArr.map(() => '?').join(', ');

            if (effectiveTarifaId && effectiveTarifaId !== 0) {
              const [rowsP] = await conn.execute(
                `SELECT \`${cTar}\` AS Id_Tarifa, \`${cArt}\` AS Id_Articulo, \`${cPrecio}\` AS Precio
                 FROM \`${tTP}\`
                 WHERE \`${cTar}\` IN (?, 0) AND \`${cArt}\` IN (${ph})`,
                [effectiveTarifaId, ...idsArr]
              );
              for (const r of (rowsP || [])) {
                const tid = Number.parseInt(String(r.Id_Tarifa ?? '').trim(), 10);
                const aid = Number.parseInt(String(r.Id_Articulo ?? '').trim(), 10);
                const pr = getNum(r.Precio, NaN);
                if (!Number.isFinite(aid) || aid <= 0) continue;
                if (!Number.isFinite(pr) || pr < 0) continue;
                if (tid === 0) preciosPVL.set(aid, pr);
                if (tid === effectiveTarifaId) preciosTarifa.set(aid, pr);
              }
            } else {
              const [rowsP] = await conn.execute(
                `SELECT \`${cArt}\` AS Id_Articulo, \`${cPrecio}\` AS Precio
                 FROM \`${tTP}\`
                 WHERE \`${cTar}\` = 0 AND \`${cArt}\` IN (${ph})`,
                idsArr
              );
              for (const r of (rowsP || [])) {
                const aid = Number.parseInt(String(r.Id_Articulo ?? '').trim(), 10);
                const pr = getNum(r.Precio, NaN);
                if (!Number.isFinite(aid) || aid <= 0) continue;
                if (!Number.isFinite(pr) || pr < 0) continue;
                preciosPVL.set(aid, pr);
              }
            }
          }
        } catch (_) {
          // ignore (best-effort)
        }

        const getPrecioFromTarifa = (art, artId) => {
          if (!art || typeof art !== 'object') return 0;
          const pvlArticulo = getNum(art.PVL ?? art.pvl ?? 0, 0);
          const pvl = (artId && preciosPVL.has(artId)) ? preciosPVL.get(artId) : pvlArticulo;
          if (effectiveTarifaId && effectiveTarifaId !== 0 && artId && preciosTarifa.has(artId)) {
            return preciosTarifa.get(artId);
          }
          return pvl;
        };

        // 1) Update cabecera (si hay campos)
        const pedidoKeys = Object.keys(filteredPedido);
        let updatedPedido = { affectedRows: 0, changedRows: 0 };
        if (pedidoKeys.length) {
          const fields = pedidoKeys.map((c) => `\`${c}\` = ?`).join(', ');
          const values = pedidoKeys.map((c) => filteredPedido[c]);
          values.push(idNum);
          const updSql = `UPDATE \`${tPedidos}\` SET ${fields} WHERE \`${pk}\` = ?`;
          const [updRes] = await conn.execute(updSql, values);
          updatedPedido = { affectedRows: updRes?.affectedRows || 0, changedRows: updRes?.changedRows || 0 };
        }

        // 2) Borrar líneas actuales (priorizando el enlace más fuerte para proteger integridad)
        // Evitamos borrados cruzados si existe NumPedido y no es único, limpiando "legacy" solo cuando no hay vínculo por ID.
        let deletedLineas = 0;
        const delExec = async (sql, params) => {
          const [r] = await conn.execute(sql, params);
          deletedLineas += r?.affectedRows || 0;
        };

        if (paMeta.colPedidoId) {
          await delExec(`DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colPedidoId}\` = ?`, [idNum]);

          if (paMeta.colPedidoIdNum) {
            await delExec(
              `DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colPedidoIdNum}\` = ? AND (\`${paMeta.colPedidoId}\` IS NULL OR \`${paMeta.colPedidoId}\` = 0)`,
              [idNum]
            );
          }
          if (paMeta.colNumPedido && finalNumPedido) {
            const extra = paMeta.colPedidoIdNum
              ? ` AND (\`${paMeta.colPedidoIdNum}\` IS NULL OR \`${paMeta.colPedidoIdNum}\` = 0)`
              : '';
            await delExec(
              `DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colNumPedido}\` = ? AND (\`${paMeta.colPedidoId}\` IS NULL OR \`${paMeta.colPedidoId}\` = 0)${extra}`,
              [finalNumPedido]
            );
          }
        } else if (paMeta.colPedidoIdNum) {
          await delExec(`DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colPedidoIdNum}\` = ?`, [idNum]);
          if (paMeta.colNumPedido && finalNumPedido) {
            await delExec(
              `DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colNumPedido}\` = ? AND (\`${paMeta.colPedidoIdNum}\` IS NULL OR \`${paMeta.colPedidoIdNum}\` = 0)`,
              [finalNumPedido]
            );
          }
        } else if (paMeta.colNumPedido && finalNumPedido) {
          await delExec(`DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colNumPedido}\` = ?`, [finalNumPedido]);
        } else {
          throw new Error('No se pudo determinar cómo enlazar líneas con el pedido (faltan columnas)');
        }

        // 3) Insertar nuevas líneas
        const insertedIds = [];
        let sumBase = 0;
        let sumIva = 0;
        let sumTotal = 0;
        let sumDescuento = 0;
        for (const lineaRaw of lineasPayload) {
          const linea = lineaRaw && typeof lineaRaw === 'object' ? lineaRaw : {};

          const mysqlData = {};
          for (const [k, v] of Object.entries(linea)) {
            const real = paColsLower.get(String(k).toLowerCase());
            if (!real) continue;
            if (String(real).toLowerCase() === String(paMeta.pk).toLowerCase()) continue;
            if (Array.isArray(v) && v.length > 0 && v[0]?.Id) mysqlData[real] = v[0].Id;
            else mysqlData[real] = v === undefined ? null : v;
          }

          // Forzar relación con el pedido (solo si existe la columna)
          if (paMeta.colPedidoId && !Object.prototype.hasOwnProperty.call(mysqlData, paMeta.colPedidoId)) mysqlData[paMeta.colPedidoId] = idNum;
          if (paMeta.colPedidoIdNum && !Object.prototype.hasOwnProperty.call(mysqlData, paMeta.colPedidoIdNum)) mysqlData[paMeta.colPedidoIdNum] = idNum;
          if (paMeta.colNumPedido && finalNumPedido && !Object.prototype.hasOwnProperty.call(mysqlData, paMeta.colNumPedido)) mysqlData[paMeta.colNumPedido] = finalNumPedido;

          // --- Cálculos best-effort (tarifa + dto + iva) ---
          let articulo = null;
          let artId = null;
          if (paMeta.colArticulo) {
            const rawArtId =
              Object.prototype.hasOwnProperty.call(mysqlData, paMeta.colArticulo) ? mysqlData[paMeta.colArticulo]
              : (linea.Id_Articulo ?? linea.id_articulo ?? linea.ArticuloId ?? linea.articuloId);
            const n = Number.parseInt(String(rawArtId ?? '').trim(), 10);
            if (Number.isFinite(n) && n > 0) {
              artId = n;
              articulo = articulosById.get(n) || null;
            }
          }

          // Si existe columna Articulo (texto) y no viene informada, rellenar con el nombre/SKU
          if (colArticuloTxt) {
            const cur = mysqlData[colArticuloTxt];
            const curStr = cur === null || cur === undefined ? '' : String(cur).trim();
            if (!curStr) {
              const nombre =
                (articulo && (articulo.Nombre ?? articulo.nombre ?? articulo.Descripcion ?? articulo.descripcion ?? articulo.SKU ?? articulo.sku)) ??
                null;
              if (nombre && String(nombre).trim()) mysqlData[colArticuloTxt] = String(nombre).trim();
              else if (artId) mysqlData[colArticuloTxt] = String(artId);
            }
          }

          const qty = colQty ? Math.max(0, getNum(mysqlData[colQty], 0)) : Math.max(0, getNum(linea.Cantidad ?? linea.Unidades ?? 0, 0));

          let precioUnit = 0;
          // Fuente de verdad: SIEMPRE calcular PVL por tarifa en backend (no confiar en valores enviados por navegador).
          if (articulo) precioUnit = Math.max(0, getPrecioFromTarifa(articulo, artId));
          if (isTransfer) {
            precioUnit = 0;
          }
          if (colPrecioUnit) mysqlData[colPrecioUnit] = precioUnit;

          // DTO de línea (específico) se aplica en base imponible de la línea.
          // DTO de pedido (general) se aplica a nivel pedido (sobre el Subtotal) y se calcula desde tabla,
          // por lo que NO se aplica aquí por línea.
          // Transfer: dto línea por defecto 5% (informativo, editable)
          const defaultDtoLinea = isTransfer ? 5 : (linea.Dto ?? linea.Descuento ?? 0);
          const dtoLineaPct = clampPct(
            colDtoLinea
              ? getNum(mysqlData[colDtoLinea], defaultDtoLinea)
              : getNum(linea.Dto ?? linea.Descuento ?? defaultDtoLinea, defaultDtoLinea)
          );

          const bruto = round2(qty * precioUnit);
          const base = round2(bruto * (1 - dtoLineaPct / 100));

          // IVA porcentaje (prioridad: línea explícita -> artículo -> 0)
          let ivaPct = 0;
          if (colIvaPctLinea && mysqlData[colIvaPctLinea] !== null && mysqlData[colIvaPctLinea] !== undefined && String(mysqlData[colIvaPctLinea]).trim() !== '') {
            ivaPct = clampPct(getNum(mysqlData[colIvaPctLinea], 0));
          } else if (articulo) {
            ivaPct = clampPct(getNum(articulo.IVA ?? articulo.iva ?? 0, 0));
          }
          const ivaImporte = round2(base * ivaPct / 100);
          const total = round2(base + ivaImporte);
          const descuento = round2(bruto - base);

          sumBase += base;
          sumIva += ivaImporte;
          sumTotal += total;
          sumDescuento += descuento;

          // Guardar campos calculados si existen (sin pisar si ya vienen en payload)
          if (colPrecioUnit && (mysqlData[colPrecioUnit] === null || mysqlData[colPrecioUnit] === undefined || String(mysqlData[colPrecioUnit]).trim() === '')) {
            mysqlData[colPrecioUnit] = precioUnit;
          }
          if (colDtoLinea && (mysqlData[colDtoLinea] === null || mysqlData[colDtoLinea] === undefined || String(mysqlData[colDtoLinea]).trim() === '')) {
            // Guardar SOLO el dto de línea (no el de pedido)
            mysqlData[colDtoLinea] = dtoLineaPct;
          }
          if (colIvaPctLinea && (mysqlData[colIvaPctLinea] === null || mysqlData[colIvaPctLinea] === undefined || String(mysqlData[colIvaPctLinea]).trim() === '')) {
            mysqlData[colIvaPctLinea] = ivaPct;
          }
          if (colBaseLinea && (mysqlData[colBaseLinea] === null || mysqlData[colBaseLinea] === undefined || String(mysqlData[colBaseLinea]).trim() === '')) {
            mysqlData[colBaseLinea] = base;
          }
          if (colIvaImporteLinea && (mysqlData[colIvaImporteLinea] === null || mysqlData[colIvaImporteLinea] === undefined || String(mysqlData[colIvaImporteLinea]).trim() === '')) {
            mysqlData[colIvaImporteLinea] = ivaImporte;
          }
          if (colTotalLinea && (mysqlData[colTotalLinea] === null || mysqlData[colTotalLinea] === undefined || String(mysqlData[colTotalLinea]).trim() === '')) {
            mysqlData[colTotalLinea] = total;
          }

          // Si tras filtrar no queda nada útil, saltar (evita inserts vacíos)
          const keys = Object.keys(mysqlData);
          if (!keys.length) continue;

          const fields = keys.map((c) => `\`${c}\``).join(', ');
          const placeholders = keys.map(() => '?').join(', ');
          const values = keys.map((c) => mysqlData[c]);

          const insSql = `INSERT INTO \`${paMeta.table}\` (${fields}) VALUES (${placeholders})`;
          const [insRes] = await conn.execute(insSql, values);
          if (insRes?.insertId) insertedIds.push(insRes.insertId);
        }

        // 4) DTO pedido (manual si especial, automático por tramos si normal) y totales del pedido (sobre Subtotal)
        let pedidoDtoPct = 0;
        if (isTransfer) {
          pedidoDtoPct = 0;
        } else if (isEspecial) {
          const dtoManualRaw = colDtoPedido
            ? (Object.prototype.hasOwnProperty.call(filteredPedido, colDtoPedido) ? filteredPedido[colDtoPedido] : current[colDtoPedido])
            : (pedidoInput.Dto ?? pedidoInput.dto ?? 0);
          pedidoDtoPct = clampPct(getNum(dtoManualRaw, 0));
        } else {
          const dtoPedidoPct = await this.getDtoPedidoPctForSubtotal(sumTotal, conn).catch(() => 0);
          pedidoDtoPct = clampPct(getNum(dtoPedidoPct, 0));
        }
        const descuentoPedido = round2(sumTotal * (pedidoDtoPct / 100));
        const totalFinal = round2(sumTotal - descuentoPedido);

        // Totales best-effort, sólo columnas existentes.
        const totalsUpdate = {};
        if (colTotalPedido) totalsUpdate[colTotalPedido] = totalFinal;
        if (colBasePedido) totalsUpdate[colBasePedido] = round2(sumBase);
        if (colIvaPedido) totalsUpdate[colIvaPedido] = round2(sumIva);
        if (colDescuentoPedido) totalsUpdate[colDescuentoPedido] = round2(sumDescuento + descuentoPedido);
        if (colDtoPedido) totalsUpdate[colDtoPedido] = pedidoDtoPct;
        const totalKeys = Object.keys(totalsUpdate);
        if (totalKeys.length) {
          const fields = totalKeys.map((c) => `\`${c}\` = ?`).join(', ');
          const values = totalKeys.map((c) => totalsUpdate[c]);
          values.push(idNum);
          await conn.execute(`UPDATE \`${tPedidos}\` SET ${fields} WHERE \`${pk}\` = ?`, values);
        }

        await conn.commit();
        return {
          pedido: updatedPedido,
          deletedLineas,
          insertedLineas: insertedIds.length,
          insertedIds,
          numPedido: finalNumPedido,
          totals: { base: round2(sumBase), iva: round2(sumIva), subtotal: round2(sumTotal), dtoPct: pedidoDtoPct, descuentoPedido: descuentoPedido, total: totalFinal, descuentoLineas: round2(sumDescuento), descuentoTotal: round2(sumDescuento + descuentoPedido) },
          tarifa: { Id_Tarifa: effectiveTarifaId, info: tarifaInfo || null }
        };
      } catch (e) {
        try { await conn.rollback(); } catch (_) {}
        throw e;
      } finally {
        conn.release();
      }
    } catch (error) {
      console.error('❌ Error actualizando pedido con líneas:', error.message);
      throw error;
    }
  }

  async deletePedidoLinea(id) {
    try {
      const idNum = Number(id);
      if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('ID no válido');

      const meta = await this._ensurePedidosArticulosMeta();
      const sql = `DELETE FROM \`${meta.table}\` WHERE \`${meta.pk}\` = ?`;
      const result = await this.query(sql, [idNum]);
      return { affectedRows: result?.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error eliminando línea de pedido:', error.message);
      throw error;
    }
  }

  async deletePedido(id) {
    try {
      const idNum = Number(id);
      if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('ID no válido');

      if (!this.connected && !this.pool) await this.connect();

      const pedido = await this.getPedidoById(idNum);
      if (!pedido) return { affectedRows: 0, deletedLineas: 0 };

      const pedidosMeta = await this._ensurePedidosMeta();
      const paMeta = await this._ensurePedidosArticulosMeta();

      const colNumPedidoPedido = pedidosMeta.colNumPedido;
      const numPedido = colNumPedidoPedido ? (pedido[colNumPedidoPedido] ?? pedido.NumPedido ?? pedido.Numero_Pedido ?? null) : null;

      const numPedidoStr = numPedido !== null && numPedido !== undefined ? String(numPedido).trim() : null;

      const conn = await this.pool.getConnection();
      try {
        try { await conn.query("SET time_zone = 'Europe/Madrid'"); } catch (_) {}
        await conn.beginTransaction();

        let deletedLineas = 0;
        const delExec = async (sql, params) => {
          const [r] = await conn.execute(sql, params);
          deletedLineas += r?.affectedRows || 0;
        };

        // Borrado seguro de líneas: primero por ID, luego limpiar "legacy" sin vínculo por ID
        if (paMeta.colPedidoId) {
          await delExec(`DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colPedidoId}\` = ?`, [idNum]);

          if (paMeta.colPedidoIdNum) {
            await delExec(
              `DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colPedidoIdNum}\` = ? AND (\`${paMeta.colPedidoId}\` IS NULL OR \`${paMeta.colPedidoId}\` = 0)`,
              [idNum]
            );
          }
          if (paMeta.colNumPedido && numPedidoStr) {
            const extra = paMeta.colPedidoIdNum
              ? ` AND (\`${paMeta.colPedidoIdNum}\` IS NULL OR \`${paMeta.colPedidoIdNum}\` = 0)`
              : '';
            await delExec(
              `DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colNumPedido}\` = ? AND (\`${paMeta.colPedidoId}\` IS NULL OR \`${paMeta.colPedidoId}\` = 0)${extra}`,
              [numPedidoStr]
            );
          }
        } else if (paMeta.colPedidoIdNum) {
          await delExec(`DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colPedidoIdNum}\` = ?`, [idNum]);
          if (paMeta.colNumPedido && numPedidoStr) {
            await delExec(
              `DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colNumPedido}\` = ? AND (\`${paMeta.colPedidoIdNum}\` IS NULL OR \`${paMeta.colPedidoIdNum}\` = 0)`,
              [numPedidoStr]
            );
          }
        } else if (paMeta.colNumPedido && numPedidoStr) {
          await delExec(`DELETE FROM \`${paMeta.table}\` WHERE \`${paMeta.colNumPedido}\` = ?`, [numPedidoStr]);
        }

        const [delPedidoRes] = await conn.execute(
          `DELETE FROM \`${pedidosMeta.tPedidos}\` WHERE \`${pedidosMeta.pk}\` = ?`,
          [idNum]
        );
        await conn.commit();
        return { affectedRows: delPedidoRes?.affectedRows || 0, deletedLineas };
      } catch (e) {
        try { await conn.rollback(); } catch (_) {}
        throw e;
      } finally {
        conn.release();
      }
    } catch (error) {
      console.error('❌ Error eliminando pedido:', error.message);
      throw error;
    }
  }

  async togglePedidoActivo(id, value) {
    try {
      const sql = 'UPDATE pedidos SET Activo = ? WHERE Id = ?';
      await this.query(sql, [value ? 1 : 0, id]);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando estado de pedido:', error.message);
      throw error;
    }
  }

  async createPedido(pedidoData) {
    try {
      // Asegurar conexión
      if (!this.connected && !this.pool) {
        await this.connect();
      }
      await this.ensurePedidosSchema();

      const { tPedidos, pk, colCliente, colFecha, colNumPedido } = await this._ensurePedidosMeta();
      const cols = await this._getColumns(tPedidos).catch(() => []);
      const colsLower = new Map((cols || []).map((c) => [String(c).toLowerCase(), c]));
      const pick = (cands) => this._pickCIFromColumns(cols, cands);

      const colTarifaId = pick(['Id_Tarifa', 'id_tarifa', 'TarifaId', 'tarifa_id']);
      const colTarifaLegacy = pick(['Tarifa', 'tarifa']);
      const colDtoPedido = pick(['Dto', 'DTO', 'Descuento', 'DescuentoPedido', 'PorcentajeDescuento', 'porcentaje_descuento']);
      const colEstadoTxt = pick(['EstadoPedido', 'estado_pedido', 'Estado', 'estado']);
      const colEstadoId = pick(['Id_EstadoPedido', 'id_estado_pedido', 'EstadoPedidoId', 'estado_pedido_id']);

      // Mapeo payload legacy → columna BD (post-migración)
      const pedidoLegacyToCol = {
        Id_Cial: 'ped_com_id', Id_Cliente: 'ped_cli_id', Id_DireccionEnvio: 'ped_direnv_id',
        Id_FormaPago: 'ped_formp_id', Id_TipoPedido: 'ped_tipp_id', Id_Tarifa: 'ped_tarcli_id',
        Id_EstadoPedido: 'ped_estped_id', NumPedido: 'ped_numero', FechaPedido: 'ped_fecha',
        EstadoPedido: 'ped_estado_txt', TotalPedido: 'ped_total', BaseImponible: 'ped_base',
        TotalIva: 'ped_iva', TotalDescuento: 'ped_descuento', Dto: 'ped_dto',
        NumPedidoCliente: 'ped_num_pedido_cliente', NumAsociadoHefame: 'ped_num_asoc_hefame',
        FechaEntrega: 'ped_fecha_entrega', Observaciones: 'ped_observaciones',
        EsEspecial: 'ped_es_especial', EspecialEstado: 'ped_especial_estado',
        EspecialFechaSolicitud: 'ped_especial_fecha_solicitud'
      };
      // Convertir formato NocoDB a MySQL + filtrar columnas válidas
      const mysqlData = {};
      const input = pedidoData && typeof pedidoData === 'object' ? pedidoData : {};
      for (const [key, value] of Object.entries(input)) {
        const mappedKey = pedidoLegacyToCol[key] || key;
        const real = colsLower.get(String(mappedKey).toLowerCase()) || colsLower.get(String(key).toLowerCase());
        if (!real) continue;
        if (String(real).toLowerCase() === String(pk).toLowerCase()) continue;

        if (Array.isArray(value) && value.length > 0 && value[0]?.Id) {
          mysqlData[real] = value[0].Id;
        } else if (value === null || value === undefined || value === '') {
          // no enviar vacíos por defecto
          continue;
        } else {
          mysqlData[real] = value;
        }
      }

      // Defaults: NumPedido y Fecha si existen y no vienen
      if (colNumPedido && (mysqlData[colNumPedido] === undefined || mysqlData[colNumPedido] === null || String(mysqlData[colNumPedido]).trim() === '')) {
        mysqlData[colNumPedido] = await this.getNextNumeroPedido();
      }
      if (colFecha && mysqlData[colFecha] === undefined) {
        mysqlData[colFecha] = new Date();
      }

      // Default Tarifa/Dto desde cliente si procede
      try {
        const clienteId = colCliente ? Number(mysqlData[colCliente] ?? input[colCliente] ?? input.ped_cli_id ?? input.Id_Cliente ?? input.ClienteId) : NaN;
        const hasTarifa = (colTarifaId && mysqlData[colTarifaId] !== undefined) || (colTarifaLegacy && mysqlData[colTarifaLegacy] !== undefined);
        const hasDto = colDtoPedido && mysqlData[colDtoPedido] !== undefined;
        if (colCliente && Number.isFinite(clienteId) && clienteId > 0 && (!hasTarifa || !hasDto)) {
          const cliente = await this.getClienteById(clienteId);
          if (cliente) {
            const tarifaCliente =
              cliente.cli_tarcli_id ?? cliente.cli_tarifa_legacy ?? cliente.Id_Tarifa ?? cliente.id_tarifa ?? cliente.Tarifa ?? cliente.tarifa ?? 0;
            const dtoCliente = cliente.cli_dto ?? cliente.Dto ?? cliente.dto ?? null;
            if (!hasTarifa) {
              // Requisito: si el cliente tiene tarifa pero NO existe/está vigente, aplicar tarifa 0 (PVL).
              let tId = Number(tarifaCliente);
              if (!Number.isFinite(tId) || tId < 0) tId = 0;
              if (tId > 0) {
                try {
                  const tTar = await this._resolveTableNameCaseInsensitive('tarifasClientes');
                  const tarCols = await this._getColumns(tTar).catch(() => []);
                  const pickTar = (cands) => this._pickCIFromColumns(tarCols, cands);
                  const tarPk = pickTar(['Id', 'id']) || 'Id';
                  const colActiva = pickTar(['Activa', 'activa']);
                  const colInicio = pickTar(['FechaInicio', 'fecha_inicio', 'Fecha_Inicio', 'inicio']);
                  const colFin = pickTar(['FechaFin', 'fecha_fin', 'Fecha_Fin', 'fin']);
                  const rows = await this.query(`SELECT * FROM \`${tTar}\` WHERE \`${tarPk}\` = ? LIMIT 1`, [tId]);
                  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
                  if (!row) {
                    tId = 0;
                  } else {
                    const activaRaw = colActiva ? row[colActiva] : 1;
                    const activa =
                      activaRaw === 1 || activaRaw === '1' || activaRaw === true ||
                      (typeof activaRaw === 'string' && ['ok', 'si', 'sí', 'true'].includes(activaRaw.trim().toLowerCase()));
                    const now = new Date();
                    const start = colInicio && row[colInicio] ? new Date(row[colInicio]) : null;
                    const end = colFin && row[colFin] ? new Date(row[colFin]) : null;
                    const inRange = (!start || now >= start) && (!end || now <= end);
                    if (!activa || !inRange) tId = 0;
                  }
                } catch (_) {
                  // Si no podemos validar, mejor no inventar: caer a PVL.
                  tId = 0;
                }
              }
              if (colTarifaId) mysqlData[colTarifaId] = tId;
              else if (colTarifaLegacy) mysqlData[colTarifaLegacy] = tId;
            }
            if (!hasDto && colDtoPedido && dtoCliente !== null && dtoCliente !== undefined && dtoCliente !== '') {
              mysqlData[colDtoPedido] = Number(dtoCliente) || 0;
            }
          }
        }
      } catch (_) {
        // best-effort
      }

      // Estado: normalizar por catálogo (si existe columna FK) o mantener texto (legacy).
      try {
        await this.ensureEstadosPedidoTable();
        let estadoId = null;

        // Prioridad: Id_EstadoPedido explícito
        if (colEstadoId) {
          const raw = mysqlData[colEstadoId] ?? input.Id_EstadoPedido ?? input.id_estado_pedido ?? input.EstadoPedidoId ?? input.estado_pedido_id;
          const n = Number.parseInt(String(raw ?? '').trim(), 10);
          if (Number.isFinite(n) && n > 0) estadoId = n;
        }

        // Fallback: texto -> codigo
        if (!estadoId) {
          const rawTxt = colEstadoTxt ? (mysqlData[colEstadoTxt] ?? input.EstadoPedido ?? input.Estado ?? null) : (input.EstadoPedido ?? input.Estado ?? null);
          const code = String(rawTxt ?? '').trim().toLowerCase();
          if (code) estadoId = await this.getEstadoPedidoIdByCodigo(code).catch(() => null);
        }

        // Default: Pendiente
        if (!estadoId) estadoId = await this.getEstadoPedidoIdByCodigo('pendiente').catch(() => null);

        // Persistir FK si hay columna
        if (colEstadoId && estadoId && mysqlData[colEstadoId] === undefined) {
          mysqlData[colEstadoId] = estadoId;
        }

        // Persistir texto (si existe la columna legacy) para compat/reporting
        if (colEstadoTxt && (mysqlData[colEstadoTxt] === undefined || mysqlData[colEstadoTxt] === null || String(mysqlData[colEstadoTxt]).trim() === '') && estadoId) {
          const est = await this.getEstadoPedidoById(estadoId).catch(() => null);
          const eMeta = await this._ensureEstadosPedidoMeta().catch(() => null);
          const nombre = eMeta?.colNombre && est ? est[eMeta.colNombre] : (est?.nombre ?? null);
          if (nombre) mysqlData[colEstadoTxt] = String(nombre);
        }
      } catch (_) {}

      if (Object.keys(mysqlData).length === 0) {
        throw new Error('No hay campos válidos para crear el pedido');
      }

      const buildInsert = (dataObj) => {
        const fields = Object.keys(dataObj).map(key => `\`${key}\``).join(', ');
        const placeholders = Object.keys(dataObj).map(() => '?').join(', ');
        const values = Object.values(dataObj);
        const sql = `INSERT INTO \`${tPedidos}\` (${fields}) VALUES (${placeholders})`;
        return { sql, values, fields };
      };

      let insert = buildInsert(mysqlData);
      console.log('🔍 [CREATE PEDIDO] SQL:', insert.sql);
      console.log('🔍 [CREATE PEDIDO] Values:', insert.values);
      console.log('🔍 [CREATE PEDIDO] Fields count:', insert.fields.split(',').length, 'Values count:', insert.values.length);

      // Usar pool.execute directamente para obtener el ResultSetHeader con insertId
      let result;
      try {
        [result] = await this.pool.execute(insert.sql, insert.values);
      } catch (err) {
        // Compatibilidad: si la BD aún no tiene la columna Id_Tarifa, reintentar sin ella
        const msg = String(err?.sqlMessage || err?.message || '');
        const isUnknownColumn = err?.code === 'ER_BAD_FIELD_ERROR' && /Unknown column/i.test(msg) && /Id_Tarifa/i.test(msg);
        if (isUnknownColumn && Object.prototype.hasOwnProperty.call(mysqlData, 'Id_Tarifa')) {
          console.warn('⚠️ [CREATE PEDIDO] La BD no tiene Id_Tarifa. Reintentando INSERT sin Id_Tarifa...');
          delete mysqlData.Id_Tarifa;
          insert = buildInsert(mysqlData);
          [result] = await this.pool.execute(insert.sql, insert.values);
        } else {
          throw err;
        }
      }
      const insertId = result.insertId;
      
      if (!insertId) {
        console.error('❌ [CREATE PEDIDO] No se pudo obtener insertId del resultado:', result);
        console.error('❌ [CREATE PEDIDO] Result completo:', JSON.stringify(result, null, 2));
        throw new Error('No se pudo obtener el ID del pedido creado');
      }
      
      console.log(`✅ [CREATE PEDIDO] Pedido creado con ID: ${insertId}`);
      return { Id: insertId, id: insertId, insertId: insertId };
    } catch (error) {
      console.error('❌ [CREATE PEDIDO] Error creando pedido:', error.message);
      console.error('❌ [CREATE PEDIDO] Error code:', error.code);
      console.error('❌ [CREATE PEDIDO] SQL State:', error.sqlState);
      console.error('❌ [CREATE PEDIDO] Stack:', error.stack);
      console.error('❌ [CREATE PEDIDO] Datos que fallaron:', JSON.stringify(pedidoData, null, 2));
      throw error;
    }
  }

  async createPedidoLinea(payload) {
    try {
      // Asegurar conexión
      if (!this.connected && !this.pool) {
        await this.connect();
      }

      const meta = await this._ensurePedidosArticulosMeta();
      const cols = await this._getColumns(meta.table).catch(() => []);
      const colsLower = new Map((cols || []).map((c) => [String(c).toLowerCase(), c]));

      // Convertir formato NocoDB a MySQL + filtrar columnas válidas
      const mysqlData = {};
      const input = payload && typeof payload === 'object' ? payload : {};
      for (const [key, value] of Object.entries(input)) {
        const real = colsLower.get(String(key).toLowerCase());
        if (!real) continue;
        if (String(real).toLowerCase() === String(meta.pk).toLowerCase()) continue;
        if (Array.isArray(value) && value.length > 0 && value[0]?.Id) {
          mysqlData[real] = value[0].Id;
        } else if (value === null || value === undefined) {
          mysqlData[real] = null;
        } else {
          mysqlData[real] = value;
        }
      }

      if (Object.keys(mysqlData).length === 0) {
        throw new Error('No hay campos válidos para crear la línea de pedido');
      }

      const fields = Object.keys(mysqlData).map((k) => `\`${k}\``).join(', ');
      const placeholders = Object.keys(mysqlData).map(() => '?').join(', ');
      const values = Object.values(mysqlData);

      const sql = `INSERT INTO \`${meta.table}\` (${fields}) VALUES (${placeholders})`;
      const [result] = await this.pool.execute(sql, values);
      const insertId = result.insertId;
      
      if (!insertId) {
        console.error('❌ No se pudo obtener insertId del resultado:', result);
        throw new Error('No se pudo obtener el ID de la línea de pedido creada');
      }
      
      console.log(`✅ Línea de pedido creada con ID: ${insertId}`);
      return { Id: insertId, id: insertId, insertId: insertId };
    } catch (error) {
      console.error('❌ Error creando línea de pedido:', error.message);
      console.error('❌ Datos que fallaron:', JSON.stringify(payload, null, 2));
      throw error;
    }
  }

  async updatePedidoLinea(id, payload) {
    try {
      const idNum = Number(id);
      if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('ID no válido');
      if (!payload || typeof payload !== 'object') throw new Error('Payload no válido');

      if (!this.connected && !this.pool) await this.connect();

      const meta = await this._ensurePedidosArticulosMeta();
      const cols = await this._getColumns(meta.table).catch(() => []);
      const colsLower = new Map((cols || []).map((c) => [String(c).toLowerCase(), c]));

      const filtered = {};
      for (const [k, v] of Object.entries(payload)) {
        const real = colsLower.get(String(k).toLowerCase());
        if (real && String(real).toLowerCase() !== String(meta.pk).toLowerCase()) filtered[real] = v;
      }
      const keys = Object.keys(filtered);
      if (!keys.length) return { affectedRows: 0 };

      const fields = keys.map((k) => `\`${k}\` = ?`).join(', ');
      const values = keys.map((k) => filtered[k]);
      values.push(idNum);

      const sql = `UPDATE \`${meta.table}\` SET ${fields} WHERE \`${meta.pk}\` = ?`;
      const [result] = await this.pool.execute(sql, values);
      return { affectedRows: result?.affectedRows || 0, changedRows: result?.changedRows || 0 };
    } catch (error) {
      console.error('❌ Error actualizando línea de pedido:', error.message);
      throw error;
    }
  }

  async getTarifas() {
    // Best-effort:
    // - Preferir `tarifasClientes`
    // - Fallback a `tarifas` (legacy)
    // - Si no existe nada, devolver PVL (0)
    try {
      const t = await this._resolveTableNameCaseInsensitive('tarifasClientes');
      const cols = await this._getColumns(t).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['Id', 'id']) || 'Id';
      const rows = await this.query(`SELECT * FROM \`${t}\` ORDER BY \`${pk}\` ASC`);
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      try {
        const t = await this._resolveTableNameCaseInsensitive('tarifas');
        const cols = await this._getColumns(t).catch(() => []);
        const pk = this._pickCIFromColumns(cols, ['Id', 'id']) || 'id';
        const rows = await this.query(`SELECT * FROM \`${t}\` ORDER BY \`${pk}\` ASC`);
        return Array.isArray(rows) ? rows : [];
      } catch (_) {
        return [{ Id: 0, NombreTarifa: 'PVL', Activa: 1 }];
      }
    }
  }

  /**
   * Asegura que exista la tarifa "Transfer" (para pedidos no valorados).
   * Si no existe, la crea. Devuelve la tarifa encontrada o creada, o null si no se pudo.
   */
  async ensureTarifaTransfer() {
    try {
      const list = await this.getTarifas();
      const transfer = (list || []).find(
        (r) => String((r.NombreTarifa ?? r.Nombre ?? r.nombre ?? '').toLowerCase()).includes('transfer')
      );
      if (transfer) return transfer;
      const t = await this._resolveTableNameCaseInsensitive('tarifasClientes').catch(() => null);
      if (!t) return null;
      const cols = await this._getColumns(t).catch(() => []);
      const colNombre = this._pickCIFromColumns(cols, ['NombreTarifa', 'Nombre', 'nombre', 'nombre_tarifa']);
      const colActiva = this._pickCIFromColumns(cols, ['Activa', 'activa']);
      if (!colNombre) return null;
      const insertCols = [colNombre];
      const insertVals = ['Transfer'];
      if (colActiva) {
        insertCols.push(colActiva);
        insertVals.push(1);
      }
      const sql = `INSERT INTO \`${t}\` (\`${insertCols.join('`, `')}\`) VALUES (${insertCols.map(() => '?').join(', ')})`;
      const res = await this.query(sql, insertVals);
      const id = res?.insertId ?? res?.insertId;
      return { Id: id, [colNombre]: 'Transfer', NombreTarifa: 'Transfer', Activa: 1 };
    } catch (e) {
      console.warn('⚠️ [ensureTarifaTransfer]', e?.message || e);
      return null;
    }
  }

  /**
   * Copia los precios de la tarifa MIRAFARMA al PVL de artículos (articulos.PVL).
   * Para cada artículo con precio en la tarifa MIRAFARMA, actualiza articulos.PVL = ese precio.
   * @returns { Promise<{ tarifaId: number, updated: number, error?: string }> }
   */
  async copyTarifaMirafarmaToPvl() {
    try {
      if (!this.connected && !this.pool) await this.connect();

      const tTar = await this._resolveTableNameCaseInsensitive('tarifasClientes').catch(() => null);
      if (!tTar) return { tarifaId: 0, updated: 0, error: 'Tabla tarifasClientes no encontrada' };

      const tarCols = await this._getColumns(tTar).catch(() => []);
      const tarPk = this._pickCIFromColumns(tarCols, ['Id', 'id']) || 'Id';
      const colNombre = this._pickCIFromColumns(tarCols, ['NombreTarifa', 'Nombre', 'nombre', 'nombre_tarifa']) || 'NombreTarifa';

      const [tarRows] = await this.pool.execute(
        `SELECT \`${tarPk}\` AS id FROM \`${tTar}\` WHERE UPPER(TRIM(\`${colNombre}\`)) = 'MIRAFARMA' LIMIT 1`
      );
      if (!tarRows || tarRows.length === 0) return { tarifaId: 0, updated: 0, error: 'Tarifa MIRAFARMA no encontrada' };
      const tarifaId = Number(tarRows[0].id);
      if (!Number.isFinite(tarifaId) || tarifaId <= 0) return { tarifaId: 0, updated: 0, error: 'Id tarifa MIRAFARMA no válido' };

      const tTP = await this._resolveTableNameCaseInsensitive('tarifasClientes_precios').catch(() => null);
      if (!tTP) return { tarifaId, updated: 0, error: 'Tabla tarifasClientes_precios no encontrada' };

      const tpCols = await this._getColumns(tTP).catch(() => []);
      const cTar = this._pickCIFromColumns(tpCols, ['Id_Tarifa', 'id_tarifa', 'TarifaId', 'tarifa_id']) || 'Id_Tarifa';
      const cArt = this._pickCIFromColumns(tpCols, ['Id_Articulo', 'id_articulo', 'ArticuloId', 'articulo_id']) || 'Id_Articulo';
      const cPrecio = this._pickCIFromColumns(tpCols, ['Precio', 'precio', 'PrecioUnitario', 'precio_unitario', 'PVL', 'pvl']) || 'Precio';

      const [precioRows] = await this.pool.execute(
        `SELECT \`${cArt}\` AS Id_Articulo, \`${cPrecio}\` AS Precio FROM \`${tTP}\` WHERE \`${cTar}\` = ?`,
        [tarifaId]
      );
      if (!precioRows || precioRows.length === 0) return { tarifaId, updated: 0, error: 'Sin precios en tarifa MIRAFARMA' };

      const tArt = await this._resolveTableNameCaseInsensitive('articulos').catch(() => null);
      if (!tArt) return { tarifaId, updated: 0, error: 'Tabla articulos no encontrada' };
      const artCols = await this._getColumns(tArt).catch(() => []);
      const artPk = this._pickCIFromColumns(artCols, ['id', 'Id']) || 'id';
      const cPVL = this._pickCIFromColumns(artCols, ['PVL', 'pvl', 'Precio', 'precio']) || 'PVL';

      let updated = 0;
      for (const r of precioRows) {
        const idArt = Number(r.Id_Articulo);
        const precio = Number(String(r.Precio ?? '').replace(',', '.'));
        if (!Number.isFinite(idArt) || idArt <= 0 || !Number.isFinite(precio)) continue;
        const [result] = await this.pool.execute(
          `UPDATE \`${tArt}\` SET \`${cPVL}\` = ? WHERE \`${artPk}\` = ?`,
          [precio, idArt]
        );
        if (result && result.affectedRows > 0) updated += result.affectedRows;
      }
      return { tarifaId, updated };
    } catch (e) {
      console.error('❌ [copyTarifaMirafarmaToPvl]', e?.message || e);
      return { tarifaId: 0, updated: 0, error: e?.message || String(e) };
    }
  }

  /**
   * Asegura que exista la forma de pago "Transfer".
   * Si no existe, la crea. Devuelve la forma de pago encontrada o creada, o null.
   */
  async ensureFormaPagoTransfer() {
    try {
      const existing = await this.getFormaPagoByNombre('Transfer');
      if (existing) return existing;
      const table = await this._getFormasPagoTableName();
      if (!table) return null;
      const cols = await this.query(`SHOW COLUMNS FROM ${table}`).catch(() => []);
      const colNames = (cols || []).map((c) => c.Field || c.field || '').filter(Boolean);
      const hasFormaPago = colNames.some((c) => c.toLowerCase() === 'formapago' || c.toLowerCase() === 'forma_pago');
      const hasNombre = colNames.some((c) => c.toLowerCase() === 'nombre');
      const payload = {};
      if (hasFormaPago) payload.FormaPago = 'Transfer';
      if (hasNombre) payload.Nombre = 'Transfer';
      if (!Object.keys(payload).length) payload.FormaPago = 'Transfer';
      await this.createFormaPago(payload);
      return await this.getFormaPagoByNombre('Transfer');
    } catch (e) {
      console.warn('⚠️ [ensureFormaPagoTransfer]', e?.message || e);
      return null;
    }
  }

  async linkPedidoLineas(pedidoId, lineasIds) {
    try {
      // Actualizar todas las líneas para que apunten al pedido
      if (!lineasIds || lineasIds.length === 0) {
        console.warn('⚠️ No hay líneas para vincular');
        return { affectedRows: 0 };
      }
      // Verificar que todas las líneas tengan el Id_NumPedido correcto (usando 'id' como nombre de columna PK)
      const placeholders = lineasIds.map(() => '?').join(',');
      const sql = `UPDATE pedidos_articulos SET Id_NumPedido = ? WHERE id IN (${placeholders}) AND (Id_NumPedido IS NULL OR Id_NumPedido != ?)`;
      const result = await this.query(sql, [pedidoId, ...lineasIds, pedidoId]);
      console.log(`✅ ${result.affectedRows || 0} líneas verificadas/actualizadas para el pedido ${pedidoId}`);
      return { affectedRows: result.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error vinculando líneas de pedido:', error.message);
      throw error;
    }
  }

  async _ensureTiposCargoRolTable() {
    // Catálogo relacional de Cargo (tipo/rol) para Agenda: `tiposcargorol`.
    try {
      await this.query(`
        CREATE TABLE IF NOT EXISTS \`tiposcargorol\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`Nombre\` VARCHAR(120) NOT NULL,
          \`Activo\` TINYINT(1) NOT NULL DEFAULT 1,
          \`CreadoEn\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`ActualizadoEn\` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`ux_tiposcargorol_nombre\` (\`Nombre\`),
          KEY \`idx_tiposcargorol_activo_nombre\` (\`Activo\`, \`Nombre\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      return true;
    } catch (e) {
      console.warn('⚠️ [AGENDA] No se pudo asegurar tabla tiposcargorol:', e?.message || e);
      return false;
    }
  }

  async _ensureEspecialidadesIndexes() {
    // Tabla existente: `especialidades` (id, Especialidad, Observaciones).
    // Best-effort: asegurar índices para búsquedas rápidas.
    try {
      const t = await this._resolveTableNameCaseInsensitive('especialidades').catch(() => 'especialidades');
      const idxRows = await this.query(`SHOW INDEX FROM \`${t}\``).catch(() => []);
      const existing = new Set((idxRows || []).map(r => String(r.Key_name || r.key_name || '').trim()).filter(Boolean));
      // Índice por nombre (no único, por compat)
      if (!existing.has('idx_especialidades_especialidad')) {
        try { await this.query(`CREATE INDEX \`idx_especialidades_especialidad\` ON \`${t}\` (\`Especialidad\`)`); } catch (_) {}
      }
      // Único (si no existe)
      if (!existing.has('ux_especialidades_especialidad')) {
        try { await this.query(`CREATE UNIQUE INDEX \`ux_especialidades_especialidad\` ON \`${t}\` (\`Especialidad\`)`); } catch (_) {}
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  _titleCaseEs(value) {
    const s = String(value ?? '').trim();
    if (!s) return '';
    const lowerWords = new Set(['de', 'del', 'la', 'el', 'y', 'o', 'a', 'en', 'por', 'para', 'con']);
    const parts = s
      .split(/\s+/g)
      .map((p) => p.trim())
      .filter(Boolean);

    const capWord = (w) => {
      const lw = w.toLowerCase();
      if (!lw) return lw;
      // Mantener tokens numéricos tal cual
      if (/^[0-9]+$/.test(lw)) return lw;
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    };

    const capToken = (token, idx) => {
      // Mantener separadores dentro del token (p.ej. "I+D", "Co-Director")
      const raw = String(token || '');
      // Separar por '-' conservando estructura básica
      const sub = raw.split('-').map((x) => String(x || ''));
      const out = sub.map((x, subIdx) => {
        const base = x.toLowerCase();
        if (idx > 0 && subIdx === 0 && lowerWords.has(base)) return base;
        return capWord(x);
      });
      return out.join('-');
    };

    return parts.map(capToken).join(' ');
  }

  _normalizeAgendaCatalogLabel(value) {
    // Trim + colapsar espacios + capitalizar (title case ES).
    const raw = String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!raw) return '';
    return this._titleCaseEs(raw).slice(0, 120);
  }

  // AGENDA / CONTACTOS (delegado a domains/agenda.js)
  async getAgendaRoles(options = {}) {
    return domains.agenda.getAgendaRoles.apply(this, arguments);
  }
  async createAgendaRol(nombre) {
    return domains.agenda.createAgendaRol.apply(this, arguments);
  }
  async getAgendaEspecialidades(options = {}) {
    return domains.agenda.getAgendaEspecialidades.apply(this, arguments);
  }
  async createAgendaEspecialidad(nombre) {
    return domains.agenda.createAgendaEspecialidad.apply(this, arguments);
  }
  async getContactos(options = {}) {
    return domains.agenda.getContactos.apply(this, arguments);
  }
  async getContactoById(id) {
    return domains.agenda.getContactoById.apply(this, arguments);
  }
  async createContacto(payload) {
    return domains.agenda.createContacto.apply(this, arguments);
  }
  async updateContacto(id, payload) {
    return domains.agenda.updateContacto.apply(this, arguments);
  }
  async getContactosByCliente(clienteId, options = {}) {
    return domains.agenda.getContactosByCliente.apply(this, arguments);
  }
  async vincularContactoACliente(clienteId, contactoId, options = {}) {
    return domains.agenda.vincularContactoACliente.apply(this, arguments);
  }
  async setContactoPrincipalForCliente(clienteId, contactoId) {
    return domains.agenda.setContactoPrincipalForCliente.apply(this, arguments);
  }
  async cerrarVinculoContactoCliente(clienteId, contactoId, options = {}) {
    return domains.agenda.cerrarVinculoContactoCliente.apply(this, arguments);
  }
  async getClientesByContacto(contactoId, options = {}) {
    return domains.agenda.getClientesByContacto.apply(this, arguments);
  }

  // =====================================================
  // DIRECCIONES DE ENVÍO
  // =====================================================
  async getDireccionesEnvioByCliente(clienteId, options = {}) {
    try {
      const includeInactivas = Boolean(options.includeInactivas);
      const compact = Boolean(options.compact);
      const meta = await this._ensureDireccionesEnvioMeta();
      if (!meta?.table || !meta?.colCliente) return [];

      const cols = Array.isArray(meta?._cols) ? meta._cols : [];
      const pickCI = (cands) => this._pickCIFromColumns(cols, cands);

      const colAlias = pickCI(['Alias', 'alias']);
      const colDest = pickCI(['Nombre_Destinatario', 'nombre_destinatario', 'Destinatario', 'destinatario', 'Nombre', 'nombre']);
      const colDir1 = pickCI(['Direccion', 'direccion', 'Dirección']);
      const colDir2 = pickCI(['Direccion2', 'direccion2', 'Dirección2']);
      const colPob = pickCI(['Poblacion', 'poblacion']);
      const colCP = pickCI(['CodigoPostal', 'codigo_postal', 'CP', 'cp']);
      const colPais = pickCI(['Pais', 'pais']);
      const colEmail = pickCI(['Email', 'email']);
      const colTel = pickCI(['Telefono', 'telefono', 'Tel', 'tel']);
      const colMov = pickCI(['Movil', 'movil', 'Móvil']);
      const colObs = pickCI(['Observaciones', 'observaciones', 'Notas', 'notas']);

      const select = [];
      select.push(`d.\`${meta.pk}\` AS id`);
      select.push(`d.\`${meta.colCliente}\` AS Id_Cliente`);
      if (colAlias) select.push(`d.\`${colAlias}\` AS Alias`);
      if (colDest) select.push(`d.\`${colDest}\` AS Nombre_Destinatario`);
      if (colDir1) select.push(`d.\`${colDir1}\` AS Direccion`);
      if (colDir2) select.push(`d.\`${colDir2}\` AS Direccion2`);
      if (colPob) select.push(`d.\`${colPob}\` AS Poblacion`);
      if (colCP) select.push(`d.\`${colCP}\` AS CodigoPostal`);
      if (colPais) select.push(`d.\`${colPais}\` AS Pais`);
      if (!compact) {
        if (colEmail) select.push(`d.\`${colEmail}\` AS Email`);
        if (colTel) select.push(`d.\`${colTel}\` AS Telefono`);
        if (colMov) select.push(`d.\`${colMov}\` AS Movil`);
        if (colObs) select.push(`d.\`${colObs}\` AS Observaciones`);
      }
      if (meta.colActiva) select.push(`d.\`${meta.colActiva}\` AS Activa`);
      if (meta.colPrincipal) select.push(`d.\`${meta.colPrincipal}\` AS Es_Principal`);

      let sql = `SELECT ${select.join(', ')} FROM \`${meta.table}\` d WHERE d.\`${meta.colCliente}\` = ?`;
      const params = [clienteId];

      if (!includeInactivas && meta.colActiva) {
        sql += ` AND d.\`${meta.colActiva}\` = 1`;
      }

      const order = [];
      if (meta.colActiva) order.push(`d.\`${meta.colActiva}\` DESC`);
      if (meta.colPrincipal) order.push(`d.\`${meta.colPrincipal}\` DESC`);
      order.push(`d.\`${meta.pk}\` DESC`);
      sql += ` ORDER BY ${order.join(', ')}`;

      return await this.query(sql, params);
    } catch (error) {
      // Si la tabla no existe aún, no romper flujos: devolver vacío.
      const msg = String(error?.sqlMessage || error?.message || '');
      if (error?.code === 'ER_NO_SUCH_TABLE' || /doesn't exist/i.test(msg)) {
        return [];
      }
      console.error('❌ Error obteniendo direcciones de envío por cliente:', error.message);
      throw error;
    }
  }

  async getDireccionEnvioById(id) {
    try {
      const meta = await this._ensureDireccionesEnvioMeta();
      if (!meta?.table) return null;
      const rows = await this.query(
        `SELECT * FROM \`${meta.table}\` WHERE \`${meta.pk}\` = ? LIMIT 1`,
        [id]
      );
      return rows && rows.length > 0 ? rows[0] : null;
    } catch (error) {
      const msg = String(error?.sqlMessage || error?.message || '');
      if (error?.code === 'ER_NO_SUCH_TABLE' || /doesn't exist/i.test(msg)) return null;
      console.error('❌ Error obteniendo dirección de envío por ID:', error.message);
      throw error;
    }
  }

  async createDireccionEnvio(payload) {
    try {
      if (!this.connected && !this.pool) await this.connect();

      const allowed = new Set([
        'Id_Cliente',
        'Id_Contacto',
        'Alias',
        'Nombre_Destinatario',
        'Direccion',
        'Direccion2',
        'Poblacion',
        'CodigoPostal',
        'Id_Provincia',
        'Id_CodigoPostal',
        'Id_Pais',
        'Pais',
        'Telefono',
        'Movil',
        'Email',
        'Observaciones',
        'Es_Principal',
        'Activa'
      ]);

      const data = {};
      for (const [k, v] of Object.entries(payload || {})) {
        if (!allowed.has(k)) continue;
        data[k] = v === undefined ? null : v;
      }

      if (!data.Id_Cliente) throw new Error('Id_Cliente es obligatorio');

      const tDirecciones = await this._resolveTableNameCaseInsensitive('direccionesEnvio');

      // Si se marca como principal activa, desmarcar otras antes para evitar UNIQUE.
      const esPrincipal = Number(data.Es_Principal) === 1;
      const activa = (data.Activa === undefined || data.Activa === null) ? true : (Number(data.Activa) === 1);

      // Transacción para consistencia
      if (!this.pool) await this.connect();
      const conn = await this.pool.getConnection();
      try {
        await conn.beginTransaction();

        if (esPrincipal && activa) {
          await conn.execute(
            `UPDATE \`${tDirecciones}\` SET Es_Principal = 0 WHERE Id_Cliente = ? AND Activa = 1`,
            [Number(data.Id_Cliente)]
          );
        }

        const fields = Object.keys(data).map(k => `\`${k}\``).join(', ');
        const placeholders = Object.keys(data).map(() => '?').join(', ');
        const values = Object.values(data);
        const sql = `INSERT INTO \`${tDirecciones}\` (${fields}) VALUES (${placeholders})`;
        const [result] = await conn.execute(sql, values);

        await conn.commit();
        return { insertId: result.insertId };
      } catch (e) {
        try { await conn.rollback(); } catch (_) {}
        throw e;
      } finally {
        conn.release();
      }
    } catch (error) {
      console.error('❌ Error creando dirección de envío:', error.message);
      throw error;
    }
  }

  /**
   * Si un cliente no tiene direcciones de envío, crea una (principal) a partir de la dirección fiscal.
   * Devuelve { created: boolean, id: number|null }.
   */
  async ensureDireccionEnvioFiscal(clienteId) {
    const cid = Number.parseInt(String(clienteId ?? '').trim(), 10);
    if (!Number.isFinite(cid) || cid <= 0) return { created: false, id: null };
    try {
      // Si ya existe alguna dirección activa, no crear nada.
      const existing = await this.getDireccionesEnvioByCliente(cid, { compact: true }).catch(() => []);
      const arr = Array.isArray(existing) ? existing : [];
      if (arr.length > 0) {
        const firstId = Number.parseInt(String(arr[0]?.id ?? arr[0]?.Id ?? '').trim(), 10);
        return { created: false, id: Number.isFinite(firstId) ? firstId : null };
      }

      const c = await this.getClienteById(cid).catch(() => null);
      if (!c) return { created: false, id: null };

      const nombre = String(c.cli_nombre_razon_social ?? c.Nombre ?? '').trim();
      const direccion = String(c.Direccion ?? c.direccion ?? '').trim();
      const poblacion = String(c.Poblacion ?? c.poblacion ?? '').trim();
      const cp = String(c.CodigoPostal ?? c.codigo_postal ?? c.CP ?? c.cp ?? '').trim();
      const pais = String(c.Pais ?? c.pais ?? '').trim();

      // Si no hay una dirección fiscal mínima, no podemos crear.
      if (!direccion && !poblacion && !cp) return { created: false, id: null };

      const created = await this.createDireccionEnvio({
        Id_Cliente: cid,
        Alias: 'Fiscal',
        Nombre_Destinatario: nombre || null,
        Direccion: direccion || null,
        Poblacion: poblacion || null,
        CodigoPostal: cp || null,
        Pais: pais || null,
        Es_Principal: 1,
        Activa: 1
      });
      const id = Number(created?.insertId ?? 0) || null;
      return { created: Boolean(id), id };
    } catch (e) {
      console.warn('⚠️ Error asegurando dirección envío fiscal:', e?.message || e);
      return { created: false, id: null };
    }
  }

  async updateDireccionEnvio(id, payload) {
    try {
      if (!this.connected && !this.pool) {
        await this.connect();
      }

      const allowed = new Set([
        'Id_Contacto',
        'Alias',
        'Nombre_Destinatario',
        'Direccion',
        'Direccion2',
        'Poblacion',
        'CodigoPostal',
        'Id_Provincia',
        'Id_CodigoPostal',
        'Id_Pais',
        'Pais',
        'Telefono',
        'Movil',
        'Email',
        'Observaciones',
        'Es_Principal',
        'Activa'
      ]);

      const fields = [];
      const values = [];
      for (const [k, v] of Object.entries(payload || {})) {
        if (!allowed.has(k)) continue;
        fields.push(`\`${k}\` = ?`);
        values.push(v === undefined ? null : v);
      }
      if (!fields.length) return { affectedRows: 0 };

      const tDirecciones = await this._resolveTableNameCaseInsensitive('direccionesEnvio');

      // Si se pone como principal activa, desmarcar otras antes.
      const willSetPrincipal = Object.prototype.hasOwnProperty.call(payload || {}, 'Es_Principal') && Number(payload.Es_Principal) === 1;
      const willBeActive = !Object.prototype.hasOwnProperty.call(payload || {}, 'Activa') || Number(payload.Activa) === 1;

      if (!this.pool) await this.connect();
      const conn = await this.pool.getConnection();
      try {
        await conn.beginTransaction();

        let clienteId = null;
        try {
          const [rows] = await conn.execute(`SELECT Id_Cliente FROM \`${tDirecciones}\` WHERE id = ? LIMIT 1`, [id]);
          clienteId = rows?.[0]?.Id_Cliente ?? null;
        } catch (_) {
          clienteId = null;
        }

        if (clienteId && willSetPrincipal && willBeActive) {
          await conn.execute(
            `UPDATE \`${tDirecciones}\` SET Es_Principal = 0 WHERE Id_Cliente = ? AND Activa = 1`,
            [Number(clienteId)]
          );
        }

        values.push(id);
        const sql = `UPDATE \`${tDirecciones}\` SET ${fields.join(', ')} WHERE id = ?`;
        const [result] = await conn.execute(sql, values);

        await conn.commit();
        return { affectedRows: result.affectedRows || 0 };
      } catch (e) {
        try { await conn.rollback(); } catch (_) {}
        throw e;
      } finally {
        conn.release();
      }
    } catch (error) {
      console.error('❌ Error actualizando dirección de envío:', error.message);
      throw error;
    }
  }

  async desactivarDireccionEnvio(id) {
    try {
      if (!this.connected && !this.pool) {
        await this.connect();
      }
      const tDirecciones = await this._resolveTableNameCaseInsensitive('direccionesEnvio');
      const sql = `UPDATE \`${tDirecciones}\` SET Activa = 0, Es_Principal = 0 WHERE id = ?`;
      const result = await this.query(sql, [id]);
      return { affectedRows: result.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error desactivando dirección de envío:', error.message);
      throw error;
    }
  }

  // VISITAS (delegado a domains/visitas.js)
  async getVisitas(comercialId = null) {
    return domains.visitas.getVisitas.apply(this, arguments);
  }
  async getVisitasPaged(filters = {}, options = {}) {
    return domains.visitas.getVisitasPaged.apply(this, arguments);
  }
  async countVisitas(filters = {}) {
    return domains.visitas.countVisitas.apply(this, arguments);
  }
  async getVisitasByComercial(comercialId) {
    return domains.visitas.getVisitasByComercial.apply(this, arguments);
  }
  async getVisitasByCliente(clienteId) {
    return domains.visitas.getVisitasByCliente.apply(this, arguments);
  }
  async getVisitaById(id) {
    return domains.visitas.getVisitaById.apply(this, arguments);
  }
  async createVisita(visitaData) {
    return domains.visitas.createVisita.apply(this, arguments);
  }
  async updateVisita(visitaId, visitaData) {
    return domains.visitas.updateVisita.apply(this, arguments);
  }
  async deleteVisita(id) {
    return domains.visitas.deleteVisita.apply(this, arguments);
  }

  // CENTROS DE SALUD
  async getCentrosSalud() {
    try {
      const sql = 'SELECT * FROM centros_salud ORDER BY Id ASC';
      const rows = await this.query(sql);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo centros de salud:', error.message);
      return [];
    }
  }

  async getCentroSaludById(id) {
    try {
      const sql = 'SELECT * FROM centros_salud WHERE Id = ? LIMIT 1';
      const rows = await this.query(sql, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo centro de salud por ID:', error.message);
      return null;
    }
  }

  // MÉDICOS Y ENFERMERAS
  async getMedicosEnfermeras() {
    try {
      const sql = 'SELECT * FROM medicos_enfermeras ORDER BY Id ASC';
      const rows = await this.query(sql);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo médicos/enfermeras:', error.message);
      return [];
    }
  }

  async getMedicosEnfermerasByCentro(centroId) {
    try {
      const sql = 'SELECT * FROM medicos_enfermeras WHERE CentroSaludId = ? OR centroSaludId = ? ORDER BY Id ASC';
      const rows = await this.query(sql, [centroId, centroId]);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo médicos/enfermeras por centro:', error.message);
      return [];
    }
  }

  // ESTADÍSTICAS
  async getEstadisticasComercial(comercialId) {
    try {
      const stats = {
        totalClientes: 0,
        totalPedidos: 0,
        totalVisitas: 0,
        pedidosActivos: 0
      };

      const [clientes] = await this.pool.execute('SELECT COUNT(*) as count FROM clientes WHERE ComercialId = ? OR comercialId = ?', [comercialId, comercialId]);
      stats.totalClientes = clientes[0]?.count || 0;

      const [pedidos] = await this.pool.execute('SELECT COUNT(*) as count FROM pedidos WHERE ComercialId = ? OR comercialId = ?', [comercialId, comercialId]);
      stats.totalPedidos = pedidos[0]?.count || 0;

      const [visitas] = await this.pool.execute('SELECT COUNT(*) as count FROM visitas WHERE ComercialId = ? OR comercialId = ?', [comercialId, comercialId]);
      stats.totalVisitas = visitas[0]?.count || 0;

      const [activos] = await this.pool.execute('SELECT COUNT(*) as count FROM pedidos WHERE (ComercialId = ? OR comercialId = ?) AND Activo = 1', [comercialId, comercialId]);
      stats.pedidosActivos = activos[0]?.count || 0;

      return stats;
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas:', error.message);
      return {
        totalClientes: 0,
        totalPedidos: 0,
        totalVisitas: 0,
        pedidosActivos: 0
      };
    }
  }

  // FORMAS_PAGO - MÉTODOS DUPLICADOS ELIMINADOS (los correctos están en las líneas 1125-1191)

  // ESPECIALIDADES
  async getEspecialidades() {
    try {
      const sql = 'SELECT * FROM especialidades ORDER BY Id ASC';
      const rows = await this.query(sql);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo especialidades:', error.message);
      return [];
    }
  }

  async getEspecialidadById(id) {
    try {
      const sql = 'SELECT * FROM especialidades WHERE Id = ? LIMIT 1';
      const rows = await this.query(sql, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo especialidad por ID:', error.message);
      return null;
    }
  }

  async createEspecialidad(payload) {
    try {
      const fields = Object.keys(payload).map(key => `\`${key}\``).join(', ');
      const placeholders = Object.keys(payload).map(() => '?').join(', ');
      const values = Object.values(payload);
      
      const sql = `INSERT INTO especialidades (${fields}) VALUES (${placeholders})`;
      const result = await this.query(sql, values);
      return { insertId: result.insertId || result.insertId };
    } catch (error) {
      console.error('❌ Error creando especialidad:', error.message);
      throw error;
    }
  }

  async updateEspecialidad(id, payload) {
    try {
      const fields = Object.keys(payload).map(key => `\`${key}\` = ?`).join(', ');
      const values = Object.values(payload);
      values.push(id);
      
      const sql = `UPDATE especialidades SET ${fields} WHERE Id = ?`;
      await this.query(sql, values);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando especialidad:', error.message);
      throw error;
    }
  }

  async deleteEspecialidad(id) {
    try {
      const sql = 'DELETE FROM especialidades WHERE Id = ?';
      await this.query(sql, [id]);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error eliminando especialidad:', error.message);
      throw error;
    }
  }

  // Método genérico para compatibilidad (no usado en MySQL directo)
  async getTableData(tableName, options = {}) {
    try {
      const sql = `SELECT * FROM \`${tableName}\` ORDER BY Id ASC`;
      const rows = await this.query(sql);
      return rows;
    } catch (error) {
      console.error(`❌ Error obteniendo datos de ${tableName}:`, error.message);
      return [];
    }
  }

  // CONFIGURACIONES
  async getConfiguracion(clave) {
    try {
      const sql = 'SELECT * FROM Configuraciones WHERE clave = ? LIMIT 1';
      const rows = await this.query(sql, [clave]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error(`❌ Error obteniendo configuración ${clave}:`, error.message);
      return null;
    }
  }

  async getConfiguracionValor(clave, defaultValue = '') {
    try {
      const config = await this.getConfiguracion(clave);
      return config ? (config.valor || defaultValue) : defaultValue;
    } catch (error) {
      console.error(`❌ Error obteniendo valor de configuración ${clave}:`, error.message);
      return defaultValue;
    }
  }

  async setConfiguracion(clave, valor, descripcion = null, tipo = 'text') {
    try {
      // Asegurar conexión
      if (!this.connected && !this.pool) {
        await this.connect();
      }
      
      // Intentar actualizar primero
      const sqlUpdate = 'UPDATE Configuraciones SET valor = ?, descripcion = ?, tipo = ? WHERE clave = ?';
      const [result] = await this.pool.execute(sqlUpdate, [valor, descripcion, tipo, clave]);
      
      // Si no se actualizó ninguna fila, insertar
      if (result.affectedRows === 0) {
        const sqlInsert = 'INSERT INTO Configuraciones (clave, valor, descripcion, tipo) VALUES (?, ?, ?, ?)';
        await this.pool.execute(sqlInsert, [clave, valor, descripcion, tipo]);
      }
      
      return { success: true };
    } catch (error) {
      console.error(`❌ Error guardando configuración ${clave}:`, error.message);
      throw error;
    }
  }

  async getAllConfiguraciones() {
    try {
      const sql = 'SELECT * FROM Configuraciones ORDER BY clave ASC';
      const rows = await this.query(sql);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo todas las configuraciones:', error.message);
      return [];
    }
  }

  // API KEYS
  async getApiKeyByKey(apiKey) {
    try {
      const sql = 'SELECT * FROM `api_keys` WHERE api_key = ? AND activa = 1 LIMIT 1';
      const rows = await this.query(sql, [apiKey]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo API key:', error.message);
      return null;
    }
  }

  async getAllApiKeys() {
    try {
      // Incluir api_key para que los administradores puedan consultarla
      const sql = 'SELECT id, nombre, api_key, descripcion, activa, ultimo_uso, creado_en, actualizado_en, creado_por FROM `api_keys` ORDER BY creado_en DESC';
      const rows = await this.query(sql);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo todas las API keys:', error.message);
      return [];
    }
  }

  async createApiKey(nombre, descripcion = null, creadoPor = null) {
    try {
      // Generar API key único
      const crypto = require('crypto');
      const apiKey = 'farma_' + crypto.randomBytes(32).toString('hex');
      
      const sql = 'INSERT INTO `api_keys` (nombre, api_key, descripcion, creado_por) VALUES (?, ?, ?, ?)';
      const [result] = await this.pool.execute(sql, [nombre, apiKey, descripcion, creadoPor]);
      
      return {
        id: result.insertId,
        nombre: nombre,
        api_key: apiKey,
        descripcion: descripcion
      };
    } catch (error) {
      console.error('❌ Error creando API key:', error.message);
      throw error;
    }
  }

  async updateApiKeyUsage(apiKey) {
    try {
      const sql = 'UPDATE `api_keys` SET ultimo_uso = NOW() WHERE api_key = ?';
      await this.query(sql, [apiKey]);
    } catch (error) {
      console.error('❌ Error actualizando uso de API key:', error.message);
      // No lanzar error, solo log
    }
  }

  async toggleApiKey(id, activa) {
    try {
      const sql = 'UPDATE `api_keys` SET activa = ? WHERE id = ?';
      await this.query(sql, [activa ? 1 : 0, id]);
      return { success: true };
    } catch (error) {
      console.error('❌ Error actualizando estado de API key:', error.message);
      throw error;
    }
  }

  async deleteApiKey(id) {
    try {
      const sql = 'DELETE FROM `api_keys` WHERE id = ?';
      await this.query(sql, [id]);
      return { success: true };
    } catch (error) {
      console.error('❌ Error eliminando API key:', error.message);
      throw error;
    }
  }

  // =====================================================
  // Helpers internos (tablas con case variable)
  // =====================================================
  async _getCodigosPostalesTableName() {
    // Cache simple en la instancia
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
  }

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
  }

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
  }

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
  }

  // =====================================================
  // MÉTODOS CRUD PARA CÓDIGOS POSTALES
  // =====================================================

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
  }

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
  }

  async createCodigoPostal(data) {
    try {
      // Resolver nombre real de la tabla de códigos postales (en algunos servidores MySQL es case-sensitive)
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
  }

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
  }

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
  }

  // =====================================================
  // MÉTODOS CRUD PARA ASIGNACIONES COMERCIALES - CÓDIGOS POSTALES - MARCAS
  // =====================================================

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

      console.log(`✅ [ASIGNACIONES] Ejecutando consulta SQL: ${sql.substring(0, 200)}...`);
      console.log(`✅ [ASIGNACIONES] Parámetros:`, params);
      const rows = await this.query(sql, params);
      console.log(`✅ [ASIGNACIONES] Resultados obtenidos: ${rows ? rows.length : 0} asignaciones`);
      if (rows && rows.length > 0) {
        const ejemplo = rows[0];
        console.log(`✅ [ASIGNACIONES] Ejemplo de asignación:`);
        console.log(`   - CodigoPostal: ${ejemplo.CodigoPostal}`);
        console.log(`   - Poblacion: ${ejemplo.Poblacion}`);
        console.log(`   - NumClientes: ${ejemplo.NumClientes}`);
        console.log(`   - Localidad: ${ejemplo.Localidad}`);
        console.log(`✅ [ASIGNACIONES] Primera asignación completa:`, JSON.stringify({
          CodigoPostal: ejemplo.CodigoPostal,
          Poblacion: ejemplo.Poblacion,
          NumClientes: ejemplo.NumClientes,
          Localidad: ejemplo.Localidad
        }, null, 2));
      } else {
        console.warn(`⚠️ [ASIGNACIONES] No se encontraron asignaciones con los filtros aplicados`);
      }
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('❌ [ASIGNACIONES] Error obteniendo asignaciones:', error.message);
      console.error('❌ [ASIGNACIONES] Stack:', error.stack);
      // Devolver array vacío en lugar de lanzar error para evitar 500
      return [];
    }
  }

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
  }

  async createAsignacion(data) {
    try {
      // Validación defensiva (evita errores SQL tipo "Field 'Id_CodigoPostal' doesn't have a default value")
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
  }

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
  }

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
  }

  // =====================================================
  // MÉTODOS PARA ASIGNACIONES MASIVAS
  // =====================================================

  /**
   * Crear asignaciones masivas
   * @param {Object} data - Datos de la asignación masiva
   * @param {number} data.Id_Comercial - ID del comercial
   * @param {Array<number>} data.Ids_CodigosPostales - Array de IDs de códigos postales
   * @param {number|null} data.Id_Marca - ID de la marca (null = todas las marcas)
   * @param {Date|null} data.FechaInicio - Fecha de inicio
   * @param {Date|null} data.FechaFin - Fecha de fin
   * @param {number} data.Prioridad - Prioridad
   * @param {boolean} data.Activo - Si está activo
   * @param {string|null} data.Observaciones - Observaciones
   * @param {number|null} data.CreadoPor - ID del usuario que crea
   * @param {boolean} data.ActualizarClientes - Si actualizar clientes automáticamente
   * @returns {Object} Resultado con asignaciones creadas y clientes actualizados
   */
  async createAsignacionesMasivas(data) {
    const connection = await this.pool.getConnection();
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

      // Obtener todas las marcas si Id_Marca es null
      let marcas = [];
      if (Id_Marca === null || Id_Marca === '') {
        // Verificar si la columna Activo existe en Marcas antes de usarla
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
        
        // Consultar marcas (con filtro Activo solo si existe)
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

      // Crear asignaciones para cada código postal y marca
      for (const Id_CodigoPostal of Ids_CodigosPostales) {
        for (const marcaId of marcas) {
          try {
            // Verificar si ya existe
            const existe = await this.query(
              `SELECT id FROM Comerciales_Codigos_Postales_Marcas 
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

            // Crear nueva asignación
            const result = await this.query(
              `INSERT INTO Comerciales_Codigos_Postales_Marcas 
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

      // Actualizar clientes si se solicita
      let clientesActualizados = 0;
      if (ActualizarClientes && asignacionesCreadas.length > 0) {
        // Obtener códigos postales únicos de las asignaciones creadas
        const codigosPostalesUnicos = [...new Set(asignacionesCreadas.map(a => a.Id_CodigoPostal))];
        
        // Actualizar clientes que tengan estos códigos postales
        // Usar el comercial específico que acabamos de asignar
        if (codigosPostalesUnicos.length > 0) {
          // Usar placeholders para evitar inyección SQL
          const placeholders = codigosPostalesUnicos.map(() => '?').join(',');
          
          console.log(`✅ [ACTUALIZAR-CLIENTES] Actualizando clientes con códigos postales: ${codigosPostalesUnicos.join(', ')}`);
          console.log(`✅ [ACTUALIZAR-CLIENTES] Comercial asignado: ${Id_Comercial}, Prioridad: ${Prioridad}`);
          
          // Obtener la prioridad máxima del comercial asignado para estos códigos postales
          const prioridadPlaceholders = codigosPostalesUnicos.map(() => '?').join(',');
          const prioridadResult = await this.query(
            `SELECT MAX(Prioridad) as maxPrioridad 
             FROM Comerciales_Codigos_Postales_Marcas 
             WHERE Id_Comercial = ? 
               AND Id_CodigoPostal IN (${prioridadPlaceholders})
               AND Activo = 1
               AND (FechaFin IS NULL OR FechaFin >= CURDATE())
               AND (FechaInicio IS NULL OR FechaInicio <= CURDATE())`,
            [Id_Comercial, ...codigosPostalesUnicos]
          );
          
          const prioridadComercial = prioridadResult[0]?.maxPrioridad || Prioridad || 0;
          console.log(`✅ [ACTUALIZAR-CLIENTES] Prioridad del comercial asignado: ${prioridadComercial}`);
          
          // Obtener los códigos postales (texto) de los IDs
          const codigosPostalesTexto = await this.query(
            `SELECT CodigoPostal FROM Codigos_Postales WHERE id IN (${placeholders})`,
            codigosPostalesUnicos
          );
          const codigosPostalesArray = codigosPostalesTexto.map(cp => cp.CodigoPostal);
          const codigosPostalesPlaceholders = codigosPostalesArray.map(() => '?').join(',');
          
          console.log(`✅ [ACTUALIZAR-CLIENTES] Códigos postales a buscar: ${codigosPostalesArray.join(', ')}`);
          
          // Actualizar clientes directamente con el comercial asignado
          // Buscar por Id_CodigoPostal O por CodigoPostal (texto) si Id_CodigoPostal es null
          // Solo actualizar si el cliente no tiene comercial o si la prioridad del nuevo comercial es mayor
          const updateResult = await this.query(
            `UPDATE Clientes c
             LEFT JOIN Codigos_Postales cp ON c.Id_CodigoPostal = cp.id
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
                   FROM Comerciales_Codigos_Postales_Marcas ccp2
                   INNER JOIN Codigos_Postales cp2 ON ccp2.Id_CodigoPostal = cp2.id
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
          console.log(`✅ [ACTUALIZAR-CLIENTES] Clientes actualizados con comercial ${Id_Comercial}: ${clientesActualizados}`);
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
  }

  /**
   * Crear asignaciones masivas por provincia
   * @param {Object} data - Datos de la asignación masiva por provincia
   * @param {number} data.Id_Comercial - ID del comercial
   * @param {number|string} data.Id_Provincia - ID o nombre de la provincia
   * @param {number|null} data.Id_Marca - ID de la marca (null = todas las marcas)
   * @param {Date|null} data.FechaInicio - Fecha de inicio
   * @param {Date|null} data.FechaFin - Fecha de fin
   * @param {number} data.Prioridad - Prioridad
   * @param {boolean} data.Activo - Si está activo
   * @param {string|null} data.Observaciones - Observaciones
   * @param {number|null} data.CreadoPor - ID del usuario que crea
   * @param {boolean} data.ActualizarClientes - Si actualizar clientes automáticamente
   * @returns {Object} Resultado con asignaciones creadas y clientes actualizados
   */
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

      console.log(`✅ [ASIGNACIONES-PROVINCIA] Iniciando asignación por provincia:`);
      console.log(`   - Id_Comercial: ${Id_Comercial}`);
      console.log(`   - Id_Provincia: ${Id_Provincia}`);
      console.log(`   - Id_Marca: ${Id_Marca}`);
      console.log(`   - Prioridad: ${Prioridad}`);
      console.log(`   - ActualizarClientes: ${ActualizarClientes}`);

      if (!Id_Comercial || !Id_Provincia) {
        throw new Error('Id_Comercial e Id_Provincia son obligatorios');
      }

      // Obtener todos los códigos postales activos de la provincia
      let sql = `
        SELECT id FROM Codigos_Postales 
        WHERE Activo = 1
      `;
      const params = [];

      // Si Id_Provincia es numérico, usar Id_Provincia, si no, usar Provincia
      if (typeof Id_Provincia === 'number' || /^\d+$/.test(Id_Provincia)) {
        sql += ' AND Id_Provincia = ?';
        params.push(parseInt(Id_Provincia));
      } else {
        sql += ' AND Provincia = ?';
        params.push(Id_Provincia);
      }

      console.log(`✅ [ASIGNACIONES-PROVINCIA] Consultando códigos postales con SQL: ${sql}`);
      console.log(`✅ [ASIGNACIONES-PROVINCIA] Parámetros:`, params);

      const codigosPostales = await this.query(sql, params);

      console.log(`✅ [ASIGNACIONES-PROVINCIA] Códigos postales encontrados: ${codigosPostales ? codigosPostales.length : 0}`);

      if (!codigosPostales || codigosPostales.length === 0) {
        throw new Error(`No se encontraron códigos postales para la provincia: ${Id_Provincia}`);
      }

      const Ids_CodigosPostales = codigosPostales.map(cp => cp.id);
      console.log(`✅ [ASIGNACIONES-PROVINCIA] IDs de códigos postales: ${Ids_CodigosPostales.slice(0, 10).join(', ')}... (${Ids_CodigosPostales.length} total)`);

      // Usar el método de asignaciones masivas
      const resultado = await this.createAsignacionesMasivas({
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

      console.log(`✅ [ASIGNACIONES-PROVINCIA] Resultado:`, JSON.stringify(resultado, null, 2));

      return resultado;
    } catch (error) {
      console.error('❌ Error creando asignaciones por provincia:', error.message);
      console.error('❌ Stack:', error.stack);
      throw error;
    }
  }

  /**
   * Actualizar solo la contraseña de un comercial (hash bcrypt).
   * @param {number} comercialId - id del comercial
   * @param {string} hashedPassword - contraseña ya hasheada con bcrypt
   */
  async updateComercialPassword(comercialId, hashedPassword) {
    try {
      if (!this.connected && !this.pool) await this.connect();
      const t = await this._resolveTableNameCaseInsensitive('comerciales');
      const cols = await this._getColumns(t);
      const colPwd = this._pickCIFromColumns(cols, ['com_password', 'Password', 'password']) || 'Password';
      const pk = this._pickCIFromColumns(cols, ['com_id', 'Id', 'id']) || 'id';
      const sql = `UPDATE \`${t}\` SET \`${colPwd}\` = ? WHERE \`${pk}\` = ?`;
      const [result] = await this.pool.execute(sql, [hashedPassword, comercialId]);
      return (result?.affectedRows ?? 0) > 0;
    } catch (e) {
      console.error('❌ Error actualizando contraseña:', e?.message);
      throw e;
    }
  }

  // ============================================
  // MÉTODOS DE RECUPERACIÓN DE CONTRASEÑA
  // ============================================

  async _ensurePasswordResetTokensTable() {
    try {
      await this.query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id INT NOT NULL AUTO_INCREMENT,
          comercial_id INT NOT NULL,
          token VARCHAR(128) NOT NULL,
          email VARCHAR(255) NOT NULL,
          expires_at DATETIME NOT NULL,
          used TINYINT(1) NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_token (token),
          KEY idx_email_created (email, created_at),
          KEY idx_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    } catch (e) {
      console.warn('⚠️ No se pudo asegurar tabla password_reset_tokens:', e?.message);
    }
  }

  /**
   * Crear un token de recuperación de contraseña
   */
  async createPasswordResetToken(comercialId, email, token, expiresInHours = 1) {
    try {
      if (!this.connected && !this.pool) await this.connect();
      await this._ensurePasswordResetTokensTable();

      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expiresInHours);

      // Invalidar tokens anteriores no usados del mismo usuario
      await this.pool.execute(
        'UPDATE password_reset_tokens SET used = 1 WHERE comercial_id = ? AND used = 0',
        [comercialId]
      );

      // Crear nuevo token
      const sql = `INSERT INTO password_reset_tokens (comercial_id, token, email, expires_at, used) 
                   VALUES (?, ?, ?, ?, 0)`;
      const [result] = await this.pool.execute(sql, [comercialId, token, email, expiresAt]);
      return { insertId: result.insertId, expiresAt };
    } catch (error) {
      console.error('❌ Error creando token de recuperación:', error.message);
      throw error;
    }
  }

  /**
   * Buscar un token de recuperación válido
   */
  async findPasswordResetToken(token) {
    try {
      if (!this.connected && !this.pool) await this.connect();
      await this._ensurePasswordResetTokensTable();

      const sql = `SELECT * FROM password_reset_tokens 
                   WHERE token = ? AND used = 0 AND expires_at > NOW() 
                   LIMIT 1`;
      const [rows] = await this.pool.execute(sql, [token]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error buscando token de recuperación:', error.message);
      return null;
    }
  }

  /**
   * Marcar un token como usado
   */
  async markPasswordResetTokenAsUsed(token) {
    try {
      if (!this.connected && !this.pool) {
        await this.connect();
      }

      const sql = 'UPDATE password_reset_tokens SET used = 1 WHERE token = ?';
      const [result] = await this.pool.execute(sql, [token]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('❌ Error marcando token como usado:', error.message);
      return false;
    }
  }

  /**
   * Limpiar tokens expirados
   */
  async cleanupExpiredTokens() {
    try {
      if (!this.connected && !this.pool) {
        await this.connect();
      }

      const sql = 'DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used = 1';
      const [result] = await this.pool.execute(sql);
      return result.affectedRows || 0;
    } catch (error) {
      console.error('❌ Error limpiando tokens expirados:', error.message);
      return 0;
    }
  }

  /**
   * Verificar intentos recientes de recuperación (rate limiting)
   */
  async countRecentPasswordResetAttempts(email, hours = 1) {
    try {
      if (!this.connected && !this.pool) await this.connect();
      await this._ensurePasswordResetTokensTable();

      const sql = `SELECT COUNT(*) as count FROM password_reset_tokens 
                   WHERE email = ? AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)`;
      const [rows] = await this.pool.execute(sql, [email, hours]);
      return rows[0]?.count || 0;
    } catch (error) {
      console.error('❌ Error contando intentos recientes:', error.message);
      return 0;
    }
  }

  // REGISTRO PÚBLICO DE VISITAS (layout tipo Excel)
  async ensureRegistroVisitasSchema() {
    try {
      if (!this.connected && !this.pool) {
        await this.connect();
      }
      // Best-effort: si el entorno no permite CREATE TABLE, no romper el servidor
      await this.query(`
        CREATE TABLE IF NOT EXISTS \`registro_visitas\` (
          id INT NOT NULL AUTO_INCREMENT,
          fecha DATE NOT NULL,
          comercial_id INT NOT NULL,
          cliente VARCHAR(180) NOT NULL,
          ciudad_zona VARCHAR(120) NULL,
          tipo_visita VARCHAR(40) NOT NULL,
          motivo VARCHAR(40) NULL,
          resultado VARCHAR(40) NULL,
          importe_estimado DECIMAL(12,2) NULL,
          proxima_accion VARCHAR(120) NULL,
          proxima_fecha DATE NULL,
          notas VARCHAR(800) NULL,
          ip VARCHAR(45) NULL,
          user_agent VARCHAR(255) NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_registro_visitas_fecha (fecha),
          KEY idx_registro_visitas_comercial (comercial_id),
          KEY idx_registro_visitas_fecha_comercial (fecha, comercial_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    } catch (e) {
      console.warn('⚠️ [SCHEMA] No se pudo asegurar registro_visitas:', e?.message || e);
    }
  }

  async createRegistroVisita(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('Payload no válido');
    await this.ensureRegistroVisitasSchema();

    const fields = Object.keys(payload)
      .filter((k) => payload[k] !== undefined)
      .map((k) => `\`${k}\``)
      .join(', ');
    const placeholders = Object.keys(payload)
      .filter((k) => payload[k] !== undefined)
      .map(() => '?')
      .join(', ');
    const values = Object.keys(payload)
      .filter((k) => payload[k] !== undefined)
      .map((k) => payload[k]);

    const sql = `INSERT INTO \`registro_visitas\` (${fields}) VALUES (${placeholders})`;
    const result = await this.query(sql, values);
    return { insertId: result?.insertId || null };
  }

  async getRegistroVisitasByFecha(fechaYmd, { limit = 50 } = {}) {
    try {
      await this.ensureRegistroVisitasSchema();
      const lim = Math.max(1, Math.min(200, Number(limit) || 50));
      const ymd = String(fechaYmd || '').slice(0, 10);
      if (!ymd) return [];

      // Join suave: si cambia el esquema de comerciales, mostramos al menos el id
      const rows = await this.query(
        `
          SELECT
            rv.id,
            rv.fecha,
            rv.comercial_id,
            COALESCE(c.com_nombre, c.Nombre, c.nombre, c.name, CONCAT('Comercial ', rv.comercial_id)) AS comercial_nombre,
            rv.cliente,
            rv.ciudad_zona,
            rv.tipo_visita,
            rv.motivo,
            rv.resultado,
            rv.importe_estimado,
            rv.proxima_accion,
            rv.proxima_fecha,
            rv.notas,
            rv.created_at
          FROM \`registro_visitas\` rv
          LEFT JOIN \`comerciales\` c ON c.com_id = rv.comercial_id
          WHERE rv.fecha = ?
          ORDER BY rv.id DESC
          LIMIT ${lim}
        `,
        [ymd]
      );
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      console.warn('⚠️ Error leyendo registro_visitas por fecha:', e?.message || e);
      return [];
    }
  }
}

Object.assign(MySQLCRM.prototype, clientesModule);

module.exports = new MySQLCRM();

