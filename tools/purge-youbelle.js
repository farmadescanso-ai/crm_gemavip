#!/usr/bin/env node
/**
 * Purga controlada de datos relacionados con "Youbelle" (o el término indicado).
 *
 * Objetivo:
 * - Ver (preview) qué registros se borrarían en tablas relacionadas (clientes, pedidos, pedidos_articulos, articulos, comisiones_detalle).
 * - Aplicar el borrado manteniendo integridad y evitando romper la app.
 *
 * Por defecto: SOLO PREVIEW (no modifica).
 *
 * Uso:
 *   node tools/purge-youbelle.js --term "Youbelle"
 *   node tools/purge-youbelle.js --term "Youbelle" --apply
 *
 * Modos de artículos:
 *   --apply                => borra pedidos+líneas Youbelle; artículos: borra SOLO si no están referenciados, si no -> los desactiva (Activo=0) si existe columna.
 *   --apply --hard-articulos => además elimina artículos (hard delete) y borra cualquier línea que los referencie (aunque sea de otros pedidos).
 */
/* eslint-disable no-console */
const mysql = require('mysql2/promise');
require('dotenv').config();

function parseArgs(argv) {
  const out = {
    term: 'Youbelle',
    apply: false,
    hardArticulos: false,
    limit: 50
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--term' && argv[i + 1]) out.term = String(argv[++i]);
    else if (a === '--apply') out.apply = true;
    else if (a === '--hard-articulos') out.hardArticulos = true;
    else if (a === '--limit' && argv[i + 1]) out.limit = Math.max(1, Math.min(500, Number(argv[++i]) || 50));
  }
  return out;
}

function pickCI(cols, candidates) {
  const set = new Set((cols || []).map((c) => String(c).toLowerCase()));
  for (const cand of candidates || []) {
    const key = String(cand).toLowerCase();
    if (set.has(key)) {
      const real = (cols || []).find((c) => String(c).toLowerCase() === key);
      return real || cand;
    }
  }
  return null;
}

async function tableExists(conn, name) {
  const [rows] = await conn.execute('SHOW TABLES LIKE ?', [name]);
  return Array.isArray(rows) && rows.length > 0;
}

async function resolveTableNameCaseInsensitive(conn, baseName) {
  const base = String(baseName || '').trim();
  if (!base) return baseName;
  const cap = base.charAt(0).toUpperCase() + base.slice(1);
  const upper = base.toUpperCase();
  const candidates = Array.from(new Set([base, cap, upper].filter(Boolean)));

  for (const cand of candidates) {
    try {
      // SHOW COLUMNS suele estar permitido incluso cuando information_schema no lo está.
      await conn.execute(`SHOW COLUMNS FROM \`${cand}\``);
      return cand;
    } catch (_) {
      // seguir probando
    }
  }

  // Fallback: si SHOW COLUMNS está restringido pero SELECT funciona
  for (const cand of candidates) {
    try {
      await conn.execute(`SELECT * FROM \`${cand}\` LIMIT 0`);
      return cand;
    } catch (_) {
      // seguir probando
    }
  }

  return base;
}

async function getColumns(conn, table) {
  const [rows] = await conn.execute(`SHOW COLUMNS FROM \`${table}\``);
  return (Array.isArray(rows) ? rows : [])
    .map((r) => String(r.Field || r.field || '').trim())
    .filter(Boolean);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function selectIds(conn, { sql, params = [], idCol = 'Id' }) {
  const [rows] = await conn.execute(sql, params);
  const ids = (Array.isArray(rows) ? rows : [])
    .map((r) => r?.[idCol])
    .filter((x) => x !== null && x !== undefined);
  return { rows: Array.isArray(rows) ? rows : [], ids };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const term = String(args.term || '').trim();
  if (!term) throw new Error('Falta --term');

  const dbCfg = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'crm_gemavip',
    charset: 'utf8mb4'
  };

  if (!dbCfg.host || !dbCfg.user || !dbCfg.database) {
    throw new Error('Faltan variables de entorno: DB_HOST/DB_USER/DB_NAME (y normalmente DB_PASSWORD).');
  }

  const conn = await mysql.createConnection(dbCfg);
  try {
    // Resolver nombres de tabla robustos (case-sensitive en Linux)
    const tClientes = await resolveTableNameCaseInsensitive(conn, 'clientes');
    const tPedidos = await resolveTableNameCaseInsensitive(conn, 'pedidos');
    const tPedArt = await resolveTableNameCaseInsensitive(conn, 'pedidos_articulos');
    const tArticulos = await resolveTableNameCaseInsensitive(conn, 'articulos');

    const hasCd = await tableExists(conn, 'comisiones_detalle')
      || await tableExists(conn, 'Comisiones_Detalle');
    const tComisionesDetalle = hasCd
      ? (await resolveTableNameCaseInsensitive(conn, 'comisiones_detalle'))
      : null;

    // Columnas meta
    const clientesCols = await getColumns(conn, tClientes);
    const clientesPk = pickCI(clientesCols, ['Id', 'id']) || 'Id';
    const clientesNombre = pickCI(clientesCols, ['Nombre_Razon_Social', 'Nombre', 'nombre', 'Razon_Social', 'RazonSocial']);
    const clientesNombreCial = pickCI(clientesCols, ['Nombre_Cial', 'Nombre_CIAL', 'nombre_cial']);

    const pedidosCols = await getColumns(conn, tPedidos);
    const pedidosPk = pickCI(pedidosCols, ['Id', 'id']) || 'Id';
    const pedidosColCliente = pickCI(pedidosCols, ['Id_Cliente', 'id_cliente', 'ClienteId', 'clienteId', 'cliente_id', 'Cliente_id']);
    const pedidosColNum = pickCI(pedidosCols, ['NumPedido', 'Numero_Pedido', 'numero_pedido', 'Número_Pedido', 'Número Pedido', 'NumeroPedido', 'numeroPedido']);

    const paCols = await getColumns(conn, tPedArt);
    const paPk = pickCI(paCols, ['Id', 'id']) || 'Id';
    const paColNum = pickCI(paCols, ['NumPedido', 'numPedido', 'NumeroPedido', 'numeroPedido', 'Numero_Pedido', 'Número_Pedido', 'Número Pedido']);
    const paColPedidoId = pickCI(paCols, ['PedidoId', 'pedidoId', 'Id_Pedido', 'id_pedido', 'pedido_id']);
    const paColPedidoIdNum = pickCI(paCols, ['Id_NumPedido', 'id_numpedido', 'id_num_pedido', 'PedidoIdNum', 'pedidoIdNum']);
    const paColArticulo = pickCI(paCols, ['Id_Articulo', 'id_articulo', 'ArticuloId', 'articuloId', 'IdArticulo', 'idArticulo', 'articulo_id']);

    const artCols = await getColumns(conn, tArticulos);
    const artPk = pickCI(artCols, ['Id', 'id']) || 'Id';
    const artColMarca = pickCI(artCols, ['Marca', 'marca']);
    const artColNombre = pickCI(artCols, ['Nombre', 'nombre']);
    const artColActivo = pickCI(artCols, ['Activo', 'activo']);

    const like = `%${term.toUpperCase()}%`;

    // 1) Clientes objetivo
    const clienteWhere = [];
    const clienteParams = [];
    if (clientesNombre) {
      clienteWhere.push(`UPPER(COALESCE(\`${clientesNombre}\`, '')) LIKE ?`);
      clienteParams.push(like);
    }
    if (clientesNombreCial) {
      clienteWhere.push(`UPPER(COALESCE(\`${clientesNombreCial}\`, '')) LIKE ?`);
      clienteParams.push(like);
    }
    const clientesSql = `
      SELECT *
      FROM \`${tClientes}\`
      ${clienteWhere.length ? `WHERE (${clienteWhere.join(' OR ')})` : ''}
      ORDER BY \`${clientesPk}\` DESC
      LIMIT ${Number(args.limit)}
    `;
    const clientesRes = await selectIds(conn, { sql: clientesSql, params: clienteParams, idCol: clientesPk });
    const clienteIds = Array.from(new Set(clientesRes.ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)));

    // 2) Pedidos del/los clientes
    let pedidosRes = { rows: [], ids: [] };
    let pedidoIds = [];
    let numPedidos = [];
    if (clienteIds.length && pedidosColCliente) {
      const ph = clienteIds.map(() => '?').join(',');
      const pedidosSql = `
        SELECT *
        FROM \`${tPedidos}\`
        WHERE \`${pedidosColCliente}\` IN (${ph})
        ORDER BY \`${pedidosPk}\` DESC
      `;
      pedidosRes = await selectIds(conn, { sql: pedidosSql, params: clienteIds, idCol: pedidosPk });
      pedidoIds = Array.from(new Set(pedidosRes.ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)));
      if (pedidosColNum) {
        numPedidos = Array.from(
          new Set(
            (pedidosRes.rows || [])
              .map((r) => r?.[pedidosColNum])
              .filter((x) => x !== null && x !== undefined && String(x).trim() !== '')
              .map((x) => String(x).trim())
          )
        );
      }
    }

    // 3) Líneas asociadas a pedidos (por cualquiera de las columnas disponibles)
    const lineasMatches = [];
    const lineasIds = new Set();
    async function fetchLineas(whereSql, params) {
      const sql = `SELECT * FROM \`${tPedArt}\` WHERE ${whereSql}`;
      const [rows] = await conn.execute(sql, params);
      for (const r of rows || []) {
        lineasMatches.push(r);
        if (r && r[paPk] != null) lineasIds.add(r[paPk]);
      }
    }

    if (pedidoIds.length && paColPedidoId) {
      for (const part of chunk(pedidoIds, 500)) {
        await fetchLineas(`\`${paColPedidoId}\` IN (${part.map(() => '?').join(',')})`, part);
      }
    }
    if (pedidoIds.length && paColPedidoIdNum) {
      for (const part of chunk(pedidoIds, 500)) {
        await fetchLineas(`\`${paColPedidoIdNum}\` IN (${part.map(() => '?').join(',')})`, part);
      }
    }
    if (numPedidos.length && paColNum) {
      for (const part of chunk(numPedidos, 300)) {
        await fetchLineas(`\`${paColNum}\` IN (${part.map(() => '?').join(',')})`, part);
      }
    }

    // 4) Artículos "Youbelle" (marca o nombre)
    const artWhere = [];
    const artParams = [];
    if (artColMarca) {
      artWhere.push(`UPPER(COALESCE(\`${artColMarca}\`, '')) LIKE ?`);
      artParams.push(like);
    }
    if (artColNombre) {
      artWhere.push(`UPPER(COALESCE(\`${artColNombre}\`, '')) LIKE ?`);
      artParams.push(like);
    }
    const articulosSql = `
      SELECT *
      FROM \`${tArticulos}\`
      ${artWhere.length ? `WHERE (${artWhere.join(' OR ')})` : ''}
      ORDER BY \`${artPk}\` DESC
    `;
    const articulosRes = await selectIds(conn, { sql: articulosSql, params: artParams, idCol: artPk });
    const articuloIds = Array.from(new Set(articulosRes.ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)));

    // 5) Líneas que referencian artículos Youbelle (para integridad)
    let lineasPorArticulos = [];
    if (articuloIds.length && paColArticulo) {
      const acc = [];
      for (const part of chunk(articuloIds, 500)) {
        const [rows] = await conn.execute(
          `SELECT * FROM \`${tPedArt}\` WHERE \`${paColArticulo}\` IN (${part.map(() => '?').join(',')})`,
          part
        );
        for (const r of rows || []) acc.push(r);
      }
      lineasPorArticulos = acc;
    }

    // 6) Comisiones detalle afectadas (si existe)
    let cdByPedidos = [];
    let cdByArticulos = [];
    let cdCols = null;
    let cdColPedido = null;
    let cdColArticulo = null;
    if (tComisionesDetalle) {
      cdCols = await getColumns(conn, tComisionesDetalle).catch(() => []);
      cdColPedido = pickCI(cdCols, ['pedido_id', 'PedidoId', 'pedidoId']);
      cdColArticulo = pickCI(cdCols, ['articulo_id', 'ArticuloId', 'articuloId']);
      if (pedidoIds.length && cdColPedido) {
        const acc = [];
        for (const part of chunk(pedidoIds, 500)) {
          const [rows] = await conn.execute(
            `SELECT * FROM \`${tComisionesDetalle}\` WHERE \`${cdColPedido}\` IN (${part.map(() => '?').join(',')})`,
            part
          );
          for (const r of rows || []) acc.push(r);
        }
        cdByPedidos = acc;
      }
      if (articuloIds.length && cdColArticulo) {
        const acc = [];
        for (const part of chunk(articuloIds, 500)) {
          const [rows] = await conn.execute(
            `SELECT * FROM \`${tComisionesDetalle}\` WHERE \`${cdColArticulo}\` IN (${part.map(() => '?').join(',')})`,
            part
          );
          for (const r of rows || []) acc.push(r);
        }
        cdByArticulos = acc;
      }
    }

    // ====== Preview ======
    console.log('== Purga Youbelle (PREVIEW) ==');
    console.log('Term:', term);
    console.log('DB:', `${dbCfg.host}:${dbCfg.port}/${dbCfg.database}`);
    console.log('Tablas:', { tClientes, tPedidos, tPedArt, tArticulos, tComisionesDetalle });
    console.log('Columnas detectadas:', {
      clientes: { pk: clientesPk, nombre: clientesNombre, nombre_cial: clientesNombreCial },
      pedidos: { pk: pedidosPk, colCliente: pedidosColCliente, colNumPedido: pedidosColNum },
      pedidos_articulos: { pk: paPk, colNumPedido: paColNum, colPedidoId: paColPedidoId, colPedidoIdNum: paColPedidoIdNum, colArticulo: paColArticulo },
      articulos: { pk: artPk, marca: artColMarca, nombre: artColNombre, activo: artColActivo },
      comisiones_detalle: tComisionesDetalle ? { colPedido: cdColPedido, colArticulo: cdColArticulo } : null
    });
    console.log('');
    console.log(`Clientes a afectar: ${clienteIds.length}`);
    if (clientesRes.rows.length) {
      console.log('Ejemplos clientes (primeros 5):', clientesRes.rows.slice(0, 5).map((r) => ({ [clientesPk]: r[clientesPk], nombre: clientesNombre ? r[clientesNombre] : null })));
    }
    console.log(`Pedidos a borrar: ${pedidoIds.length}`);
    console.log(`Líneas asociadas a esos pedidos: ${lineasIds.size}`);
    console.log(`Artículos identificados por término (candidatos): ${articuloIds.length}`);
    console.log(`Líneas que referencian esos artículos: ${lineasPorArticulos.length}`);
    if (tComisionesDetalle) {
      console.log(`Comisiones detalle por pedidos: ${cdByPedidos.length}`);
      console.log(`Comisiones detalle por artículos: ${cdByArticulos.length}`);
    }
    console.log('');

    if (!args.apply) {
      console.log('Modo PREVIEW: no se ha modificado nada. Usa --apply para ejecutar.');
      return;
    }

    // ====== Apply (en transacción) ======
    console.log('== Ejecutando purga (APPLY) ==');
    console.log('Modo artículos:', args.hardArticulos ? 'HARD DELETE (borra líneas que los referencien)' : 'CONSERVADOR (desactiva si está referenciado)');

    await conn.beginTransaction();
    try {
      // 0) Comisiones detalle (si existe)
      if (tComisionesDetalle) {
        if (cdColPedido && pedidoIds.length) {
          for (const part of chunk(pedidoIds, 500)) {
            await conn.execute(
              `DELETE FROM \`${tComisionesDetalle}\` WHERE \`${cdColPedido}\` IN (${part.map(() => '?').join(',')})`,
              part
            );
          }
        }
        if (cdColArticulo && articuloIds.length) {
          for (const part of chunk(articuloIds, 500)) {
            await conn.execute(
              `DELETE FROM \`${tComisionesDetalle}\` WHERE \`${cdColArticulo}\` IN (${part.map(() => '?').join(',')})`,
              part
            );
          }
        }
      }

      // 1) Líneas de pedidos (por pedido)
      if (pedidoIds.length && paColPedidoId) {
        for (const part of chunk(pedidoIds, 500)) {
          await conn.execute(
            `DELETE FROM \`${tPedArt}\` WHERE \`${paColPedidoId}\` IN (${part.map(() => '?').join(',')})`,
            part
          );
        }
      }
      if (pedidoIds.length && paColPedidoIdNum) {
        for (const part of chunk(pedidoIds, 500)) {
          await conn.execute(
            `DELETE FROM \`${tPedArt}\` WHERE \`${paColPedidoIdNum}\` IN (${part.map(() => '?').join(',')})`,
            part
          );
        }
      }
      if (numPedidos.length && paColNum) {
        for (const part of chunk(numPedidos, 300)) {
          await conn.execute(
            `DELETE FROM \`${tPedArt}\` WHERE \`${paColNum}\` IN (${part.map(() => '?').join(',')})`,
            part
          );
        }
      }

      // 2) Borrar pedidos
      if (pedidoIds.length) {
        for (const part of chunk(pedidoIds, 500)) {
          await conn.execute(
            `DELETE FROM \`${tPedidos}\` WHERE \`${pedidosPk}\` IN (${part.map(() => '?').join(',')})`,
            part
          );
        }
      }

      // 3) Artículos
      if (articuloIds.length) {
        if (args.hardArticulos) {
          // Asegurar que no quedan líneas referenciando esos artículos
          if (paColArticulo) {
            for (const part of chunk(articuloIds, 500)) {
              await conn.execute(
                `DELETE FROM \`${tPedArt}\` WHERE \`${paColArticulo}\` IN (${part.map(() => '?').join(',')})`,
                part
              );
            }
          }
          for (const part of chunk(articuloIds, 500)) {
            await conn.execute(
              `DELETE FROM \`${tArticulos}\` WHERE \`${artPk}\` IN (${part.map(() => '?').join(',')})`,
              part
            );
          }
        } else {
          // Conservador: borrar solo artículos no referenciados; si lo están, desactivar si es posible.
          let referenced = new Set();
          if (paColArticulo) {
            for (const part of chunk(articuloIds, 500)) {
              const [rows] = await conn.execute(
                `SELECT DISTINCT \`${paColArticulo}\` AS aid FROM \`${tPedArt}\` WHERE \`${paColArticulo}\` IN (${part.map(() => '?').join(',')})`,
                part
              );
              for (const r of rows || []) {
                const n = Number(r?.aid);
                if (Number.isFinite(n) && n > 0) referenced.add(n);
              }
            }
          }
          const toDelete = articuloIds.filter((id) => !referenced.has(id));
          const toDisable = articuloIds.filter((id) => referenced.has(id));

          if (toDelete.length) {
            for (const part of chunk(toDelete, 500)) {
              await conn.execute(
                `DELETE FROM \`${tArticulos}\` WHERE \`${artPk}\` IN (${part.map(() => '?').join(',')})`,
                part
              );
            }
          }
          if (toDisable.length) {
            if (artColActivo) {
              for (const part of chunk(toDisable, 500)) {
                await conn.execute(
                  `UPDATE \`${tArticulos}\` SET \`${artColActivo}\` = 0 WHERE \`${artPk}\` IN (${part.map(() => '?').join(',')})`,
                  part
                );
              }
            } else {
              console.warn('⚠️ No existe columna Activo/activo en articulos; no se pueden desactivar. Se han dejado intactos los artículos referenciados.');
            }
          }
          console.log(`Artículos borrados (no referenciados): ${toDelete.length}`);
          console.log(`Artículos desactivados (referenciados): ${toDisable.length}`);
        }
      }

      await conn.commit();
      console.log('✅ Purga completada y confirmada (COMMIT).');
    } catch (e) {
      await conn.rollback();
      console.error('❌ Error durante purga, se hizo ROLLBACK.');
      throw e;
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exitCode = 1;
});

