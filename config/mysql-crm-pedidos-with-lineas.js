'use strict';

module.exports = async function(id, pedidoPayload, lineasPayload, options = {}) {
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
  };