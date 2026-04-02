/**
 * Dominio: Notificaciones (solicitudes de asignación de contactos, pedidos especiales)
 * Se invoca con db como contexto (this) para acceder a query, _getColumns, etc.
 * Compatible con esquema legacy (tipo, id_contacto...) y migrado (notif_tipo, notif_ag_id...).
 */
'use strict';

module.exports = {
  async _ensureNotificacionesMeta() {
    if (this.__notifMeta) return this.__notifMeta;
    const cols = await this._getColumns('notificaciones').catch(() => []);
    const pick = (cands) => this._pickCIFromColumns(cols, cands);
    const meta = {
      pk: pick(['notif_id', 'id']) || 'id',
      colTipo: pick(['notif_tipo', 'tipo']) || 'tipo',
      colContacto: pick(['notif_ag_id', 'notif_cli_id', 'id_contacto']) || 'id_contacto',
      colComercial: pick(['notif_com_id', 'id_comercial_solicitante']) || 'id_comercial_solicitante',
      colAdmin: pick(['notif_com_admin_id', 'id_admin_resolvio']) || 'id_admin_resolvio',
      colPedido: pick(['notif_ped_id', 'id_pedido']) || 'id_pedido',
      colEstado: pick(['notif_estado', 'estado']) || 'estado',
      colFechaCreacion: pick(['notif_fecha_creacion', 'fecha_creacion']) || 'fecha_creacion',
      colFechaResolucion: pick(['notif_fecha_resolucion', 'fecha_resolucion']) || 'fecha_resolucion',
      colNotas: pick(['notif_notas', 'notas']) || 'notas'
    };
    this.__notifMeta = meta;
    return meta;
  },

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

      try {
        const cols = await this._getColumns('notificaciones').catch(() => []);
        const colsLower = new Set((cols || []).map((c) => String(c).toLowerCase()));
        if (!colsLower.has('id_pedido')) {
          try { await this.query('ALTER TABLE `notificaciones` ADD COLUMN `id_pedido` INT NULL'); } catch (_) {}
        }
        try { await this.query('ALTER TABLE `notificaciones` ADD KEY `idx_notif_pedido` (`id_pedido`)'); } catch (_) {}
        try { await this.query('ALTER TABLE `notificaciones` ADD KEY `idx_notif_tipo_estado` (`tipo`, `estado`, `fecha_creacion`)'); } catch (_) {}
      } catch (_) {}
      return true;
    } catch (e) {
      console.warn('⚠️ [NOTIF] No se pudo crear tabla notificaciones:', e?.message);
      return false;
    }
  },

  async createSolicitudAsignacion(idContacto, idComercialSolicitante) {
    await this._ensureNotificacionesTable();
    const m = await this._ensureNotificacionesMeta();
    const cols = [m.colTipo, m.colContacto, m.colPedido, m.colComercial, m.colEstado];
    const colList = cols.map((c) => `\`${c}\``).join(', ');
    try {
      const r = await this.query(
        `INSERT INTO \`notificaciones\` (${colList}) VALUES (?, ?, ?, ?, ?)`,
        ['asignacion_contacto', idContacto, null, idComercialSolicitante, 'pendiente']
      );
      return r?.insertId ?? r?.affectedRows ?? null;
    } catch (_e) {
      const colsAlt = [m.colTipo, m.colContacto, m.colComercial, m.colEstado];
      const colListAlt = colsAlt.map((c) => `\`${c}\``).join(', ');
      const r = await this.query(
        `INSERT INTO \`notificaciones\` (${colListAlt}) VALUES (?, ?, ?, ?)`,
        ['asignacion_contacto', idContacto, idComercialSolicitante, 'pendiente']
      );
      return r?.insertId ?? r?.affectedRows ?? null;
    }
  },

  /**
   * Solicitud de decisión Holded ↔ CRM (enlaces firmados en email).
   * @param {number} idCliente - cli_id
   * @param {number} idComercialSolicitante - comercial asociado (p. ej. cli_com_id)
   * @param {string|Record<string, unknown>} notasObj - JSON o objeto (se serializa; máx. ~500 chars en columna legacy)
   */
  async createAprobacionSyncCliente(idCliente, idComercialSolicitante, notasObj) {
    await this._ensureNotificacionesTable();
    const m = await this._ensureNotificacionesMeta();
    let notas =
      typeof notasObj === 'string' ? notasObj : JSON.stringify(notasObj != null ? notasObj : {});
    if (notas.length > 500) {
      notas = `${notas.slice(0, 497)}...`;
    }
    const comId = Number(idComercialSolicitante) > 0 ? Number(idComercialSolicitante) : 1;
    const cid = Number(idCliente) > 0 ? Number(idCliente) : 0;
    if (!cid) return null;
    const cols = [m.colTipo, m.colContacto, m.colPedido, m.colComercial, m.colEstado, m.colNotas];
    const colList = cols.map((c) => `\`${c}\``).join(', ');
    try {
      const r = await this.query(
        `INSERT INTO \`notificaciones\` (${colList}) VALUES (?, ?, NULL, ?, 'pendiente', ?)`,
        ['aprobacion_sync_cliente', cid, comId, notas]
      );
      return r?.insertId ?? r?.insertId ?? null;
    } catch (_e) {
      const colsAlt = [m.colTipo, m.colContacto, m.colComercial, m.colEstado];
      const colListAlt = colsAlt.map((c) => `\`${c}\``).join(', ');
      const r = await this.query(
        `INSERT INTO \`notificaciones\` (${colListAlt}) VALUES (?, ?, ?, ?)`,
        ['aprobacion_sync_cliente', cid, comId, 'pendiente']
      );
      return r?.insertId ?? r?.insertId ?? null;
    }
  },

  async hasPendingAprobacionSyncCliente(cliId) {
    const cid = Number(cliId) > 0 ? Number(cliId) : 0;
    if (!cid) return false;
    await this._ensureNotificacionesTable();
    try {
      const m = await this._ensureNotificacionesMeta();
      const rows = await this.query(
        `SELECT \`${m.pk}\` FROM \`notificaciones\` WHERE \`${m.colTipo}\` = 'aprobacion_sync_cliente' AND \`${m.colContacto}\` = ? AND \`${m.colEstado}\` = 'pendiente' LIMIT 1`,
        [cid]
      );
      return Array.isArray(rows) && rows.length > 0;
    } catch (_) {
      return false;
    }
  },

  async createSolicitudPedido(idPedido, idComercialSolicitante, idCliente) {
    await this._ensureNotificacionesTable();
    const m = await this._ensureNotificacionesMeta();
    const cols = [m.colTipo, m.colContacto, m.colPedido, m.colComercial, m.colEstado];
    const colList = cols.map((c) => `\`${c}\``).join(', ');
    try {
      const r = await this.query(
        `INSERT INTO \`notificaciones\` (${colList}) VALUES (?, ?, ?, ?, ?)`,
        ['aprobacion_pedido', idCliente || 0, idPedido, idComercialSolicitante, 'pendiente']
      );
      return r?.insertId ?? r?.affectedRows ?? null;
    } catch (_e) {
      const colsAlt = [m.colTipo, m.colPedido, m.colComercial, m.colEstado];
      const colListAlt = colsAlt.map((c) => `\`${c}\``).join(', ');
      const r = await this.query(
        `INSERT INTO \`notificaciones\` (${colListAlt}) VALUES (?, ?, ?, ?)`,
        ['aprobacion_pedido', idPedido, idComercialSolicitante, 'pendiente']
      );
      return r?.insertId ?? r?.affectedRows ?? null;
    }
  },

  async getNotificacionesPendientesCount() {
    try {
      await this._ensureNotificacionesTable();
      const m = await this._ensureNotificacionesMeta();
      const rows = await this.query(`SELECT COUNT(*) AS n FROM \`notificaciones\` WHERE \`${m.colEstado}\` = 'pendiente'`);
      if (!rows) return 0;
      const first = Array.isArray(rows) ? rows[0] : rows;
      const n = first?.n ?? first?.N ?? (Array.isArray(first) ? first[0] : 0);
      return Number(n ?? 0);
    } catch (_) {
      return 0;
    }
  },

  async getNotificaciones(limit = 50, offset = 0) {
    const l = Math.max(1, Math.min(100, Number(limit)));
    const o = Math.max(0, Number(offset));
    await this._ensureNotificacionesTable();
    try {
      const m = await this._ensureNotificacionesMeta();
      const sql = `SELECT \`${m.pk}\` as id, \`${m.colTipo}\` as tipo, \`${m.colContacto}\` as id_contacto, \`${m.colPedido}\` as id_pedido, \`${m.colComercial}\` as id_comercial_solicitante, \`${m.colEstado}\` as estado, \`${m.colAdmin}\` as id_admin_resolvio, \`${m.colFechaCreacion}\` as fecha_creacion, \`${m.colFechaResolucion}\` as fecha_resolucion, \`${m.colNotas}\` as notas FROM \`notificaciones\` ORDER BY \`${m.colFechaCreacion}\` DESC LIMIT ${l} OFFSET ${o}`;
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
        comercial_nombre: null,
        admin_nombre: null
      }));
      if (items.length === 0) return items;
      const contactIds = items.map((x) => x.id_contacto).filter(Boolean);
      const comercialIds = items.map((x) => x.id_comercial_solicitante).filter(Boolean);
      const adminIds = items.map((x) => x.id_admin_resolvio).filter(Boolean);
      const pedidoIds = items
        .map((x) => x.id_pedido)
        .filter(Boolean)
        .map((v) => Number.parseInt(String(v).trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);

      const [nombresContactos, nombresComerciales, nombresAdmins, numsPedido] = await Promise.all([
        this._getClientesNombresByIds(contactIds),
        this._getComercialesNombresByIds(comercialIds),
        this._getComercialesNombresByIds(adminIds),
        this._getPedidosNumsByIds(pedidoIds)
      ]);
      items.forEach((n) => {
        n.contacto_nombre = nombresContactos[Number(n.id_contacto)] ?? null;
        n.comercial_nombre = nombresComerciales[Number(n.id_comercial_solicitante)] ?? null;
        n.admin_nombre = nombresAdmins[Number(n.id_admin_resolvio)] ?? null;
        const pid = Number.parseInt(String(n.id_pedido ?? '').trim(), 10);
        n.pedido_num = Number.isFinite(pid) && pid > 0 ? (numsPedido[pid] ?? null) : null;
      });
      return items;
    } catch (e) {
      console.error('❌ Error listando notificaciones:', e?.message);
      return [];
    }
  },

  async getNotificacionesForComercial(idComercial, limit = 50, offset = 0) {
    const cid = Number.parseInt(String(idComercial ?? '').trim(), 10);
    if (!Number.isFinite(cid) || cid <= 0) return [];
    const l = Math.max(1, Math.min(100, Number(limit)));
    const o = Math.max(0, Number(offset));
    await this._ensureNotificacionesTable();
    try {
      const m = await this._ensureNotificacionesMeta();
      const sql = `SELECT n.\`${m.pk}\` as id, n.\`${m.colTipo}\` as tipo, n.\`${m.colContacto}\` as id_contacto, n.\`${m.colPedido}\` as id_pedido, n.\`${m.colComercial}\` as id_comercial_solicitante, n.\`${m.colEstado}\` as estado, n.\`${m.colAdmin}\` as id_admin_resolvio, n.\`${m.colFechaCreacion}\` as fecha_creacion, n.\`${m.colFechaResolucion}\` as fecha_resolucion, n.\`${m.colNotas}\` as notas
        FROM \`notificaciones\` n
        INNER JOIN (
          SELECT \`${m.colContacto}\` AS cid, \`${m.colPedido}\` AS pid, \`${m.colTipo}\` AS tipo, MAX(\`${m.pk}\`) AS max_id
          FROM \`notificaciones\`
          WHERE \`${m.colComercial}\` = ?
          GROUP BY \`${m.colContacto}\`, \`${m.colPedido}\`, \`${m.colTipo}\`
        ) latest ON n.\`${m.colContacto}\` = latest.cid AND (n.\`${m.colPedido}\` <=> latest.pid) AND n.\`${m.colTipo}\` = latest.tipo AND n.\`${m.pk}\` = latest.max_id
        WHERE n.\`${m.colComercial}\` = ?
        ORDER BY n.\`${m.colFechaCreacion}\` DESC
        LIMIT ${l} OFFSET ${o}`;
      const rows = await this.query(sql, [cid, cid]);
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
  },

  async getNotificacionesForComercialCount(idComercial) {
    const cid = Number.parseInt(String(idComercial ?? '').trim(), 10);
    if (!Number.isFinite(cid) || cid <= 0) return 0;
    await this._ensureNotificacionesTable();
    try {
      const m = await this._ensureNotificacionesMeta();
      const rows = await this.query(
        `SELECT COUNT(*) AS n FROM (
          SELECT 1 FROM \`notificaciones\`
          WHERE \`${m.colComercial}\` = ?
          GROUP BY \`${m.colContacto}\`, \`${m.colPedido}\`, \`${m.colTipo}\`
        ) AS dedup`,
        [cid]
      );
      const first = Array.isArray(rows) ? rows[0] : rows;
      return Number(first?.n ?? 0) || 0;
    } catch (_) {
      return 0;
    }
  },

  /** IDs de contactos con solicitud PENDIENTE del comercial (para icono naranja) */
  async getClienteIdsSolicitudPendienteComercial(idComercial) {
    const cid = Number.parseInt(String(idComercial ?? '').trim(), 10);
    if (!Number.isFinite(cid) || cid <= 0) return new Set();
    await this._ensureNotificacionesTable();
    try {
      const m = await this._ensureNotificacionesMeta();
      const rows = await this.query(
        `SELECT \`${m.colContacto}\` AS id_contacto FROM \`notificaciones\` WHERE \`${m.colComercial}\` = ? AND \`${m.colEstado}\` = 'pendiente' AND \`${m.colTipo}\` = 'asignacion_contacto'`,
        [cid]
      );
      const list = Array.isArray(rows) ? rows : [];
      return new Set(list.map((r) => Number(r.id_contacto ?? r.Id_Contacto ?? 0)).filter((n) => Number.isFinite(n) && n > 0));
    } catch (_) {
      return new Set();
    }
  },

  /** IDs de contactos con solicitud RECHAZADA del comercial (ocultar icono) */
  async getClienteIdsSolicitudRechazadaComercial(idComercial) {
    const cid = Number.parseInt(String(idComercial ?? '').trim(), 10);
    if (!Number.isFinite(cid) || cid <= 0) return new Set();
    await this._ensureNotificacionesTable();
    try {
      const m = await this._ensureNotificacionesMeta();
      const rows = await this.query(
        `SELECT \`${m.colContacto}\` AS id_contacto FROM \`notificaciones\` WHERE \`${m.colComercial}\` = ? AND \`${m.colEstado}\` = 'rechazada' AND \`${m.colTipo}\` = 'asignacion_contacto'`,
        [cid]
      );
      const list = Array.isArray(rows) ? rows : [];
      return new Set(list.map((r) => Number(r.id_contacto ?? r.Id_Contacto ?? 0)).filter((n) => Number.isFinite(n) && n > 0));
    } catch (_) {
      return new Set();
    }
  },

  async resolverSolicitudAsignacion(idNotif, idAdmin, aprobar) {
    await this._ensureNotificacionesTable();
    const m = await this._ensureNotificacionesMeta();
    const rows = await this.query(`SELECT \`${m.pk}\` as id, \`${m.colTipo}\` as tipo, \`${m.colContacto}\` as id_contacto, \`${m.colComercial}\` as id_comercial_solicitante, \`${m.colPedido}\` as id_pedido, \`${m.colEstado}\` as estado, \`${m.colAdmin}\` as id_admin_resolvio, \`${m.colFechaCreacion}\` as fecha_creacion, \`${m.colFechaResolucion}\` as fecha_resolucion, \`${m.colNotas}\` as notas FROM \`notificaciones\` WHERE \`${m.pk}\` = ? AND \`${m.colEstado}\` = ?`, [idNotif, 'pendiente']);
    if (!rows?.length) return { ok: false, message: 'Notificación no encontrada o ya resuelta' };
    const notif = rows[0];
    if (String(notif.tipo || '').toLowerCase() === 'aprobacion_sync_cliente') {
      return {
        ok: false,
        message: 'Las notificaciones de sincronización Holded se resuelven solo desde el enlace firmado del correo.'
      };
    }
    const ahora = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await this.query(
      `UPDATE \`notificaciones\` SET \`${m.colEstado}\` = ?, \`${m.colAdmin}\` = ?, \`${m.colFechaResolucion}\` = ? WHERE \`${m.pk}\` = ?`,
      [aprobar ? 'aprobada' : 'rechazada', idAdmin, ahora, idNotif]
    );
    if (String(notif.tipo || '').toLowerCase() === 'pedido_especial') {
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

    if (String(notif.tipo || '').toLowerCase() === 'aprobacion_pedido') {
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
        const colEstadoTxtPedido = meta.colEstado || pick(['EstadoPedido', 'estado_pedido', 'Estado', 'estado']);
        const colEstadoIdPedido = meta.colEstadoId || pick(['Id_EstadoPedido', 'id_estado_pedido', 'EstadoPedidoId', 'estado_pedido_id']);
        const colNumPedido = meta.colNumPedido || pick(['NumPedido', 'NumeroPedido', 'Numero_Pedido', 'num_pedido']);
        let pid = Number.parseInt(String(notif.id_pedido ?? '').trim(), 10);
        if (Number.isFinite(pid) && pid > 0) {
          resolvedPid = pid;
          const upd = {};
          const estadoTexto = aprobar ? 'Aprobado' : 'Denegado';
          const estadoCodigo = aprobar ? 'aprobado' : 'denegado';
          if (colEstadoTxtPedido) upd[colEstadoTxtPedido] = estadoTexto;
          if (colEstadoIdPedido) {
            const estId = await this.getEstadoPedidoIdByCodigo(estadoCodigo).catch(() => null);
            if (estId) upd[colEstadoIdPedido] = estId;
          }
          const keys = Object.keys(upd);
          if (keys.length) {
            const fields = keys.map((c) => `\`${c}\` = ?`).join(', ');
            const values = keys.map((c) => upd[c]);
            values.push(pid);
            await this.query(`UPDATE \`${meta.tPedidos}\` SET ${fields} WHERE \`${pk}\` = ?`, values);
          }
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
          resolvedComercialEmail = com?.Email ?? com?.email ?? com?.com_email ?? null;
        }
      } catch (_) {}

      return {
        ok: true,
        tipo: 'aprobacion_pedido',
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
    return {
      ok: true,
      tipo: 'asignacion_contacto',
      id_contacto: notif.id_contacto,
      id_comercial_solicitante: notif.id_comercial_solicitante
    };
  },

  /**
   * Borra una notificación por ID (solo admin).
   * @param {number} id - ID de la notificación
   * @returns {{ ok: boolean, deleted: number }}
   */
  async deleteNotificacionById(id) {
    const nid = Number.parseInt(String(id ?? '').trim(), 10);
    if (!Number.isFinite(nid) || nid <= 0) return { ok: false, deleted: 0 };
    await this._ensureNotificacionesTable();
    try {
      const m = await this._ensureNotificacionesMeta();
      const result = await this.query(`DELETE FROM \`notificaciones\` WHERE \`${m.pk}\` = ?`, [nid]);
      const deleted = result?.affectedRows ?? result ?? 0;
      return { ok: true, deleted: Number(deleted) };
    } catch (e) {
      console.error('❌ Error eliminando notificación:', e?.message);
      throw e;
    }
  },

  /**
   * Borra todo el historial de notificaciones (solo admin).
   * @returns {{ ok: boolean, deleted: number }}
   */
  async deleteAllNotificaciones() {
    await this._ensureNotificacionesTable();
    try {
      const result = await this.query('DELETE FROM `notificaciones`');
      const deleted = result?.affectedRows ?? result ?? 0;
      return { ok: true, deleted: Number(deleted) };
    } catch (e) {
      console.error('❌ Error borrando historial de notificaciones:', e?.message);
      throw e;
    }
  }
};
