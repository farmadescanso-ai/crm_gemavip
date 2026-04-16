const path = require('path');
const mysql = require('mysql2/promise');
const createDomains = require('./domains');
const { getCatalogCached } = require('../lib/catalog-cache');
const { debug } = require('../lib/logger');
const { getPoolConfig } = require('./db-pool-config');

class MySQLCRM {
  constructor() {
    this.config = getPoolConfig();

    debug('🔍 [DB CONFIG] DB_HOST:', this.config.host, 'DB_NAME:', this.config.database);

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
    if (!/^[a-zA-Z0-9_\-]+$/.test(key) || key.length > 64) return [];

    // Mapeo estático: evita SHOW COLUMNS en cada request (crítico en Vercel serverless)
    const { getColumns: getStaticColumns } = require('./schema-columns');
    const staticCols = getStaticColumns(key);
    if (staticCols && Array.isArray(staticCols) && staticCols.length > 0) {
      return staticCols;
    }

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

  // [Visitas: ver mysql-crm-visitas.js] - métodos en visitasModule

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
    const pk = pick(['varsis_id', 'id', 'Id']) || 'id';
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

  // [Direcciones de envío: ver mysql-crm-direcciones-envio.js]
  async _ensureDireccionesEnvioMeta() {
    if (typeof ensureModule === 'function') ensureModule('direcciones-envio');
    const mod = require(path.join(__dirname, 'mysql-crm-direcciones-envio.js'));
    return mod._ensureDireccionesEnvioMeta.apply(this, arguments);
  }
  async ensureDireccionesEnvioIndexes() {
    if (typeof ensureModule === 'function') ensureModule('direcciones-envio');
    const mod = require(path.join(__dirname, 'mysql-crm-direcciones-envio.js'));
    return mod.ensureDireccionesEnvioIndexes.apply(this, arguments);
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

    // clientes_contactos (M:N) -> clientes (agenda removido)
    try {
      const tClientesContactos = await this._resolveTableNameCaseInsensitive('clientes_contactos').catch(() => null);
      if (tClientesContactos) {
        const ccCols = await this._getColumns(tClientesContactos).catch(() => []);
        if (ccCols && ccCols.length) {
          const colCliente = this._pickCIFromColumns(ccCols, ['clicont_cli_id', 'Id_Cliente', 'id_cliente', 'ClienteId', 'clienteId', 'cliente_id']);
          if (colCliente && clientes?.tClientes) {
            await runCount(
              'clientes_contactos_orfanos_cliente',
              `SELECT COUNT(*) AS n
               FROM \`${tClientesContactos}\` cc
               LEFT JOIN \`${clientes.tClientes}\` c ON cc.\`${colCliente}\` = c.\`${clientes.pk}\`
               WHERE cc.\`${colCliente}\` IS NOT NULL AND cc.\`${colCliente}\` != 0 AND c.\`${clientes.pk}\` IS NULL`
            );
          }
        }
      }
    } catch (e) {
      add({ name: 'clientes_contactos_orfanos_check', ok: false, error: e?.message || String(e) });
    }

    return report;
  }

  // Validar nombre de tabla/columna: solo alfanumérico y underscore (evita inyección SQL).
  _sanitizeIdentifier(name, maxLen = 64) {
    const s = String(name || '').trim();
    if (!s || s.length > maxLen) return null;
    if (!/^[a-zA-Z0-9_]+$/.test(s)) return null;
    return s;
  }

  /**
   * Construye cláusula IN segura para arrays (auditoría punto 20).
   * Si arr está vacío, devuelve "1=0" (nunca coincide) en lugar de IN () que da error SQL.
   * @param {string} columnExpr - Expresión de columna, ej: "c.Id_CodigoPostal"
   * @param {Array} arr - Array de valores (se filtran null/undefined/'')
   * @returns {{ sql: string, params: Array }}
   */
  _buildInClauseSafe(columnExpr, arr) {
    const safe = Array.isArray(arr) ? arr.filter((x) => x != null && x !== '') : [];
    if (safe.length === 0) {
      return { sql: '1=0', params: [] };
    }
    const placeholders = safe.map(() => '?').join(', ');
    return { sql: `${columnExpr} IN (${placeholders})`, params: safe };
  }

  // Filtra claves de payload para usar en SQL (solo identificadores válidos).
  _filterPayloadKeys(payload, excludeUndefined = false) {
    const keys = Object.keys(payload || {}).filter((k) => {
      if (!this._sanitizeIdentifier(k)) return false;
      if (excludeUndefined && payload[k] === undefined) return false;
      return true;
    });
    return keys;
  }

  // Resolver nombre real de tabla (auditoría punto 14: config estático evita 20-60 queries en cold start).
  async _resolveTableNameCaseInsensitive(baseName) {
    const base = this._sanitizeIdentifier(baseName);
    if (!base) throw new Error('Nombre de tabla inválido');

    const staticName = require('./table-names').getTableName(base);
    if (staticName) return staticName;

    this._cache = this._cache || {};
    const cacheKey = `tableName:${base}`;
    if (this._cache[cacheKey] !== undefined) return this._cache[cacheKey];

    const cap = base.charAt(0).toUpperCase() + base.slice(1);
    const upper = base.toUpperCase();
    const candidates = Array.from(new Set([base, cap, upper].filter(Boolean)));

    for (const cand of candidates) {
      try {
        await this.query(`SHOW COLUMNS FROM \`${cand}\``);
        this._cache[cacheKey] = cand;
        return cand;
      } catch (_) {}
    }
    for (const cand of candidates) {
      try {
        await this.queryWithFields(`SELECT * FROM \`${cand}\` LIMIT 0`);
        this._cache[cacheKey] = cand;
        return cand;
      } catch (_) {}
    }
    this._cache[cacheKey] = base;
    return base;
  }

  // Stubs para lazy loading: cargan el módulo bajo demanda cuando se llama antes de connect()
  async _ensureVisitasMeta() {
    if (typeof ensureModule === 'function') ensureModule('visitas');
    const mod = require(path.join(__dirname, 'mysql-crm-visitas.js'));
    return mod._ensureVisitasMeta.apply(this, arguments);
  }
  async _ensureClientesMeta() {
    if (typeof ensureModule === 'function') ensureModule('clientes');
    const mod = require(path.join(__dirname, 'mysql-crm-clientes.js'));
    return mod._ensureClientesMeta.apply(this, arguments);
  }
  async _ensurePedidosMeta() {
    if (typeof ensureModule === 'function') ensureModule('pedidos');
    const mod = require(path.join(__dirname, 'mysql-crm-pedidos.js'));
    return mod._ensurePedidosMeta.apply(this, arguments);
  }
  async _ensureComercialesMeta() {
    if (typeof ensureModule === 'function') ensureModule('comerciales');
    const mod = require(path.join(__dirname, 'mysql-crm-comerciales.js'));
    return mod._ensureComercialesMeta.apply(this, arguments);
  }
  async _ensurePedidosArticulosMeta() {
    if (typeof ensureModule === 'function') ensureModule('pedidos');
    const mod = require(path.join(__dirname, 'mysql-crm-pedidos.js'));
    return mod._ensurePedidosArticulosMeta.apply(this, arguments);
  }
  _buildVisitasOwnerWhere(...args) {
    if (typeof ensureModule === 'function') ensureModule('visitas');
    const mod = require(path.join(__dirname, 'mysql-crm-visitas.js'));
    return mod._buildVisitasOwnerWhere.apply(this, args);
  }
  async getTiposVisita() {
    if (typeof ensureModule === 'function') ensureModule('visitas');
    const mod = require(path.join(__dirname, 'mysql-crm-visitas.js'));
    return mod.getTiposVisita.apply(this, arguments);
  }
  async getEstadosVisita() {
    if (typeof ensureModule === 'function') ensureModule('visitas');
    const mod = require(path.join(__dirname, 'mysql-crm-visitas.js'));
    return mod.getEstadosVisita.apply(this, arguments);
  }

  /**
   * Usar un pool externo compartido (p.ej. con express-mysql-session) para evitar duplicar conexiones.
   * Debe llamarse antes de la primera consulta.
   */
  setSharedPool(pool) {
    if (this.pool && this.pool !== pool) {
      try {
        this.pool.end().catch(() => {});
      } catch (_) {}
    }
    this._sharedPool = pool;
    this.pool = pool;
    // No marcar connected para que connect() ejecute ensureSchema en el primer uso
  }

  async connect() {
    // En entornos serverless (Vercel), este módulo puede vivir entre invocaciones.
    // Si ya estamos conectados, reutilizar el pool.
    if (this.pool && this.connected) {
      return true;
    }
    
    try {
      // Si existe un pool previo pero no está marcado como conectado (p.ej. fallo anterior),
      // cerrarlo para evitar quedar en un estado inconsistente (solo si es nuestro pool, no el compartido).
      if (this.pool && !this.connected && !this._sharedPool) {
        try {
          await this.pool.end();
        } catch (_) {
          // Ignorar errores al cerrar pool previo
        } finally {
          this.pool = null;
        }
      }

      // Si se configuró un pool compartido (api/index.js), usarlo.
      if (this._sharedPool) {
        this.pool = this._sharedPool;
        this.connected = true;
        const connection = await this.pool.getConnection();
        await connection.ping();
        connection.release();
        // Cargar módulos y ensureSchema (igual que el flujo normal)
        if (typeof ensureModule === 'function') {
          ['comerciales', 'visitas', 'clientes', 'pedidos', 'agenda', 'catalogos', 'notificaciones'].forEach((m) => ensureModule(m));
        }
        await this.ensureComercialesReunionesNullable();
        await this.ensureVisitasSchema();
        await this.ensureEstadosVisitaCatalog();
        await this.ensurePedidosSchema();
        if (process.env.ENABLE_INDEX_CREATION_ON_STARTUP === '1') {
          await this.ensureVisitasIndexes();
          await this.ensureClientesIndexes();
          await this.ensurePedidosIndexes();
          await this.ensurePedidosArticulosIndexes();
          await this.ensureContactosIndexes();
          await this.ensureDireccionesEnvioIndexes();
        }
        return true;
      }

      this.pool = mysql.createPool(this.config);
      
      // Verificar conexión (charset y timezone ya en config del pool)
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();
      
      this.connected = true;
      debug('✅ Conectado a MySQL correctamente');
      debug('📊 Base de datos:', this.config.database);
      debug('🌐 Host:', this.config.host + ':' + this.config.port);

      // Cargar módulos necesarios para ensureSchema (lazy loading Fase 3)
      if (typeof ensureModule === 'function') {
        ['comerciales', 'visitas', 'clientes', 'pedidos', 'agenda', 'catalogos', 'notificaciones'].forEach((m) => ensureModule(m));
      }
      // Asegurar compatibilidad de esquema (evita errores tipo "Column 'meet_email' cannot be null").
      await this.ensureComercialesReunionesNullable();
      await this.ensureVisitasSchema();
      await this.ensureEstadosVisitaCatalog();
      await this.ensurePedidosSchema();
      // Índices: NO crear en startup por defecto (CREATE INDEX bloquea tablas en producción).
      // Usar scripts/indices-migracion.sql o POST /api/db/ensure-indexes (admin) manualmente.
      if (process.env.ENABLE_INDEX_CREATION_ON_STARTUP === '1') {
        await this.ensureVisitasIndexes();
        await this.ensureClientesIndexes();
        await this.ensurePedidosIndexes();
        await this.ensurePedidosArticulosIndexes();
        await this.ensureContactosIndexes();
        await this.ensureDireccionesEnvioIndexes();
      }
      return true;
    } catch (error) {
      console.error('❌ Error conectando a MySQL:', error.message);
      console.error(`🔍 [DEBUG] Intentando conectar a: ${this.config.host}:${this.config.port}`);
      console.error(`🔍 [DEBUG] Base de datos: ${this.config.database}`);
      
      // Evitar quedar con un pool creado a medias si la conexión falló (muy importante en serverless).
      // No cerrar el pool compartido (lo gestiona api/index.js).
      if (this.pool && !this._sharedPool) {
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
    if (this.pool && !this._sharedPool) {
      await this.pool.end();
      this.connected = false;
      debug('🔌 Desconectado de MySQL');
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
        // Charset y timezone ya configurados en createPool (evita 6 queries extra por consulta)
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
      // Charset y timezone ya configurados en createPool
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
  async getComercialesForSelect() {
    return domains.comerciales.getComercialesForSelect.apply(this, arguments);
  }
  async getComercialByEmail(email) {
    return domains.comerciales.getComercialByEmail.apply(this, arguments);
  }
  async getComercialById(id) {
    return domains.comerciales.getComercialById.apply(this, arguments);
  }
  async comercialesHasComActivoColumn() {
    return domains.comerciales.comercialesHasComActivoColumn.apply(this, arguments);
  }
  async comercialesHasFechaBajaColumn() {
    return domains.comerciales.comercialesHasFechaBajaColumn.apply(this, arguments);
  }
  async isComercialActiveById(id) {
    return domains.comerciales.isComercialActiveById.apply(this, arguments);
  }
  async reassignClientesComercialToPool(comId) {
    return domains.comerciales.reassignClientesComercialToPool.apply(this, arguments);
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
  async countArticulos(options = {}) {
    return domains.articulos.countArticulos.apply(this, arguments);
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

  async getClientesDuplicados(filters = {}) {
    return domains.clientes.getClientesDuplicados.apply(this, arguments);
  }

  async mergeClientesDuplicados(ids) {
    return domains.clientes.mergeClientesDuplicados.apply(this, arguments);
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
  async resolveClienteIdFromRouteParam(raw) {
    return domains.clientes.resolveClienteIdFromRouteParam.apply(this, arguments);
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
  async findConflictoDniCifCliente(opts = {}) {
    return domains.clientes.findConflictoDniCifCliente.apply(this, arguments);
  }
  async findConflictoNombreYRazonYCif(opts = {}) {
    return domains.clientes.findConflictoNombreYRazonYCif.apply(this, arguments);
  }
  async getClientesByComercial(comercialId) {
    return domains.clientes.getClientesByComercial.apply(this, arguments);
  }
  async getClientesByCodigoPostal(idCodigoPostal) {
    return domains.clientes.getClientesByCodigoPostal.apply(this, arguments);
  }

  // NOTIFICACIONES (delegado a domains/notificaciones.js)
  async _ensureNotificacionesMeta() { return domains.notificaciones._ensureNotificacionesMeta.apply(this); }
  async createSolicitudAsignacion(idContacto, idComercialSolicitante) {
    try {
      return await domains.notificaciones.createSolicitudAsignacion.apply(this, arguments);
    } catch (e) {
      if (e.code === 'ER_NO_REFERENCED_ROW_2' && e.message?.includes('fk_notif_ag')) {
        await this.fixNotifFkCliente();
        return await domains.notificaciones.createSolicitudAsignacion.apply(this, arguments);
      }
      throw e;
    }
  }
  async createSolicitudPedido(idPedido, idComercialSolicitante, idCliente) {
    try {
      return await domains.notificaciones.createSolicitudPedido.apply(this, arguments);
    } catch (e) {
      if (e.code === 'ER_NO_REFERENCED_ROW_2' && e.message?.includes('fk_notif_ag')) {
        await this.fixNotifFkCliente();
        return await domains.notificaciones.createSolicitudPedido.apply(this, arguments);
      }
      throw e;
    }
  }
  async createAprobacionSyncCliente(idCliente, idComercialSolicitante, notasObj) {
    try {
      return await domains.notificaciones.createAprobacionSyncCliente.apply(this, arguments);
    } catch (e) {
      if (e.code === 'ER_NO_REFERENCED_ROW_2' && e.message?.includes('fk_notif_ag')) {
        await this.fixNotifFkCliente();
        return await domains.notificaciones.createAprobacionSyncCliente.apply(this, arguments);
      }
      throw e;
    }
  }
  async hasPendingAprobacionSyncCliente(cliId) {
    return domains.notificaciones.hasPendingAprobacionSyncCliente.apply(this, arguments);
  }
  async getNotificacionesPendientesCount() { return domains.notificaciones.getNotificacionesPendientesCount.apply(this, arguments); }
  async getNotificaciones(limit, offset) { return domains.notificaciones.getNotificaciones.apply(this, arguments); }
  async getNotificacionesForComercial(idComercial, limit, offset) { return domains.notificaciones.getNotificacionesForComercial.apply(this, arguments); }
  async getNotificacionesForComercialCount(idComercial) { return domains.notificaciones.getNotificacionesForComercialCount.apply(this, arguments); }
  async getClienteIdsSolicitudPendienteComercial(idComercial) { return domains.notificaciones.getClienteIdsSolicitudPendienteComercial.apply(this, arguments); }
  async getClienteIdsSolicitudRechazadaComercial(idComercial) { return domains.notificaciones.getClienteIdsSolicitudRechazadaComercial.apply(this, arguments); }
  async resolverSolicitudAsignacion(idNotif, idAdmin, aprobar) { return domains.notificaciones.resolverSolicitudAsignacion.apply(this, arguments); }
  async deleteNotificacionById(id) { return domains.notificaciones.deleteNotificacionById.apply(this, arguments); }
  async deleteAllNotificaciones() { return domains.notificaciones.deleteAllNotificaciones.apply(this, arguments); }

  async fixNotifFkCliente() {
    const result = { dropped: false, added: false };
    await this.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      await this.query('ALTER TABLE `notificaciones` DROP FOREIGN KEY `fk_notif_ag`');
      result.dropped = true;
    } catch (e) {
      if (e.code !== 'ER_CANT_DROP_FIELD_OR_KEY' && !e.message?.includes('check that it exists')) throw e;
    }
    try {
      await this.query('ALTER TABLE `notificaciones` ADD CONSTRAINT `fk_notif_cli` FOREIGN KEY (`notif_ag_id`) REFERENCES `clientes`(`cli_id`) ON DELETE CASCADE ON UPDATE CASCADE');
      result.added = true;
    } catch (e) {
      if (e.code !== 'ER_DUP_KEYNAME' && !e.message?.includes('Duplicate')) throw e;
    }
    await this.query('SET FOREIGN_KEY_CHECKS = 1');
    return result;
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

  // CLIENTES RELACIONADOS
  async getRelacionesByClienteOrigen(cliOrigenId) { return domains.clientesRelacionados.getRelacionesByClienteOrigen.apply(this, arguments); }
  async getRelacionesByClienteRelacionado(cliRelacionadoId) { return domains.clientesRelacionados.getRelacionesByClienteRelacionado.apply(this, arguments); }
  async getRelacionesByCliente(cliId) { return domains.clientesRelacionados.getRelacionesByCliente.apply(this, arguments); }
  async createRelacion(cliOrigenId, cliRelacionadoId, descripcion) { return domains.clientesRelacionados.createRelacion.apply(this, arguments); }
  async createRelacionesBatch(cliOrigenId, items) { return domains.clientesRelacionados.createRelacionesBatch.apply(this, arguments); }
  async _actualizarCliRelacionadoPrincipal(cliOrigenId, cliRelacionadoId) { return domains.clientesRelacionados._actualizarCliRelacionadoPrincipal.apply(this, arguments); }
  async updateRelacion(clirelId, payload) { return domains.clientesRelacionados.updateRelacion.apply(this, arguments); }
  async deleteRelacion(cliOrigenId, cliRelacionadoId) { return domains.clientesRelacionados.deleteRelacion.apply(this, arguments); }
  async getClienteRelacionadoPrincipal(cliId) { return domains.clientesRelacionados.getClienteRelacionadoPrincipal.apply(this, arguments); }
  async tieneRelaciones(cliId) { return domains.clientesRelacionados.tieneRelaciones.apply(this, arguments); }

  // COOPERATIVAS (soporta legacy id/Nombre y normalizado coop_id/coop_nombre)
  async getCooperativas() {
    try {
      try {
        const rows = await this.query('SELECT id, Nombre, Email, Telefono, Contacto FROM cooperativas ORDER BY Id ASC');
        return rows;
      } catch (e1) {
        try {
          const rows = await this.query('SELECT id, Nombre, Email, Telefono, Contacto FROM cooperativas ORDER BY id ASC');
          return rows;
        } catch (e2) {
          const rows = await this.query('SELECT coop_id AS id, coop_nombre AS Nombre, coop_email AS Email, coop_telefono AS Telefono, coop_contacto AS Contacto FROM cooperativas ORDER BY coop_id ASC');
          return rows;
        }
      }
    } catch (error) {
      console.error('❌ Error obteniendo cooperativas:', error.message);
      return [];
    }
  }

  async getCooperativaById(id) {
    try {
      try {
        const rows = await this.query('SELECT id, Nombre, Email, Telefono, Contacto FROM cooperativas WHERE Id = ? LIMIT 1', [id]);
        return rows.length > 0 ? rows[0] : null;
      } catch (e1) {
        try {
          const rows = await this.query('SELECT id, Nombre, Email, Telefono, Contacto FROM cooperativas WHERE id = ? LIMIT 1', [id]);
          return rows.length > 0 ? rows[0] : null;
        } catch (e2) {
          const rows = await this.query('SELECT coop_id AS id, coop_nombre AS Nombre, coop_email AS Email, coop_telefono AS Telefono, coop_contacto AS Contacto FROM cooperativas WHERE coop_id = ? LIMIT 1', [id]);
          return rows.length > 0 ? rows[0] : null;
        }
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
      const colList = 'id, Nombre, CIF, Email, Telefono, Contacto, Direccion, Poblacion, CodigoPostal, Provincia, Pais, Observaciones, Activo, CreadoEn, ActualizadoEn';
      const rows = await this.query(`SELECT ${colList} FROM \`${t}\` ORDER BY id ASC`).catch(async () => {
        return await this.query(`SELECT ${colList} FROM \`${t}\` ORDER BY Id ASC`);
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
      const colList = 'id, Nombre, CIF, Email, Telefono, Contacto, Direccion, Poblacion, CodigoPostal, Provincia, Pais, Observaciones, Activo, CreadoEn, ActualizadoEn';
      try {
        const rows = await this.query(`SELECT ${colList} FROM \`${t}\` WHERE id = ? LIMIT 1`, [id]);
        return rows?.[0] || null;
      } catch (_) {
        const rows = await this.query(`SELECT ${colList} FROM \`${t}\` WHERE Id = ? LIMIT 1`, [id]);
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
      const keys = this._filterPayloadKeys(payload);
      const fields = keys.map(k => `\`${k}\``).join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map(k => payload[k]);
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
      const keys = this._filterPayloadKeys(payload);
      const fields = keys.map(k => `\`${k}\` = ?`).join(', ');
      const values = keys.map(k => payload[k]);
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
      const keys = this._filterPayloadKeys(payload);
      const fields = keys.map(key => `\`${key}\``).join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map(key => payload[key]);
      
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
      const keys = this._filterPayloadKeys(payload);
      const fields = keys.map(key => `\`${key}\` = ?`).join(', ');
      const values = keys.map(key => payload[key]);
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

  // CATÁLOGOS (delegado a domains/catalogos.js)
  async getFormasPago() {
    return getCatalogCached('formasPago', '', () => domains.catalogos.getFormasPago.apply(this, arguments));
  }
  async getFormaPagoById(id) { return domains.catalogos.getFormaPagoById.apply(this, arguments); }
  async getFormaPagoByNombre(nombre) { return domains.catalogos.getFormaPagoByNombre.apply(this, arguments); }
  async createFormaPago(payload) { return domains.catalogos.createFormaPago.apply(this, arguments); }
  async updateFormaPago(id, payload) { return domains.catalogos.updateFormaPago.apply(this, arguments); }
  async deleteFormaPago(id) { return domains.catalogos.deleteFormaPago.apply(this, arguments); }
  async getTiposPedido() {
    return getCatalogCached('tiposPedido', '', () => domains.catalogos.getTiposPedido.apply(this, arguments));
  }
  async getTiposClientes() {
    return getCatalogCached('tiposClientes', '', () => domains.catalogos.getTiposClientes.apply(this, arguments));
  }
  async getEstadosCliente() {
    return getCatalogCached('estadosCliente', '', () => domains.catalogos.getEstadosCliente.apply(this, arguments));
  }
  async getEspecialidades() {
    return getCatalogCached('especialidades', '', () => domains.catalogos.getEspecialidades.apply(this, arguments));
  }
  async getEspecialidadById(id) { return domains.catalogos.getEspecialidadById.apply(this, arguments); }
  async createEspecialidad(payload) { return domains.catalogos.createEspecialidad.apply(this, arguments); }
  async updateEspecialidad(id, payload) { return domains.catalogos.updateEspecialidad.apply(this, arguments); }
  async deleteEspecialidad(id) { return domains.catalogos.deleteEspecialidad.apply(this, arguments); }
  async getProvincias(filtroPais) {
    const suffix = filtroPais != null ? String(filtroPais) : '';
    return getCatalogCached('provincias', suffix, () => domains.catalogos.getProvincias.apply(this, arguments));
  }
  async getProvinciaById(id) { return domains.catalogos.getProvinciaById.apply(this, arguments); }
  async getProvinciaByCodigo(codigo) { return domains.catalogos.getProvinciaByCodigo.apply(this, arguments); }
  async getPaises() {
    return getCatalogCached('paises', '', () => domains.catalogos.getPaises.apply(this, arguments));
  }
  async getPaisById(id) { return domains.catalogos.getPaisById.apply(this, arguments); }
  async getPaisByCodigoISO(codigoISO) { return domains.catalogos.getPaisByCodigoISO.apply(this, arguments); }

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

  async getPedidosArticulos() {
    return domains.pedidos.getPedidosArticulos.apply(this, arguments);
  }
  async getArticulosByPedido(pedidoId) {
    return domains.pedidos.getArticulosByPedido.apply(this, arguments);
  }
  async updatePedido(id, payload) {
    return domains.pedidos.updatePedido.apply(this, arguments);
  }

  // Pedidos: descuentos, estados (módulo mysql-crm-pedidos, lazy load)
  async getDescuentosPedidoActivos(conn) {
    if (typeof ensureModule === 'function') ensureModule('pedidos');
    const mod = require(path.join(__dirname, 'mysql-crm-pedidos.js'));
    return mod.getDescuentosPedidoActivos.apply(this, arguments);
  }
  async ensureEstadosPedidoTable() {
    if (typeof ensureModule === 'function') ensureModule('pedidos');
    const mod = require(path.join(__dirname, 'mysql-crm-pedidos.js'));
    return mod.ensureEstadosPedidoTable.apply(this, arguments);
  }
  async _ensureEstadosPedidoMeta() {
    if (typeof ensureModule === 'function') ensureModule('pedidos');
    const mod = require(path.join(__dirname, 'mysql-crm-pedidos.js'));
    return mod._ensureEstadosPedidoMeta.apply(this, arguments);
  }
  async getEstadosPedidoActivos() {
    if (typeof ensureModule === 'function') ensureModule('pedidos');
    const mod = require(path.join(__dirname, 'mysql-crm-pedidos.js'));
    return mod.getEstadosPedidoActivos.apply(this, arguments);
  }
  async getEstadoPedidoById(id) {
    if (typeof ensureModule === 'function') ensureModule('pedidos');
    const mod = require(path.join(__dirname, 'mysql-crm-pedidos.js'));
    return mod.getEstadoPedidoById.apply(this, arguments);
  }
  async getEstadoPedidoIdByCodigo(codigo) {
    if (typeof ensureModule === 'function') ensureModule('pedidos');
    const mod = require(path.join(__dirname, 'mysql-crm-pedidos.js'));
    return mod.getEstadoPedidoIdByCodigo.apply(this, arguments);
  }

  async getTarifas() {
    // Best-effort:
    // - Preferir `tarifasClientes`
    // - Fallback a `tarifas` (legacy)
    // - Si no existe nada, devolver PVL (0)
    try {
      const t = await this._resolveTableNameCaseInsensitive('tarifasClientes');
      const cols = await this._getColumns(t).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['tarcli_id', 'Id', 'id']) || 'Id';
      const colNombre = this._pickCIFromColumns(cols, ['tarcli_nombre', 'NombreTarifa', 'Nombre', 'nombre']) || 'NombreTarifa';
      const colList = cols.length ? cols.map((c) => `\`${c}\``).join(', ') : '*';
      const rows = await this.query(`SELECT ${colList} FROM \`${t}\` ORDER BY \`${pk}\` ASC`);
      return (rows || []).map((r) => ({
        ...r,
        id: r?.[pk] ?? r?.tarcli_id ?? r?.Id ?? r?.id ?? null,
        Id: r?.[pk] ?? r?.tarcli_id ?? r?.Id ?? r?.id ?? null,
        tarcli_id: r?.[pk] ?? r?.tarcli_id ?? null,
        tarcli_nombre: r?.[colNombre] ?? r?.tarcli_nombre ?? null,
        NombreTarifa: r?.[colNombre] ?? r?.NombreTarifa ?? r?.Nombre ?? r?.nombre ?? ''
      }));
    } catch (_) {
      try {
        const t = await this._resolveTableNameCaseInsensitive('tarifas');
        const cols = await this._getColumns(t).catch(() => []);
        const pk = this._pickCIFromColumns(cols, ['Id', 'id']) || 'id';
        const colNombre = this._pickCIFromColumns(cols, ['NombreTarifa', 'Nombre', 'nombre']) || 'NombreTarifa';
        const colList = cols.length ? cols.map((c) => `\`${c}\``).join(', ') : '*';
        const rows = await this.query(`SELECT ${colList} FROM \`${t}\` ORDER BY \`${pk}\` ASC`);
        return (rows || []).map((r) => ({
          ...r,
          id: r?.[pk] ?? r?.Id ?? r?.id ?? null,
          Id: r?.[pk] ?? r?.Id ?? r?.id ?? null,
          tarcli_id: r?.[pk] ?? null,
          tarcli_nombre: r?.[colNombre] ?? null,
          NombreTarifa: r?.[colNombre] ?? r?.NombreTarifa ?? r?.Nombre ?? r?.nombre ?? ''
        }));
      } catch (_) {
        return [{ Id: 0, id: 0, tarcli_id: 0, tarcli_nombre: 'PVL', NombreTarifa: 'PVL', Activa: 1 }];
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
      debug('✅ Líneas verificadas/actualizadas para el pedido:', pedidoId);
      return { affectedRows: result.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error vinculando líneas de pedido:', error.message);
      throw error;
    }
  }

  // [Direcciones de envío: ver mysql-crm-direcciones-envio.js]
  async getDireccionesEnvioByCliente(clienteId, options = {}) {
    if (typeof ensureModule === 'function') ensureModule('direcciones-envio');
    const mod = require(path.join(__dirname, 'mysql-crm-direcciones-envio.js'));
    return mod.getDireccionesEnvioByCliente.apply(this, arguments);
  }
  async getDireccionEnvioById(id) {
    if (typeof ensureModule === 'function') ensureModule('direcciones-envio');
    const mod = require(path.join(__dirname, 'mysql-crm-direcciones-envio.js'));
    return mod.getDireccionEnvioById.apply(this, arguments);
  }
  async createDireccionEnvio(payload) {
    if (typeof ensureModule === 'function') ensureModule('direcciones-envio');
    const mod = require(path.join(__dirname, 'mysql-crm-direcciones-envio.js'));
    return mod.createDireccionEnvio.apply(this, arguments);
  }
  async ensureDireccionEnvioFiscal(clienteId) {
    if (typeof ensureModule === 'function') ensureModule('direcciones-envio');
    const mod = require(path.join(__dirname, 'mysql-crm-direcciones-envio.js'));
    return mod.ensureDireccionEnvioFiscal.apply(this, arguments);
  }
  async updateDireccionEnvio(id, payload) {
    if (typeof ensureModule === 'function') ensureModule('direcciones-envio');
    const mod = require(path.join(__dirname, 'mysql-crm-direcciones-envio.js'));
    return mod.updateDireccionEnvio.apply(this, arguments);
  }
  async desactivarDireccionEnvio(id) {
    if (typeof ensureModule === 'function') ensureModule('direcciones-envio');
    const mod = require(path.join(__dirname, 'mysql-crm-direcciones-envio.js'));
    return mod.desactivarDireccionEnvio.apply(this, arguments);
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
      const sql = 'SELECT id, Id_Ruta, Nombre_Centro, Direccion, Poblacion, Cod_Postal, Municipio, Telefono, Email, Coordinador, Telf_Coordinador, Email_Coordinador, Area_Salud FROM centros_salud ORDER BY id ASC';
      const rows = await this.query(sql);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo centros de salud:', error.message);
      return [];
    }
  }

  async getCentroSaludById(id) {
    try {
      const sql = 'SELECT id, Id_Ruta, Nombre_Centro, Direccion, Poblacion, Cod_Postal, Municipio, Telefono, Email, Coordinador, Telf_Coordinador, Email_Coordinador, Area_Salud FROM centros_salud WHERE id = ? LIMIT 1';
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
      const sql = 'SELECT id, Id, CentroSaludId, centroSaludId, Nombre, Apellidos, Especialidad, Telefono, Email FROM medicos_enfermeras ORDER BY Id ASC';
      const rows = await this.query(sql);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo médicos/enfermeras:', error.message);
      return [];
    }
  }

  async getMedicosEnfermerasByCentro(centroId) {
    try {
      const sql = 'SELECT id, Id, CentroSaludId, centroSaludId, Nombre, Apellidos, Especialidad, Telefono, Email FROM medicos_enfermeras WHERE CentroSaludId = ? OR centroSaludId = ? ORDER BY Id ASC';
      const rows = await this.query(sql, [centroId, centroId]);
      return rows;
    } catch (error) {
      console.error('❌ Error obteniendo médicos/enfermeras por centro:', error.message);
      return [];
    }
  }

  // Método genérico para compatibilidad (no usado en MySQL directo)
  async getTableData(tableName, options = {}) {
    try {
      const t = this._sanitizeIdentifier(tableName);
      if (!t) throw new Error('Nombre de tabla inválido');
      const cols = await this._getColumns(t).catch(() => []);
      const colList = cols.length ? cols.map((c) => `\`${c}\``).join(', ') : '*';
      const sql = `SELECT ${colList} FROM \`${t}\` ORDER BY Id ASC`;
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
      const sql = 'SELECT id, clave, valor, descripcion, tipo FROM Configuraciones WHERE clave = ? LIMIT 1';
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
      const sql = 'SELECT id, clave, valor, descripcion, tipo FROM Configuraciones ORDER BY clave ASC';
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
      const sql = 'SELECT id, nombre, api_key, descripcion, activa, permisos, ultimo_uso, creado_en, actualizado_en, creado_por FROM `api_keys` WHERE api_key = ? AND activa = 1 LIMIT 1';
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

  // [Códigos postales y asignaciones: ver mysql-crm-codigos-postales.js]
  async _getCodigosPostalesTableName() {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod._getCodigosPostalesTableName.apply(this, arguments);
  }
  async _getAsignacionesCpMarcasTableName() {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod._getAsignacionesCpMarcasTableName.apply(this, arguments);
  }
  async _getComercialesTableName() {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod._getComercialesTableName.apply(this, arguments);
  }
  async _getMarcasTableName() {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod._getMarcasTableName.apply(this, arguments);
  }
  async getCodigosPostales(filtros = {}) {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod.getCodigosPostales.apply(this, arguments);
  }
  async getCodigoPostalById(id) {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod.getCodigoPostalById.apply(this, arguments);
  }
  async createCodigoPostal(data) {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod.createCodigoPostal.apply(this, arguments);
  }
  async updateCodigoPostal(id, data) {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod.updateCodigoPostal.apply(this, arguments);
  }
  async deleteCodigoPostal(id) {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod.deleteCodigoPostal.apply(this, arguments);
  }
  async getAsignaciones(filtros = {}) {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod.getAsignaciones.apply(this, arguments);
  }
  async getAsignacionById(id) {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod.getAsignacionById.apply(this, arguments);
  }
  async createAsignacion(data) {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod.createAsignacion.apply(this, arguments);
  }
  async updateAsignacion(id, data) {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod.updateAsignacion.apply(this, arguments);
  }
  async deleteAsignacion(id) {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod.deleteAsignacion.apply(this, arguments);
  }
  async createAsignacionesMasivas(data) {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod.createAsignacionesMasivas.apply(this, arguments);
  }
  async createAsignacionesPorProvincia(data) {
    if (typeof ensureModule === 'function') ensureModule('codigos-postales');
    const mod = require(path.join(__dirname, 'mysql-crm-codigos-postales.js'));
    return mod.createAsignacionesPorProvincia.apply(this, arguments);
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

    const keys = this._filterPayloadKeys(payload, true);
    const fields = keys.map((k) => `\`${k}\``).join(', ');
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map((k) => payload[k]);

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

// Módulos: carga eager al inicio (evita overhead por request en cold start Vercel)
const _modulesApplied = new Set();
const _configDir = __dirname;
const MODULE_NAMES = [
  'visitas',
  'articulos',
  'pedidos',
  'comerciales',
  'agenda',
  'clientes',
  'catalogos',
  'notificaciones',
  'direcciones-envio',
  'codigos-postales',
  'push'
];

function ensureModule(name) {
  if (_modulesApplied.has(name)) return;
  if (MODULE_NAMES.includes(name)) {
    const p = path.join(_configDir, `mysql-crm-${name}.js`);
    Object.assign(MySQLCRM.prototype, require(p));
    _modulesApplied.add(name);
  }
}

MODULE_NAMES.forEach((m) => ensureModule(m));

const domains = createDomains(ensureModule);

// Login: cargar al inicio (createPasswordResetToken, findPasswordResetToken, etc.)
const _loginModule = require(path.join(_configDir, 'mysql-crm-login.js'));
Object.assign(MySQLCRM.prototype, _loginModule);
function getLoginModule() {
  return _loginModule;
}

// Wrappers para métodos de login
MySQLCRM.prototype.updateComercialPassword = async function (comercialId, hashedPassword) {
  return getLoginModule().updateComercialPassword.call(this, comercialId, hashedPassword);
};
MySQLCRM.prototype.createPasswordResetToken = async function (comercialId, email, token, expiresInHours) {
  return getLoginModule().createPasswordResetToken.call(this, comercialId, email, token, expiresInHours);
};
MySQLCRM.prototype.findPasswordResetToken = async function (token) {
  return getLoginModule().findPasswordResetToken.call(this, token);
};
MySQLCRM.prototype.markPasswordResetTokenAsUsed = async function (token) {
  return getLoginModule().markPasswordResetTokenAsUsed.call(this, token);
};
MySQLCRM.prototype.countRecentPasswordResetAttempts = async function (email, hours) {
  return getLoginModule().countRecentPasswordResetAttempts.call(this, email, hours);
};
MySQLCRM.prototype.cleanupExpiredTokens = async function () {
  return getLoginModule().cleanupExpiredTokens.call(this);
};

const db = new MySQLCRM();
// Stubs para compatibilidad: evitan error en Vercel si código antiguo los llama
db.checkPasswordResetRateLimitByIp = async () => true;
db.recordPasswordResetIpAttempt = async () => {};
module.exports = db;

