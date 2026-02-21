/**
 * Dominio: Comerciales
 * Consultas y lógica específica de comerciales.
 * Se invoca con db como contexto (this) para acceder a query, createCodigoPostal, etc.
 */
'use strict';

module.exports = {
  async getComerciales() {
    try {
      const sql = 'SELECT * FROM comerciales ORDER BY id ASC';
      const rows = await this.query(sql);
      console.log(`✅ Obtenidos ${rows.length} comerciales`);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('❌ Error obteniendo comerciales:', error.message);
      return [];
    }
  },

  async getComercialByEmail(email) {
    try {
      const t = await this._resolveTableNameCaseInsensitive('comerciales');
      const cols = await this._getColumns(t);
      const colEmail = this._pickCIFromColumns(cols, ['com_email', 'Email', 'email']) || 'com_email';
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
      const cols = await this._getColumns(await this._resolveTableNameCaseInsensitive('comerciales'));
      const pk = this._pickCIFromColumns(cols, ['com_id', 'Id', 'id']) || 'com_id';
      const sql = `SELECT * FROM comerciales WHERE \`${pk}\` = ? LIMIT 1`;
      const rows = await this.query(sql, [id]);
      return rows.length > 0 ? rows[0] : null;
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

      const codigoPostalTexto = (payload.CodigoPostal || payload.codigoPostal || '').toString().trim();
      let idCodigoPostal = payload.Id_CodigoPostal || payload.id_CodigoPostal || payload.IdCodigoPostal || null;
      if (!idCodigoPostal && codigoPostalTexto) {
        const cpLimpio = codigoPostalTexto.replace(/[^0-9]/g, '').slice(0, 5);
        if (cpLimpio.length >= 4) {
          try {
            const rows = await this.query(`SELECT id FROM ${codigosPostalesTable} WHERE CodigoPostal = ? LIMIT 1`, [cpLimpio]);
            if (rows && rows.length > 0 && rows[0].id) {
              idCodigoPostal = rows[0].id;
            } else {
              let provinciaNombre = payload.Provincia || payload.provincia || null;
              const idProvincia = payload.Id_Provincia || payload.id_Provincia || null;
              if (!provinciaNombre && idProvincia) {
                try {
                  const provRows = await this.query('SELECT Nombre FROM provincias WHERE id = ? LIMIT 1', [idProvincia]);
                  provinciaNombre = provRows?.[0]?.Nombre || null;
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
                const retry = await this.query(`SELECT id FROM ${codigosPostalesTable} WHERE CodigoPostal = ? LIMIT 1`, [cpLimpio]);
                if (retry && retry.length > 0 && retry[0].id) {
                  idCodigoPostal = retry[0].id;
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
  },

  async updateComercial(id, payload) {
    try {
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
      if (payload.meet_email !== undefined) {
        updates.push('meet_email = ?');
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
      params.push(id, id);
      const sql = `UPDATE comerciales SET ${updates.join(', ')} WHERE id = ? OR Id = ?`;

      if (!this.connected && !this.pool) {
        await this.connect();
      }
      const [result] = await this.pool.execute(sql, params);
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
      const sql = 'DELETE FROM comerciales WHERE id = ? OR Id = ?';
      const [result] = await this.pool.execute(sql, [id, id]);
      return { affectedRows: result.affectedRows || 0 };
    } catch (error) {
      console.error('❌ Error eliminando comercial:', error.message);
      throw error;
    }
  }
};
