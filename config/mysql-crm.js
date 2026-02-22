const mysql = require('mysql2/promise');
const domains = require('./domains');
const clientesModule = require('./mysql-crm-clientes');
const pedidosModule = require('./mysql-crm-pedidos');
const visitasModule = require('./mysql-crm-visitas');
const articulosModule = require('./mysql-crm-articulos');
const comercialesModule = require('./mysql-crm-comerciales');
const agendaModule = require('./mysql-crm-agenda');

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
      const cols = await this._getColumns(table).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['formp_id', 'id', 'Id']) || 'id';
      const colNombre = this._pickCIFromColumns(cols, ['formp_nombre', 'FormaPago', 'Nombre', 'nombre']) || 'FormaPago';
      const rows = await this.query(`SELECT * FROM \`${table}\` ORDER BY \`${pk}\` ASC`);
      return (rows || []).map(r => ({
        ...r,
        id: r?.[pk] ?? r?.id ?? r?.Id ?? r?.ID ?? null,
        Id: r?.[pk] ?? r?.id ?? r?.Id ?? null,
        Nombre: r?.[colNombre] ?? r?.Nombre ?? r?.FormaPago ?? r?.formaPago ?? r?.nombre ?? null
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
      const cols = await this._getColumns(table).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['formp_id', 'id', 'Id']) || 'id';
      const rows = await this.query(`SELECT * FROM \`${table}\` WHERE \`${pk}\` = ? LIMIT 1`, [id]);
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
      const pk = this._pickCIFromColumns(cols, ['tipp_id', 'id', 'Id']) || 'id';
      const colNombre = this._pickCIFromColumns(cols, ['tipp_tipo', 'Tipo', 'tipo', 'Nombre', 'nombre']) || 'Tipo';
      let rows = [];
      try {
        rows = await this.query(`SELECT * FROM \`${table}\` ORDER BY \`${pk}\` ASC`);
      } catch (e1) {
        rows = await this.query(`SELECT * FROM \`${table}\` ORDER BY Id ASC`).catch(() => []);
      }
      return (rows || []).map((r) => ({
        ...r,
        id: r?.[pk] ?? r?.tipp_id ?? r?.id ?? r?.Id ?? r?.ID ?? null,
        Id: r?.[pk] ?? r?.tipp_id ?? r?.id ?? r?.Id ?? null,
        tipp_id: r?.[pk] ?? r?.tipp_id ?? null,
        tipp_tipo: r?.[colNombre] ?? r?.tipp_tipo ?? null,
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
      const rows = await this.query(`SELECT * FROM \`${t}\` ORDER BY \`${pk}\` ASC`);
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
        const rows = await this.query(`SELECT * FROM \`${t}\` ORDER BY \`${pk}\` ASC`);
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
      console.log(`✅ ${result.affectedRows || 0} líneas verificadas/actualizadas para el pedido ${pedidoId}`);
      return { affectedRows: result.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error vinculando líneas de pedido:', error.message);
      throw error;
    }
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
Object.assign(MySQLCRM.prototype, pedidosModule);
Object.assign(MySQLCRM.prototype, visitasModule);
Object.assign(MySQLCRM.prototype, articulosModule);
Object.assign(MySQLCRM.prototype, comercialesModule);
Object.assign(MySQLCRM.prototype, agendaModule);

module.exports = new MySQLCRM();

