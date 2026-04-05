/**
 * Dominio: Comerciales
 * Consultas y lógica específica de comerciales.
 * Se invoca con db como contexto (this) para acceder a query, createCodigoPostal, etc.
 */
'use strict';

module.exports = {
  /**
   * La columna com_activo no está en schema-columns (evita falsos positivos).
   * Se consulta information_schema (caché por instancia).
   */
  async comercialesHasComActivoColumn() {
    if (this._cacheComercialComActivo === true || this._cacheComercialComActivo === false) {
      return this._cacheComercialComActivo;
    }
    try {
      const t = await this._resolveTableNameCaseInsensitive('comerciales');
      const rows = await this.query(
        `SELECT 1 AS ok FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?) AND COLUMN_NAME = 'com_activo' LIMIT 1`,
        [t]
      );
      this._cacheComercialComActivo = !!(rows && rows.length);
    } catch (_) {
      this._cacheComercialComActivo = false;
    }
    return this._cacheComercialComActivo;
  },

  /** Consulta ligera para selects: com_id, com_nombre, com_email. Sin JOIN. */
  async getComercialesForSelect() {
    try {
      const t = await this._resolveTableNameCaseInsensitive('comerciales');
      const hasActivo = await this.comercialesHasComActivoColumn();
      let sql = `SELECT com_id, com_nombre, com_email FROM \`${t}\``;
      if (hasActivo) {
        sql += ' WHERE `com_activo` = 1';
      }
      sql += ' ORDER BY com_nombre ASC';
      const rows = await this.query(sql);
      return (rows || []).map(r => ({
        com_id: Number(r.com_id) || 0,
        com_nombre: String(r.com_nombre || '').trim(),
        com_email: String(r.com_email || '').trim()
      }));
    } catch (e) {
      console.error('❌ getComercialesForSelect:', e?.message);
      return [];
    }
  },

  /**
   * Comprueba si el comercial puede acceder al CRM (columna com_activo).
   * Si la columna no existe, true (compatibilidad).
   */
  async isComercialActiveById(id) {
    try {
      if (!(await this.comercialesHasComActivoColumn())) return true;
      const t = await this._resolveTableNameCaseInsensitive('comerciales');
      const cols = await this._getColumns(t).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['com_id', 'id', 'Id']) || 'com_id';
      const rows = await this.query(`SELECT \`com_activo\` AS v FROM \`${t}\` WHERE \`${pk}\` = ? LIMIT 1`, [id]);
      const v = rows?.[0]?.v;
      if (v === undefined || v === null) return true;
      return Number(v) !== 0;
    } catch (e) {
      console.error('❌ isComercialActiveById:', e?.message);
      return true;
    }
  },

  /**
   * Mueve todos los clientes con cli_com_id = comId al comercial "pool" (pendiente de asignar).
   */
  async reassignClientesComercialToPool(comId) {
    try {
      const poolId = await this.getComercialIdPool();
      const cid = Number(comId);
      const pid = Number(poolId);
      if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(pid) || pid <= 0 || cid === pid) {
        return { affectedRows: 0 };
      }
      const t = await this._resolveTableNameCaseInsensitive('clientes');
      const cols = await this._getColumns(t).catch(() => []);
      const colCom = this._pickCIFromColumns(cols, ['cli_com_id', 'Id_Cial', 'id_cial']) || 'cli_com_id';
      if (!this.connected && !this.pool) await this.connect();
      const sql = `UPDATE \`${t}\` SET \`${colCom}\` = ? WHERE \`${colCom}\` = ?`;
      const [result] = await this.pool.execute(sql, [pid, cid]);
      return { affectedRows: result.affectedRows || 0 };
    } catch (e) {
      console.error('❌ reassignClientesComercialToPool:', e?.message);
      throw e;
    }
  },

  async getComerciales() {
    try {
      const t = await this._resolveTableNameCaseInsensitive('comerciales');
      const tProv = await this._resolveTableNameCaseInsensitive('provincias').catch(() => 'provincias');
      const cols = await this._getColumns(t).catch(() => []);
      const colsProv = await this._getColumns(tProv).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['com_id', 'id', 'Id']) || 'id';
      const colNombre = this._pickCIFromColumns(cols, ['com_nombre', 'Nombre', 'nombre']) || 'Nombre';
      const colIdProv = this._pickCIFromColumns(cols, ['com_prov_id', 'Id_Provincia', 'id_Provincia']) || 'Id_Provincia';
      const provPk = this._pickCIFromColumns(colsProv, ['prov_id', 'id', 'Id']) || 'id';
      const provNombre = this._pickCIFromColumns(colsProv, ['prov_nombre', 'Nombre', 'nombre', 'Nombre_provincia']) || 'Nombre';
      const sql = `SELECT c.*, p.\`${provNombre}\` AS ProvinciaNombre
        FROM \`${t}\` c
        LEFT JOIN \`${tProv}\` p ON c.\`${colIdProv}\` = p.\`${provPk}\`
        ORDER BY c.\`${colNombre}\` ASC`;
      const rows = await this.query(sql);
      const colEmail = this._pickCIFromColumns(cols, ['com_email', 'Email', 'email']) || 'Email';
      const colMovil = this._pickCIFromColumns(cols, ['com_movil', 'Movil', 'movil']) || 'Movil';
      const normalized = (rows || []).map(r => {
        const idVal = r?.[pk] ?? r?.id ?? r?.Id ?? r?.com_id ?? null;
        const nomVal = r?.[colNombre] ?? r?.Nombre ?? r?.nombre ?? r?.com_nombre ?? '';
        const emailVal = r?.[colEmail] ?? r?.Email ?? r?.email ?? r?.com_email ?? '';
        return {
          ...r,
          id: idVal,
          Id: idVal,
          com_id: idVal,
          Nombre: nomVal,
          com_nombre: nomVal,
          Email: emailVal,
          com_email: emailVal,
          Movil: r?.[colMovil] ?? r?.Movil ?? r?.com_movil ?? '',
          ProvinciaNombre: r?.ProvinciaNombre ?? r?.Provincia ?? ''
        };
      });
      return normalized;
    } catch (error) {
      console.error('❌ Error obteniendo comerciales:', error.message);
      return [];
    }
  },

  async getComercialByEmail(email) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('comerciales');
      const cols = await this._getColumns(t);
      const colEmail = this._pickCIFromColumns(cols, ['com_email', 'Email', 'email', 'Email_Comercial', 'email_comercial']) || 'com_email';
      const sql = `SELECT * FROM \`${t}\` WHERE LOWER(TRIM(\`${colEmail}\`)) = LOWER(TRIM(?)) LIMIT 1`;
      const rows = await this.query(sql, [email]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error obteniendo comercial por email:', error.message);
      return null;
    }
  },

  async getComercialById(id) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('comerciales');
      const cols = await this._getColumns(t);
      const pk = this._pickCIFromColumns(cols, ['com_id', 'Id', 'id']) || 'com_id';
      const colNombre = this._pickCIFromColumns(cols, ['com_nombre', 'Nombre', 'nombre']) || 'Nombre';
      const colEmail = this._pickCIFromColumns(cols, ['com_email', 'Email', 'email']) || 'Email';
      const colDni = this._pickCIFromColumns(cols, ['com_dni', 'DNI', 'dni']) || 'DNI';
      const colRoll = this._pickCIFromColumns(cols, ['com_roll', 'Roll', 'roll']) || 'Roll';
      const colMovil = this._pickCIFromColumns(cols, ['com_movil', 'Movil', 'movil']) || 'Movil';
      const colDireccion = this._pickCIFromColumns(cols, ['com_direccion', 'Direccion', 'direccion']) || 'Direccion';
      const colCodigoPostal = this._pickCIFromColumns(cols, ['com_codigo_postal', 'CodigoPostal', 'codigoPostal']) || 'CodigoPostal';
      const colPoblacion = this._pickCIFromColumns(cols, ['com_poblacion', 'Poblacion', 'poblacion']) || 'Poblacion';
      const colIdProv = this._pickCIFromColumns(cols, ['com_prov_id', 'Id_Provincia', 'id_Provincia']) || 'Id_Provincia';
      const colFijoMensual = this._pickCIFromColumns(cols, ['com_fijo_mensual', 'fijo_mensual', 'FijoMensual']) || 'com_fijo_mensual';
      const colPlataforma = this._pickCIFromColumns(cols, ['com_plataforma_reunion_preferida', 'plataforma_reunion_preferida']) || 'com_plataforma_reunion_preferida';
      const colMeetEmail = this._pickCIFromColumns(cols, ['com_meet_email', 'meet_email']) || 'com_meet_email';
      const colTeamsEmail = this._pickCIFromColumns(cols, ['com_teams_email', 'teams_email']) || 'com_teams_email';
      const hasActivoCol = await this.comercialesHasComActivoColumn();
      const colActivo = hasActivoCol ? 'com_activo' : null;
      const sql = `SELECT * FROM \`${t}\` WHERE \`${pk}\` = ? LIMIT 1`;
      const rows = await this.query(sql, [id]);
      const row = rows.length > 0 ? rows[0] : null;
      if (!row) return null;
      const normalized = {
        ...row,
        id: row[pk] ?? row.id ?? row.Id ?? null,
        Id: row[pk] ?? row.id ?? row.Id ?? null,
        Nombre: row[colNombre] ?? row.Nombre ?? row.com_nombre ?? '',
        Email: row[colEmail] ?? row.Email ?? row.com_email ?? '',
        DNI: row[colDni] ?? row.DNI ?? row.com_dni ?? '',
        Roll: row[colRoll] ?? row.Roll ?? row.com_roll ?? '',
        Movil: row[colMovil] ?? row.Movil ?? row.com_movil ?? '',
        Direccion: row[colDireccion] ?? row.Direccion ?? row.com_direccion ?? '',
        CodigoPostal: row[colCodigoPostal] ?? row.CodigoPostal ?? row.com_codigo_postal ?? '',
        Poblacion: row[colPoblacion] ?? row.Poblacion ?? row.com_poblacion ?? '',
        Id_Provincia: row[colIdProv] ?? row.Id_Provincia ?? row.com_prov_id ?? '',
        fijo_mensual: row[colFijoMensual] ?? row.fijo_mensual ?? row.FijoMensual ?? '',
        plataforma_reunion_preferida: row[colPlataforma] ?? row.plataforma_reunion_preferida ?? '',
        meet_email: row[colMeetEmail] ?? row.meet_email ?? '',
        teams_email: row[colTeamsEmail] ?? row.teams_email ?? '',
        com_activo: (() => {
          if (!colActivo) return true;
          const raw = row[colActivo] ?? row.com_activo ?? row.Activo;
          if (raw === undefined || raw === null) return true;
          return Number(raw) !== 0;
        })()
      };
      return normalized;
    } catch (error) {
      console.error('❌ Error obteniendo comercial por ID:', error.message);
      return null;
    }
  },

  async getComercialIdFromDisplayString(displayStr) {
    if (!displayStr || typeof displayStr !== 'string') return null;
    const trimmed = displayStr.trim();
    if (!trimmed) return null;
    const email = trimmed.includes(' · ') ? trimmed.split(' · ').pop().trim() : trimmed;
    if (!email) return null;
    const c = await this.getComercialByEmail(email);
    return c ? (c.com_id ?? c.id ?? c.Id ?? null) : null;
  },

  /**
   * ID del "pool" de clientes pendientes de asignar (cli_com_id = 26).
   * Los comerciales ven sus clientes + los del pool para poder asignárselos.
   * Prioridad: COMERCIAL_POOL_ID > búsqueda por COMERCIAL_POOL_NAME > fallback 26.
   */
  async getComercialIdPool() {
    const poolIdEnv = process.env.COMERCIAL_POOL_ID;
    if (poolIdEnv != null && poolIdEnv !== '' && !isNaN(Number(poolIdEnv))) {
      const id = Number(poolIdEnv);
      if (id > 0) return id;
    }
    const name = (process.env.COMERCIAL_POOL_NAME || '').trim();
    if (name) {
      try {
        const t = await this._resolveTableNameCaseInsensitive('comerciales');
        const cols = await this._getColumns(t).catch(() => []);
        const pk = this._pickCIFromColumns(cols, ['com_id', 'id', 'Id']) || 'com_id';
        const colNombre = this._pickCIFromColumns(cols, ['com_nombre', 'Nombre', 'nombre']) || 'Nombre';
        const sql = `SELECT \`${pk}\` AS id FROM \`${t}\` WHERE TRIM(\`${colNombre}\`) = ? LIMIT 1`;
        const rows = await this.query(sql, [name]);
        const row = rows?.[0];
        if (row) return row.id ?? row[pk] ?? null;
      } catch (_) { /* fallback */ }
    }
    // Fallback: 26 = pendiente de asignar comercial (CRM Gemavip)
    return 26;
  },

  async createComercial(payload) {
    try {
      if (!this.connected && !this.pool) {
        await this.connect();
      }

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

      const colsCp = await this._getColumns(codigosPostalesTable).catch(() => []);
      const pickCp = (cands) => this._pickCIFromColumns(colsCp, cands);
      const cpPk = pickCp(['codpos_id', 'id', 'Id']) || 'codpos_id';
      const cpColCodigo = pickCp(['codpos_CodigoPostal', 'CodigoPostal', 'codigo_postal']) || 'codpos_CodigoPostal';

      const tProv = await this._resolveTableNameCaseInsensitive('provincias').catch(() => 'provincias');
      const colsProv = await this._getColumns(tProv).catch(() => []);
      const provPk = this._pickCIFromColumns(colsProv, ['prov_id', 'id', 'Id']) || 'prov_id';
      const provNombre = this._pickCIFromColumns(colsProv, ['prov_nombre', 'Nombre', 'nombre']) || 'prov_nombre';

      const codigoPostalTexto = (payload.CodigoPostal || payload.codigoPostal || '').toString().trim();
      let idCodigoPostal = payload.Id_CodigoPostal || payload.id_CodigoPostal || payload.IdCodigoPostal || null;
      if (!idCodigoPostal && codigoPostalTexto) {
        const cpLimpio = codigoPostalTexto.replace(/[^0-9]/g, '').slice(0, 5);
        if (cpLimpio.length >= 4) {
          try {
            const rows = await this.query(`SELECT \`${cpPk}\` AS id FROM \`${codigosPostalesTable}\` WHERE \`${cpColCodigo}\` = ? LIMIT 1`, [cpLimpio]);
            if (rows && rows.length > 0 && (rows[0].id ?? rows[0][cpPk])) {
              idCodigoPostal = rows[0].id ?? rows[0][cpPk];
            } else {
              let provinciaNombre = payload.Provincia || payload.provincia || null;
              const idProvincia = payload.Id_Provincia || payload.id_Provincia || null;
              if (!provinciaNombre && idProvincia) {
                try {
                  const provRows = await this.query(`SELECT \`${provNombre}\` AS Nombre FROM \`${tProv}\` WHERE \`${provPk}\` = ? LIMIT 1`, [idProvincia]);
                  provinciaNombre = provRows?.[0]?.Nombre ?? provRows?.[0]?.[provNombre] ?? null;
                } catch (e) {}
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
                const retry = await this.query(`SELECT \`${cpPk}\` AS id FROM \`${codigosPostalesTable}\` WHERE \`${cpColCodigo}\` = ? LIMIT 1`, [cpLimpio]);
                if (retry && retry.length > 0 && (retry[0].id ?? retry[0][cpPk])) {
                  idCodigoPostal = retry[0].id ?? retry[0][cpPk];
                }
              }
            }
          } catch (e) {
            console.warn('⚠️ No se pudo resolver Id_CodigoPostal:', e.message);
          }
        }
      }
      if (!idCodigoPostal) {
        throw new Error('No se pudo resolver/crear Id_CodigoPostal para el comercial. Revisa el Código Postal.');
      }

      const plataformaPreferidaRaw = payload.plataforma_reunion_preferida ?? payload.PlataformaReunionPreferida ?? null;
      const plataformaPreferida = (plataformaPreferidaRaw !== undefined && plataformaPreferidaRaw !== null && String(plataformaPreferidaRaw).trim() !== '')
        ? String(plataformaPreferidaRaw).trim()
        : 'meet';

      const cols = await this._getColumns(await this._resolveTableNameCaseInsensitive('comerciales')).catch(() => []);
      const pick = (cands) => this._pickCIFromColumns(cols, cands);
      const colNombre = pick(['com_nombre', 'Nombre', 'nombre']) || 'Nombre';
      const colEmail = pick(['com_email', 'Email', 'email']) || 'Email';
      const colDni = pick(['com_dni', 'DNI', 'dni']) || 'DNI';
      const colPassword = pick(['com_password', 'Password', 'password']) || 'Password';
      const colRoll = pick(['com_roll', 'Roll', 'roll']) || 'Roll';
      const hasActivoCol = await this.comercialesHasComActivoColumn();
      const colActivoIns = hasActivoCol ? 'com_activo' : null;
      const colMovil = pick(['com_movil', 'Movil', 'movil']) || 'Movil';
      const colDireccion = pick(['com_direccion', 'Direccion', 'direccion']) || 'Direccion';
      const colCodigoPostal = pick(['com_codigo_postal', 'CodigoPostal', 'codigo_postal']) || 'CodigoPostal';
      const colPoblacion = pick(['com_poblacion', 'Poblacion', 'poblacion']) || 'Poblacion';
      const colIdProvincia = pick(['com_prov_id', 'Id_Provincia', 'id_Provincia']) || 'Id_Provincia';
      const colIdCodigoPostal = pick(['com_codp_id', 'Id_CodigoPostal', 'id_CodigoPostal']) || 'Id_CodigoPostal';

      const insertCols = [colNombre, colEmail, colDni, colPassword, colRoll];
      if (colActivoIns) insertCols.push(colActivoIns);
      insertCols.push(colMovil, colDireccion, colCodigoPostal, colPoblacion, colIdProvincia, colIdCodigoPostal);
      const fijoMensualCol = pick(['com_fijo_mensual', 'fijo_mensual', 'FijoMensual']);
      if (fijoMensualCol) insertCols.push(fijoMensualCol);
      const plataformaCol = pick(['com_plataforma_reunion_preferida', 'plataforma_reunion_preferida', 'PlataformaReunionPreferida']);
      if (plataformaCol) insertCols.push(plataformaCol);

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
        payload.Roll ? (Array.isArray(payload.Roll) ? JSON.stringify(payload.Roll) : payload.Roll) : '["Comercial"]'
      ];
      if (colActivoIns) {
        const a = payload.com_activo ?? payload.Activo ?? true;
        const on = a === true || a === 1 || String(a).toLowerCase() === 'true' || String(a) === '1';
        params.push(on ? 1 : 0);
      }
      params.push(
        payload.Movil || payload.movil || null,
        payload.Direccion || payload.direccion || null,
        codigoPostalTexto || null,
        payload.Poblacion || payload.poblacion || null,
        payload.Id_Provincia || payload.id_Provincia || null,
        idCodigoPostal
      );
      if (fijoMensualCol) params.push(fijoMensual);
      if (plataformaCol) params.push(plataformaPreferida);

      const placeholders = params.map(() => '?').join(', ');
      const sql = `INSERT INTO comerciales (\`${insertCols.join('`, `')}\`) VALUES (${placeholders})`;
      const [result] = await this.pool.execute(sql, params);
      return { insertId: result.insertId, ...result };
    } catch (error) {
      console.error('❌ Error creando comercial:', error.message);
      throw error;
    }
  },

  async updateComercial(id, payload) {
    try {
      const cols = await this._getColumns(await this._resolveTableNameCaseInsensitive('comerciales')).catch(() => []);
      const pick = (cands) => this._pickCIFromColumns(cols, cands);
      const hasComActivoCol = await this.comercialesHasComActivoColumn();
      const colMap = {
        Nombre: pick(['com_nombre', 'Nombre', 'nombre']),
        Email: pick(['com_email', 'Email', 'email']),
        DNI: pick(['com_dni', 'DNI', 'dni']),
        Password: pick(['com_password', 'Password', 'password']),
        Roll: pick(['com_roll', 'Roll', 'roll']),
        Movil: pick(['com_movil', 'Movil', 'movil']),
        Direccion: pick(['com_direccion', 'Direccion', 'direccion']),
        CodigoPostal: pick(['com_codigo_postal', 'CodigoPostal', 'codigo_postal']),
        Poblacion: pick(['com_poblacion', 'Poblacion', 'poblacion']),
        Id_Provincia: pick(['com_prov_id', 'Id_Provincia', 'id_Provincia']),
        Id_CodigoPostal: pick(['com_codp_id', 'Id_CodigoPostal', 'id_CodigoPostal']),
        fijo_mensual: pick(['com_fijo_mensual', 'fijo_mensual', 'FijoMensual']),
        meet_email: pick(['com_meet_email', 'meet_email']),
        teams_email: pick(['com_teams_email', 'teams_email']),
        plataforma_reunion_preferida: pick(['com_plataforma_reunion_preferida', 'plataforma_reunion_preferida']),
        com_activo: hasComActivoCol ? 'com_activo' : null
      };
      const pk = pick(['com_id', 'id', 'Id']) || 'id';
      const colActivoEarly = colMap.com_activo;
      let prevActive = true;
      if (colActivoEarly && payload && payload.com_activo !== undefined) {
        const t0 = await this._resolveTableNameCaseInsensitive('comerciales');
        const prevRows = await this.query(`SELECT \`${colActivoEarly}\` AS v FROM \`${t0}\` WHERE \`${pk}\` = ? LIMIT 1`, [id]);
        const pv = prevRows?.[0]?.v;
        prevActive = pv === undefined || pv === null ? true : Number(pv) !== 0;
      }

      const updates = [];
      const params = [];

      const cpTableRows = await this.query(
        `SELECT table_name AS name
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND LOWER(table_name) = 'codigos_postales'
         LIMIT 1`
      );
      const codigosPostalesTable = cpTableRows?.[0]?.name;

      if (payload.CodigoPostal !== undefined && payload.Id_CodigoPostal === undefined && codigosPostalesTable) {
        const codigoPostalTexto = (payload.CodigoPostal || '').toString().trim();
        const cpLimpio = codigoPostalTexto.replace(/[^0-9]/g, '').slice(0, 5);
        if (cpLimpio) {
          try {
            const colsCp = await this._getColumns(codigosPostalesTable).catch(() => []);
            const cpPk = this._pickCIFromColumns(colsCp, ['codpos_id', 'id', 'Id']) || 'codpos_id';
            const cpColCodigo = this._pickCIFromColumns(colsCp, ['codpos_CodigoPostal', 'CodigoPostal', 'codigo_postal']) || 'codpos_CodigoPostal';
            const tProv = await this._resolveTableNameCaseInsensitive('provincias').catch(() => 'provincias');
            const colsProv = await this._getColumns(tProv).catch(() => []);
            const provPk = this._pickCIFromColumns(colsProv, ['prov_id', 'id', 'Id']) || 'prov_id';
            const provNombre = this._pickCIFromColumns(colsProv, ['prov_nombre', 'Nombre', 'nombre']) || 'prov_nombre';

            const rows = await this.query(`SELECT \`${cpPk}\` AS id FROM \`${codigosPostalesTable}\` WHERE \`${cpColCodigo}\` = ? LIMIT 1`, [cpLimpio]);
            if (rows && rows.length > 0 && (rows[0].id ?? rows[0][cpPk])) {
              payload.Id_CodigoPostal = rows[0].id ?? rows[0][cpPk];
            } else {
              let idProvincia = payload.Id_Provincia || payload.id_Provincia || null;
              if (!idProvincia && cpLimpio.length >= 2) {
                const pref = Number(cpLimpio.slice(0, 2));
                if (Number.isFinite(pref) && pref >= 1 && pref <= 52) idProvincia = pref;
              }
              let provinciaNombre = payload.Provincia || payload.provincia || null;
              if (!provinciaNombre && idProvincia) {
                try {
                  const provRows = await this.query(`SELECT \`${provNombre}\` AS Nombre FROM \`${tProv}\` WHERE \`${provPk}\` = ? LIMIT 1`, [idProvincia]);
                  provinciaNombre = provRows?.[0]?.Nombre ?? provRows?.[0]?.[provNombre] ?? null;
                } catch (e) {}
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
                const retry = await this.query(`SELECT \`${cpPk}\` AS id FROM \`${codigosPostalesTable}\` WHERE \`${cpColCodigo}\` = ? LIMIT 1`, [cpLimpio]);
                if (retry && retry.length > 0 && (retry[0].id ?? retry[0][cpPk])) {
                  payload.Id_CodigoPostal = retry[0].id ?? retry[0][cpPk];
                }
              }
            }
          } catch (e) {
            console.warn('⚠️ No se pudo resolver Id_CodigoPostal en updateComercial:', e.message);
          }
        }
      }

      if (payload.Nombre !== undefined && colMap.Nombre) {
        updates.push(`\`${colMap.Nombre}\` = ?`);
        params.push(payload.Nombre);
      }
      if (payload.Email !== undefined && colMap.Email) {
        updates.push(`\`${colMap.Email}\` = ?`);
        params.push(payload.Email);
      }
      if (payload.DNI !== undefined && colMap.DNI) {
        updates.push(`\`${colMap.DNI}\` = ?`);
        params.push(payload.DNI);
      }
      if (payload.Password !== undefined && colMap.Password) {
        updates.push(`\`${colMap.Password}\` = ?`);
        params.push(payload.Password);
      }
      if (payload.Roll !== undefined && colMap.Roll) {
        const rollValue = Array.isArray(payload.Roll) ? JSON.stringify(payload.Roll) : payload.Roll;
        updates.push(`\`${colMap.Roll}\` = ?`);
        params.push(rollValue);
      }
      if (payload.Movil !== undefined && colMap.Movil) {
        updates.push(`\`${colMap.Movil}\` = ?`);
        params.push(payload.Movil);
      }
      if (payload.Direccion !== undefined && colMap.Direccion) {
        updates.push(`\`${colMap.Direccion}\` = ?`);
        params.push(payload.Direccion);
      }
      if (payload.CodigoPostal !== undefined && colMap.CodigoPostal) {
        updates.push(`\`${colMap.CodigoPostal}\` = ?`);
        params.push(payload.CodigoPostal);
      }
      if (payload.Id_CodigoPostal !== undefined && colMap.Id_CodigoPostal) {
        updates.push(`\`${colMap.Id_CodigoPostal}\` = ?`);
        params.push(payload.Id_CodigoPostal || null);
      }
      if (payload.Poblacion !== undefined && colMap.Poblacion) {
        updates.push(`\`${colMap.Poblacion}\` = ?`);
        params.push(payload.Poblacion);
      }
      if (payload.Id_Provincia !== undefined && colMap.Id_Provincia) {
        updates.push(`\`${colMap.Id_Provincia}\` = ?`);
        params.push(payload.Id_Provincia || null);
      }
      if (payload.fijo_mensual !== undefined && colMap.fijo_mensual) {
        updates.push(`\`${colMap.fijo_mensual}\` = ?`);
        params.push(payload.fijo_mensual);
      }
      if (payload.meet_email !== undefined && colMap.meet_email) {
        updates.push(`\`${colMap.meet_email}\` = ?`);
        params.push(payload.meet_email === '' ? '' : payload.meet_email);
      }
      if (payload.teams_email !== undefined && colMap.teams_email) {
        updates.push(`\`${colMap.teams_email}\` = ?`);
        params.push(payload.teams_email === '' ? '' : payload.teams_email);
      }
      if (payload.plataforma_reunion_preferida !== undefined && colMap.plataforma_reunion_preferida) {
        updates.push(`\`${colMap.plataforma_reunion_preferida}\` = ?`);
        params.push(payload.plataforma_reunion_preferida || 'meet');
      }
      if (payload.com_activo !== undefined && colMap.com_activo) {
        const a = payload.com_activo;
        const on = a === true || a === 1 || String(a).toLowerCase() === 'true' || String(a) === '1';
        updates.push(`\`${colMap.com_activo}\` = ?`);
        params.push(on ? 1 : 0);
      }

      if (updates.length === 0) {
        throw new Error('No hay campos para actualizar');
      }
      params.push(id);
      const t = await this._resolveTableNameCaseInsensitive('comerciales');
      const sql = `UPDATE \`${t}\` SET ${updates.join(', ')} WHERE \`${pk}\` = ?`;

      if (!this.connected && !this.pool) {
        await this.connect();
      }
      const [result] = await this.pool.execute(sql, params);
      if (colActivoEarly && payload && payload.com_activo !== undefined) {
        const a = payload.com_activo;
        const nowActive = a === true || a === 1 || String(a).toLowerCase() === 'true' || String(a) === '1';
        if (prevActive && !nowActive) {
          await this.reassignClientesComercialToPool(id);
        }
      }
      return { affectedRows: result.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error actualizando comercial:', error.message);
      throw error;
    }
  },

  async deleteComercial(id) {
    try {
      if (!this.connected && !this.pool) {
        await this.connect();
      }
      const t = await this._resolveTableNameCaseInsensitive('comerciales');
      const cols = await this._getColumns(t).catch(() => []);
      const pk = this._pickCIFromColumns(cols, ['com_id', 'id', 'Id']) || 'com_id';
      const sql = `DELETE FROM \`${t}\` WHERE \`${pk}\` = ?`;
      const [result] = await this.pool.execute(sql, [id]);
      return { affectedRows: result.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error eliminando comercial:', error.message);
      throw error;
    }
  }
};
