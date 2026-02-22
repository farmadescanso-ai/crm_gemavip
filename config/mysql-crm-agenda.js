/**
 * Módulo de gestión de agenda/contactos para MySQL CRM.
 * Resolución de tabla, índices, catálogos (tiposcargorol, especialidades), normalización.
 * Se asigna al prototipo de MySQLCRM con Object.assign.
 */
'use strict';

module.exports = {
  /**
   * Resolver la tabla `agenda` (nuevo nombre) con fallback a `contactos` (legacy).
   */
  async _resolveAgendaTableName() {
    const tryResolveAndProbe = async (base) => {
      const t = await this._resolveTableNameCaseInsensitive(base);
      await this.query(`SELECT 1 FROM \`${t}\` LIMIT 1`);
      return t;
    };

    try {
      return await tryResolveAndProbe('agenda');
    } catch (_e) {
      return await tryResolveAndProbe('contactos');
    }
  },

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
  },

  async _ensureTiposCargoRolTable() {
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
  },

  async _ensureEspecialidadesIndexes() {
    try {
      const t = await this._resolveTableNameCaseInsensitive('especialidades').catch(() => 'especialidades');
      const idxRows = await this.query(`SHOW INDEX FROM \`${t}\``).catch(() => []);
      const existing = new Set((idxRows || []).map(r => String(r.Key_name || r.key_name || '').trim()).filter(Boolean));
      if (!existing.has('idx_especialidades_especialidad')) {
        try { await this.query(`CREATE INDEX \`idx_especialidades_especialidad\` ON \`${t}\` (\`Especialidad\`)`); } catch (_) {}
      }
      if (!existing.has('ux_especialidades_especialidad')) {
        try { await this.query(`CREATE UNIQUE INDEX \`ux_especialidades_especialidad\` ON \`${t}\` (\`Especialidad\`)`); } catch (_) {}
      }
      return true;
    } catch (_) {
      return false;
    }
  },

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
      if (/^[0-9]+$/.test(lw)) return lw;
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    };

    const capToken = (token, idx) => {
      const raw = String(token || '');
      const sub = raw.split('-').map((x) => String(x || ''));
      const out = sub.map((x, subIdx) => {
        const base = x.toLowerCase();
        if (idx > 0 && subIdx === 0 && lowerWords.has(base)) return base;
        return capWord(x);
      });
      return out.join('-');
    };

    return parts.map(capToken).join(' ');
  },

  _normalizeAgendaCatalogLabel(value) {
    const raw = String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!raw) return '';
    return this._titleCaseEs(raw).slice(0, 120);
  }
};
