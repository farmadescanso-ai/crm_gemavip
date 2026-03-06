/**
 * Normaliza contactos con datos españoles:
 * 1. Si tienen CP español (5 dígitos) o provincia española → país = España
 * 2. Si no tienen CP pero tienen provincia española y población → rellenar CP desde codigos_postales
 *
 * Ejecutar: node scripts/normalizar-clientes-espana.js
 * Opción --dry-run: solo muestra qué se haría, sin modificar
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'config', 'mysql-crm.js'));

const DRY_RUN = process.argv.includes('--dry-run');

const CP_ESPANA_REGEX = /^[0-5][0-9]{4}$/;

function isCpEspanol(cp) {
  if (!cp || typeof cp !== 'string') return false;
  const limpio = String(cp).trim().replace(/\s/g, '');
  return CP_ESPANA_REGEX.test(limpio);
}

async function run() {
  try {
    const meta = await db._ensureClientesMeta();
    const tClientes = meta?.tClientes || 'clientes';
    const pk = meta?.pk || 'cli_id';
    const colCp = meta?.cols?.find((c) => /codigo_postal|codigopostal/i.test(c)) || 'cli_codigo_postal';
    const colProv = meta?.cols?.find((c) => /prov_id|provincia/i.test(c)) || 'cli_prov_id';
    const colPoblacion = meta?.cols?.find((c) => /poblacion/i.test(c)) || 'cli_poblacion';
    const colPais = meta?.cols?.find((c) => /pais_id|id_pais/i.test(c)) || 'cli_pais_id';
    const colCodPais = meta?.cols?.find((c) => /codpais|cod_pais/i.test(c)) || null;
    const colPaisTxt = meta?.cols?.find((c) => /cli_pais/i.test(c) && !/cli_pais_id/i.test(c)) || meta?.cols?.find((c) => /^pais$/i.test(c) && !/pais_id|codpais/i.test(c)) || null;

    const espana = await db.getPaisByCodigoISO('ES');
    if (!espana) {
      console.error('No se encontró España en la tabla paises.');
      process.exit(1);
    }
    const espanaId = espana.pais_id ?? espana.id ?? espana.Id;
    const espanaNombre = espana.pais_nombre ?? espana.Nombre_pais ?? 'España';

    const [provincias, clientes] = await Promise.all([
      db.getProvincias(),
      db.query(`SELECT \`${pk}\`, \`${colCp}\`, \`${colProv}\`, \`${colPoblacion}\`, \`${colPais}\` FROM \`${tClientes}\``)
    ]);

    const provById = new Map((provincias || []).map((p) => [Number(p.prov_id ?? p.id ?? p.Id ?? 0), p]));
    const provEspanola = (p) => {
      const prov = provById.get(Number(p));
      if (!prov) return false;
      const cod = String(prov.prov_codigo_pais ?? prov.CodigoPais ?? '').trim().toUpperCase();
      return cod === 'ES';
    };

    let actualizadosPais = 0;
    let actualizadosCp = 0;
    let errores = 0;

    for (const c of clientes || []) {
      const id = c[pk] ?? c.Id ?? c.id;
      if (id == null) continue;

      const cp = String(c[colCp] ?? '').trim();
      const provId = c[colProv];
      const poblacion = String(c[colPoblacion] ?? '').trim();
      const paisId = c[colPais];

      const cpEsp = isCpEspanol(cp);
      const provEsp = provEspanola(provId);
      const necesitaEspana = (cpEsp || provEsp) && paisId !== espanaId && (paisId == null || paisId === '' || Number(paisId) !== Number(espanaId));

      const updates = [];
      const params = [];

      if (necesitaEspana) {
        updates.push(`\`${colPais}\` = ?`);
        params.push(espanaId);
        if (colCodPais) {
          updates.push(`\`${colCodPais}\` = ?`);
          params.push('ES');
        }
        if (colPaisTxt) {
          updates.push(`\`${colPaisTxt}\` = ?`);
          params.push(espanaNombre);
        }
        actualizadosPais++;
      }

      let cpNuevo = null;
      if (!cp && provEsp && poblacion && db.getCodigosPostales) {
        try {
          const cps = await db.getCodigosPostales({ idProvincia: provId, localidad: poblacion, limit: 1 });
          const cpRow = cps?.[0];
          const cpCol = cpRow?.codpos_CodigoPostal ?? cpRow?.CodigoPostal ?? cpRow?.codigo_postal;
          if (cpCol) {
            cpNuevo = String(cpCol).trim().slice(0, 8);
            updates.push(`\`${colCp}\` = ?`);
            params.push(cpNuevo);
            actualizadosCp++;
          }
        } catch (_) {}
      }

      if (updates.length > 0) {
        if (DRY_RUN) {
          console.log(`  [DRY-RUN] ${id}: ${necesitaEspana ? 'país→España ' : ''}${cpNuevo ? 'CP→' + cpNuevo + ' ' : ''}`);
        } else {
          try {
            params.push(id);
            await db.query(`UPDATE \`${tClientes}\` SET ${updates.join(', ')} WHERE \`${pk}\` = ?`, params);
            if ((actualizadosPais + actualizadosCp) <= 10 || (actualizadosPais + actualizadosCp) % 100 === 0) {
              console.log(`  ${id}: ${necesitaEspana ? 'país→España ' : ''}${cpNuevo ? 'CP→' + cpNuevo : ''}`);
            }
          } catch (e) {
            errores++;
            console.error(`  Error id ${id}:`, e.message || e);
          }
        }
      }
    }

    console.log('');
    if (DRY_RUN) {
      console.log('Resumen (DRY-RUN): %d con país→España, %d con CP rellenado.', actualizadosPais, actualizadosCp);
    } else {
      console.log('Resumen: %d país→España, %d CP rellenados, %d errores.', actualizadosPais, actualizadosCp, errores);
    }
  } catch (e) {
    console.error('Error:', e.message || e);
    process.exit(1);
  } finally {
    if (db.pool) await db.pool.end?.().catch(() => {});
  }
}

run();
