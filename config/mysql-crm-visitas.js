/**
 * Módulo de gestión de visitas para MySQL CRM.
 * Metadatos, esquema, índices, catálogos (tipos/estados).
 * Se asigna al prototipo de MySQLCRM con Object.assign.
 */
'use strict';

const tiposVisitaFallback = require('./tipos-visita.json');
const estadosVisitaFallback = require('./estados-visita.json');

module.exports = {
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

    if (!meta.colComercial) meta.colComercial = guessColByKeywords(['comercial', 'cial']);
    if (!meta.colCliente) meta.colCliente = guessColByKeywords(['cliente', 'farmacia']);
    if (!meta.colFecha) meta.colFecha = guessColByKeywords(['fecha']);
    if (!meta.colHora) meta.colHora = guessColByKeywords(['hora']);
    if (!meta.colHoraFinal) meta.colHoraFinal = guessColByKeywords(['hora_final', 'horafinal']);
    if (!meta.colTipo) meta.colTipo = guessColByKeywords(['tipo']);
    if (!meta.colEstado) meta.colEstado = guessColByKeywords(['estado']);

    meta._cols = cols;
    this._metaCache.visitasMeta = meta;
    return meta;
  },

  _buildVisitasOwnerWhere(meta, user, alias = 'v') {
    const cols = Array.isArray(meta?._cols) ? meta._cols : [];
    const candCols = [];
    if (meta?.colComercial) candCols.push(meta.colComercial);
    for (const c of cols) {
      const cl = String(c || '').toLowerCase();
      if (cl.includes('comercial') || cl.includes('cial')) candCols.push(c);
    }
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
  },

  async getTiposVisita() {
    try {
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
        } catch (_) {}
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
      if (activeCol) sql += ` WHERE \`${activeCol}\` = 1`;
      sql += ` ORDER BY \`${nameCol}\` ASC LIMIT 200`;

      const rows = await this.query(sql, params);
      const tipos = (rows || [])
        .map(r => ({ id: r.id, nombre: r.nombre }))
        .filter(r => r?.nombre !== null && r?.nombre !== undefined && String(r.nombre).trim() !== '');

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
  },

  async ensureEstadosVisitaCatalog() {
    if (this._estadosVisitaEnsured) return;
    this._estadosVisitaEnsured = true;

    try {
      if (!this.pool) return;

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
      } catch (_) {}

      const values = Array.from(normalized).slice(0, 200);
      for (const nombre of values) {
        await this.query('INSERT IGNORE INTO `estados_visita` (nombre, activo) VALUES (?, 1)', [nombre]);
      }

      if (this._metaCache) delete this._metaCache.estadosVisita;
    } catch (e) {
      console.warn('⚠️ [CATALOGO] No se pudo asegurar estados_visita:', e?.message || e);
    }
  },

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
        } catch (_) {}
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
  },

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
      console.warn('⚠️ [INDEX] No se pudieron asegurar índices en visitas:', e?.message || e);
    }
  },

  async ensureVisitasSchema() {
    if (this._visitasSchemaEnsured) return;
    this._visitasSchemaEnsured = true;

    try {
      if (!this.pool) return;

      const tVisitas = await this._resolveTableNameCaseInsensitive('visitas');
      const cols = await this._getColumns(tVisitas);
      const colsLower = new Set((cols || []).map((c) => String(c || '').toLowerCase()));
      const hasColCI = (name) => colsLower.has(String(name || '').toLowerCase());

      if (!hasColCI('Id_Comercial')) {
        try {
          await this.query(`ALTER TABLE \`${tVisitas}\` ADD COLUMN \`Id_Comercial\` INT NULL`);
          console.log(`✅ [SCHEMA] Añadida columna Id_Comercial en ${tVisitas}`);
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir Id_Comercial en visitas:', e?.message || e);
        }
      }

      if (!hasColCI('Hora_Final')) {
        try {
          await this.query(`ALTER TABLE \`${tVisitas}\` ADD COLUMN \`Hora_Final\` TIME NULL`);
          console.log(`✅ [SCHEMA] Añadida columna Hora_Final en ${tVisitas}`);
        } catch (e) {
          console.warn('⚠️ [SCHEMA] No se pudo añadir Hora_Final en visitas:', e?.message || e);
        }
      }

      if (this._metaCache) delete this._metaCache.visitasMeta;
      const meta = await this._ensureVisitasMeta();

      if (meta?.colHora && (meta?.colHoraFinal || hasColCI('hora_final'))) {
        const colHoraFinal = meta.colHoraFinal || 'Hora_Final';
        try {
          await this.query(
            `UPDATE \`${meta.table}\` SET \`${colHoraFinal}\` = ADDTIME(\`${meta.colHora}\`, '00:30:00') WHERE (\`${colHoraFinal}\` IS NULL OR \`${colHoraFinal}\` = '00:00:00') AND \`${meta.colHora}\` IS NOT NULL`
          );
        } catch (_) {}
      }

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

      try {
        const comMeta = await this._ensureComercialesMeta().catch(() => null);
        if (comMeta?.table && comMeta?.pk && (meta.colComercial || hasColCI('Id_Comercial'))) {
          const fkName = 'fk_visitas_comercial';
          try {
            await this.query(
              `ALTER TABLE \`${meta.table}\` ADD CONSTRAINT \`${fkName}\` FOREIGN KEY (\`${meta.colComercial || 'Id_Comercial'}\`) REFERENCES \`${comMeta.table}\`(\`${comMeta.pk}\`) ON DELETE SET NULL ON UPDATE CASCADE`
            );
            console.log(`✅ [FK] Creada ${fkName}`);
          } catch (e) {
            const msg = String(e?.message || e);
            if (!msg.toLowerCase().includes('duplicate') && !msg.toLowerCase().includes('already') && !msg.toLowerCase().includes('exists')) {
              console.warn('⚠️ [FK] No se pudo crear FK visitas->comerciales:', e?.message || e);
            }
          }
        }
      } catch (_) {}
    } catch (e) {
      console.warn('⚠️ [SCHEMA] No se pudo asegurar esquema de visitas:', e?.message || e);
    }
  }
};
