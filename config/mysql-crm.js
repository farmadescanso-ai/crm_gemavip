const mysql = require('mysql2/promise');
const tiposVisitaFallback = require('./tipos-visita.json');
const estadosVisitaFallback = require('./estados-visita.json');

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
    try {
      const rows = await this.query(`SHOW COLUMNS FROM \`${tableName}\``);
      const cols = (Array.isArray(rows) ? rows : [])
        .map(r => String(r.Field || r.field || '').trim())
        .filter(Boolean);
      return cols;
    } catch (_) {
      // Fallback cuando SHOW COLUMNS no está permitido
      try {
        const r = await this.queryWithFields(`SELECT * FROM \`${tableName}\` LIMIT 0`);
        const fields = Array.isArray(r?.fields) ? r.fields : [];
        const cols = fields
          .map((f) => String(f?.name || '').trim())
          .filter(Boolean);
        return cols;
      } catch (_) {
        return [];
      }
    }
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
      pk: pickCI(['Id', 'id']) || 'Id',
      colComercial: pickCI([
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
      colCliente: pickCI(['ClienteId', 'clienteId', 'Id_Cliente', 'id_cliente', 'Cliente_id', 'cliente_id', 'FarmaciaClienteId', 'farmaciaClienteId']),
      colFecha: pickCI(['Fecha', 'fecha', 'FechaVisita', 'fechaVisita', 'Fecha_Visita', 'fecha_visita', 'Fecha_Visita', 'fechaVisita']),
      colHora: pickCI(['Hora', 'hora', 'Hora_Visita', 'hora_visita']),
      colHoraFinal: pickCI(['Hora_Final', 'hora_final', 'HoraFinal', 'horaFinal', 'Hora_Fin', 'hora_fin', 'HoraFin', 'horaFin']),
      colTipo: pickCI([
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
        'id_tipo_visita',
        'TipoVisitaId',
        'Tipo_VisitaId',
        'tipoVisitaId'
      ]),
      colEstado: pickCI(['Estado', 'estado', 'EstadoVisita', 'estadoVisita', 'Estado_Visita', 'estado_visita']),
      colNotas: pickCI(['Notas', 'notas', 'Observaciones', 'observaciones', 'Comentarios', 'comentarios', 'Mensaje', 'mensaje'])
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

    const pk = pickCI(['Id', 'id']) || 'Id';
    const colComercial = pickCI([
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
      'Id_Cliente',
      'id_cliente',
      'Cliente_id',
      'cliente_id',
      'ClienteId',
      'clienteId'
    ]);
    const colFecha = pickCI([
      'FechaPedido',
      'Fecha_Pedido',
      'Fecha',
      'fecha',
      'created_at',
      'CreatedAt'
    ]);
    const colNumPedido = pickCI([
      'NumPedido',
      'Numero_Pedido',
      'numero_pedido',
      'Número_Pedido',
      'Número Pedido',
      'NumeroPedido',
      'numeroPedido'
    ]);

    const meta = { tPedidos, pk, colComercial, colCliente, colFecha, colNumPedido };
    this._metaCache.pedidosMeta = meta;
    return meta;
  }

  async _ensurePedidosArticulosMeta() {
    if (this._metaCache?.pedidosArticulosMeta) return this._metaCache.pedidosArticulosMeta;

    const t = await this._resolveTableNameCaseInsensitive('pedidos_articulos');
    const cols = await this._getColumns(t);
    const pickCI = (cands) => this._pickCIFromColumns(cols, cands);

    const pk = pickCI(['Id', 'id']) || 'Id';
    const colNumPedido = pickCI(['NumPedido', 'numPedido', 'NumeroPedido', 'numeroPedido', 'Numero_Pedido', 'Número_Pedido', 'Número Pedido']);
    const colPedidoId = pickCI(['PedidoId', 'pedidoId', 'Id_Pedido', 'id_pedido', 'pedido_id', 'IdPedido', 'idPedido']);
    const colPedidoIdNum = pickCI(['Id_NumPedido', 'id_numpedido', 'id_num_pedido', 'PedidoIdNum', 'pedidoIdNum', 'IdNumPedido', 'idNumPedido']);
    const colArticulo = pickCI(['Id_Articulo', 'id_articulo', 'ArticuloId', 'articuloId', 'IdArticulo', 'idArticulo']);

    const meta = { table: t, pk, colNumPedido, colPedidoId, colPedidoIdNum, colArticulo };
    this._metaCache.pedidosArticulosMeta = meta;
    return meta;
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
    const pk = pickCI(['id', 'Id']) || 'id';
    const colCliente = pickCI(['Id_Cliente', 'id_cliente', 'ClienteId', 'clienteId', 'cliente_id']);
    const colActiva = pickCI(['Activa', 'activa', 'Activo', 'activo']);
    const colPrincipal = pickCI(['Es_Principal', 'es_principal', 'EsPrincipal', 'esPrincipal', 'Principal', 'principal']);
    const colContacto = pickCI(['Id_Contacto', 'id_contacto', 'ContactoId', 'contactoId', 'contacto_id']);

    const meta = { table: t, pk, colCliente, colActiva, colPrincipal, colContacto, _cols: cols };
    this._metaCache.direccionesEnvioMeta = meta;
    return meta;
  }

  async ensureClientesIndexes() {
    if (this._clientesIndexesEnsured) return;
    this._clientesIndexesEnsured = true;

    try {
      if (!this.pool) return;
      const { tClientes, pk, colComercial, colEstadoCliente } = await this._ensureClientesMeta();
      const cols = await this._getColumns(tClientes);
      const colsSet = new Set(cols);
      const hasCol = (c) => c && colsSet.has(c);

      const idxRows = await this.query(`SHOW INDEX FROM \`${tClientes}\``).catch(() => []);
      const existing = new Set((idxRows || []).map(r => String(r.Key_name || r.key_name || '').trim()).filter(Boolean));

      const createIfMissing = async (name, colsToUse, kind = 'INDEX') => {
        if (!name || existing.has(name)) return;
        const cleanCols = (colsToUse || []).filter(hasCol);
        if (!cleanCols.length) return;
        const colsSql = cleanCols.map(c => `\`${c}\``).join(', ');
        const stmt =
          kind === 'FULLTEXT'
            ? `CREATE FULLTEXT INDEX \`${name}\` ON \`${tClientes}\` (${colsSql})`
            : `CREATE INDEX \`${name}\` ON \`${tClientes}\` (${colsSql})`;
        await this.query(stmt);
        existing.add(name);
        console.log(`✅ [INDEX] Creado ${name} en ${tClientes} (${colsSql})`);
      };

      // Filtros habituales
      await createIfMissing('idx_clientes_provincia', ['Id_Provincia']);
      await createIfMissing('idx_clientes_tipocliente', ['Id_TipoCliente']);
      await createIfMissing('idx_clientes_comercial', [colComercial]);
      await createIfMissing('idx_clientes_estado_cliente', [colEstadoCliente]);

      // Búsquedas / listados frecuentes
      await createIfMissing('idx_clientes_cp', ['CodigoPostal']);
      await createIfMissing('idx_clientes_poblacion', ['Poblacion']);
      await createIfMissing('idx_clientes_nombre', ['Nombre_Razon_Social']);

      // FULLTEXT (best-effort) para búsqueda rápida: si el servidor no soporta, no rompemos.
      // Usamos pocas columnas de alto valor para minimizar coste de índice.
      await createIfMissing(
        'ft_clientes_busqueda',
        ['Nombre_Razon_Social', 'Nombre_Cial', 'DNI_CIF', 'Email', 'Telefono', 'Movil', 'Poblacion', 'CodigoPostal', 'NomContacto', 'Observaciones'],
        'FULLTEXT'
      );

      // FULLTEXT "básico" (más barato) para autocomplete: solo los campos clave de identidad.
      await createIfMissing('ft_clientes_busqueda_basica', ['Nombre_Razon_Social', 'Nombre_Cial', 'DNI_CIF'], 'FULLTEXT');

      // Orden estable por PK (normalmente ya está por ser PRIMARY), pero si no, creamos.
      if (hasCol(pk)) {
        await createIfMissing('idx_clientes_pk', [pk]);
      }
    } catch (e) {
      console.warn('⚠️ [INDEX] No se pudieron asegurar índices en clientes:', e?.message || e);
    }
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
      const t = await this._resolveTableNameCaseInsensitive('contactos');
      const cols = await this._getColumns(t);
      const colsSet = new Set(cols);
      const hasCol = (c) => c && colsSet.has(c);

      const idxRows = await this.query(`SHOW INDEX FROM \`${t}\``).catch(() => []);
      const existing = new Set((idxRows || []).map(r => String(r.Key_name || r.key_name || '').trim()).filter(Boolean));

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

      await createIfMissing('idx_contactos_activo_apellidos_nombre', ['Activo', 'Apellidos', 'Nombre']);
      await createIfMissing('ft_contactos_busqueda', ['Nombre', 'Apellidos', 'Empresa', 'Email', 'Movil', 'Telefono'], 'FULLTEXT');
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
    const pk = pickCI(['id', 'Id']) || 'id';
    const meta = { table: t, pk };
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
      await runCount(
        'clientes_orfanos_provincia',
        `SELECT COUNT(*) AS n
         FROM \`${clientes.tClientes}\` c
         LEFT JOIN \`${tProvincias || 'provincias'}\` p ON c.Id_Provincia = p.id
         WHERE c.Id_Provincia IS NOT NULL AND c.Id_Provincia != 0 AND p.id IS NULL`
      );
      await runCount(
        'clientes_orfanos_tipo_cliente',
        `SELECT COUNT(*) AS n
         FROM \`${clientes.tClientes}\` c
         LEFT JOIN \`${tTiposClientes || 'tipos_clientes'}\` tc ON c.Id_TipoCliente = tc.id
         WHERE c.Id_TipoCliente IS NOT NULL AND c.Id_TipoCliente != 0 AND tc.id IS NULL`
      );
      if (clientes.colEstadoCliente) {
        await runCount(
          'clientes_orfanos_estado_cliente',
          `SELECT COUNT(*) AS n
           FROM \`${clientes.tClientes}\` c
           LEFT JOIN \`${tEstadosClientes || 'estdoClientes'}\` ec ON c.\`${clientes.colEstadoCliente}\` = ec.id
           WHERE c.\`${clientes.colEstadoCliente}\` IS NOT NULL AND c.\`${clientes.colEstadoCliente}\` != 0 AND ec.id IS NULL`
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
           LEFT JOIN \`${tArticulos}\` a ON pa.\`${pedArt.colArticulo}\` = a.Id
           WHERE pa.\`${pedArt.colArticulo}\` IS NOT NULL AND pa.\`${pedArt.colArticulo}\` != 0 AND a.Id IS NULL`
        );
      }
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
   * Resolver (cacheado) nombres de columnas para la tabla clientes en distintos entornos.
   * Evita fallos si la columna del comercial cambia (Id_Cial vs ComercialId, etc.).
   */
  async _ensureClientesMeta() {
    if (this._metaCache?.clientesMeta) return this._metaCache.clientesMeta;

    const tClientes = await this._resolveTableNameCaseInsensitive('clientes');
    let colsRows = [];
    try {
      colsRows = await this.query(`SHOW COLUMNS FROM \`${tClientes}\``);
    } catch (_) {
      colsRows = [];
    }

    const cols = (Array.isArray(colsRows) ? colsRows : [])
      .map(r => String(r.Field || r.field || '').trim())
      .filter(Boolean);

    const colsLower = new Set(cols.map(c => c.toLowerCase()));
    const pickCI = (cands) => {
      for (const cand of (cands || [])) {
        const cl = String(cand).toLowerCase();
        if (colsLower.has(cl)) {
          // devolver el nombre real tal como aparece en SHOW COLUMNS (preserva casing)
          const idx = cols.findIndex(c => c.toLowerCase() === cl);
          return idx >= 0 ? cols[idx] : cand;
        }
      }
      return null;
    };

    const pk = pickCI(['Id', 'id']) || 'Id';
    const colComercial = pickCI([
      'Id_Cial',
      'id_cial',
      'Id_Comercial',
      'id_comercial',
      'ComercialId',
      'comercialId',
      'comercial_id'
    ]);
    const colEstadoCliente = pickCI([
      'Id_EstdoCliente',
      'id_estdo_cliente',
      'Id_EstadoCliente',
      'id_estado_cliente',
      'EstadoClienteId',
      'estadoClienteId'
    ]);
    const colTipoContacto = pickCI(['TipoContacto', 'tipo_contacto', 'Tipo_Contacto']);

    const meta = { tClientes, pk, colComercial, colEstadoCliente, colTipoContacto };
    this._metaCache.clientesMeta = meta;
    return meta;
  }

  _normalizeDniCif(value) {
    return String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/-/g, '');
  }

  _isValidDniCif(value) {
    const v = this._normalizeDniCif(value);
    if (!v) return false;
    if (['PENDIENTE', 'NULL', 'N/A', 'NA'].includes(v)) return false;
    if (v.startsWith('SIN_DNI')) return false;

    // DNI: 8 dígitos + letra
    // NIE: X/Y/Z + 7 dígitos + letra
    // CIF: letra + 7 dígitos + [0-9A-J]
    const dni = /^[0-9]{8}[A-Z]$/;
    const nie = /^[XYZ][0-9]{7}[A-Z]$/;
    const cif = /^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/;
    return dni.test(v) || nie.test(v) || cif.test(v);
  }

  /**
   * Clasifica TipoContacto por DNI_CIF: CIF → Empresa, DNI/NIE → Persona, resto → Otros.
   * @param {string} value - DNI_CIF del cliente
   * @returns {'Empresa'|'Persona'|'Otros'}
   */
  _getTipoContactoFromDniCif(value) {
    const v = this._normalizeDniCif(value);
    if (!v || ['PENDIENTE', 'NULL', 'N/A', 'NA'].includes(v) || v.startsWith('SIN_DNI')) return 'Otros';
    const dni = /^[0-9]{8}[A-Z]$/;
    const nie = /^[XYZ][0-9]{7}[A-Z]$/;
    const cif = /^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/;
    if (cif.test(v)) return 'Empresa';
    if (dni.test(v) || nie.test(v)) return 'Persona';
    return 'Otros';
  }

  async _getEstadoClienteIds() {
    // Cache: ids fijos por diseño, pero leemos por si en el futuro cambian
    if (this._metaCache?.estadoClienteIds) return this._metaCache.estadoClienteIds;
    const tEstados = await this._resolveTableNameCaseInsensitive('estdoClientes');
    const rows = await this.query(`SELECT id, Nombre FROM \`${tEstados}\``).catch(() => []);
    const map = new Map((rows || []).map(r => [String(r.Nombre || '').toLowerCase(), Number(r.id)]));
    const ids = {
      potencial: map.get('potencial') || 1,
      activo: map.get('activo') || 2,
      inactivo: map.get('inactivo') || 3
    };
    this._metaCache.estadoClienteIds = ids;
    return ids;
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

  // COMERCIALES
  async getComerciales() {
    try {
      const sql = 'SELECT * FROM comerciales ORDER BY id ASC';
      const rows = await this.query(sql);
      console.log(`✅ Obtenidos ${rows.length} comerciales`);
      // Asegurar que siempre devolvemos un array
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('❌ Error obteniendo comerciales:', error.message);
      return [];
    }
  }

  async getComercialByEmail(email) {
    try {
      const sql = 'SELECT * FROM comerciales WHERE LOWER(Email) = LOWER(?) OR LOWER(email) = LOWER(?) LIMIT 1';
      const rows = await this.query(sql, [email, email]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo comercial por email:', error.message);
      return null;
    }
  }

  async getComercialById(id) {
    try {
      // Intentar con ambas variantes de nombre de columna (id e Id)
      const sql = 'SELECT * FROM comerciales WHERE id = ? OR Id = ? LIMIT 1';
      const rows = await this.query(sql, [id, id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo comercial por ID:', error.message);
      return null;
    }
  }

  /**
   * Obtiene el ID del comercial "pool" (ej. Paco Lara) por nombre.
   * Nombre configurable con COMERCIAL_POOL_NAME (default "Paco Lara").
   */
  async getComercialIdPool() {
    const name = (process.env.COMERCIAL_POOL_NAME || 'Paco Lara').trim();
    if (!name) return null;
    try {
      const sql = 'SELECT id, Id FROM comerciales WHERE TRIM(Nombre) = ? OR TRIM(nombre) = ? LIMIT 1';
      const rows = await this.query(sql, [name, name]);
      const row = rows?.[0];
      return row ? (row.id ?? row.Id ?? null) : null;
    } catch (_) {
      return null;
    }
  }

  async createComercial(payload) {
    try {
      if (!this.connected && !this.pool) {
        await this.connect();
      }
      
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
        throw new Error('No existe la tabla de códigos postales (Codigos_Postales/codigos_postales) en la BD.');
      }

      // fijo_mensual es NOT NULL en algunos entornos; siempre insertar un valor (por defecto 0)
      const codigoPostalTexto = (payload.CodigoPostal || payload.codigoPostal || '').toString().trim();
      // Resolver Id_CodigoPostal (NOT NULL en algunos entornos)
      let idCodigoPostal = payload.Id_CodigoPostal || payload.id_CodigoPostal || payload.IdCodigoPostal || null;
      if (!idCodigoPostal && codigoPostalTexto) {
        const cpLimpio = codigoPostalTexto.replace(/[^0-9]/g, '').slice(0, 5);
        if (cpLimpio.length >= 4) {
          try {
            const rows = await this.query(`SELECT id FROM ${codigosPostalesTable} WHERE CodigoPostal = ? LIMIT 1`, [cpLimpio]);
            if (rows && rows.length > 0 && rows[0].id) {
              idCodigoPostal = rows[0].id;
            } else {
              // Si no existe, crearlo automáticamente (evita error NOT NULL en Id_CodigoPostal)
              let provinciaNombre = payload.Provincia || payload.provincia || null;
              const idProvincia = payload.Id_Provincia || payload.id_Provincia || null;
              if (!provinciaNombre && idProvincia) {
                try {
                  const provRows = await this.query('SELECT Nombre FROM provincias WHERE id = ? LIMIT 1', [idProvincia]);
                  provinciaNombre = provRows?.[0]?.Nombre || null;
                } catch (e) {
                  // opcional
                }
              }
              const localidad = payload.Poblacion || payload.poblacion || null;
              try {
                const creado = await this.createCodigoPostal({
                  CodigoPostal: cpLimpio,
                  Localidad: localidad,
                  Provincia: provinciaNombre,
                  Id_Provincia: idProvincia || null,
                  ComunidadAutonoma: null,
                  Latitud: null,
                  Longitud: null,
                  Activo: true
                });
                if (creado && creado.insertId) {
                  idCodigoPostal = creado.insertId;
                }
              } catch (e) {
                // Si falló por duplicado o carrera, re-intentar select
                const retry = await this.query(`SELECT id FROM ${codigosPostalesTable} WHERE CodigoPostal = ? LIMIT 1`, [cpLimpio]);
                if (retry && retry.length > 0 && retry[0].id) {
                  idCodigoPostal = retry[0].id;
                }
              }
            }
          } catch (e) {
            // No bloquear aquí: se manejará con error claro abajo si sigue faltando.
            console.warn('⚠️ No se pudo resolver Id_CodigoPostal:', e.message);
          }
        }
      }
      if (!idCodigoPostal) {
        throw new Error('No se pudo resolver/crear Id_CodigoPostal para el comercial. Revisa el Código Postal.');
      }

      // plataforma_reunion_preferida es NOT NULL en algunos entornos; siempre insertar un valor (por defecto 'meet')
      const plataformaPreferidaRaw = payload.plataforma_reunion_preferida ?? payload.PlataformaReunionPreferida ?? null;
      const plataformaPreferida = (plataformaPreferidaRaw !== undefined && plataformaPreferidaRaw !== null && String(plataformaPreferidaRaw).trim() !== '')
        ? String(plataformaPreferidaRaw).trim()
        : 'meet';

      const sql = `INSERT INTO comerciales (Nombre, Email, DNI, Password, Roll, Movil, Direccion, CodigoPostal, Poblacion, Id_Provincia, Id_CodigoPostal, fijo_mensual, plataforma_reunion_preferida) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const fijoMensualRaw = payload.fijo_mensual ?? payload.fijoMensual ?? payload.FijoMensual;
      let fijoMensual = 0;
      if (fijoMensualRaw !== undefined && fijoMensualRaw !== null && String(fijoMensualRaw).trim() !== '') {
        const n = Number(String(fijoMensualRaw).replace(',', '.'));
        fijoMensual = Number.isFinite(n) ? n : 0;
      }
      const params = [
        payload.Nombre || payload.nombre || '',
        payload.Email || payload.email || '',
        payload.DNI || payload.dni || null,
        payload.Password || payload.password || null,
        payload.Roll ? (Array.isArray(payload.Roll) ? JSON.stringify(payload.Roll) : payload.Roll) : '["Comercial"]',
        payload.Movil || payload.movil || null,
        payload.Direccion || payload.direccion || null,
        codigoPostalTexto || null,
        payload.Poblacion || payload.poblacion || null,
        payload.Id_Provincia || payload.id_Provincia || null,
        idCodigoPostal,
        fijoMensual,
        plataformaPreferida
      ];
      const [result] = await this.pool.execute(sql, params);
      return { insertId: result.insertId, ...result };
    } catch (error) {
      console.error('❌ Error creando comercial:', error.message);
      throw error;
    }
  }

  async updateComercial(id, payload) {
    try {
      const updates = [];
      const params = [];
      
      // Resolver nombre real de la tabla de códigos postales (en algunos servidores MySQL es case-sensitive)
      const cpTableRows = await this.query(
        `SELECT table_name AS name
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND LOWER(table_name) = 'codigos_postales'
         LIMIT 1`
      );
      const codigosPostalesTable = cpTableRows?.[0]?.name;

      // Si se actualiza el CódigoPostal y no viene Id_CodigoPostal, resolverlo
      if (payload.CodigoPostal !== undefined && payload.Id_CodigoPostal === undefined) {
        const codigoPostalTexto = (payload.CodigoPostal || '').toString().trim();
        const cpLimpio = codigoPostalTexto.replace(/[^0-9]/g, '').slice(0, 5);
        if (cpLimpio) {
          try {
            if (!codigosPostalesTable) {
              throw new Error('No existe la tabla de códigos postales (Codigos_Postales/codigos_postales) en la BD.');
            }
            const rows = await this.query(`SELECT id FROM ${codigosPostalesTable} WHERE CodigoPostal = ? LIMIT 1`, [cpLimpio]);
            if (rows && rows.length > 0 && rows[0].id) {
              payload.Id_CodigoPostal = rows[0].id;
            } else {
              // Crear el CP si no existe (usar Id_Provincia si viene; si no, inferir por prefijo 2 dígitos)
              let idProvincia = payload.Id_Provincia || payload.id_Provincia || null;
              if (!idProvincia && cpLimpio.length >= 2) {
                const pref = Number(cpLimpio.slice(0, 2));
                if (Number.isFinite(pref) && pref >= 1 && pref <= 52) idProvincia = pref;
              }
              let provinciaNombre = payload.Provincia || payload.provincia || null;
              if (!provinciaNombre && idProvincia) {
                try {
                  const provRows = await this.query('SELECT Nombre FROM provincias WHERE id = ? LIMIT 1', [idProvincia]);
                  provinciaNombre = provRows?.[0]?.Nombre || null;
                } catch (e) {
                  // opcional
                }
              }
              const localidad = payload.Poblacion || payload.poblacion || null;
              try {
                const creado = await this.createCodigoPostal({
                  CodigoPostal: cpLimpio,
                  Localidad: localidad,
                  Provincia: provinciaNombre,
                  Id_Provincia: idProvincia || null,
                  ComunidadAutonoma: null,
                  Latitud: null,
                  Longitud: null,
                  Activo: true
                });
                if (creado && creado.insertId) payload.Id_CodigoPostal = creado.insertId;
              } catch (e) {
                const retry = await this.query(`SELECT id FROM ${codigosPostalesTable} WHERE CodigoPostal = ? LIMIT 1`, [cpLimpio]);
                if (retry && retry.length > 0 && retry[0].id) {
                  payload.Id_CodigoPostal = retry[0].id;
                }
              }
            }
          } catch (e) {
            console.warn('⚠️ No se pudo resolver Id_CodigoPostal en updateComercial:', e.message);
          }
        }
      }
      
      if (payload.Nombre !== undefined) {
        updates.push('Nombre = ?');
        params.push(payload.Nombre);
      }
      if (payload.Email !== undefined) {
        updates.push('Email = ?');
        params.push(payload.Email);
      }
      if (payload.DNI !== undefined) {
        updates.push('DNI = ?');
        params.push(payload.DNI);
      }
      if (payload.Password !== undefined) {
        updates.push('Password = ?');
        params.push(payload.Password);
      }
      if (payload.Roll !== undefined) {
        const rollValue = Array.isArray(payload.Roll) ? JSON.stringify(payload.Roll) : payload.Roll;
        updates.push('Roll = ?');
        params.push(rollValue);
      }
      if (payload.Movil !== undefined) {
        updates.push('Movil = ?');
        params.push(payload.Movil);
      }
      if (payload.Direccion !== undefined) {
        updates.push('Direccion = ?');
        params.push(payload.Direccion);
      }
      if (payload.CodigoPostal !== undefined) {
        updates.push('CodigoPostal = ?');
        params.push(payload.CodigoPostal);
      }
      if (payload.Id_CodigoPostal !== undefined) {
        updates.push('Id_CodigoPostal = ?');
        params.push(payload.Id_CodigoPostal || null);
      }
      if (payload.Poblacion !== undefined) {
        updates.push('Poblacion = ?');
        params.push(payload.Poblacion);
      }
      if (payload.Id_Provincia !== undefined) {
        updates.push('Id_Provincia = ?');
        params.push(payload.Id_Provincia || null);
      }
      if (payload.fijo_mensual !== undefined) {
        updates.push('fijo_mensual = ?');
        params.push(payload.fijo_mensual);
      }
      
      // Campos de credenciales de reuniones
      if (payload.meet_email !== undefined) {
        updates.push('meet_email = ?');
        // No convertir '' a NULL automáticamente (puede romper si la columna está NOT NULL).
        params.push(payload.meet_email === '' ? '' : payload.meet_email);
      }
      if (payload.teams_email !== undefined) {
        updates.push('teams_email = ?');
        params.push(payload.teams_email === '' ? '' : payload.teams_email);
      }
      if (payload.plataforma_reunion_preferida !== undefined) {
        updates.push('plataforma_reunion_preferida = ?');
        params.push(payload.plataforma_reunion_preferida || 'meet');
      }
      
      if (updates.length === 0) {
        throw new Error('No hay campos para actualizar');
      }
      
      params.push(id);
      const sql = `UPDATE comerciales SET ${updates.join(', ')} WHERE Id = ?`;
      
      // Para UPDATE necesitamos usar execute directamente para obtener affectedRows
      if (!this.connected && !this.pool) {
        await this.connect();
      }
      const [result] = await this.pool.execute(sql, params);
      return { affectedRows: result.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error actualizando comercial:', error.message);
      throw error;
    }
  }

  async deleteComercial(id) {
    try {
      const sql = 'DELETE FROM comerciales WHERE Id = ?';
      const [result] = await this.query(sql, [id]);
      return result;
    } catch (error) {
      console.error('❌ Error eliminando comercial:', error.message);
      throw error;
    }
  }

  // ARTÍCULOS
  async getArticulos(options = {}) {
    try {
      const marcaIdRaw = options && typeof options === 'object' ? options.marcaId : null;
      const marcaId = Number(marcaIdRaw);
      const hasMarcaId = Number.isFinite(marcaId) && marcaId > 0;

      // Incluir nombre de marca si existe tabla `marcas`
      let rows = [];
      try {
        const tArt = await this._resolveTableNameCaseInsensitive('articulos');
        const aCols = await this._getColumns(tArt).catch(() => []);
        const aPk = this._pickCIFromColumns(aCols, ['id', 'Id']) || 'id';
        const aMarcaId = this._pickCIFromColumns(aCols, ['Id_Marca', 'id_marca', 'MarcaId', 'marcaId']) || 'Id_Marca';

        const tMarcas = await this._resolveTableNameCaseInsensitive('marcas').catch(() => null);
        if (!tMarcas) throw new Error('Sin tabla marcas');

        const mCols = await this._getColumns(tMarcas).catch(() => []);
        const mColsLower = new Set((mCols || []).map((c) => String(c).toLowerCase()));
        const pick = (cands) => (cands || []).find((c) => mColsLower.has(String(c).toLowerCase())) || null;
        const mPk = pick(['id', 'Id']) || 'id';
        const mNombre =
          pick(['Nombre', 'nombre', 'Marca', 'marca', 'Descripcion', 'descripcion', 'NombreMarca', 'nombre_marca']) || null;

        const selectMarcaNombre = mNombre
          ? `m.\`${mNombre}\` AS MarcaNombre`
          : `CAST(m.\`${mPk}\` AS CHAR) AS MarcaNombre`;

        const sql = `
          SELECT a.*, ${selectMarcaNombre}
          FROM \`${tArt}\` a
          LEFT JOIN \`${tMarcas}\` m ON m.\`${mPk}\` = a.\`${aMarcaId}\`
          ${hasMarcaId ? `WHERE a.\`${aMarcaId}\` = ?` : ''}
          ORDER BY a.\`${aPk}\` ASC
        `;
        rows = hasMarcaId ? await this.query(sql, [marcaId]) : await this.query(sql);
      } catch (_) {
        const tArt = await this._resolveTableNameCaseInsensitive('articulos');
        const aCols = await this._getColumns(tArt).catch(() => []);
        const aPk = this._pickCIFromColumns(aCols, ['id', 'Id']) || 'id';
        const aMarcaId = this._pickCIFromColumns(aCols, ['Id_Marca', 'id_marca', 'MarcaId', 'marcaId']) || 'Id_Marca';
        const sql = hasMarcaId
          ? `SELECT * FROM \`${tArt}\` WHERE \`${aMarcaId}\` = ? ORDER BY \`${aPk}\` ASC`
          : `SELECT * FROM \`${tArt}\` ORDER BY \`${aPk}\` ASC`;
        rows = hasMarcaId ? await this.query(sql, [marcaId]) : await this.query(sql);
      }
      console.log(`✅ Obtenidos ${rows.length} artículos`);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo artículos:', error.message);
      return [];
    }
  }

  async getArticuloById(id) {
    try {
      // Incluir nombre de marca si existe tabla `marcas`
      let rows = [];
      try {
        const tArt = await this._resolveTableNameCaseInsensitive('articulos');
        const aCols = await this._getColumns(tArt).catch(() => []);
        const aPk = this._pickCIFromColumns(aCols, ['id', 'Id']) || 'id';
        const aMarcaId = this._pickCIFromColumns(aCols, ['Id_Marca', 'id_marca', 'MarcaId', 'marcaId']) || 'Id_Marca';

        const tMarcas = await this._resolveTableNameCaseInsensitive('marcas').catch(() => null);
        if (!tMarcas) throw new Error('Sin tabla marcas');

        const mCols = await this._getColumns(tMarcas).catch(() => []);
        const mColsLower = new Set((mCols || []).map((c) => String(c).toLowerCase()));
        const pick = (cands) => (cands || []).find((c) => mColsLower.has(String(c).toLowerCase())) || null;
        const mPk = pick(['id', 'Id']) || 'id';
        const mNombre =
          pick(['Nombre', 'nombre', 'Marca', 'marca', 'Descripcion', 'descripcion', 'NombreMarca', 'nombre_marca']) || null;

        const selectMarcaNombre = mNombre
          ? `m.\`${mNombre}\` AS MarcaNombre`
          : `CAST(m.\`${mPk}\` AS CHAR) AS MarcaNombre`;

        const sql = `
          SELECT a.*, ${selectMarcaNombre}
          FROM \`${tArt}\` a
          LEFT JOIN \`${tMarcas}\` m ON m.\`${mPk}\` = a.\`${aMarcaId}\`
          WHERE a.\`${aPk}\` = ?
          LIMIT 1
        `;
        rows = await this.query(sql, [id]);
      } catch (_) {
        const tArt = await this._resolveTableNameCaseInsensitive('articulos');
        const aCols = await this._getColumns(tArt).catch(() => []);
        const aPk = this._pickCIFromColumns(aCols, ['id', 'Id']) || 'id';
        const sql = `SELECT * FROM \`${tArt}\` WHERE \`${aPk}\` = ? LIMIT 1`;
        rows = await this.query(sql, [id]);
      }
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo artículo por ID:', error.message);
      return null;
    }
  }

  async getArticulosByCategoria(categoria) {
    try {
      const sql = 'SELECT * FROM articulos WHERE Categoria = ? OR categoria = ? OR Categoria_Farmaceutica = ? OR categoria_farmaceutica = ? ORDER BY Id ASC';
      const rows = await this.query(sql, [categoria, categoria, categoria, categoria]);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo artículos por categoría:', error.message);
      return [];
    }
  }

  async updateArticulo(id, payload) {
    try {
      // COLUMNAS VÁLIDAS en la tabla articulos (verificadas contra la BD)
      const columnasValidas = ['Nombre', 'SKU', 'Presentacion', 'PVL', 'PCP', 'Unidades_Caja', 'Imagen', 'Marca', 'EAN13', 'Activo', 'IVA', 'Id_Marca'];
      
      // FILTRAR el payload: solo incluir columnas válidas
      const payloadFiltrado = {};
      for (const [key, value] of Object.entries(payload)) {
        if (columnasValidas.includes(key)) {
          payloadFiltrado[key] = value;
        } else {
          console.warn(`⚠️ [UPDATE ARTICULO] Ignorando columna inválida: '${key}'`);
        }
      }
      
      if (Object.keys(payloadFiltrado).length === 0) {
        throw new Error('No hay columnas válidas para actualizar');
      }
      
      const fields = [];
      const values = [];
      
      console.log(`✅ [UPDATE ARTICULO] Actualizando artículo ${id}`);
      console.log(`✅ [UPDATE ARTICULO] Payload original:`, JSON.stringify(payload, null, 2));
      console.log(`✅ [UPDATE ARTICULO] Payload filtrado:`, JSON.stringify(payloadFiltrado, null, 2));
      
      for (const [key, value] of Object.entries(payloadFiltrado)) {
        fields.push(`\`${key}\` = ?`);
        values.push(value);
        console.log(`✅ [UPDATE ARTICULO] Campo ${key}: ${value} (tipo: ${typeof value})`);
      }
      
      values.push(id);
      const tArt = await this._resolveTableNameCaseInsensitive('articulos');
      const aCols = await this._getColumns(tArt).catch(() => []);
      const aPk = this._pickCIFromColumns(aCols, ['id', 'Id']) || 'id';
      const sql = `UPDATE \`${tArt}\` SET ${fields.join(', ')} WHERE \`${aPk}\` = ?`;
      console.log(`✅ [UPDATE ARTICULO] SQL: ${sql}`);
      console.log(`✅ [UPDATE ARTICULO] Valores:`, values);
      
      const result = await this.query(sql, values);
      console.log(`✅ [UPDATE ARTICULO] Resultado:`, result);
      
      // Para UPDATE, el resultado debería ser un ResultSetHeader
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        console.log(`✅ [UPDATE ARTICULO] Filas afectadas:`, result.affectedRows);
        console.log(`✅ [UPDATE ARTICULO] Filas cambiadas:`, result.changedRows);
        return { affectedRows: result.affectedRows || 1, changedRows: result.changedRows || 0 };
      }
      
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando artículo:', error.message);
      console.error('❌ Stack:', error.stack);
      throw error;
    }
  }

  async createArticulo(payload) {
    try {
      // Elegir primer ID disponible desde 1 (para no dejar huecos)
      // Nota: esto es intencional por requerimiento del proyecto.
      const tArt = await this._resolveTableNameCaseInsensitive('articulos');
      const aCols = await this._getColumns(tArt).catch(() => []);
      const aPk = this._pickCIFromColumns(aCols, ['id', 'Id']) || 'id';

      if (payload && typeof payload === 'object' && payload[aPk] === undefined) {
        // Buscar el primer hueco: 1 si no existe, o el siguiente tras un id sin sucesor.
        const nextIdRows = await this.query(
          `
            SELECT
              CASE
                WHEN NOT EXISTS (SELECT 1 FROM \`${tArt}\`) THEN 1
                WHEN NOT EXISTS (SELECT 1 FROM \`${tArt}\` WHERE \`${aPk}\` = 1) THEN 1
                ELSE (
                  SELECT MIN(a.\`${aPk}\`) + 1
                  FROM \`${tArt}\` a
                  LEFT JOIN \`${tArt}\` b ON b.\`${aPk}\` = a.\`${aPk}\` + 1
                  WHERE b.\`${aPk}\` IS NULL
                )
              END AS next_id
          `
        ).catch(() => []);
        const nextId = Number(nextIdRows?.[0]?.next_id);
        if (Number.isFinite(nextId) && nextId > 0) {
          payload[aPk] = nextId;
        }
      }

      const fields = Object.keys(payload).map(key => `\`${key}\``).join(', ');
      const placeholders = Object.keys(payload).map(() => '?').join(', ');
      const values = Object.values(payload);
      
      const sql = `INSERT INTO articulos (${fields}) VALUES (${placeholders})`;
      const result = await this.query(sql, values);
      return { insertId: result.insertId || result.insertId };
    } catch (error) {
      console.error('❌ Error creando artículo:', error.message);
      throw error;
    }
  }

  async deleteArticulo(id) {
    try {
      const tArt = await this._resolveTableNameCaseInsensitive('articulos');
      const aCols = await this._getColumns(tArt).catch(() => []);
      const aPk = this._pickCIFromColumns(aCols, ['id', 'Id']) || 'id';
      const sql = `DELETE FROM \`${tArt}\` WHERE \`${aPk}\` = ?`;
      const result = await this.query(sql, [id]);
      return { affectedRows: result.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error eliminando artículo:', error.message);
      throw error;
    }
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
      const aPk = this._pickCIFromColumns(aCols, ['id', 'Id']) || 'id';
      const sql = `UPDATE \`${tArt}\` SET Activo = ? WHERE \`${aPk}\` = ?`;
      await this.query(sql, [activoValue, id]);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando Activo de artículo:', error.message);
      throw error;
    }
  }

  // CLIENTES
  async getClientes(comercialId = null) {
    try {
      const { tClientes, pk, colComercial } = await this._ensureClientesMeta();
      let sql = `SELECT * FROM \`${tClientes}\``;
      const params = [];
      
      // Si se proporciona un comercialId, filtrar por él
      // El campo en la tabla clientes es Id_Cial (con mayúsculas, igual que en pedidos)
      if (comercialId) {
        if (!colComercial) {
          console.warn('⚠️ [GET_CLIENTES] No se pudo resolver la columna de comercial en clientes. Devolviendo vacío por seguridad.');
          return [];
        }
        sql += ` WHERE \`${colComercial}\` = ?`;
        params.push(comercialId);
        console.log(`🔐 [GET_CLIENTES] Filtro aplicado: ${colComercial} = ${comercialId}`);
      }
      
      sql += ` ORDER BY \`${pk}\` ASC`;
      
      const rows = await this.query(sql, params);
      console.log(`✅ Obtenidos ${rows.length} clientes${comercialId ? ` (filtrado por comercial ${comercialId})` : ''}`);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo clientes:', error.message);
      return [];
    }
  }

  /**
   * Método optimizado para obtener clientes con JOINs y filtros
   * @param {Object} filters - Filtros opcionales: { tipoCliente, provincia, comercial, conVentas }
   */
  async getClientesOptimizado(filters = {}) {
    let sql = '';
    try {
      const { colComercial, colEstadoCliente } = await this._ensureClientesMeta();
      const tEstados = colEstadoCliente ? await this._resolveTableNameCaseInsensitive('estdoClientes') : null;
      const whereConditions = [];
      const params = [];

      // Construir JOINs y WHERE - versión simplificada y robusta
      // Usar nombres de campos exactos como en la tabla
      sql = `
        SELECT 
          c.*,
          p.Nombre as ProvinciaNombre,
          tc.Tipo as TipoClienteNombre,
          ${colComercial ? 'cial.Nombre as ComercialNombre' : 'NULL as ComercialNombre'},
          ${colEstadoCliente ? 'ec.Nombre as EstadoClienteNombre' : 'NULL as EstadoClienteNombre'},
          ${colEstadoCliente ? `c.\`${colEstadoCliente}\` as EstadoClienteId` : 'NULL as EstadoClienteId'}
        FROM clientes c
        LEFT JOIN provincias p ON c.Id_Provincia = p.id
        LEFT JOIN tipos_clientes tc ON c.Id_TipoCliente = tc.id
        ${colComercial ? `LEFT JOIN comerciales cial ON c.\`${colComercial}\` = cial.id` : ''}
        ${colEstadoCliente ? `LEFT JOIN \`${tEstados}\` ec ON c.\`${colEstadoCliente}\` = ec.id` : ''}
      `;

      // Filtro por tipo de cliente
      if (filters.tipoCliente !== null && filters.tipoCliente !== undefined && filters.tipoCliente !== '' && !isNaN(filters.tipoCliente)) {
        const tipoClienteId = typeof filters.tipoCliente === 'number' ? filters.tipoCliente : parseInt(filters.tipoCliente);
        if (!isNaN(tipoClienteId) && tipoClienteId > 0) {
          whereConditions.push('c.Id_TipoCliente = ?');
          params.push(tipoClienteId);
          console.log('✅ [OPTIMIZADO] Filtro tipoCliente aplicado:', tipoClienteId);
        }
      }

      if (colTipoContacto && filters.tipoContacto !== null && filters.tipoContacto !== undefined && String(filters.tipoContacto).trim() !== '') {
        const tipoVal = String(filters.tipoContacto).trim();
        if (['Empresa', 'Persona', 'Otros'].includes(tipoVal)) {
          whereConditions.push(`c.\`${colTipoContacto}\` = ?`);
          params.push(tipoVal);
        }
      }

      // Filtro por provincia
      if (filters.provincia !== null && filters.provincia !== undefined && filters.provincia !== '' && !isNaN(filters.provincia)) {
        const provinciaId = typeof filters.provincia === 'number' ? filters.provincia : parseInt(filters.provincia);
        if (!isNaN(provinciaId) && provinciaId > 0) {
          whereConditions.push('c.Id_Provincia = ?');
          params.push(provinciaId);
          console.log('✅ [OPTIMIZADO] Filtro provincia aplicado:', provinciaId);
        }
      }

      // Filtro por comercial
      if (filters.comercial !== null && filters.comercial !== undefined && filters.comercial !== '' && !isNaN(filters.comercial)) {
        const comercialId = typeof filters.comercial === 'number' ? filters.comercial : parseInt(filters.comercial);
        if (!isNaN(comercialId) && comercialId > 0) {
          if (!colComercial) {
            throw new Error('No se encontró columna de comercial en tabla clientes');
          }
          // Regla: comercial ve sus clientes; si filters.comercialIncludePool, incluir pool (1)
          if (filters.comercialIncludePool && comercialId !== 1) {
            whereConditions.push(`(c.\`${colComercial}\` = ? OR c.\`${colComercial}\` = 1)`);
          } else {
            whereConditions.push(`c.\`${colComercial}\` = ?`);
          }
          params.push(comercialId);
          console.log(`✅ [OPTIMIZADO] Filtro comercial aplicado: c.${colComercial} = ${comercialId}${filters.comercialIncludePool && comercialId !== 1 ? ' (+pool=1)' : ''}`);
        } else {
          console.warn(`⚠️ [OPTIMIZADO] Filtro comercial inválido (valor recibido: ${filters.comercial}, tipo: ${typeof filters.comercial})`);
        }
      } else {
        console.log(`ℹ️ [OPTIMIZADO] No se aplica filtro de comercial (valor: ${filters.comercial}, tipo: ${typeof filters.comercial})`);
      }

      // Filtro por estado de cliente (nuevo catálogo)
      if (colEstadoCliente && filters.estadoCliente !== null && filters.estadoCliente !== undefined && filters.estadoCliente !== '' && !isNaN(filters.estadoCliente)) {
        const estadoId = typeof filters.estadoCliente === 'number' ? filters.estadoCliente : parseInt(filters.estadoCliente);
        if (!isNaN(estadoId) && estadoId > 0) {
          whereConditions.push(`c.\`${colEstadoCliente}\` = ?`);
          params.push(estadoId);
        }
      }

      // Filtro por con/sin ventas
      if (filters.conVentas !== undefined && filters.conVentas !== null && filters.conVentas !== '') {
        if (filters.conVentas === true || filters.conVentas === 'true' || filters.conVentas === '1') {
          // Con ventas: debe tener al menos un pedido
          whereConditions.push('EXISTS (SELECT 1 FROM pedidos WHERE Id_Cliente = c.Id)');
          console.log('✅ [OPTIMIZADO] Filtro conVentas aplicado: true');
        } else if (filters.conVentas === false || filters.conVentas === 'false' || filters.conVentas === '0') {
          // Sin ventas: no debe tener pedidos
          whereConditions.push('NOT EXISTS (SELECT 1 FROM pedidos WHERE Id_Cliente = c.Id)');
          console.log('✅ [OPTIMIZADO] Filtro conVentas aplicado: false');
        }
      }

      // Agregar WHERE si hay condiciones
      if (whereConditions.length > 0) {
        sql += ' WHERE ' + whereConditions.join(' AND ');
        console.log(`✅ [OPTIMIZADO] ${whereConditions.length} condición(es) WHERE aplicada(s)`);
      } else {
        console.log('⚠️ [OPTIMIZADO] No hay condiciones WHERE, devolviendo todos los clientes');
      }

      // ORDER BY - usar Id como en el método original getClientes()
      sql += ' ORDER BY c.Id ASC';

      console.log('🔍 [OPTIMIZADO] SQL:', sql);
      console.log('🔍 [OPTIMIZADO] Params:', params);
      
      const rows = await this.query(sql, params);
      
      // Agregar TotalPedidos después de obtener los resultados para evitar problemas en la consulta principal
      // Esto es más lento pero más seguro
      if (rows && rows.length > 0) {
        const clienteIds = rows.map(c => c.id || c.Id).filter(id => id);
        if (clienteIds.length > 0) {
          try {
            // Consulta más robusta para pedidos
            // Consulta de pedidos - usar parámetros correctamente
            const placeholders = clienteIds.map(() => '?').join(',');
            const pedidosCount = await this.query(
              `SELECT Id_Cliente, COUNT(*) as total 
               FROM pedidos 
               WHERE Id_Cliente IN (${placeholders})
               GROUP BY Id_Cliente`,
              clienteIds
            ).catch(() => []);
            
            const pedidosMap = new Map();
            pedidosCount.forEach(p => {
              const clienteId = p.Id_Cliente || p.id_Cliente;
              pedidosMap.set(clienteId, parseInt(p.total || 0));
            });
            
            rows.forEach(cliente => {
              const clienteId = cliente.id || cliente.Id;
              cliente.TotalPedidos = pedidosMap.get(clienteId) || 0;
            });
          } catch (pedidosError) {
            console.warn('⚠️ [OPTIMIZADO] Error obteniendo conteo de pedidos:', pedidosError.message);
            rows.forEach(cliente => {
              cliente.TotalPedidos = 0;
            });
          }
        }
      }
      
      console.log(`✅ [OPTIMIZADO] Obtenidos ${rows.length} clientes con filtros:`, filters);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo clientes optimizado:', error.message);
      console.error('❌ Stack:', error.stack);
      console.error('❌ SQL que falló:', sql);
      // Fallback al método original
      console.log('⚠️ [FALLBACK] Usando método getClientes() original');
      return await this.getClientes();
    }
  }

  /**
   * Clientes paginados (evita cargar miles de filas y bloquear el render).
   * Devuelve solo la página solicitada.
   *
   * @param {Object} filters - { tipoCliente, provincia, comercial, conVentas, estado }
   * @param {Object} options - { limit, offset }
   */
  async getClientesOptimizadoPaged(filters = {}, options = {}) {
    let sql = '';
    try {
      const { pk, colComercial, colEstadoCliente, colTipoContacto } = await this._ensureClientesMeta();
      const tEstados = colEstadoCliente ? await this._resolveTableNameCaseInsensitive('estdoClientes') : null;
      const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.min(500, Number(options.limit))) : 50;
      const offset = Number.isFinite(Number(options.offset)) ? Math.max(0, Number(options.offset)) : 0;
      const compact = options.compact === true || options.compact === '1';
      const compactSearch = options.compactSearch === true || options.compactSearch === '1';
      const order = String(options.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      const sortBy = String(options.sortBy || '').toLowerCase();
      const orderByNombre = sortBy === 'nombre' || sortBy === 'nombre_razon_social';

      const whereConditions = [];
      const params = [];

      sql = `
        SELECT 
          ${
            compact
              ? [
                  `c.\`${pk}\` as Id`,
                  'c.Nombre_Razon_Social',
                  'c.Nombre_Cial',
                  'c.DNI_CIF',
                  'c.Email',
                  'c.Telefono',
                  'c.Movil',
                  'c.CodigoPostal',
                  'c.Poblacion',
                  'c.Id_Provincia',
                  'c.Id_TipoCliente',
                  ...(colTipoContacto ? [`c.\`${colTipoContacto}\` as TipoContacto`] : [])
                ].join(',\n          ')
              : 'c.*'
          },
          p.Nombre as ProvinciaNombre,
          tc.Tipo as TipoClienteNombre,
          ${colComercial ? 'cial.Nombre as ComercialNombre' : 'NULL as ComercialNombre'},
          ${colEstadoCliente ? 'ec.Nombre as EstadoClienteNombre' : 'NULL as EstadoClienteNombre'},
          ${colEstadoCliente ? `c.\`${colEstadoCliente}\` as EstadoClienteId` : 'NULL as EstadoClienteId'}
        FROM clientes c
        LEFT JOIN provincias p ON c.Id_Provincia = p.id
        LEFT JOIN tipos_clientes tc ON c.Id_TipoCliente = tc.id
        ${colComercial ? `LEFT JOIN comerciales cial ON c.\`${colComercial}\` = cial.id` : ''}
        ${colEstadoCliente ? `LEFT JOIN \`${tEstados}\` ec ON c.\`${colEstadoCliente}\` = ec.id` : ''}
      `;

      // Resolver columna cliente en pedidos (Id_Cliente vs Cliente_id, etc.) para con/sin ventas.
      // Cache simple en la instancia para no repetir SHOW COLUMNS en cada request.
      if (!this.__pedidosClienteCol) {
        try {
          const colsRows = await this.query('SHOW COLUMNS FROM pedidos').catch(() => []);
          const cols = new Set((colsRows || []).map(r => String(r.Field || '').trim()).filter(Boolean));
          this.__pedidosClienteCol =
            ['Id_Cliente', 'Cliente_id', 'id_cliente', 'cliente_id', 'ClienteId', 'clienteId'].find(c => cols.has(c)) || 'Id_Cliente';
          // Columna de fecha del pedido para ordenar por "último pedido" (compatibilidad de esquemas)
          this.__pedidosFechaCol =
            ['FechaPedido', 'Fecha', 'fecha', 'CreatedAt', 'created_at', 'Fecha_Pedido', 'fecha_pedido'].find(c => cols.has(c)) || null;
        } catch (_) {
          this.__pedidosClienteCol = 'Id_Cliente';
          this.__pedidosFechaCol = null;
        }
      }

      // Estado: preferir catálogo si existe; fallback a OK_KO si no.
      if (colEstadoCliente) {
        if (filters.estadoCliente !== undefined && filters.estadoCliente !== null && String(filters.estadoCliente).trim() !== '' && !isNaN(filters.estadoCliente)) {
          const estadoId = Number(filters.estadoCliente);
          if (Number.isFinite(estadoId) && estadoId > 0) {
            whereConditions.push(`c.\`${colEstadoCliente}\` = ?`);
            params.push(estadoId);
          }
        } else if (filters.estado && typeof filters.estado === 'string') {
          // Compatibilidad legacy: estado=activos/inactivos/todos
          const ids = await this._getEstadoClienteIds();
          const e = filters.estado.trim().toLowerCase();
          if (e === 'activos') {
            whereConditions.push(`c.\`${colEstadoCliente}\` = ?`);
            params.push(ids.activo);
          } else if (e === 'inactivos') {
            whereConditions.push(`c.\`${colEstadoCliente}\` = ?`);
            params.push(ids.inactivo);
          }
        }
      } else {
        if (filters.estado === 'activos') {
          whereConditions.push("(c.OK_KO = 1 OR c.OK_KO = '1' OR UPPER(c.OK_KO) = 'OK')");
        } else if (filters.estado === 'inactivos') {
          whereConditions.push("(c.OK_KO = 0 OR c.OK_KO = '0' OR UPPER(c.OK_KO) = 'KO')");
        }
      }

      if (filters.tipoCliente !== null && filters.tipoCliente !== undefined && filters.tipoCliente !== '' && !isNaN(filters.tipoCliente)) {
        const tipoClienteId = typeof filters.tipoCliente === 'number' ? filters.tipoCliente : parseInt(filters.tipoCliente);
        if (!isNaN(tipoClienteId) && tipoClienteId > 0) {
          whereConditions.push('c.Id_TipoCliente = ?');
          params.push(tipoClienteId);
        }
      }

      if (colTipoContacto && filters.tipoContacto !== null && filters.tipoContacto !== undefined && String(filters.tipoContacto).trim() !== '') {
        const tipoVal = String(filters.tipoContacto).trim();
        if (['Empresa', 'Persona', 'Otros'].includes(tipoVal)) {
          whereConditions.push(`c.\`${colTipoContacto}\` = ?`);
          params.push(tipoVal);
        }
      }

      if (filters.provincia !== null && filters.provincia !== undefined && filters.provincia !== '' && !isNaN(filters.provincia)) {
        const provinciaId = typeof filters.provincia === 'number' ? filters.provincia : parseInt(filters.provincia);
        if (!isNaN(provinciaId) && provinciaId > 0) {
          whereConditions.push('c.Id_Provincia = ?');
          params.push(provinciaId);
        }
      }

      if (filters.comercial !== null && filters.comercial !== undefined && filters.comercial !== '' && !isNaN(filters.comercial)) {
        const comercialId = typeof filters.comercial === 'number' ? filters.comercial : parseInt(filters.comercial);
        if (!isNaN(comercialId) && comercialId > 0) {
          if (!colComercial) {
            throw new Error('No se encontró columna de comercial en tabla clientes');
          }
          const poolId = filters.comercialPoolId != null && !isNaN(filters.comercialPoolId) ? Number(filters.comercialPoolId) : null;
          if (poolId != null && poolId > 0 && poolId !== comercialId) {
            whereConditions.push(`(c.\`${colComercial}\` = ? OR c.\`${colComercial}\` = ?)`);
            params.push(comercialId, poolId);
          } else if (filters.comercialIncludePool && comercialId !== 1) {
            whereConditions.push(`(c.\`${colComercial}\` = ? OR c.\`${colComercial}\` = 1)`);
            params.push(comercialId);
          } else {
            whereConditions.push(`c.\`${colComercial}\` = ?`);
            params.push(comercialId);
          }
        }
      }

      if (filters.conVentas !== undefined && filters.conVentas !== null && filters.conVentas !== '') {
        if (filters.conVentas === true || filters.conVentas === 'true' || filters.conVentas === '1') {
          whereConditions.push(`EXISTS (SELECT 1 FROM pedidos p2 WHERE p2.\`${this.__pedidosClienteCol}\` = c.\`${pk}\`)`);
        } else if (filters.conVentas === false || filters.conVentas === 'false' || filters.conVentas === '0') {
          whereConditions.push(`NOT EXISTS (SELECT 1 FROM pedidos p2 WHERE p2.\`${this.__pedidosClienteCol}\` = c.\`${pk}\`)`);
        }
      }

      // Búsqueda inteligente (servidor) por múltiples campos.
      // Preferir FULLTEXT si existe (mucho más rápido) y hacer fallback a LIKE.
      // Regla: a partir de 3 caracteres, excepto si es numérico (ID/CP) que se permite desde 1.
      if (filters.q && typeof filters.q === 'string' && filters.q.trim().length >= 1) {
        const raw = filters.q.trim();
        const rawDigits = raw.replace(/\D/g, '');
        const isOnlyDigits = rawDigits.length === raw.length;
        const canTextSearch = !isOnlyDigits && raw.length >= 3;
        // Cache: lista exacta de columnas del índice FULLTEXT (si existe) para evitar el error
        // "Can't find FULLTEXT index matching the column list".
        const ftCacheKey = compactSearch ? '__clientesFulltextCols_basic' : '__clientesFulltextCols';
        const ftIndexName = compactSearch ? 'ft_clientes_busqueda_basica' : 'ft_clientes_busqueda';
        if (this[ftCacheKey] === undefined) {
          try {
            const { tClientes } = await this._ensureClientesMeta();
            const idx = await this.query(`SHOW INDEX FROM \`${tClientes}\``).catch(() => []);
            const ft = (idx || [])
              .filter(r => String(r.Key_name || r.key_name || '').trim() === ftIndexName)
              .filter(r => String(r.Index_type || r.index_type || '').toUpperCase() === 'FULLTEXT')
              .sort((a, b) => Number(a.Seq_in_index || a.seq_in_index || 0) - Number(b.Seq_in_index || b.seq_in_index || 0))
              .map(r => String(r.Column_name || r.column_name || '').trim())
              .filter(Boolean);
            this[ftCacheKey] = ft.length ? ft : null;
          } catch (_) {
            this[ftCacheKey] = null;
          }
        }

        const ftCols = Array.isArray(this[ftCacheKey]) ? this[ftCacheKey] : null;
        const canUseFulltext = ftCols && ftCols.length >= 1;

        // Atajo rápido: si el usuario escribe un número, intentar por ID/CP (usa índices normales).
        // Importante: se combina con la búsqueda principal como OR, no como AND.
        let numericClause = null;
        let numericParams = null;
        if (isOnlyDigits && rawDigits.length > 0) {
          const n = Number(rawDigits);
          if (Number.isFinite(n) && n > 0) {
            numericClause = `(c.\`${pk}\` = ? OR c.CodigoPostal = ?)`;
            numericParams = [n, rawDigits];
          }
        }

        if (!canTextSearch) {
          // Si no llegamos a 3 caracteres: solo aplicar búsqueda si es numérico (ID/CP).
          // Evita scans caros y cumple la UX (arranca desde 3 caracteres).
          if (numericClause) {
            whereConditions.push(numericClause);
            params.push(...numericParams);
          }
        } else if (canUseFulltext) {
          const terms = raw
            .split(/\s+/)
            .map(t => t.trim())
            .filter(Boolean)
            .map(t => `${t.replace(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ._@+-]/g, '')}*`)
            .filter(t => t !== '*')
            .join(' ');

          if (terms && terms.replace(/\*/g, '').length >= 3) {
            const colsSql = ftCols.map(cn => `c.\`${cn}\``).join(', ');
            whereConditions.push(
              numericClause
                ? `(${numericClause} OR (MATCH(${colsSql}) AGAINST (? IN BOOLEAN MODE)))`
                : `(MATCH(${colsSql}) AGAINST (? IN BOOLEAN MODE))`
            );
            if (numericParams) params.push(...numericParams);
            params.push(terms);
          } else {
            // término demasiado corto: fallback a LIKE
            const termLower = raw.toLowerCase();
            const like = `%${termLower}%`;
            if (compactSearch) {
              whereConditions.push(`${numericClause ? `(${numericClause} OR (` : '('}
                LOWER(IFNULL(c.Nombre_Razon_Social,'')) LIKE ?
                OR LOWER(IFNULL(c.Nombre_Cial,'')) LIKE ?
                OR LOWER(IFNULL(c.DNI_CIF,'')) LIKE ?
              ${numericClause ? '))' : ')'}`);
              if (numericParams) params.push(...numericParams);
              params.push(like, like, like);
            } else {
              whereConditions.push(`${numericClause ? `(${numericClause} OR (` : '('}
                LOWER(IFNULL(c.Nombre_Razon_Social,'')) LIKE ?
                OR LOWER(IFNULL(c.Nombre_Cial,'')) LIKE ?
                OR LOWER(IFNULL(c.DNI_CIF,'')) LIKE ?
                OR LOWER(IFNULL(c.Email,'')) LIKE ?
                OR LOWER(IFNULL(c.Telefono,'')) LIKE ?
                OR LOWER(IFNULL(c.Movil,'')) LIKE ?
                OR LOWER(IFNULL(c.NumeroFarmacia,'')) LIKE ?
                OR LOWER(IFNULL(c.Direccion,'')) LIKE ?
                OR LOWER(IFNULL(c.Poblacion,'')) LIKE ?
                OR LOWER(IFNULL(c.CodigoPostal,'')) LIKE ?
                OR LOWER(IFNULL(c.NomContacto,'')) LIKE ?
                OR LOWER(IFNULL(c.Observaciones,'')) LIKE ?
                OR LOWER(IFNULL(c.IBAN,'')) LIKE ?
                OR LOWER(IFNULL(c.CuentaContable,'')) LIKE ?
              ${numericClause ? '))' : ')'}`);
              if (numericParams) params.push(...numericParams);
              params.push(like, like, like, like, like, like, like, like, like, like, like, like, like, like);
            }
          }
        } else if (canTextSearch) {
          const termLower = raw.toLowerCase();
          const like = `%${termLower}%`;
          if (compactSearch) {
            whereConditions.push(`${numericClause ? `(${numericClause} OR (` : '('}
              LOWER(IFNULL(c.Nombre_Razon_Social,'')) LIKE ?
              OR LOWER(IFNULL(c.Nombre_Cial,'')) LIKE ?
              OR LOWER(IFNULL(c.DNI_CIF,'')) LIKE ?
            ${numericClause ? '))' : ')'}`);
            if (numericParams) params.push(...numericParams);
            params.push(like, like, like);
          } else {
            whereConditions.push(`${numericClause ? `(${numericClause} OR (` : '('}
              LOWER(IFNULL(c.Nombre_Razon_Social,'')) LIKE ?
              OR LOWER(IFNULL(c.Nombre_Cial,'')) LIKE ?
              OR LOWER(IFNULL(c.DNI_CIF,'')) LIKE ?
              OR LOWER(IFNULL(c.Email,'')) LIKE ?
              OR LOWER(IFNULL(c.Telefono,'')) LIKE ?
              OR LOWER(IFNULL(c.Movil,'')) LIKE ?
              OR LOWER(IFNULL(c.NumeroFarmacia,'')) LIKE ?
              OR LOWER(IFNULL(c.Direccion,'')) LIKE ?
              OR LOWER(IFNULL(c.Poblacion,'')) LIKE ?
              OR LOWER(IFNULL(c.CodigoPostal,'')) LIKE ?
              OR LOWER(IFNULL(c.NomContacto,'')) LIKE ?
              OR LOWER(IFNULL(c.Observaciones,'')) LIKE ?
              OR LOWER(IFNULL(c.IBAN,'')) LIKE ?
              OR LOWER(IFNULL(c.CuentaContable,'')) LIKE ?
            ${numericClause ? '))' : ')'}`);
            if (numericParams) params.push(...numericParams);
            params.push(like, like, like, like, like, like, like, like, like, like, like, like, like, like);
          }
        }
      }

      if (whereConditions.length > 0) {
        sql += ' WHERE ' + whereConditions.join(' AND ');
      }

      // Orden estable (evita saltos entre páginas)
      // Nota: algunos drivers/entornos dan problemas con placeholders en LIMIT/OFFSET.
      // Como limit/offset ya están saneados a números, los interpolamos directamente.
      // Orden:
      // - Si estamos en modo "conVentas" y no hay búsqueda, priorizar por último pedido (para que los "primeros 20" sean relevantes)
      // - Si hay búsqueda u otros filtros, ordenar estable por Id.
      const hasSearch = !!(filters.q && String(filters.q).trim().length >= 3);
      const conVentas = (filters.conVentas === true || filters.conVentas === 'true' || filters.conVentas === '1');
      if (orderByNombre) {
        sql += ` ORDER BY NULLIF(TRIM(c.Nombre_Razon_Social), '') ${order}, c.\`${pk}\` ASC LIMIT ${limit} OFFSET ${offset}`;
      } else if (conVentas && !hasSearch && this.__pedidosFechaCol) {
        sql += ` ORDER BY (SELECT MAX(p3.\`${this.__pedidosFechaCol}\`) FROM pedidos p3 WHERE p3.\`${this.__pedidosClienteCol}\` = c.\`${pk}\`) DESC, c.\`${pk}\` ${order} LIMIT ${limit} OFFSET ${offset}`;
      } else {
        sql += ` ORDER BY c.\`${pk}\` ${order} LIMIT ${limit} OFFSET ${offset}`;
      }

      const rows = await this.query(sql, params);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo clientes paginados:', error.message);
      console.error('❌ SQL (paged):', sql);
      throw error;
    }
  }

  /**
   * Conteo para paginación con los mismos filtros que getClientesOptimizadoPaged.
   */
  async countClientesOptimizado(filters = {}) {
    let sql = '';
    try {
      const { pk, colComercial, colEstadoCliente, colTipoContacto } = await this._ensureClientesMeta();
      const whereConditions = [];

      sql = 'SELECT COUNT(*) as total FROM clientes c';
      const params = [];

      // Estado: preferir catálogo si existe; fallback a OK_KO si no.
      if (colEstadoCliente) {
        if (filters.estadoCliente !== undefined && filters.estadoCliente !== null && String(filters.estadoCliente).trim() !== '' && !isNaN(filters.estadoCliente)) {
          const estadoId = Number(filters.estadoCliente);
          if (Number.isFinite(estadoId) && estadoId > 0) {
            whereConditions.push(`c.\`${colEstadoCliente}\` = ?`);
            params.push(estadoId);
          }
        } else if (filters.estado && typeof filters.estado === 'string') {
          const ids = await this._getEstadoClienteIds();
          const e = filters.estado.trim().toLowerCase();
          if (e === 'activos') {
            whereConditions.push(`c.\`${colEstadoCliente}\` = ?`);
            params.push(ids.activo);
          } else if (e === 'inactivos') {
            whereConditions.push(`c.\`${colEstadoCliente}\` = ?`);
            params.push(ids.inactivo);
          }
        }
      } else {
        if (filters.estado === 'activos') {
          whereConditions.push("(c.OK_KO = 1 OR c.OK_KO = '1' OR UPPER(c.OK_KO) = 'OK')");
        } else if (filters.estado === 'inactivos') {
          whereConditions.push("(c.OK_KO = 0 OR c.OK_KO = '0' OR UPPER(c.OK_KO) = 'KO')");
        }
      }

      // Resolver columna cliente en pedidos (Id_Cliente vs Cliente_id, etc.) para con/sin ventas.
      if (!this.__pedidosClienteCol) {
        try {
          const colsRows = await this.query('SHOW COLUMNS FROM pedidos').catch(() => []);
          const cols = new Set((colsRows || []).map(r => String(r.Field || '').trim()).filter(Boolean));
          this.__pedidosClienteCol =
            ['Id_Cliente', 'Cliente_id', 'id_cliente', 'cliente_id', 'ClienteId', 'clienteId'].find(c => cols.has(c)) || 'Id_Cliente';
        } catch (_) {
          this.__pedidosClienteCol = 'Id_Cliente';
        }
      }

      if (filters.tipoCliente !== null && filters.tipoCliente !== undefined && filters.tipoCliente !== '' && !isNaN(filters.tipoCliente)) {
        const tipoClienteId = typeof filters.tipoCliente === 'number' ? filters.tipoCliente : parseInt(filters.tipoCliente);
        if (!isNaN(tipoClienteId) && tipoClienteId > 0) {
          whereConditions.push('c.Id_TipoCliente = ?');
          params.push(tipoClienteId);
        }
      }

      if (colTipoContacto && filters.tipoContacto !== null && filters.tipoContacto !== undefined && String(filters.tipoContacto).trim() !== '') {
        const tipoVal = String(filters.tipoContacto).trim();
        if (['Empresa', 'Persona', 'Otros'].includes(tipoVal)) {
          whereConditions.push(`c.\`${colTipoContacto}\` = ?`);
          params.push(tipoVal);
        }
      }

      if (filters.provincia !== null && filters.provincia !== undefined && filters.provincia !== '' && !isNaN(filters.provincia)) {
        const provinciaId = typeof filters.provincia === 'number' ? filters.provincia : parseInt(filters.provincia);
        if (!isNaN(provinciaId) && provinciaId > 0) {
          whereConditions.push('c.Id_Provincia = ?');
          params.push(provinciaId);
        }
      }

      if (filters.comercial !== null && filters.comercial !== undefined && filters.comercial !== '' && !isNaN(filters.comercial)) {
        const comercialId = typeof filters.comercial === 'number' ? filters.comercial : parseInt(filters.comercial);
        if (!isNaN(comercialId) && comercialId > 0) {
          if (!colComercial) {
            throw new Error('No se encontró columna de comercial en tabla clientes');
          }
          const poolId = filters.comercialPoolId != null && !isNaN(filters.comercialPoolId) ? Number(filters.comercialPoolId) : null;
          if (poolId != null && poolId > 0 && poolId !== comercialId) {
            whereConditions.push(`(c.\`${colComercial}\` = ? OR c.\`${colComercial}\` = ?)`);
            params.push(comercialId, poolId);
          } else if (filters.comercialIncludePool && comercialId !== 1) {
            whereConditions.push(`(c.\`${colComercial}\` = ? OR c.\`${colComercial}\` = 1)`);
            params.push(comercialId);
          } else {
            whereConditions.push(`c.\`${colComercial}\` = ?`);
            params.push(comercialId);
          }
        }
      }

      if (filters.conVentas !== undefined && filters.conVentas !== null && filters.conVentas !== '') {
        if (filters.conVentas === true || filters.conVentas === 'true' || filters.conVentas === '1') {
          whereConditions.push(`EXISTS (SELECT 1 FROM pedidos p2 WHERE p2.\`${this.__pedidosClienteCol}\` = c.\`${pk}\`)`);
        } else if (filters.conVentas === false || filters.conVentas === 'false' || filters.conVentas === '0') {
          whereConditions.push(`NOT EXISTS (SELECT 1 FROM pedidos p2 WHERE p2.\`${this.__pedidosClienteCol}\` = c.\`${pk}\`)`);
        }
      }

      // A partir de 3 caracteres (excepto numérico: ID/CP desde 1)
      if (filters.q && typeof filters.q === 'string' && filters.q.trim().length >= 1) {
        const raw = filters.q.trim();
        const rawDigits = raw.replace(/\D/g, '');
        const isOnlyDigits = rawDigits.length === raw.length;
        const canTextSearch = !isOnlyDigits && raw.length >= 3;

        // Reutilizar cache calculada en getClientesOptimizadoPaged (si aún no existe, calcularla).
        if (this.__clientesFulltextCols === undefined) {
          try {
            const { tClientes } = await this._ensureClientesMeta();
            const idx = await this.query(`SHOW INDEX FROM \`${tClientes}\``).catch(() => []);
            const ft = (idx || [])
              .filter(r => String(r.Key_name || r.key_name || '').trim() === 'ft_clientes_busqueda')
              .filter(r => String(r.Index_type || r.index_type || '').toUpperCase() === 'FULLTEXT')
              .sort((a, b) => Number(a.Seq_in_index || a.seq_in_index || 0) - Number(b.Seq_in_index || b.seq_in_index || 0))
              .map(r => String(r.Column_name || r.column_name || '').trim())
              .filter(Boolean);
            this.__clientesFulltextCols = ft.length ? ft : null;
          } catch (_) {
            this.__clientesFulltextCols = null;
          }
        }

        const ftCols = Array.isArray(this.__clientesFulltextCols) ? this.__clientesFulltextCols : null;
        const canUseFulltext = ftCols && ftCols.length >= 1;

        let numericClause = null;
        let numericParams = null;
        if (isOnlyDigits && rawDigits.length > 0) {
          const n = Number(rawDigits);
          if (Number.isFinite(n) && n > 0) {
            numericClause = `(c.\`${pk}\` = ? OR c.CodigoPostal = ?)`;
            numericParams = [n, rawDigits];
          }
        }

        if (!canTextSearch) {
          // Solo numérico corto (ID/CP): aplicar condición rápida si existe.
          if (numericClause) {
            whereConditions.push(numericClause);
            params.push(...numericParams);
          }
        } else if (canUseFulltext) {
          const terms = raw
            .split(/\s+/)
            .map(t => t.trim())
            .filter(Boolean)
            .map(t => `${t.replace(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ._@+-]/g, '')}*`)
            .filter(t => t !== '*')
            .join(' ');

          if (terms && terms.replace(/\*/g, '').length >= 3) {
            const colsSql = ftCols.map(cn => `c.\`${cn}\``).join(', ');
            whereConditions.push(
              numericClause
                ? `(${numericClause} OR (MATCH(${colsSql}) AGAINST (? IN BOOLEAN MODE)))`
                : `(MATCH(${colsSql}) AGAINST (? IN BOOLEAN MODE))`
            );
            if (numericParams) params.push(...numericParams);
            params.push(terms);
          } else {
            const termLower = raw.toLowerCase();
            const like = `%${termLower}%`;
            whereConditions.push(`${numericClause ? `(${numericClause} OR (` : '('}
              LOWER(IFNULL(c.Nombre_Razon_Social,'')) LIKE ?
              OR LOWER(IFNULL(c.Nombre_Cial,'')) LIKE ?
              OR LOWER(IFNULL(c.DNI_CIF,'')) LIKE ?
              OR LOWER(IFNULL(c.Email,'')) LIKE ?
              OR LOWER(IFNULL(c.Telefono,'')) LIKE ?
              OR LOWER(IFNULL(c.Movil,'')) LIKE ?
              OR LOWER(IFNULL(c.NumeroFarmacia,'')) LIKE ?
              OR LOWER(IFNULL(c.Direccion,'')) LIKE ?
              OR LOWER(IFNULL(c.Poblacion,'')) LIKE ?
              OR LOWER(IFNULL(c.CodigoPostal,'')) LIKE ?
              OR LOWER(IFNULL(c.NomContacto,'')) LIKE ?
              OR LOWER(IFNULL(c.Observaciones,'')) LIKE ?
              OR LOWER(IFNULL(c.IBAN,'')) LIKE ?
              OR LOWER(IFNULL(c.CuentaContable,'')) LIKE ?
            ${numericClause ? '))' : ')'}`);
            if (numericParams) params.push(...numericParams);
            params.push(like, like, like, like, like, like, like, like, like, like, like, like, like, like);
          }
        } else if (canTextSearch) {
          const termLower = raw.toLowerCase();
          const like = `%${termLower}%`;
          whereConditions.push(`${numericClause ? `(${numericClause} OR (` : '('}
            LOWER(IFNULL(c.Nombre_Razon_Social,'')) LIKE ?
            OR LOWER(IFNULL(c.Nombre_Cial,'')) LIKE ?
            OR LOWER(IFNULL(c.DNI_CIF,'')) LIKE ?
            OR LOWER(IFNULL(c.Email,'')) LIKE ?
            OR LOWER(IFNULL(c.Telefono,'')) LIKE ?
            OR LOWER(IFNULL(c.Movil,'')) LIKE ?
            OR LOWER(IFNULL(c.NumeroFarmacia,'')) LIKE ?
            OR LOWER(IFNULL(c.Direccion,'')) LIKE ?
            OR LOWER(IFNULL(c.Poblacion,'')) LIKE ?
            OR LOWER(IFNULL(c.CodigoPostal,'')) LIKE ?
            OR LOWER(IFNULL(c.NomContacto,'')) LIKE ?
            OR LOWER(IFNULL(c.Observaciones,'')) LIKE ?
            OR LOWER(IFNULL(c.IBAN,'')) LIKE ?
            OR LOWER(IFNULL(c.CuentaContable,'')) LIKE ?
          ${numericClause ? '))' : ')'}`);
          if (numericParams) params.push(...numericParams);
          params.push(like, like, like, like, like, like, like, like, like, like, like, like, like, like);
        }
      }

      if (whereConditions.length > 0) {
        sql += ' WHERE ' + whereConditions.join(' AND ');
      }

      const rows = await this.query(sql, params);
      return rows?.[0]?.total ? Number(rows[0].total) : 0;
    } catch (error) {
      console.error('❌ Error contando clientes (optimizado):', error.message);
      console.error('❌ SQL (count):', sql);
      return 0;
    }
  }

  async getClientesCount() {
    try {
      const sql = 'SELECT COUNT(*) as count FROM clientes';
      const rows = await this.query(sql);
      const count = rows[0]?.count || rows[0]?.COUNT || 0;
      console.log(`📊 [COUNT CLIENTES] Total de clientes: ${count}`);
      return parseInt(count, 10) || 0;
    } catch (error) {
      console.error('❌ Error obteniendo conteo de clientes:', error.message);
      console.error('❌ Stack:', error.stack);
      // Fallback: obtener todos y contar
      try {
        const todos = await this.getClientes();
        const fallbackCount = Array.isArray(todos) ? todos.length : 0;
        console.log(`⚠️ [COUNT CLIENTES] Usando fallback, contados: ${fallbackCount}`);
        return fallbackCount;
      } catch (fallbackError) {
        console.error('❌ Error en fallback de conteo:', fallbackError.message);
        return 0;
      }
    }
  }

  async getClientesEstadisticas() {
    try {
      // Obtener total de clientes
      const sqlTotal = 'SELECT COUNT(*) as total FROM clientes';
      const rowsTotal = await this.query(sqlTotal);
      const total = parseInt(rowsTotal[0]?.total || rowsTotal[0]?.COUNT || 0, 10);

      // Obtener clientes activos usando OK_KO (Estado)
      // OK_KO = 1 significa Activo, OK_KO = 0 significa Inactivo
      // También aceptar valores legacy 'OK'/'KO' para compatibilidad
      const sqlActivos = `
        SELECT COUNT(*) as activos 
        FROM clientes 
        WHERE (OK_KO = 1 OR UPPER(TRIM(COALESCE(OK_KO, ''))) = 'OK')
      `;
      let rowsActivos;
      let activos = 0;
      
      try {
        rowsActivos = await this.query(sqlActivos);
        activos = parseInt(rowsActivos[0]?.activos || rowsActivos[0]?.ACTIVOS || 0, 10);
      } catch (errorActivos) {
        console.log('⚠️ [ESTADISTICAS] Error en consulta de activos, usando fallback:', errorActivos.message);
        // Si falla, usar el método de fallback directamente
        throw errorActivos;
      }

      // Calcular inactivos
      const inactivos = total - activos;

      console.log(`📊 [ESTADISTICAS CLIENTES] Total: ${total}, Activos: ${activos}, Inactivos: ${inactivos}`);

      return {
        total: total,
        activos: activos,
        inactivos: inactivos
      };
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas de clientes:', error.message);
      console.error('❌ Stack:', error.stack);
      
      // Fallback: obtener todos y contar manualmente usando OK_KO
      try {
        const todos = await this.getClientes();
        const total = Array.isArray(todos) ? todos.length : 0;
        let activos = 0;
        
        todos.forEach(cliente => {
          // Usar OK_KO para determinar si está activo
          const okKo = cliente.OK_KO;
          if (okKo === 1 || okKo === true || okKo === '1' || (typeof okKo === 'string' && okKo.toUpperCase().trim() === 'OK')) {
            activos++;
          }
        });
        
        const inactivos = total - activos;
        
        console.log(`⚠️ [ESTADISTICAS CLIENTES] Usando fallback - Total: ${total}, Activos: ${activos}, Inactivos: ${inactivos}`);
        
        return {
          total: total,
          activos: activos,
          inactivos: inactivos
        };
      } catch (fallbackError) {
        console.error('❌ Error en fallback de estadísticas:', fallbackError.message);
        return {
          total: 0,
          activos: 0,
          inactivos: 0
        };
      }
    }
  }

  async getClienteById(id) {
    try {
      const tClientes = await this._resolveTableNameCaseInsensitive('clientes');
      const sql = `SELECT * FROM \`${tClientes}\` WHERE Id = ? LIMIT 1`;
      const rows = await this.query(sql, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo cliente por ID:', error.message);
      return null;
    }
  }

  /**
   * Indica si un comercial puede editar un contacto: es suyo o está asignado al comercial pool (Paco Lara).
   */
  async canComercialEditCliente(clienteId, userId) {
    if (!clienteId || !userId) return false;
    const cliente = await this.getClienteById(clienteId);
    if (!cliente) return false;
    const { colComercial } = await this._ensureClientesMeta();
    if (!colComercial) return false;
    const asignado = Number(cliente[colComercial] ?? cliente.Id_Cial ?? 0) || 0;
    if (asignado === Number(userId)) return true;
    const poolId = await this.getComercialIdPool();
    return poolId != null && asignado === Number(poolId);
  }

  /**
   * Indica si el contacto está asignado al pool (Paco Lara) o sin asignar (permite solicitar asignación).
   */
  async isContactoAsignadoAPoolOSinAsignar(clienteId) {
    if (!clienteId) return false;
    const cliente = await this.getClienteById(clienteId);
    if (!cliente) return false;
    const { colComercial } = await this._ensureClientesMeta();
    if (!colComercial) return false;
    const asignado = Number(cliente[colComercial] ?? cliente.Id_Cial ?? 0) || 0;
    if (asignado === 0) return true;
    const poolId = await this.getComercialIdPool();
    return poolId != null && asignado === Number(poolId);
  }

  async getClientesByComercial(comercialId) {
    try {
      const sql = 'SELECT * FROM clientes WHERE ComercialId = ? OR comercialId = ? ORDER BY Id ASC';
      const rows = await this.query(sql, [comercialId, comercialId]);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo clientes por comercial:', error.message);
      return [];
    }
  }

  async getClientesByCodigoPostal(idCodigoPostal) {
    try {
      const sql = `
        SELECT 
          c.*,
          c.Nombre_Razon_Social AS Nombre,
          c.Poblacion,
          com.Nombre AS NombreComercial
        FROM Clientes c
        LEFT JOIN Comerciales com ON c.Id_Cial = com.id
        WHERE c.Id_CodigoPostal = ?
        ORDER BY c.Nombre_Razon_Social ASC
      `;
      const rows = await this.query(sql, [idCodigoPostal]);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo clientes por código postal:', error.message);
      return [];
    }
  }

  // ---------- Notificaciones (solicitudes de asignación de contactos) ----------
  async _ensureNotificacionesTable() {
    try {
      await this.query(`
        CREATE TABLE IF NOT EXISTS \`notificaciones\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`tipo\` VARCHAR(64) NOT NULL DEFAULT 'asignacion_contacto',
          \`id_contacto\` INT NOT NULL,
          \`id_comercial_solicitante\` INT NOT NULL,
          \`estado\` ENUM('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'pendiente',
          \`id_admin_resolvio\` INT NULL,
          \`fecha_creacion\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`fecha_resolucion\` DATETIME NULL,
          \`notas\` VARCHAR(500) NULL,
          PRIMARY KEY (\`id\`),
          KEY \`idx_notif_estado\` (\`estado\`),
          KEY \`idx_notif_contacto\` (\`id_contacto\`),
          KEY \`idx_notif_comercial\` (\`id_comercial_solicitante\`),
          KEY \`idx_notif_fecha_creacion\` (\`fecha_creacion\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      return true;
    } catch (e) {
      console.warn('⚠️ [NOTIF] No se pudo crear tabla notificaciones:', e?.message);
      return false;
    }
  }

  async createSolicitudAsignacion(idContacto, idComercialSolicitante) {
    await this._ensureNotificacionesTable();
    const r = await this.query(
      'INSERT INTO `notificaciones` (tipo, id_contacto, id_comercial_solicitante, estado) VALUES (?, ?, ?, ?)',
      ['asignacion_contacto', idContacto, idComercialSolicitante, 'pendiente']
    );
    return r?.insertId ?? r?.affectedRows ?? null;
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
   * Obtiene nombres de contactos por lista de IDs. Devuelve Map(id -> nombre).
   */
  async _getClientesNombresByIds(ids) {
    const map = {};
    if (!ids || ids.length === 0) return map;
    const uniq = [...new Set(ids.filter((id) => id != null && id !== ''))];
    if (uniq.length === 0) return map;
    try {
      const meta = await this._ensureClientesMeta();
      const placeholders = uniq.map(() => '?').join(',');
      const sql = `SELECT \`${meta.pk}\` AS id, Nombre_Razon_Social AS nombre FROM \`${meta.tClientes}\` WHERE \`${meta.pk}\` IN (${placeholders})`;
      const rows = await this.query(sql, uniq);
      const list = Array.isArray(rows) ? rows : [];
      list.forEach((r) => {
        const id = r.id ?? r.Id ?? r.id_contacto;
        const nombre = r.nombre ?? r.Nombre_Razon_Social ?? r.Nombre ?? '';
        if (id != null) map[Number(id)] = nombre;
      });
    } catch (e) {
      console.warn('⚠️ [NOTIF] No se pudieron cargar nombres de contactos:', e?.message);
    }
    return map;
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
      const sql = `SELECT \`${meta.pk}\` AS id, Nombre AS nombre FROM \`${meta.table}\` WHERE \`${meta.pk}\` IN (${placeholders})`;
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

  async getNotificaciones(limit = 50, offset = 0) {
    const l = Math.max(1, Math.min(100, Number(limit)));
    const o = Math.max(0, Number(offset));
    await this._ensureNotificacionesTable();
    try {
      const sql = `SELECT id, tipo, id_contacto, id_comercial_solicitante, estado, id_admin_resolvio, fecha_creacion, fecha_resolucion, notas FROM \`notificaciones\` ORDER BY fecha_creacion DESC LIMIT ${l} OFFSET ${o}`;
      const rows = await this.query(sql);
      const list = Array.isArray(rows) ? rows : (rows && typeof rows === 'object' && !rows.insertId ? [rows] : []);
      const items = list.map((n) => ({
        id: n.id,
        tipo: n.tipo,
        id_contacto: n.id_contacto,
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
      const [nombresContactos, nombresComerciales] = await Promise.all([
        this._getClientesNombresByIds(contactIds),
        this._getComercialesNombresByIds(comercialIds)
      ]);
      items.forEach((n) => {
        n.contacto_nombre = nombresContactos[Number(n.id_contacto)] ?? null;
        n.comercial_nombre = nombresComerciales[Number(n.id_comercial_solicitante)] ?? null;
      });
      return items;
    } catch (e) {
      console.error('❌ Error listando notificaciones:', e?.message);
      return [];
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
    if (aprobar) {
      const { colComercial } = await this._ensureClientesMeta();
      if (colComercial) {
        await this.query(`UPDATE clientes SET \`${colComercial}\` = ? WHERE Id = ?`, [notif.id_comercial_solicitante, notif.id_contacto]);
      }
    }
    return { ok: true };
  }

  async moverClienteAPapelera(clienteId, eliminadoPor) {
    try {
      // Obtener el cliente completo
      const cliente = await this.getClienteById(clienteId);
      if (!cliente) {
        throw new Error('Cliente no encontrado');
      }

      // Preparar los datos para insertar en la papelera
      const datosPapelera = {
        id: cliente.id || cliente.Id,
        Id_Cial: cliente.Id_Cial || cliente.id_Cial,
        DNI_CIF: cliente.DNI_CIF,
        Nombre_Razon_Social: cliente.Nombre_Razon_Social || cliente.Nombre,
        Nombre_Cial: cliente.Nombre_Cial,
        NumeroFarmacia: cliente.NumeroFarmacia,
        Direccion: cliente.Direccion,
        Poblacion: cliente.Poblacion,
        Id_Provincia: cliente.Id_Provincia || cliente.id_Provincia,
        CodigoPostal: cliente.CodigoPostal,
        Movil: cliente.Movil,
        Telefono: cliente.Telefono,
        Email: cliente.Email,
        TipoCliente: cliente.TipoCliente,
        Id_TipoCliente: cliente.Id_TipoCliente || cliente.id_TipoCliente,
        CodPais: cliente.CodPais,
        Id_Pais: cliente.Id_Pais || cliente.id_Pais,
        Pais: cliente.Pais,
        Idioma: cliente.Idioma,
        Id_Idioma: cliente.Id_Idioma || cliente.id_Idioma,
        Moneda: cliente.Moneda,
        Id_Moneda: cliente.Id_Moneda || cliente.id_Moneda,
        NomContacto: cliente.NomContacto,
        Tarifa: cliente.Tarifa,
        Id_FormaPago: cliente.Id_FormaPago || cliente.id_FormaPago,
        Dto: cliente.Dto,
        CuentaContable: cliente.CuentaContable,
        RE: cliente.RE,
        Banco: cliente.Banco,
        Swift: cliente.Swift,
        IBAN: cliente.IBAN,
        Modelo_347: cliente.Modelo_347,
        FechaEliminacion: new Date(),
        EliminadoPor: eliminadoPor
      };

      // Insertar en la papelera
      const campos = Object.keys(datosPapelera).map(key => `\`${key}\``).join(', ');
      const placeholders = Object.keys(datosPapelera).map(() => '?').join(', ');
      const valores = Object.values(datosPapelera);

      const sqlInsert = `INSERT INTO \`Papelera-Clientes\` (${campos}) VALUES (${placeholders})`;
      console.log('📝 [PAPELERA] Insertando cliente en papelera:', { clienteId, eliminadoPor });
      await this.query(sqlInsert, valores);

      // Eliminar de la tabla clientes
      const sqlDelete = 'DELETE FROM clientes WHERE id = ?';
      await this.query(sqlDelete, [clienteId]);

      console.log(`✅ Cliente ${clienteId} movido a la papelera por usuario ${eliminadoPor}`);
      return { success: true, message: 'Cliente movido a la papelera correctamente' };
    } catch (error) {
      console.error('❌ Error moviendo cliente a la papelera:', error.message);
      throw error;
    }
  }

  async updateCliente(id, payload) {
    try {
      // Tarifa: si no viene o viene vacía, aplicar PVL (Id=0)
      if (payload.Tarifa !== undefined) {
        const raw = payload.Tarifa;
        if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
          payload.Tarifa = 0;
        } else {
          const n = Number.parseInt(String(raw).trim(), 10);
          payload.Tarifa = Number.isFinite(n) ? n : 0;
        }
      }

      // Validar y normalizar OK_KO (Estado) - debe ser 1 (Activo) o 0 (Inactivo)
      // OK_KO es el campo que determina si un cliente está activo o no
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
      
      // Obtener provincias y países para validación
      const provincias = await this.getProvincias();
      const paises = await this.getPaises();
      
      // Si se actualiza Id_Pais, actualizar también CodPais y Pais (legacy)
      if (payload.Id_Pais !== undefined) {
        try {
          const pais = await this.getPaisById(payload.Id_Pais);
          if (pais) {
            // Normalizar nombre del país antes de guardarlo en campos legacy
            const { normalizeTitleCaseES } = require('../utils/normalize-utf8');
            payload.CodPais = pais.Id_pais;
            payload.Pais = normalizeTitleCaseES(pais.Nombre_pais || '');
          }
        } catch (error) {
          console.warn('⚠️  No se pudo obtener país por ID:', error.message);
        }
      }
      
      // Obtener valores actuales del cliente para validación
      const clienteActual = await this.getClienteById(id);
      const provinciaId = payload.Id_Provincia !== undefined ? payload.Id_Provincia : (clienteActual?.Id_Provincia || clienteActual?.id_Provincia);
      const paisId = payload.Id_Pais !== undefined ? payload.Id_Pais : (clienteActual?.Id_Pais || clienteActual?.id_Pais);

      // Estado de cliente (nuevo): Id_EstdoCliente (si existe la columna)
      // Regla solicitada:
      // - Inactivo si OK_KO=0 o si se selecciona Inactivo explícitamente
      // - Si no inactivo:
      //    * DNI/CIF inválido => Potencial
      //    * DNI/CIF válido   => Activo
      try {
        const meta = await this._ensureClientesMeta();
        const colEstadoCliente = meta?.colEstadoCliente || null;
        if (colEstadoCliente) {
          const ids = await this._getEstadoClienteIds().catch(() => ({ potencial: 1, activo: 2, inactivo: 3 }));

          const dniToCheck = (payload.DNI_CIF !== undefined) ? payload.DNI_CIF : (clienteActual?.DNI_CIF);
          const dniValido = this._isValidDniCif(dniToCheck);

          const okKoToCheck = (payload.OK_KO !== undefined) ? payload.OK_KO : (clienteActual?.OK_KO);
          const esInactivoPorOkKo = (okKoToCheck === 0 || okKoToCheck === '0' || okKoToCheck === false || (typeof okKoToCheck === 'string' && okKoToCheck.toUpperCase().trim() === 'KO'));

          const estadoReq = (payload.Id_EstdoCliente !== undefined && payload.Id_EstdoCliente !== null && String(payload.Id_EstdoCliente).trim() !== '')
            ? Number(payload.Id_EstdoCliente)
            : null;

          const estadoFinal = (estadoReq === ids.inactivo || esInactivoPorOkKo)
            ? ids.inactivo
            : (dniValido ? ids.activo : ids.potencial);

          payload.Id_EstdoCliente = estadoFinal;
          payload.OK_KO = (estadoFinal === ids.inactivo) ? 0 : 1;
        }
      } catch (e) {
        // Si falla, no bloquear el update (compatibilidad sin migración)
        console.warn('⚠️  [UPDATE] No se pudo calcular Id_EstdoCliente:', e?.message || e);
      }
      
      // Si hay código postal, validar correspondencia con provincia y país (si existe el módulo)
      if (payload.CodigoPostal && (provinciaId || paisId)) {
        try {
          const { validarCodigoPostalProvinciaPais } = require('../scripts/validar-codigo-postal-provincia-pais');
          const validacion = validarCodigoPostalProvinciaPais(payload.CodigoPostal, provinciaId, paisId, provincias, paises);
          if (!validacion.valido) throw new Error(validacion.error);
        } catch (error) {
          if (error.code === 'MODULE_NOT_FOUND' || (error.message && error.message.includes('Cannot find module'))) {
            // Módulo opcional no desplegado: omitir validación
          } else {
            throw new Error(`Error de validación: ${error.message}`);
          }
        }
      }
      
      // Si se actualiza CodigoPostal y no hay Id_Provincia, intentar asociarla (si existe el módulo)
      if (payload.CodigoPostal && !payload.Id_Provincia) {
        try {
          const { obtenerProvinciaPorCodigoPostal } = require('../scripts/asociar-provincia-por-codigo-postal');
          if (provincias && provincias.length > 0) {
            const provinciaIdFromCP = obtenerProvinciaPorCodigoPostal(payload.CodigoPostal, provincias);
            if (provinciaIdFromCP) {
              payload.Id_Provincia = provinciaIdFromCP;
              // Actualizar Pais si no está definido
              const provincia = provincias.find(p => p.id === provinciaIdFromCP);
              if (provincia && !payload.Id_Pais && !payload.Pais) {
                // Buscar país por código de país de la provincia
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
            // Módulo opcional: omitir asociación
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
      
      const fields = [];
      const values = [];
      
      for (const [key, value] of Object.entries(payload)) {
        if (value === undefined) continue; // no enviar undefined al bind (MySQL exige null, no undefined)
        fields.push(`\`${key}\` = ?`);
        values.push(value === null ? null : value);
      }
      
      if (fields.length === 0) return { affectedRows: 0 };
      
      values.push(id);
      const tClientes = await this._resolveTableNameCaseInsensitive('clientes');
      const sql = `UPDATE \`${tClientes}\` SET ${fields.join(', ')} WHERE Id = ?`;
      await this.query(sql, values);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando cliente:', error.message);
      throw error;
    }
  }

  async createCliente(payload) {
    try {
      // Tarifa: si no viene o viene vacía, aplicar PVL (Id=0)
      if (payload.Tarifa === undefined || payload.Tarifa === null || (typeof payload.Tarifa === 'string' && payload.Tarifa.trim() === '')) {
        payload.Tarifa = 0;
      } else {
        const n = Number.parseInt(String(payload.Tarifa).trim(), 10);
        payload.Tarifa = Number.isFinite(n) ? n : 0;
      }

      // Validar y normalizar OK_KO (Estado) - debe ser 1 (Activo) o 0 (Inactivo)
      // OK_KO es el campo que determina si un cliente está activo o no
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
        // Por defecto activo si no se especifica
        payload.OK_KO = 1;
      }
      
      // Normalizar DNI_CIF: si viene vacío, guardar como "Pendiente"
      if (payload.DNI_CIF !== undefined && payload.DNI_CIF !== null) {
        const dniValue = String(payload.DNI_CIF).trim();
        if (dniValue === '' || dniValue.toLowerCase() === 'pendiente') {
          payload.DNI_CIF = 'Pendiente';
        }
      }

      // Estado de cliente (nuevo): Id_EstdoCliente
      // Regla solicitada:
      // - Si el cliente está inactivo (OK_KO=0) => Inactivo
      // - Si NO está inactivo:
      //    * DNI/CIF inválido => Potencial
      //    * DNI/CIF válido   => Activo
      const meta = await this._ensureClientesMeta().catch(() => null);
      const colEstadoCliente = meta?.colEstadoCliente || null;
      if (colEstadoCliente) {
        const ids = await this._getEstadoClienteIds().catch(() => ({ potencial: 1, activo: 2, inactivo: 3 }));

        const dniToCheck = payload.DNI_CIF;
        const dniValido = this._isValidDniCif(dniToCheck);
        const okKo = payload.OK_KO;
        const esInactivo = (okKo === 0 || okKo === '0' || okKo === false);

        // Si viene estado explícito y es Inactivo, respetar; el resto se recalcula por regla.
        const estadoReq = payload.Id_EstdoCliente !== undefined ? Number(payload.Id_EstdoCliente) : null;
        const estadoFinal = (estadoReq === ids.inactivo || esInactivo)
          ? ids.inactivo
          : (dniValido ? ids.activo : ids.potencial);

        payload.Id_EstdoCliente = estadoFinal;
        // Mantener compatibilidad con OK_KO: inactivo->0; resto->1
        payload.OK_KO = (estadoFinal === ids.inactivo) ? 0 : 1;
      }
      
      // Por defecto, si no hay país, usar España
      if (!payload.Id_Pais) {
        const espana = await this.getPaisByCodigoISO('ES');
        if (espana) {
          payload.Id_Pais = espana.id;
          payload.CodPais = espana.Id_pais;
          payload.Pais = espana.Nombre_pais;
        }
      }
      
      // Obtener provincias y países para validación
      const provincias = await this.getProvincias();
      const paises = await this.getPaises();
      
      // Si se actualiza Id_Pais, actualizar también CodPais y Pais (legacy)
      if (payload.Id_Pais !== undefined) {
        try {
          const pais = await this.getPaisById(payload.Id_Pais);
          if (pais) {
            // Normalizar nombre del país antes de guardarlo en campos legacy
            const { normalizeTitleCaseES } = require('../utils/normalize-utf8');
            payload.CodPais = pais.Id_pais;
            payload.Pais = normalizeTitleCaseES(pais.Nombre_pais || '');
          }
        } catch (error) {
          console.warn('⚠️  No se pudo obtener país por ID:', error.message);
        }
      }
      
      // Si hay código postal, validar correspondencia con provincia y país (si existe el módulo)
      if (payload.CodigoPostal && (payload.Id_Provincia || payload.Id_Pais)) {
        try {
          const { validarCodigoPostalProvinciaPais } = require('../scripts/validar-codigo-postal-provincia-pais');
          const validacion = validarCodigoPostalProvinciaPais(payload.CodigoPostal, payload.Id_Provincia, payload.Id_Pais, provincias, paises);
          if (!validacion.valido) throw new Error(validacion.error);
        } catch (error) {
          if (error.code === 'MODULE_NOT_FOUND' || (error.message && error.message.includes('Cannot find module'))) {
            // Módulo opcional no desplegado: omitir validación
          } else {
            throw new Error(`Error de validación: ${error.message}`);
          }
        }
      }
      
      // Si hay CodigoPostal y no hay Id_Provincia, intentar asociarla (si existe el módulo)
      if (payload.CodigoPostal && !payload.Id_Provincia) {
        try {
          const { obtenerProvinciaPorCodigoPostal } = require('../scripts/asociar-provincia-por-codigo-postal');
          if (provincias && provincias.length > 0) {
            const provinciaId = obtenerProvinciaPorCodigoPostal(payload.CodigoPostal, provincias);
            if (provinciaId) {
              payload.Id_Provincia = provinciaId;
              // Actualizar Pais si no está definido
              const provincia = provincias.find(p => p.id === provinciaId);
              if (provincia && !payload.Id_Pais && !payload.Pais) {
                // Buscar país por código de país de la provincia
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
            // Módulo opcional: omitir asociación
          } else {
            console.warn('⚠️  No se pudo asociar provincia por código postal:', error.message);
          }
        }
      }

      // TipoContacto (Empresa/Persona): solo incluir si la columna existe
      if (!meta?.colTipoContacto && payload.TipoContacto !== undefined) delete payload.TipoContacto;
      if (payload.TipoContacto !== undefined && payload.TipoContacto !== null) {
        const t = String(payload.TipoContacto).trim();
        payload.TipoContacto = (t === 'Empresa' || t === 'Persona' || t === 'Otros') ? t : null;
      }
      
      const fields = Object.keys(payload).map(key => `\`${key}\``).join(', ');
      const placeholders = Object.keys(payload).map(() => '?').join(', ');
      const values = Object.values(payload);
      
      // Asegurar conexión
      if (!this.connected && !this.pool) {
        await this.connect();
      }

      const tClientes = await this._resolveTableNameCaseInsensitive('clientes');
      const sql = `INSERT INTO \`${tClientes}\` (${fields}) VALUES (${placeholders})`;
      // Para INSERT, necesitamos el ResultSetHeader que contiene insertId
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

  async toggleClienteOkKo(id, value) {
    try {
      let okKoValue = 1; // Por defecto activo (1)
      
      // Si viene como toggle (sin valor específico), alternar el estado actual
      if (value === undefined || value === null || value === 'toggle') {
        // Obtener estado actual
        const current = await this.query('SELECT `OK_KO` FROM clientes WHERE id = ?', [id]);
        if (current && current.length > 0) {
          const currentValue = current[0]['OK_KO'];
          
          // Convertir valor actual a booleano
          let esActivo = false;
          if (typeof currentValue === 'string') {
            esActivo = (currentValue.toUpperCase().trim() === 'OK');
          } else if (typeof currentValue === 'number') {
            esActivo = (currentValue === 1);
          } else if (typeof currentValue === 'boolean') {
            esActivo = currentValue;
          }
          
          // Alternar: si está activo (1), cambiar a inactivo (0), y viceversa
          okKoValue = esActivo ? 0 : 1;
        }
      } else {
        // Convertir valor a 1 (Activo) o 0 (Inactivo)
        // value puede ser: 'OK'/'KO', 'Activo'/'Inactivo', true/false, 1/0
        if (typeof value === 'string') {
          const valUpper = value.toUpperCase().trim();
          okKoValue = (valUpper === 'OK' || valUpper === 'ACTIVO' || valUpper === 'TRUE' || valUpper === '1') ? 1 : 0;
        } else if (typeof value === 'boolean') {
          okKoValue = value ? 1 : 0;
        } else if (typeof value === 'number') {
          okKoValue = (value === 0 || value === 1) ? value : 1;
        }
      }
      
      // Actualizar solo OK_KO con valor booleano (1 o 0)
      const meta = await this._ensureClientesMeta().catch(() => null);
      const colEstadoCliente = meta?.colEstadoCliente || null;
      let estadoFinal = null;
      let estadoNombre = null;
      if (colEstadoCliente) {
        const ids = await this._getEstadoClienteIds().catch(() => ({ potencial: 1, activo: 2, inactivo: 3 }));
        // Necesitamos DNI_CIF para decidir Activo vs Potencial cuando se activa
        const cur = await this.query('SELECT DNI_CIF FROM clientes WHERE id = ? LIMIT 1', [id]).catch(() => []);
        const dni = cur && cur.length ? cur[0].DNI_CIF : null;
        const dniValido = this._isValidDniCif(dni);
        estadoFinal = (okKoValue === 0) ? ids.inactivo : (dniValido ? ids.activo : ids.potencial);
        const sql = `UPDATE clientes SET \`OK_KO\` = ?, \`${colEstadoCliente}\` = ? WHERE id = ?`;
        await this.query(sql, [okKoValue, estadoFinal, id]);
        estadoNombre =
          estadoFinal === ids.inactivo ? 'Inactivo'
          : (estadoFinal === ids.activo ? 'Activo' : 'Potencial');
      } else {
        const sql = 'UPDATE clientes SET `OK_KO` = ? WHERE id = ?';
        await this.query(sql, [okKoValue, id]);
      }
      console.log(`✅ [TOGGLE OK_KO] Cliente ${id} actualizado: OK_KO = ${okKoValue} (${okKoValue === 1 ? 'Activo' : 'Inactivo'})`);
      if (colEstadoCliente) {
        return { affectedRows: 1, OK_KO: okKoValue, Id_EstdoCliente: estadoFinal, EstadoClienteNombre: estadoNombre };
      }
      return { affectedRows: 1, OK_KO: okKoValue };
    } catch (error) {
      console.error('❌ Error actualizando estado de cliente:', error.message);
      throw error;
    }
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

  async getClientesCooperativa() {
    try {
      // Primero verificar qué tablas existen y cuántos registros hay
      try {
        const countQuery1 = await this.query('SELECT COUNT(*) as total FROM `Clientes_Cooperativas`');
        console.log(`📊 [GET ALL] Total registros en Clientes_Cooperativas: ${countQuery1[0]?.total || 0}`);
      } catch (e) {
        console.log('⚠️ [GET ALL] No se pudo contar Clientes_Cooperativas:', e.message);
      }
      
      try {
        const countQuery2 = await this.query('SELECT COUNT(*) as total FROM clientes_cooperativas');
        console.log(`📊 [GET ALL] Total registros en clientes_cooperativas: ${countQuery2[0]?.total || 0}`);
      } catch (e) {
        console.log('⚠️ [GET ALL] No se pudo contar clientes_cooperativas:', e.message);
      }
      
      // Intentar con diferentes nombres de tabla
      let sql = `
        SELECT 
          cc.id,
          cc.Id_Cliente,
          cc.Id_Cooperativa,
          cc.NumAsociado,
          c.Nombre_Razon_Social as ClienteNombre,
          co.Nombre as CooperativaNombre
        FROM \`Clientes_Cooperativas\` cc
        LEFT JOIN clientes c ON cc.Id_Cliente = c.id
        LEFT JOIN cooperativas co ON cc.Id_Cooperativa = co.id
        ORDER BY cc.id DESC
      `;
      let rows;
      
      try {
        rows = await this.query(sql);
        console.log(`✅ [GET ALL] Relaciones obtenidas con tabla Clientes_Cooperativas: ${rows.length}`);
        if (rows.length > 0) {
          console.log(`📋 [GET ALL] Primer registro:`, JSON.stringify(rows[0], null, 2));
        }
        return rows;
      } catch (error1) {
        console.log('⚠️ [GET ALL] Error con Clientes_Cooperativas, intentando clientes_cooperativas:', error1.message);
        // Intentar con minúsculas
        sql = `
          SELECT 
            cc.id,
            cc.Id_Cliente,
            cc.Id_Cooperativa,
            cc.NumAsociado,
            c.Nombre_Razon_Social as ClienteNombre,
            co.Nombre as CooperativaNombre
          FROM clientes_cooperativas cc
          LEFT JOIN clientes c ON cc.Id_Cliente = c.id
          LEFT JOIN cooperativas co ON cc.Id_Cooperativa = co.id
          ORDER BY cc.id DESC
        `;
        try {
          rows = await this.query(sql);
          console.log(`✅ [GET ALL] Relaciones obtenidas con tabla clientes_cooperativas: ${rows.length}`);
          if (rows.length > 0) {
            console.log(`📋 [GET ALL] Primer registro:`, JSON.stringify(rows[0], null, 2));
          }
          return rows;
        } catch (error2) {
          console.error('❌ [GET ALL] Error con ambas variantes de nombre de tabla');
          console.error('❌ Error 1:', error1.message);
          console.error('❌ Error 2:', error2.message);
          
          // Intentar consulta simple sin JOINs para verificar si la tabla existe
          try {
            const simpleQuery = await this.query('SELECT * FROM `Clientes_Cooperativas` LIMIT 5');
            console.log(`✅ [GET ALL] Consulta simple exitosa, registros: ${simpleQuery.length}`);
            // Si funciona sin JOINs, hacer el JOIN manualmente
            if (simpleQuery.length > 0) {
              const rowsWithNames = await Promise.all(simpleQuery.map(async (row) => {
                const cliente = await this.getClienteById(row.Id_Cliente).catch(() => null);
                const cooperativa = await this.getCooperativaById(row.Id_Cooperativa).catch(() => null);
                return {
                  ...row,
                  ClienteNombre: cliente ? (cliente.Nombre || cliente.nombre) : null,
                  CooperativaNombre: cooperativa ? (cooperativa.Nombre || cooperativa.nombre) : null
                };
              }));
              return rowsWithNames;
            }
          } catch (e) {
            console.error('❌ [GET ALL] Error en consulta simple:', e.message);
          }
          
          throw error2;
        }
      }
    } catch (error) {
      console.error('❌ Error obteniendo clientes_cooperativas:', error.message);
      console.error('❌ Stack:', error.stack);
      return [];
    }
  }

  async getClienteCooperativaById(id) {
    try {
      console.log(`🔍 [GET BY ID] Buscando relación con ID: ${id}`);
      
      // Primero intentar consulta simple sin JOINs para verificar que existe
      let sqlSimple = 'SELECT * FROM `Clientes_Cooperativas` WHERE id = ? LIMIT 1';
      let rowSimple;
      
      try {
        const rowsSimple = await this.query(sqlSimple, [id]);
        if (rowsSimple.length > 0) {
          rowSimple = rowsSimple[0];
          console.log(`✅ [GET BY ID] Relación encontrada con tabla Clientes_Cooperativas (sin JOINs)`);
        }
      } catch (error1) {
        console.log('⚠️ [GET BY ID] Error con Clientes_Cooperativas, intentando clientes_cooperativas:', error1.message);
        try {
          sqlSimple = 'SELECT * FROM clientes_cooperativas WHERE id = ? LIMIT 1';
          const rowsSimple2 = await this.query(sqlSimple, [id]);
          if (rowsSimple2.length > 0) {
            rowSimple = rowsSimple2[0];
            console.log(`✅ [GET BY ID] Relación encontrada con tabla clientes_cooperativas (sin JOINs)`);
          }
        } catch (error2) {
          console.error('❌ [GET BY ID] Error con ambas tablas en consulta simple:', error2.message);
        }
      }
      
      if (!rowSimple) {
        console.log(`⚠️ [GET BY ID] Relación con ID ${id} no encontrada en ninguna tabla`);
        return null;
      }
      
      // Si encontramos el registro, intentar obtener los nombres con JOINs
      let sql = `
        SELECT 
          cc.*,
          c.Nombre_Razon_Social as ClienteNombre,
          co.Nombre as CooperativaNombre
        FROM \`Clientes_Cooperativas\` cc
        LEFT JOIN clientes c ON cc.Id_Cliente = c.id
        LEFT JOIN cooperativas co ON cc.Id_Cooperativa = co.id
        WHERE cc.id = ? LIMIT 1
      `;
      let rows;
      
      try {
        rows = await this.query(sql, [id]);
        if (rows.length > 0) {
          console.log(`✅ [GET BY ID] Relación encontrada con JOINs (Clientes_Cooperativas)`);
          return rows[0];
        }
      } catch (error3) {
        console.log('⚠️ [GET BY ID] Error con JOINs en Clientes_Cooperativas, intentando clientes_cooperativas:', error3.message);
      }
      
      // Intentar con minúsculas y JOINs
      sql = `
        SELECT 
          cc.*,
          c.Nombre_Razon_Social as ClienteNombre,
          co.Nombre as CooperativaNombre
        FROM clientes_cooperativas cc
        LEFT JOIN clientes c ON cc.Id_Cliente = c.id
        LEFT JOIN cooperativas co ON cc.Id_Cooperativa = co.id
        WHERE cc.id = ? LIMIT 1
      `;
      try {
        rows = await this.query(sql, [id]);
        if (rows.length > 0) {
          console.log(`✅ [GET BY ID] Relación encontrada con JOINs (clientes_cooperativas)`);
          return rows[0];
        }
      } catch (error4) {
        console.log('⚠️ [GET BY ID] Error con JOINs, devolviendo datos sin nombres:', error4.message);
      }
      
      // Si los JOINs fallan, devolver los datos básicos sin nombres
      console.log(`✅ [GET BY ID] Devolviendo relación sin nombres de cliente/cooperativa`);
      return {
        ...rowSimple,
        ClienteNombre: null,
        CooperativaNombre: null
      };
    } catch (error) {
      console.error('❌ Error obteniendo cliente_cooperativa por ID:', error.message);
      console.error('❌ ID buscado:', id);
      console.error('❌ Stack:', error.stack);
      return null;
    }
  }

  // Obtener las cooperativas de un cliente específico
  async getCooperativasByClienteId(clienteId) {
    try {
      // Intentar con diferentes nombres de tabla
      let sql = `
        SELECT c.Nombre, cc.NumAsociado 
        FROM \`Clientes_Cooperativas\` cc
        INNER JOIN cooperativas c ON cc.Id_Cooperativa = c.id
        WHERE cc.Id_Cliente = ?
        ORDER BY c.Nombre ASC
      `;
      let rows;
      
      try {
        rows = await this.query(sql, [clienteId]);
        console.log(`✅ [GET COOP BY CLIENTE] Cooperativas obtenidas para cliente ${clienteId} con tabla Clientes_Cooperativas: ${rows.length}`);
        return rows;
      } catch (error1) {
        console.log('⚠️ [GET COOP BY CLIENTE] Error con Clientes_Cooperativas, intentando clientes_cooperativas:', error1.message);
        // Intentar con minúsculas
        sql = `
          SELECT c.Nombre, cc.NumAsociado 
          FROM clientes_cooperativas cc
          INNER JOIN cooperativas c ON cc.Id_Cooperativa = c.id
          WHERE cc.Id_Cliente = ?
          ORDER BY c.Nombre ASC
        `;
        try {
          rows = await this.query(sql, [clienteId]);
          console.log(`✅ [GET COOP BY CLIENTE] Cooperativas obtenidas para cliente ${clienteId} con tabla clientes_cooperativas: ${rows.length}`);
          return rows;
        } catch (error2) {
          console.error('❌ [GET COOP BY CLIENTE] Error con ambas variantes de nombre de tabla');
          console.error('❌ Error 1:', error1.message);
          console.error('❌ Error 2:', error2.message);
          return [];
        }
      }
    } catch (error) {
      console.error('❌ Error obteniendo cooperativas del cliente:', error.message);
      console.error('❌ Stack:', error.stack);
      return [];
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

  async getClientesGruposCompras() {
    try {
      const tRel = await this._resolveTableNameCaseInsensitive('clientes_gruposCompras');
      const tGr = await this._resolveTableNameCaseInsensitive('gruposCompras');
      const tClientes = await this._resolveTableNameCaseInsensitive('clientes');
      const sql = `
        SELECT
          cg.id,
          cg.Id_Cliente,
          cg.Id_GrupoCompras,
          cg.NumSocio,
          cg.Observaciones,
          cg.Activa,
          cg.Fecha_Alta,
          cg.Fecha_Baja,
          c.Nombre_Razon_Social as ClienteNombre,
          g.Nombre as GrupoNombre
        FROM \`${tRel}\` cg
        LEFT JOIN \`${tClientes}\` c ON cg.Id_Cliente = c.id
        LEFT JOIN \`${tGr}\` g ON cg.Id_GrupoCompras = g.id
        ORDER BY cg.id DESC
      `;
      const rows = await this.query(sql);
      return rows || [];
    } catch (error) {
      console.error('❌ Error obteniendo clientes_gruposCompras:', error.message);
      return [];
    }
  }

  async getClienteGrupoComprasById(id) {
    try {
      const tRel = await this._resolveTableNameCaseInsensitive('clientes_gruposCompras');
      const tGr = await this._resolveTableNameCaseInsensitive('gruposCompras');
      const tClientes = await this._resolveTableNameCaseInsensitive('clientes');
      const sql = `
        SELECT
          cg.*,
          c.Nombre_Razon_Social as ClienteNombre,
          g.Nombre as GrupoNombre
        FROM \`${tRel}\` cg
        LEFT JOIN \`${tClientes}\` c ON cg.Id_Cliente = c.id
        LEFT JOIN \`${tGr}\` g ON cg.Id_GrupoCompras = g.id
        WHERE cg.id = ? LIMIT 1
      `;
      const rows = await this.query(sql, [id]);
      return rows?.[0] || null;
    } catch (error) {
      console.error('❌ Error obteniendo cliente_grupoCompras por ID:', error.message);
      return null;
    }
  }

  async getGrupoComprasActivoByClienteId(clienteId) {
    try {
      const tRel = await this._resolveTableNameCaseInsensitive('clientes_gruposCompras');
      const tGr = await this._resolveTableNameCaseInsensitive('gruposCompras');
      const sql = `
        SELECT cg.*, g.Nombre as GrupoNombre
        FROM \`${tRel}\` cg
        LEFT JOIN \`${tGr}\` g ON cg.Id_GrupoCompras = g.id
        WHERE cg.Id_Cliente = ? AND cg.Activa = 1
        ORDER BY cg.id DESC
        LIMIT 1
      `;
      const rows = await this.query(sql, [clienteId]);
      return rows?.[0] || null;
    } catch (error) {
      console.error('❌ Error obteniendo grupoCompras activo del cliente:', error.message);
      return null;
    }
  }

  async createClienteGrupoCompras(payload) {
    // payload: { Id_Cliente, Id_GrupoCompras, NumSocio?, Observaciones? }
    if (!this.pool) await this.connect();
    const connection = await this.pool.getConnection();
    try {
      // Asegurar zona horaria en esta sesión de transacción
      try {
        await connection.query("SET time_zone = 'Europe/Madrid'");
      } catch (_) {}
      await connection.beginTransaction();

      const tRel = await this._resolveTableNameCaseInsensitive('clientes_gruposCompras');

      // Desactivar relación activa previa (si existe) para este cliente
      await connection.execute(
        `UPDATE \`${tRel}\` SET Activa = 0, Fecha_Baja = NOW() WHERE Id_Cliente = ? AND Activa = 1`,
        [payload.Id_Cliente]
      );

      const insertPayload = {
        Id_Cliente: payload.Id_Cliente,
        Id_GrupoCompras: payload.Id_GrupoCompras,
        NumSocio: payload.NumSocio || null,
        Observaciones: payload.Observaciones || null,
        Activa: 1
      };

      const fields = Object.keys(insertPayload).map(k => `\`${k}\``).join(', ');
      const placeholders = Object.keys(insertPayload).map(() => '?').join(', ');
      const values = Object.values(insertPayload);

      const [result] = await connection.execute(
        `INSERT INTO \`${tRel}\` (${fields}) VALUES (${placeholders})`,
        values
      );

      await connection.commit();
      return { insertId: result.insertId };
    } catch (error) {
      try { await connection.rollback(); } catch (_) {}
      console.error('❌ Error creando cliente_grupoCompras:', error.message);
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateClienteGrupoCompras(id, payload) {
    try {
      const tRel = await this._resolveTableNameCaseInsensitive('clientes_gruposCompras');
      const fields = Object.keys(payload).map(k => `\`${k}\` = ?`).join(', ');
      const values = Object.values(payload);
      values.push(id);
      const sql = `UPDATE \`${tRel}\` SET ${fields} WHERE id = ?`;
      await this.query(sql, values);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando cliente_grupoCompras:', error.message);
      throw error;
    }
  }

  async cerrarClienteGrupoCompras(id) {
    try {
      const tRel = await this._resolveTableNameCaseInsensitive('clientes_gruposCompras');
      await this.query(`UPDATE \`${tRel}\` SET Activa = 0, Fecha_Baja = NOW() WHERE id = ?`, [id]);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error cerrando cliente_grupoCompras:', error.message);
      throw error;
    }
  }

  async findCooperativaByNombre(nombre) {
    try {
      const sql = 'SELECT * FROM cooperativas WHERE Nombre = ? OR nombre = ? LIMIT 1';
      const rows = await this.query(sql, [nombre, nombre]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error buscando cooperativa por nombre:', error.message);
      return null;
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

  async checkNumeroAsociadoDuplicado(cooperativaId, numeroAsociado, excludeId = null) {
    try {
      if (!numeroAsociado || numeroAsociado.trim() === '') {
        return false; // Si no hay número de asociado, no hay duplicado
      }
      
      let sql = 'SELECT id FROM `Clientes_Cooperativas` WHERE Id_Cooperativa = ? AND NumAsociado = ?';
      let params = [cooperativaId, numeroAsociado.trim()];
      
      if (excludeId) {
        sql += ' AND id != ?';
        params.push(excludeId);
      }
      
      sql += ' LIMIT 1';
      
      let rows;
      try {
        rows = await this.query(sql, params);
      } catch (error1) {
        // Intentar con minúsculas
        sql = 'SELECT id FROM clientes_cooperativas WHERE Id_Cooperativa = ? AND NumAsociado = ?';
        params = [cooperativaId, numeroAsociado.trim()];
        if (excludeId) {
          sql += ' AND id != ?';
          params.push(excludeId);
        }
        sql += ' LIMIT 1';
        rows = await this.query(sql, params);
      }
      
      return rows.length > 0;
    } catch (error) {
      console.error('❌ Error verificando número de asociado duplicado:', error.message);
      return false; // En caso de error, permitir la operación
    }
  }

  async createClienteCooperativa(payload) {
    try {
      if (!this.connected && !this.pool) {
        await this.connect();
      }
      
      // Validar número de asociado duplicado en la misma cooperativa
      if (payload.NumAsociado && payload.NumAsociado.trim() !== '') {
        const existeDuplicado = await this.checkNumeroAsociadoDuplicado(
          payload.Id_Cooperativa, 
          payload.NumAsociado
        );
        
        if (existeDuplicado) {
          const cooperativa = await this.getCooperativaById(payload.Id_Cooperativa);
          const nombreCooperativa = cooperativa ? (cooperativa.Nombre || cooperativa.nombre) : `Cooperativa #${payload.Id_Cooperativa}`;
          throw new Error(`El número de asociado "${payload.NumAsociado}" ya existe en la cooperativa "${nombreCooperativa}". Cada cooperativa debe tener números de asociado únicos.`);
        }
      }
      
      const fields = Object.keys(payload).map(key => `\`${key}\``).join(', ');
      const placeholders = Object.keys(payload).map(() => '?').join(', ');
      const values = Object.values(payload);
      
      // Intentar con diferentes nombres de tabla
      let sql = `INSERT INTO \`Clientes_Cooperativas\` (${fields}) VALUES (${placeholders})`;
      let result;
      let insertId;
      
      try {
        // Usar pool.execute directamente para obtener el ResultSetHeader con insertId
        [result] = await this.pool.execute(sql, values);
        insertId = result.insertId;
        console.log(`✅ [CREATE] Relación creada con tabla Clientes_Cooperativas, ID: ${insertId}`);
      } catch (error1) {
        console.log('⚠️ [CREATE] Error con Clientes_Cooperativas, intentando clientes_cooperativas:', error1.message);
        // Intentar con minúsculas
        sql = `INSERT INTO clientes_cooperativas (${fields}) VALUES (${placeholders})`;
        try {
          [result] = await this.pool.execute(sql, values);
          insertId = result.insertId;
          console.log(`✅ [CREATE] Relación creada con tabla clientes_cooperativas, ID: ${insertId}`);
        } catch (error2) {
          console.error('❌ [CREATE] Error con ambas variantes de nombre de tabla');
          throw error2;
        }
      }
      
      if (!insertId) {
        console.error('❌ No se pudo obtener insertId del resultado:', result);
        throw new Error('No se pudo obtener el ID de la relación creada');
      }
      
      console.log(`✅ Relación cliente-cooperativa creada con ID: ${insertId}`);
      return { insertId: insertId, Id: insertId, id: insertId };
    } catch (error) {
      console.error('❌ Error creando cliente_cooperativa:', error.message);
      console.error('❌ Stack:', error.stack);
      throw error;
    }
  }

  async updateClienteCooperativa(id, payload) {
    try {
      // Validar número de asociado duplicado en la misma cooperativa (excluyendo el registro actual)
      if (payload.NumAsociado && payload.NumAsociado.trim() !== '') {
        const cooperativaId = payload.Id_Cooperativa;
        if (cooperativaId) {
          const existeDuplicado = await this.checkNumeroAsociadoDuplicado(
            cooperativaId, 
            payload.NumAsociado,
            id // Excluir el registro actual
          );
          
          if (existeDuplicado) {
            const cooperativa = await this.getCooperativaById(cooperativaId);
            const nombreCooperativa = cooperativa ? (cooperativa.Nombre || cooperativa.nombre) : `Cooperativa #${cooperativaId}`;
            throw new Error(`El número de asociado "${payload.NumAsociado}" ya existe en la cooperativa "${nombreCooperativa}". Cada cooperativa debe tener números de asociado únicos.`);
          }
        }
      }
      
      const fields = [];
      const values = [];
      
      for (const [key, value] of Object.entries(payload)) {
        fields.push(`\`${key}\` = ?`);
        values.push(value);
      }
      
      values.push(id);
      
      let sql = `UPDATE \`Clientes_Cooperativas\` SET ${fields.join(', ')} WHERE id = ?`;
      try {
        await this.query(sql, values);
      } catch (error1) {
        // Intentar con minúsculas
        sql = `UPDATE clientes_cooperativas SET ${fields.join(', ')} WHERE id = ?`;
        await this.query(sql, values);
      }
      
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error actualizando cliente_cooperativa:', error.message);
      throw error;
    }
  }

  async deleteClienteCooperativa(id) {
    try {
      const sql = 'DELETE FROM `Clientes_Cooperativas` WHERE id = ?';
      await this.query(sql, [id]);
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ Error eliminando cliente_cooperativa:', error.message);
      throw error;
    }
  }

  async upsertClienteCooperativa({ clienteId, cooperativaNombre, numeroAsociado }) {
    try {
      // Buscar cooperativa por nombre
      let cooperativa = await this.findCooperativaByNombre(cooperativaNombre);
      
      if (!cooperativa) {
        // Crear cooperativa si no existe
        const result = await this.createCooperativa(cooperativaNombre);
        cooperativa = { id: result.insertId };
      }

      // Buscar si ya existe la relación (usar Id_Cliente e Id_Cooperativa)
      const sqlCheck = 'SELECT * FROM `Clientes_Cooperativas` WHERE Id_Cliente = ? AND Id_Cooperativa = ? LIMIT 1';
      const cooperativaId = cooperativa.id || cooperativa.Id;
      const existing = await this.query(sqlCheck, [clienteId, cooperativaId]);
      
      if (existing.length > 0) {
        // Actualizar
        return await this.updateClienteCooperativa(existing[0].id, { NumAsociado: numeroAsociado });
      } else {
        // Crear
        return await this.createClienteCooperativa({
          Id_Cliente: clienteId,
          Id_Cooperativa: cooperativaId,
          NumAsociado: numeroAsociado
        });
      }
    } catch (error) {
      console.error('❌ Error en upsert cliente_cooperativa:', error.message);
      throw error;
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
          NumPedido,
          CAST(SUBSTRING(NumPedido, 4) AS UNSIGNED) as secuencia
        FROM pedidos 
        WHERE NumPedido LIKE ?
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

  async getPedidos(comercialId = null) {
    try {
      let sql = 'SELECT * FROM pedidos';
      const params = [];
      
      // Si se proporciona un comercialId, filtrar por él
      // El campo en la tabla pedidos es Id_Cial (con mayúsculas, según la estructura SQL)
      if (comercialId) {
        sql += ' WHERE Id_Cial = ?';
        params.push(comercialId);
        console.log(`🔐 [GET_PEDIDOS] Filtro aplicado: Id_Cial = ${comercialId}`);
      }
      
      sql += ' ORDER BY Id DESC';
      
      const rows = await this.query(sql, params);
      console.log(`📊 [GET PEDIDOS] Total pedidos obtenidos: ${rows ? rows.length : 0}${comercialId ? ` (filtrado por comercial ${comercialId})` : ''}`);
      if (rows && rows.length > 0) {
        console.log(`📋 [GET PEDIDOS] Primer pedido (muestra):`, {
          Id: rows[0].Id || rows[0].id,
          NumPedido: rows[0].NumPedido || rows[0].Numero_Pedido || rows[0].numero,
          FechaPedido: rows[0].FechaPedido || rows[0]['Fecha Pedido'] || rows[0].fecha,
          Cliente_id: rows[0].Cliente_id || rows[0].Id_Cliente,
          Id_Cial: rows[0].Id_Cial || rows[0].id_cial,
          todasLasClaves: Object.keys(rows[0])
        });
      }
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo pedidos:', error.message);
      console.error('❌ Stack:', error.stack);
      return [];
    }
  }

  /**
   * Pedidos paginados y filtrables (evita devolver miles de filas).
   * filters: { comercialId, clienteId, from, to, search }
   * options: { limit, offset }
   */
  async getPedidosPaged(filters = {}, options = {}) {
    const { tPedidos, pk, colComercial, colCliente, colFecha, colNumPedido } = await this._ensurePedidosMeta();
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.min(500, Number(options.limit))) : 100;
    const offset = Number.isFinite(Number(options.offset)) ? Math.max(0, Number(options.offset)) : 0;

    const where = [];
    const params = [];

    const comercialId = filters.comercialId ? Number(filters.comercialId) : null;
    const clienteId = filters.clienteId ? Number(filters.clienteId) : null;
    const from = filters.from ? String(filters.from).slice(0, 10) : null; // YYYY-MM-DD
    const to = filters.to ? String(filters.to).slice(0, 10) : null; // YYYY-MM-DD
    const search = filters.search ? String(filters.search).trim().toLowerCase() : '';

    if (comercialId && colComercial) {
      where.push(`p.\`${colComercial}\` = ?`);
      params.push(comercialId);
    }
    if (clienteId && colCliente) {
      where.push(`p.\`${colCliente}\` = ?`);
      params.push(clienteId);
    }
    if (colFecha && (from || to)) {
      if (from && to) {
        where.push(`DATE(p.\`${colFecha}\`) BETWEEN ? AND ?`);
        params.push(from, to);
      } else if (from) {
        where.push(`DATE(p.\`${colFecha}\`) >= ?`);
        params.push(from);
      } else if (to) {
        where.push(`DATE(p.\`${colFecha}\`) <= ?`);
        params.push(to);
      }
    }
    if (search && colNumPedido) {
      where.push(`LOWER(COALESCE(CONCAT(p.\`${colNumPedido}\`,''),'')) LIKE ?`);
      params.push(`%${search}%`);
    }

    let sql = `SELECT p.* FROM \`${tPedidos}\` p`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');

    // Orden: por fecha si existe, sino por PK
    if (colFecha) {
      sql += ` ORDER BY p.\`${colFecha}\` DESC, p.\`${pk}\` DESC`;
    } else {
      sql += ` ORDER BY p.\`${pk}\` DESC`;
    }
    sql += ` LIMIT ${limit} OFFSET ${offset}`;

    return await this.query(sql, params);
  }

  async countPedidos(filters = {}) {
    try {
      const { tPedidos, colComercial, colCliente, colFecha, colNumPedido } = await this._ensurePedidosMeta();
      const where = [];
      const params = [];

      const comercialId = filters.comercialId ? Number(filters.comercialId) : null;
      const clienteId = filters.clienteId ? Number(filters.clienteId) : null;
      const from = filters.from ? String(filters.from).slice(0, 10) : null;
      const to = filters.to ? String(filters.to).slice(0, 10) : null;
      const search = filters.search ? String(filters.search).trim().toLowerCase() : '';

      if (comercialId && colComercial) {
        where.push(`p.\`${colComercial}\` = ?`);
        params.push(comercialId);
      }
      if (clienteId && colCliente) {
        where.push(`p.\`${colCliente}\` = ?`);
        params.push(clienteId);
      }
      if (colFecha && (from || to)) {
        if (from && to) {
          where.push(`DATE(p.\`${colFecha}\`) BETWEEN ? AND ?`);
          params.push(from, to);
        } else if (from) {
          where.push(`DATE(p.\`${colFecha}\`) >= ?`);
          params.push(from);
        } else if (to) {
          where.push(`DATE(p.\`${colFecha}\`) <= ?`);
          params.push(to);
        }
      }
      if (search && colNumPedido) {
        where.push(`LOWER(COALESCE(CONCAT(p.\`${colNumPedido}\`,''),'')) LIKE ?`);
        params.push(`%${search}%`);
      }

      let sql = `SELECT COUNT(*) as total FROM \`${tPedidos}\` p`;
      if (where.length) sql += ' WHERE ' + where.join(' AND ');

      const rows = await this.query(sql, params);
      return rows?.[0]?.total ? Number(rows[0].total) : 0;
    } catch (e) {
      return 0;
    }
  }

  async getPedidosByComercial(comercialId) {
    try {
      const { tPedidos, pk, colComercial } = await this._ensurePedidosMeta();
      if (colComercial) {
        return await this.query(`SELECT * FROM \`${tPedidos}\` WHERE \`${colComercial}\` = ? ORDER BY \`${pk}\` DESC`, [comercialId]);
      }
      // Fallback legacy
      const sql = 'SELECT * FROM pedidos WHERE Id_Cial = ? OR id_cial = ? OR Comercial_id = ? OR comercial_id = ? ORDER BY Id DESC';
      return await this.query(sql, [comercialId, comercialId, comercialId, comercialId]);
    } catch (error) {
      console.error('❌ Error obteniendo pedidos por comercial:', error.message);
      return [];
    }
  }

  async getPedidosByCliente(clienteId) {
    try {
      const { tPedidos, pk, colCliente } = await this._ensurePedidosMeta();
      if (colCliente) {
        return await this.query(`SELECT * FROM \`${tPedidos}\` WHERE \`${colCliente}\` = ? ORDER BY \`${pk}\` DESC`, [clienteId]);
      }
      // Fallback legacy
      const sql = 'SELECT * FROM pedidos WHERE ClienteId = ? OR clienteId = ? ORDER BY Id DESC';
      return await this.query(sql, [clienteId, clienteId]);
    } catch (error) {
      console.error('❌ Error obteniendo pedidos por cliente:', error.message);
      return [];
    }
  }

  async getPedidoById(id) {
    try {
      // Lookup robusto por PK (numérica) o por NumPedido (string).
      // Importante: NO referenciar columnas que no existen (p.ej. Id vs id),
      // o MySQL fallará con "Unknown column" y acabaríamos devolviendo null.
      const meta = await this._ensurePedidosMeta().catch(() => null);
      const tPedidos = meta?.tPedidos || 'pedidos';
      const pk = meta?.pk || 'id';
      const colNumPedido = meta?.colNumPedido || null;

      const raw = id;
      const asNum = Number(raw);
      const isNum = Number.isFinite(asNum) && asNum > 0;
      const asStr = String(raw || '').trim();

      // 1) Buscar por ID numérico (Id/id)
      if (isNum) {
        const rows = await this.query(`SELECT * FROM \`${tPedidos}\` WHERE \`${pk}\` = ? LIMIT 1`, [asNum]);
        if (rows && rows.length > 0) return rows[0];
      }

      // 1.1) Fallback (cuando el parámetro es un número "humano" de pedido):
      // Ejemplo: /pedidos/7 puede referirse a NumPedido = P250007 (no al ID interno).
      // Probamos con prefijos de los últimos años (PYY0007).
      if (isNum && colNumPedido) {
        const sec = String(asNum).padStart(4, '0');
        const nowYear = new Date().getFullYear();
        const yearsToTry = [0, 1, 2, 3, 4, 5].map(d => nowYear - d);
        for (const y of yearsToTry) {
          const yy = String(y).slice(-2);
          const numPedido = `P${yy}${sec}`;
          const rowsByNum = await this.query(`SELECT * FROM \`${tPedidos}\` WHERE \`${colNumPedido}\` = ? LIMIT 1`, [numPedido]);
          if (rowsByNum && rowsByNum.length > 0) return rowsByNum[0];
        }
      }

      // 2) Fallback: buscar por NumPedido si el parámetro parece un número de pedido
      if (asStr && colNumPedido) {
        const rowsNum = await this.query(`SELECT * FROM \`${tPedidos}\` WHERE \`${colNumPedido}\` = ? LIMIT 1`, [asStr]);
        if (rowsNum && rowsNum.length > 0) return rowsNum[0];
      }

      return null;
    } catch (error) {
      console.error('❌ Error obteniendo pedido por ID:', error.message);
      console.error('❌ ID usado:', id);
      return null;
    }
  }

  async getPedidosArticulos() {
    try {
      const sql = 'SELECT * FROM pedidos_articulos ORDER BY Id ASC';
      const rows = await this.query(sql);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo pedidos_articulos:', error.message);
      return [];
    }
  }

  async getArticulosByPedido(pedidoId) {
    try {
      const idNum = Number(pedidoId);
      if (!Number.isFinite(idNum) || idNum <= 0) return [];

      // Resolver pedido (para recuperar NumPedido si existe)
      const pedido = await this.getPedidoById(idNum);
      if (!pedido) return [];

      const pedidosMeta = await this._ensurePedidosMeta();
      const paMeta = await this._ensurePedidosArticulosMeta();
      const tPA = paMeta.table;
      const paCols = await this._getColumns(tPA).catch(() => []);

      const tArt = await this._resolveTableNameCaseInsensitive('articulos').catch(() => null);
      const aCols = tArt ? await this._getColumns(tArt).catch(() => []) : [];
      const aPk = this._pickCIFromColumns(aCols, ['Id', 'id']) || 'Id';

      const where = [];
      const params = [];

      // Enlace por ID de pedido (según la instalación)
      if (paMeta.colPedidoId) {
        where.push(`pa.\`${paMeta.colPedidoId}\` = ?`);
        params.push(idNum);
      }
      if (paMeta.colPedidoIdNum) {
        where.push(`pa.\`${paMeta.colPedidoIdNum}\` = ?`);
        params.push(idNum);
      }

      // Enlace por NumPedido si existe en ambas tablas
      const colNumPedidoPedido = pedidosMeta.colNumPedido;
      const colNumPedidoLinea = paMeta.colNumPedido;
      const numPedido = colNumPedidoPedido ? (pedido[colNumPedidoPedido] ?? pedido.NumPedido ?? pedido.Numero_Pedido ?? null) : null;
      if (numPedido && colNumPedidoLinea) {
        where.push(`pa.\`${colNumPedidoLinea}\` = ?`);
        params.push(String(numPedido).trim());
      }

      // Fallback: si la meta no detectó columnas de enlace, buscar por nombre en la tabla real
      if (!where.length && Array.isArray(paCols) && paCols.length) {
        const colLower = (c) => String(c).toLowerCase();
        const idLink = paCols.find((c) => {
          const l = colLower(c);
          return /id_numpedido|id_num_pedido|pedido_id|id_pedido|pedidoid|idpedido/.test(l);
        });
        if (idLink) {
          where.push(`pa.\`${idLink}\` = ?`);
          params.push(idNum);
        }
        if (!where.length && numPedido) {
          const numLink = paCols.find((c) => {
            const l = colLower(c);
            return /numpedido|numero_pedido|num_pedido|numeropedido/.test(l);
          });
          if (numLink) {
            where.push(`pa.\`${numLink}\` = ?`);
            params.push(String(numPedido).trim());
          }
        }
      }

      if (!where.length) return [];

      const joinArticulo = (tArt && paMeta.colArticulo)
        ? `LEFT JOIN \`${tArt}\` a ON pa.\`${paMeta.colArticulo}\` = a.\`${aPk}\``
        : '';

      // Evitar colisiones de nombres entre pa.* y a.* (p.ej. IVA) añadiendo alias explícitos (best-effort)
      const pickPaCol = (cands) => this._pickCIFromColumns(paCols, cands);
      const colPvp = pickPaCol(['PVP', 'pvp', 'PVPUnit', 'Precio', 'precio', 'PrecioUnitario', 'precio_unitario']);
      const colDto = pickPaCol(['DtoLinea', 'dto_linea', 'dtoLinea', 'Dto', 'dto', 'DTO', 'Descuento', 'descuento']);
      const colIva = pickPaCol(['IVA', 'iva', 'PorcIVA', 'porc_iva', 'PorcentajeIVA', 'porcentaje_iva', 'TipoIVA', 'tipo_iva']);
      const extraSelect = [
        colPvp ? `pa.\`${colPvp}\` AS Linea_PVP` : null,
        colDto ? `pa.\`${colDto}\` AS Linea_Dto` : null,
        colIva ? `pa.\`${colIva}\` AS Linea_IVA` : null
      ].filter(Boolean).join(', ');

      const sql = `
        SELECT pa.*${extraSelect ? `, ${extraSelect}` : ''}${joinArticulo ? ', a.*' : ''}
        FROM \`${tPA}\` pa
        ${joinArticulo}
        WHERE (${where.join(' OR ')})
        ORDER BY pa.\`${paMeta.pk}\` ASC
      `;
      return await this.query(sql, params);
    } catch (error) {
      console.error('❌ Error obteniendo artículos por pedido:', error.message);
      return [];
    }
  }

  async updatePedido(id, payload) {
    try {
      const idNum = Number(id);
      if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('ID no válido');
      if (!payload || typeof payload !== 'object') throw new Error('Payload no válido');

      if (!this.connected && !this.pool) await this.connect();

      const { tPedidos, pk } = await this._ensurePedidosMeta();
      const cols = await this._getColumns(tPedidos).catch(() => []);
      const colsLower = new Map((cols || []).map((c) => [String(c).toLowerCase(), c]));

      const filtered = {};
      for (const [k, v] of Object.entries(payload)) {
        const real = colsLower.get(String(k).toLowerCase());
        if (real && String(real).toLowerCase() !== String(pk).toLowerCase()) filtered[real] = v;
      }

      const keys = Object.keys(filtered);
      if (!keys.length) return { affectedRows: 0 };

      const fields = keys.map((k) => `\`${k}\` = ?`).join(', ');
      const values = keys.map((k) => filtered[k]);
      values.push(idNum);

      const sql = `UPDATE \`${tPedidos}\` SET ${fields} WHERE \`${pk}\` = ?`;
      const [result] = await this.pool.execute(sql, values);
      return { affectedRows: result?.affectedRows || 0, changedRows: result?.changedRows || 0 };
    } catch (error) {
      console.error('❌ Error actualizando pedido:', error.message);
      throw error;
    }
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
    if (!Number.isFinite(tId) || tId <= 0 || ids.length === 0) return {};

    if (!this.connected && !this.pool) await this.connect();

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
      const rows = await this.query(sql, [tId, ...ids]).catch(() => []);
      for (const r of (rows || [])) {
        const aid = Number.parseInt(String(r.Id_Articulo ?? '').trim(), 10);
        const tid = Number.parseInt(String(r.Id_Tarifa ?? '').trim(), 10);
        const precio = Number(String(r.Precio ?? '').replace(',', '.'));
        if (!Number.isFinite(aid) || aid <= 0 || !Number.isFinite(precio)) continue;
        if (tid === tId) preciosTarifa.set(aid, precio);
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

      // Preparar update cabecera filtrado
      const filteredPedido = {};
      const pedidoInput = pedidoPayload && typeof pedidoPayload === 'object' ? pedidoPayload : {};
      for (const [k, v] of Object.entries(pedidoInput)) {
        const real = pedidosColsLower.get(String(k).toLowerCase());
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
          new Set([pk, colNumPedido, colClientePedido, colDirEnvio, colTarifaId, colTarifaLegacy, colDtoPedido, colTipoPedido].filter(Boolean))
        );
        const selectSql = `SELECT ${selectCols.map((c) => `\`${c}\``).join(', ')} FROM \`${tPedidos}\` WHERE \`${pk}\` = ? LIMIT 1`;
        const [rows] = await conn.execute(selectSql, [idNum]);
        if (!rows || rows.length === 0) throw new Error('Pedido no encontrado');
        const current = rows[0];

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

        const dtoPedidoRaw =
          (colDtoPedido && Object.prototype.hasOwnProperty.call(filteredPedido, colDtoPedido)) ? filteredPedido[colDtoPedido]
          : (colDtoPedido ? current[colDtoPedido] : null);
        const dtoPedido = Number.isFinite(Number(dtoPedidoRaw)) ? Number(dtoPedidoRaw) : (dtoPedidoRaw !== null && dtoPedidoRaw !== undefined ? (Number.parseFloat(String(dtoPedidoRaw).replace(',', '.')) || 0) : 0);

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

        // 2) Borrar líneas actuales (por las columnas de enlace que existan)
        const where = [];
        const params = [];
        if (paMeta.colPedidoId) {
          where.push(`\`${paMeta.colPedidoId}\` = ?`);
          params.push(idNum);
        }
        if (paMeta.colPedidoIdNum) {
          where.push(`\`${paMeta.colPedidoIdNum}\` = ?`);
          params.push(idNum);
        }
        if (paMeta.colNumPedido && finalNumPedido) {
          where.push(`\`${paMeta.colNumPedido}\` = ?`);
          params.push(finalNumPedido);
        }
        if (!where.length) throw new Error('No se pudo determinar cómo enlazar líneas con el pedido (faltan columnas)');

        const [delRes] = await conn.execute(`DELETE FROM \`${paMeta.table}\` WHERE (${where.join(' OR ')})`, params);
        const deletedLineas = delRes?.affectedRows || 0;

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

          // Aceptar alias de precio desde formularios (PrecioUnitario vs Precio)
          if (colPrecioUnit) {
            const cur = mysqlData[colPrecioUnit];
            const curStr = cur === null || cur === undefined ? '' : String(cur).trim();
            if (!curStr) {
              const raw =
                linea.PrecioUnitario ?? linea.Precio ?? linea.precioUnitario ?? linea.precio ?? linea.PVL ?? linea.pvl;
              const n = raw !== null && raw !== undefined && String(raw).trim() !== '' ? (Number(String(raw).replace(',', '.')) || 0) : null;
              if (n !== null) mysqlData[colPrecioUnit] = n;
            }
          }

          const qty = colQty ? Math.max(0, getNum(mysqlData[colQty], 0)) : Math.max(0, getNum(linea.Cantidad ?? linea.Unidades ?? 0, 0));

          let precioUnit = 0;
          if (colPrecioUnit && mysqlData[colPrecioUnit] !== null && mysqlData[colPrecioUnit] !== undefined && String(mysqlData[colPrecioUnit]).trim() !== '') {
            precioUnit = Math.max(0, getNum(mysqlData[colPrecioUnit], 0));
          } else if (articulo) {
            precioUnit = Math.max(0, getPrecioFromTarifa(articulo, artId));
          }
          if (isTransfer) {
            precioUnit = 0;
            if (colPrecioUnit) mysqlData[colPrecioUnit] = 0;
          }

          // DTO de pedido (general) y DTO de línea (específico) se aplican acumulativamente:
          // base = bruto * (1 - dtoLinea) * (1 - dtoPedido)
          // Transfer: dto línea por defecto 5% (informativo, editable)
          const dtoPedidoPct = clampPct(getNum(dtoPedido, 0));
          const defaultDtoLinea = isTransfer ? 5 : (linea.Dto ?? linea.Descuento ?? 0);
          const dtoLineaPct = clampPct(
            colDtoLinea
              ? getNum(mysqlData[colDtoLinea], defaultDtoLinea)
              : getNum(linea.Dto ?? linea.Descuento ?? defaultDtoLinea, defaultDtoLinea)
          );

          const bruto = round2(qty * precioUnit);
          const base = round2(bruto * (1 - dtoLineaPct / 100) * (1 - dtoPedidoPct / 100));

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

        // 4) Actualizar totales del pedido (best-effort, sólo columnas existentes)
        const totalsUpdate = {};
        if (colTotalPedido) totalsUpdate[colTotalPedido] = round2(sumTotal);
        if (colBasePedido) totalsUpdate[colBasePedido] = round2(sumBase);
        if (colIvaPedido) totalsUpdate[colIvaPedido] = round2(sumIva);
        if (colDescuentoPedido) totalsUpdate[colDescuentoPedido] = round2(sumDescuento);
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
          totals: { base: round2(sumBase), iva: round2(sumIva), total: round2(sumTotal), descuento: round2(sumDescuento) },
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

      const where = [];
      const params = [];
      if (paMeta.colPedidoId) {
        where.push(`\`${paMeta.colPedidoId}\` = ?`);
        params.push(idNum);
      }
      if (paMeta.colPedidoIdNum) {
        where.push(`\`${paMeta.colPedidoIdNum}\` = ?`);
        params.push(idNum);
      }
      if (paMeta.colNumPedido && numPedido) {
        where.push(`\`${paMeta.colNumPedido}\` = ?`);
        params.push(String(numPedido).trim());
      }

      const conn = await this.pool.getConnection();
      try {
        try { await conn.query("SET time_zone = 'Europe/Madrid'"); } catch (_) {}
        await conn.beginTransaction();

        let deletedLineas = 0;
        if (where.length) {
          const [delLineasRes] = await conn.execute(
            `DELETE FROM \`${paMeta.table}\` WHERE (${where.join(' OR ')})`,
            params
          );
          deletedLineas = delLineasRes?.affectedRows || 0;
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

      // Convertir formato NocoDB a MySQL + filtrar columnas válidas
      const mysqlData = {};
      const input = pedidoData && typeof pedidoData === 'object' ? pedidoData : {};
      for (const [key, value] of Object.entries(input)) {
        const real = colsLower.get(String(key).toLowerCase());
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
        const clienteId = colCliente ? Number(mysqlData[colCliente] ?? input[colCliente] ?? input.Id_Cliente ?? input.ClienteId) : NaN;
        const hasTarifa = (colTarifaId && mysqlData[colTarifaId] !== undefined) || (colTarifaLegacy && mysqlData[colTarifaLegacy] !== undefined);
        const hasDto = colDtoPedido && mysqlData[colDtoPedido] !== undefined;
        if (colCliente && Number.isFinite(clienteId) && clienteId > 0 && (!hasTarifa || !hasDto)) {
          const cliente = await this.getClienteById(clienteId);
          if (cliente) {
            const tarifaCliente = cliente.Tarifa ?? cliente.tarifa ?? 0;
            const dtoCliente = cliente.Dto ?? cliente.dto ?? null;
            if (!hasTarifa) {
              if (colTarifaId) mysqlData[colTarifaId] = Number.isFinite(Number(tarifaCliente)) ? Number(tarifaCliente) : 0;
              else if (colTarifaLegacy) mysqlData[colTarifaLegacy] = Number.isFinite(Number(tarifaCliente)) ? Number(tarifaCliente) : 0;
            }
            if (!hasDto && colDtoPedido && dtoCliente !== null && dtoCliente !== undefined && dtoCliente !== '') {
              mysqlData[colDtoPedido] = Number(dtoCliente) || 0;
            }
          }
        }
      } catch (_) {
        // best-effort
      }

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

  // CONTACTOS (persona global) + relación M:N con clientes (historial)
  async getContactos(options = {}) {
    try {
      const search = String(options.search || '').trim();
      const includeInactivos = Boolean(options.includeInactivos);
      // IMPORTANTE (compatibilidad MySQL/MariaDB):
      // Algunos servidores fallan con "Incorrect arguments to mysqld_stmt_execute"
      // cuando LIMIT/OFFSET van como parámetros preparados. Por eso los insertamos
      // como números saneados en el SQL (evita placeholders en LIMIT/OFFSET).
      const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.min(500, Number(options.limit))) : 50;
      const offset = Number.isFinite(Number(options.offset)) ? Math.max(0, Number(options.offset)) : 0;

      const where = [];
      const params = [];

      if (!includeInactivos) {
        // Compatibilidad: Activo puede venir como 1/0 o como strings ('OK'/'KO', 'SI'/'NO', etc.).
        // Forzamos a string para evitar conversiones numéricas extrañas en MySQL estricto.
        where.push("TRIM(UPPER(COALESCE(CONCAT(Activo,''),''))) IN ('1','OK','TRUE','SI','SÍ')");
      }

      if (search) {
        // Intentar FULLTEXT (rápido) y hacer fallback a LIKE si no existe el índice.
        // Boolean mode con wildcard por palabra (paco lara -> "paco* lara*").
        const terms = search
          .split(/\s+/)
          .map(t => t.trim())
          .filter(Boolean)
          .map(t => `${t.replace(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ._@+-]/g, '')}*`)
          .filter(t => t !== '*')
          .join(' ');

        if (terms && terms.replace(/\*/g, '').length >= 3) {
          where.push('(MATCH(Nombre, Apellidos, Empresa, Email, Movil, Telefono) AGAINST (? IN BOOLEAN MODE))');
          params.push(terms);
        } else {
          where.push('(Nombre LIKE ? OR Apellidos LIKE ? OR Empresa LIKE ? OR Email LIKE ? OR Movil LIKE ? OR Telefono LIKE ?)');
          const like = `%${search}%`;
          params.push(like, like, like, like, like, like);
        }
      }

      const tContactos = await this._resolveTableNameCaseInsensitive('contactos');
      let sql = `SELECT * FROM \`${tContactos}\``;
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      sql += ' ORDER BY Apellidos ASC, Nombre ASC';
      sql += ` LIMIT ${limit} OFFSET ${offset}`;

      try {
        return await this.query(sql, params);
      } catch (e) {
        // Fallback si FULLTEXT no está disponible en este entorno
        const msg = String(e?.message || '');
        if (search && msg.toLowerCase().includes('match') && msg.toLowerCase().includes('against')) {
          const where2 = where.filter(w => !w.includes('MATCH('));
          const params2 = params.slice(0, params.length - 1); // quitar terms
          where2.push('(Nombre LIKE ? OR Apellidos LIKE ? OR Empresa LIKE ? OR Email LIKE ? OR Movil LIKE ? OR Telefono LIKE ?)');
          const like = `%${search}%`;
          params2.push(like, like, like, like, like, like);
          let sql2 = `SELECT * FROM \`${tContactos}\``;
          if (where2.length) sql2 += ' WHERE ' + where2.join(' AND ');
          sql2 += ' ORDER BY Apellidos ASC, Nombre ASC';
          sql2 += ` LIMIT ${limit} OFFSET ${offset}`;
          return await this.query(sql2, params2);
        }
        throw e;
      }
    } catch (error) {
      console.error('❌ Error obteniendo contactos:', error.message);
      // Importante: no ocultar el error, para que el dashboard pueda mostrar un mensaje claro
      throw error;
    }
  }

  async getContactoById(id) {
    try {
      const tContactos = await this._resolveTableNameCaseInsensitive('contactos');
      const rows = await this.query(`SELECT * FROM \`${tContactos}\` WHERE Id = ? LIMIT 1`, [id]);
      return rows?.[0] || null;
    } catch (error) {
      console.error('❌ Error obteniendo contacto por ID:', error.message);
      return null;
    }
  }

  async createContacto(payload) {
    try {
      // Asegurar conexión
      if (!this.connected && !this.pool) {
        await this.connect();
      }

      const allowed = new Set([
        'Nombre',
        'Apellidos',
        'Cargo',
        'Especialidad',
        'Empresa',
        'Email',
        'Movil',
        'Telefono',
        'Extension',
        'Notas',
        'Activo'
      ]);

      const data = {};
      for (const [k, v] of Object.entries(payload || {})) {
        if (!allowed.has(k)) continue;
        data[k] = (v === undefined ? null : v);
      }

      if (!data.Nombre || String(data.Nombre).trim() === '') {
        throw new Error('El campo Nombre es obligatorio');
      }

      const fields = Object.keys(data).map(k => `\`${k}\``).join(', ');
      const placeholders = Object.keys(data).map(() => '?').join(', ');
      const values = Object.values(data);

      const tContactos = await this._resolveTableNameCaseInsensitive('contactos');
      const sql = `INSERT INTO \`${tContactos}\` (${fields}) VALUES (${placeholders})`;
      const result = await this.query(sql, values);
      return { insertId: result.insertId };
    } catch (error) {
      console.error('❌ Error creando contacto:', error.message);
      throw error;
    }
  }

  async updateContacto(id, payload) {
    try {
      // Asegurar conexión
      if (!this.connected && !this.pool) {
        await this.connect();
      }

      const allowed = new Set([
        'Nombre',
        'Apellidos',
        'Cargo',
        'Especialidad',
        'Empresa',
        'Email',
        'Movil',
        'Telefono',
        'Extension',
        'Notas',
        'Activo'
      ]);

      const fields = [];
      const values = [];
      for (const [k, v] of Object.entries(payload || {})) {
        if (!allowed.has(k)) continue;
        fields.push(`\`${k}\` = ?`);
        values.push(v === undefined ? null : v);
      }

      if (!fields.length) return { affectedRows: 0 };

      values.push(id);
      const tContactos = await this._resolveTableNameCaseInsensitive('contactos');
      const sql = `UPDATE \`${tContactos}\` SET ${fields.join(', ')} WHERE Id = ?`;
      const result = await this.query(sql, values);
      return { affectedRows: result.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error actualizando contacto:', error.message);
      throw error;
    }
  }

  async getContactosByCliente(clienteId, options = {}) {
    try {
      const includeHistorico = Boolean(options.includeHistorico);
      const params = [clienteId];

      const tClientesContactos = await this._resolveTableNameCaseInsensitive('clientes_contactos');
      const tContactos = await this._resolveTableNameCaseInsensitive('contactos');
      let sql = `
        SELECT
          cc.Id AS Id_Relacion,
          cc.Id_Cliente,
          cc.Id_Contacto,
          cc.Rol,
          cc.Es_Principal,
          cc.Notas AS NotasRelacion,
          cc.VigenteDesde,
          cc.VigenteHasta,
          cc.MotivoBaja,
          c.*
        FROM \`${tClientesContactos}\` cc
        INNER JOIN \`${tContactos}\` c ON c.Id = cc.Id_Contacto
        WHERE cc.Id_Cliente = ?
      `;

      if (!includeHistorico) {
        sql += ' AND cc.VigenteHasta IS NULL';
      }

      sql += ' ORDER BY (cc.VigenteHasta IS NULL) DESC, cc.Es_Principal DESC, c.Apellidos ASC, c.Nombre ASC, cc.Id DESC';

      return await this.query(sql, params);
    } catch (error) {
      console.error('❌ Error obteniendo contactos por cliente:', error.message);
      throw error;
    }
  }

  async vincularContactoACliente(clienteId, contactoId, options = {}) {
    // Crea o actualiza la relación activa (histórico: no reabre filas antiguas, crea nueva si no existe activa).
    // Si Es_Principal=1, desmarca otros principales activos del cliente en la misma transacción.
    const rol = options.Rol ?? options.rol ?? null;
    const notas = options.Notas ?? options.notas ?? null;
    const esPrincipal = (options.Es_Principal ?? options.es_principal ?? options.esPrincipal) ? 1 : 0;

    if (!this.pool) await this.connect();
    const tClientesContactos = await this._resolveTableNameCaseInsensitive('clientes_contactos');
    const conn = await this.pool.getConnection();

    try {
      // Asegurar zona horaria en esta sesión de transacción
      try {
        await conn.query("SET time_zone = 'Europe/Madrid'");
      } catch (_) {}
      await conn.beginTransaction();

      if (esPrincipal) {
        await conn.execute(
          `UPDATE \`${tClientesContactos}\` SET Es_Principal = 0 WHERE Id_Cliente = ? AND VigenteHasta IS NULL`,
          [clienteId]
        );
      }

      // ¿ya existe relación activa?
      const [rows] = await conn.execute(
        `SELECT Id FROM \`${tClientesContactos}\` WHERE Id_Cliente = ? AND Id_Contacto = ? AND VigenteHasta IS NULL ORDER BY Id DESC LIMIT 1`,
        [clienteId, contactoId]
      );

      if (rows && rows.length > 0) {
        const relId = rows[0].Id;
        await conn.execute(
          `UPDATE \`${tClientesContactos}\` SET Rol = ?, Notas = ?, Es_Principal = ? WHERE Id = ?`,
          [rol, notas, esPrincipal, relId]
        );
        await conn.commit();
        return { action: 'updated', Id_Relacion: relId };
      }

      // Crear nueva relación activa (histórico intacto)
      const [ins] = await conn.execute(
        `INSERT INTO \`${tClientesContactos}\` (Id_Cliente, Id_Contacto, Rol, Es_Principal, Notas) VALUES (?, ?, ?, ?, ?)`,
        [clienteId, contactoId, rol, esPrincipal, notas]
      );

      await conn.commit();
      return { action: 'inserted', Id_Relacion: ins.insertId };
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      console.error('❌ Error vinculando contacto a cliente:', error.message);
      throw error;
    } finally {
      conn.release();
    }
  }

  async cerrarVinculoContactoCliente(clienteId, contactoId, options = {}) {
    try {
      const motivo = options.MotivoBaja ?? options.motivoBaja ?? options.motivo ?? null;
      if (!this.connected && !this.pool) {
        await this.connect();
      }
      const tClientesContactos = await this._resolveTableNameCaseInsensitive('clientes_contactos');
      const sql = `
        UPDATE \`${tClientesContactos}\`
        SET VigenteHasta = NOW(), MotivoBaja = ?, Es_Principal = 0
        WHERE Id_Cliente = ? AND Id_Contacto = ? AND VigenteHasta IS NULL
        ORDER BY Id DESC
        LIMIT 1
      `;
      const result = await this.query(sql, [motivo, clienteId, contactoId]);
      return { affectedRows: result.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error cerrando vínculo contacto-cliente:', error.message);
      throw error;
    }
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

  async getClientesByContacto(contactoId, options = {}) {
    try {
      const includeHistorico = Boolean(options.includeHistorico);
      const params = [contactoId];
      const tClientesContactos = await this._resolveTableNameCaseInsensitive('clientes_contactos');
      const tClientes = await this._resolveTableNameCaseInsensitive('clientes');
      const { pk } = await this._ensureClientesMeta().catch(() => ({ pk: 'Id' }));

      let sql = `
        SELECT
          cc.Id AS Id_Relacion,
          cc.Id_Cliente,
          cc.Id_Contacto,
          cc.Rol,
          cc.Es_Principal,
          cc.Notas AS NotasRelacion,
          cc.VigenteDesde,
          cc.VigenteHasta,
          cc.MotivoBaja,
          c.*
        FROM \`${tClientesContactos}\` cc
        INNER JOIN \`${tClientes}\` c ON c.\`${pk}\` = cc.Id_Cliente
        WHERE cc.Id_Contacto = ?
      `;

      if (!includeHistorico) {
        sql += ' AND cc.VigenteHasta IS NULL';
      }

      sql += ' ORDER BY (cc.VigenteHasta IS NULL) DESC, cc.Es_Principal DESC, c.Id ASC, cc.Id DESC';
      return await this.query(sql, params);
    } catch (error) {
      console.error('❌ Error obteniendo clientes por contacto:', error.message);
      throw error;
    }
  }

  // VISITAS
  async getVisitas(comercialId = null) {
    try {
      let sql = 'SELECT * FROM visitas';
      const params = [];
      
      // Si se proporciona un comercialId, filtrar por él
      // Las visitas pueden usar diferentes nombres de campo
      if (comercialId) {
        sql += ' WHERE Id_Cial = ? OR id_cial = ? OR ComercialId = ? OR comercialId = ? OR Comercial_id = ? OR comercial_id = ?';
        params.push(comercialId, comercialId, comercialId, comercialId, comercialId, comercialId);
      }
      
      sql += ' ORDER BY Id DESC';
      
      const rows = await this.query(sql, params);
      console.log(`✅ Obtenidas ${rows.length} visitas${comercialId ? ` (filtrado por comercial ${comercialId})` : ''}`);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo visitas:', error.message);
      return [];
    }
  }

  /**
   * Visitas paginadas y filtrables.
   * filters: { comercialId, clienteId, from, to }
   * options: { limit, offset }
   */
  async getVisitasPaged(filters = {}, options = {}) {
    const meta = await this._ensureVisitasMeta();
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.min(500, Number(options.limit))) : 200;
    const offset = Number.isFinite(Number(options.offset)) ? Math.max(0, Number(options.offset)) : 0;

    const where = [];
    const params = [];

    const comercialId = filters.comercialId ? Number(filters.comercialId) : null;
    const clienteId = filters.clienteId ? Number(filters.clienteId) : null;
    const from = filters.from ? String(filters.from).slice(0, 10) : null;
    const to = filters.to ? String(filters.to).slice(0, 10) : null;

    if (comercialId && meta.colComercial) {
      where.push(`v.\`${meta.colComercial}\` = ?`);
      params.push(comercialId);
    }
    if (clienteId && meta.colCliente) {
      where.push(`v.\`${meta.colCliente}\` = ?`);
      params.push(clienteId);
    }
    if (meta.colFecha && (from || to)) {
      if (from && to) {
        where.push(`DATE(v.\`${meta.colFecha}\`) BETWEEN ? AND ?`);
        params.push(from, to);
      } else if (from) {
        where.push(`DATE(v.\`${meta.colFecha}\`) >= ?`);
        params.push(from);
      } else if (to) {
        where.push(`DATE(v.\`${meta.colFecha}\`) <= ?`);
        params.push(to);
      }
    }

    let sql = `SELECT v.* FROM \`${meta.table}\` v`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ` ORDER BY ${meta.colFecha ? `v.\`${meta.colFecha}\`` : `v.\`${meta.pk}\``} DESC, v.\`${meta.pk}\` DESC`;
    sql += ` LIMIT ${limit} OFFSET ${offset}`;
    return await this.query(sql, params);
  }

  async countVisitas(filters = {}) {
    try {
      const meta = await this._ensureVisitasMeta();
      const where = [];
      const params = [];

      const comercialId = filters.comercialId ? Number(filters.comercialId) : null;
      const clienteId = filters.clienteId ? Number(filters.clienteId) : null;
      const from = filters.from ? String(filters.from).slice(0, 10) : null;
      const to = filters.to ? String(filters.to).slice(0, 10) : null;

      if (comercialId && meta.colComercial) {
        where.push(`v.\`${meta.colComercial}\` = ?`);
        params.push(comercialId);
      }
      if (clienteId && meta.colCliente) {
        where.push(`v.\`${meta.colCliente}\` = ?`);
        params.push(clienteId);
      }
      if (meta.colFecha && (from || to)) {
        if (from && to) {
          where.push(`DATE(v.\`${meta.colFecha}\`) BETWEEN ? AND ?`);
          params.push(from, to);
        } else if (from) {
          where.push(`DATE(v.\`${meta.colFecha}\`) >= ?`);
          params.push(from);
        } else if (to) {
          where.push(`DATE(v.\`${meta.colFecha}\`) <= ?`);
          params.push(to);
        }
      }

      let sql = `SELECT COUNT(*) as total FROM \`${meta.table}\` v`;
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      const rows = await this.query(sql, params);
      return rows?.[0]?.total ? Number(rows[0].total) : 0;
    } catch (_) {
      return 0;
    }
  }

  async getVisitasByComercial(comercialId) {
    try {
      const meta = await this._ensureVisitasMeta();
      if (meta.colComercial) {
        return await this.query(
          `SELECT * FROM \`${meta.table}\` WHERE \`${meta.colComercial}\` = ? ORDER BY \`${meta.pk}\` DESC`,
          [comercialId]
        );
      }
      // Fallback legacy
      const sql = 'SELECT * FROM visitas WHERE Id_Cial = ? OR id_cial = ? OR ComercialId = ? OR comercialId = ? OR Comercial_id = ? OR comercial_id = ? ORDER BY Id DESC';
      return await this.query(sql, [comercialId, comercialId, comercialId, comercialId, comercialId, comercialId]);
    } catch (error) {
      console.error('❌ Error obteniendo visitas por comercial:', error.message);
      return [];
    }
  }

  async getVisitasByCliente(clienteId) {
    try {
      const meta = await this._ensureVisitasMeta();
      if (meta.colCliente) {
        return await this.query(
          `SELECT * FROM \`${meta.table}\` WHERE \`${meta.colCliente}\` = ? ORDER BY \`${meta.pk}\` DESC`,
          [clienteId]
        );
      }
      // Fallback legacy
      const sql = 'SELECT * FROM visitas WHERE ClienteId = ? OR clienteId = ? OR FarmaciaClienteId = ? OR farmaciaClienteId = ? ORDER BY Id DESC';
      return await this.query(sql, [clienteId, clienteId, clienteId, clienteId]);
    } catch (error) {
      console.error('❌ Error obteniendo visitas por cliente:', error.message);
      return [];
    }
  }

  async getVisitaById(id) {
    try {
      const meta = await this._ensureVisitasMeta();
      const t = meta?.table ? `\`${meta.table}\`` : '`visitas`';
      const pk = meta?.pk || 'Id';
      const rows = await this.query(`SELECT * FROM ${t} WHERE \`${pk}\` = ? LIMIT 1`, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo visita por ID:', error.message);
      return null;
    }
  }

  async createVisita(visitaData) {
    try {
      const meta = await this._ensureVisitasMeta();
      const t = meta?.table ? `\`${meta.table}\`` : '`visitas`';
      const fields = Object.keys(visitaData).map(key => `\`${key}\``).join(', ');
      const placeholders = Object.keys(visitaData).map(() => '?').join(', ');
      const values = Object.values(visitaData);
      
      const sql = `INSERT INTO ${t} (${fields}) VALUES (${placeholders})`;
      const result = await this.query(sql, values);
      return { insertId: result?.insertId || null };
    } catch (error) {
      console.error('❌ Error creando visita:', error.message);
      throw error;
    }
  }

  async updateVisita(visitaId, visitaData) {
    try {
      const meta = await this._ensureVisitasMeta();
      const t = meta?.table ? `\`${meta.table}\`` : '`visitas`';
      const pk = meta?.pk || 'Id';
      const fields = [];
      const values = [];
      
      for (const [key, value] of Object.entries(visitaData)) {
        fields.push(`\`${key}\` = ?`);
        values.push(value);
      }
      
      values.push(visitaId);
      const sql = `UPDATE ${t} SET ${fields.join(', ')} WHERE \`${pk}\` = ?`;
      const result = await this.query(sql, values);
      const affectedRows = result?.affectedRows ?? 0;
      return { affectedRows };
    } catch (error) {
      console.error('❌ Error actualizando visita:', error.message);
      throw error;
    }
  }

  async deleteVisita(id) {
    try {
      const meta = await this._ensureVisitasMeta();
      const t = meta?.table ? `\`${meta.table}\`` : '`visitas`';
      const pk = meta?.pk || 'Id';
      const sql = `DELETE FROM ${t} WHERE \`${pk}\` = ?`;
      const result = await this.query(sql, [id]);
      return { affectedRows: result?.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error eliminando visita:', error.message);
      throw error;
    }
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
   * Actualizar clientes basándose en asignaciones de códigos postales
   * @param {Array<number>} Ids_CodigosPostales - IDs de códigos postales
   * @param {number|null} Id_Marca - ID de la marca (null = todas)
   * @returns {Object} Resultado con clientes actualizados
   */
  async actualizarClientesPorCodigosPostales(Ids_CodigosPostales, Id_Marca = null) {
    try {
      if (!Ids_CodigosPostales || Ids_CodigosPostales.length === 0) {
        return { success: true, clientesActualizados: 0 };
      }

      let sql = `
        UPDATE Clientes c
        INNER JOIN Codigos_Postales cp ON c.Id_CodigoPostal = cp.id
        INNER JOIN Comerciales_Codigos_Postales_Marcas ccp ON cp.id = ccp.Id_CodigoPostal
        SET c.Id_Cial = ccp.Id_Comercial
        WHERE c.Id_CodigoPostal IN (?)
          AND ccp.Activo = 1
          AND (ccp.FechaFin IS NULL OR ccp.FechaFin >= CURDATE())
          AND (ccp.FechaInicio IS NULL OR ccp.FechaInicio <= CURDATE())
      `;
      const params = [Ids_CodigosPostales];

      if (Id_Marca !== null) {
        sql += ' AND ccp.Id_Marca = ?';
        params.push(Id_Marca);
      }

      // Solo actualizar si el comercial asignado tiene mayor prioridad o el cliente no tiene comercial
      sql += `
        AND (
          c.Id_Cial IS NULL 
          OR c.Id_Cial = 0
          OR ccp.Prioridad >= (
            SELECT COALESCE(MAX(ccp2.Prioridad), 0)
            FROM Comerciales_Codigos_Postales_Marcas ccp2
            INNER JOIN Codigos_Postales cp2 ON ccp2.Id_CodigoPostal = cp2.id
            WHERE cp2.id = c.Id_CodigoPostal
              AND ccp2.Id_Comercial = c.Id_Cial
              AND ccp2.Activo = 1
          )
        )
      `;

      const result = await this.query(sql, params);

      return {
        success: true,
        clientesActualizados: result.affectedRows || 0
      };
    } catch (error) {
      console.error('❌ Error actualizando clientes por códigos postales:', error.message);
      throw error;
    }
  }

  // ============================================
  // MÉTODOS DE RECUPERACIÓN DE CONTRASEÑA
  // ============================================

  /**
   * Crear un token de recuperación de contraseña
   */
  async createPasswordResetToken(comercialId, email, token, expiresInHours = 24) {
    try {
      if (!this.connected && !this.pool) {
        await this.connect();
      }

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
      if (!this.connected && !this.pool) {
        await this.connect();
      }

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
      if (!this.connected && !this.pool) {
        await this.connect();
      }

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
            COALESCE(c.Nombre, c.nombre, c.name, CONCAT('Comercial ', rv.comercial_id)) AS comercial_nombre,
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
          LEFT JOIN \`comerciales\` c ON (c.id = rv.comercial_id OR c.Id = rv.comercial_id)
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

module.exports = new MySQLCRM();

