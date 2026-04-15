/**
 * Endpoints JSON auxiliares (CP→provincia, banco, email admin, sw.js, raíz /).
 */
const path = require('path');

function registerJsonHelperRoutes(app, deps) {
  const { db, getQueryParam, requireLoginJson, requireAdmin } = deps;

  app.get('/api/provincia-by-cp', requireLoginJson, async (req, res) => {
    try {
      const cp = String(getQueryParam(req, 'cp') || '')
        .trim()
        .replace(/\s+/g, '');
      if (!cp || cp.length < 2) {
        return res.json({
          ok: true,
          provinciaId: null,
          provinciaNombre: null,
          paisId: null,
          paisNombre: null,
          poblacion: null,
          paisCodigo: null
        });
      }
      let provinciaId = null;
      let provinciaNombre = null;
      let paisId = null;
      let paisNombre = null;
      let respPaisCodigo = null;
      let poblacion = null;
      const codigosTable = await db._getCodigosPostalesTableName?.().catch(() => null);
      const provTable = await db._resolveTableNameCaseInsensitive?.('provincias').catch(() => 'provincias');
      const paisesTable = await db._resolveTableNameCaseInsensitive?.('paises').catch(() => 'paises');
      const provCols = await db._getColumns?.(provTable).catch(() => []);
      const paisesCols = await db._getColumns?.(paisesTable).catch(() => []);
      const provPk = db._pickCIFromColumns?.(provCols, ['prov_id', 'id', 'Id']) || 'prov_id';
      const provNombre = db._pickCIFromColumns?.(provCols, ['prov_nombre', 'Nombre', 'nombre']) || 'prov_nombre';
      const provCodigoPais = db._pickCIFromColumns?.(provCols, [
        'prov_codigo_pais',
        'prov_codpais',
        'CodigoPais',
        'codigo_pais'
      ]);
      const paisPk = db._pickCIFromColumns?.(paisesCols, ['pais_id', 'id', 'Id']) || 'pais_id';
      const paisCodigo =
        db._pickCIFromColumns?.(paisesCols, ['pais_codigo', 'Id_pais', 'id_pais', 'Codigo']) || 'pais_codigo';
      const paisNombreCol =
        db._pickCIFromColumns?.(paisesCols, ['pais_nombre', 'Nombre_pais', 'Nombre', 'nombre']) || 'pais_nombre';
      if (codigosTable && provPk) {
        const cpCols = await db._getColumns?.(codigosTable).catch(() => []);
        const cpIdProv =
          db._pickCIFromColumns?.(cpCols, ['codpos_Id_Provincia', 'Id_Provincia', 'id_Provincia']) ||
          'codpos_Id_Provincia';
        const cpCodigo =
          db._pickCIFromColumns?.(cpCols, ['codpos_CodigoPostal', 'CodigoPostal', 'codigo_postal']) ||
          'codpos_CodigoPostal';
        const cpLocalidad =
          db._pickCIFromColumns?.(cpCols, ['codpos_Localidad', 'Localidad', 'localidad']) || 'codpos_Localidad';
        const joinCond = `cp.\`${cpIdProv}\` = p.\`${provPk}\``;
        let sql = `SELECT cp.\`${cpIdProv}\` AS Id_Provincia, cp.\`${cpLocalidad}\` AS Localidad, p.\`${provPk}\` AS prov_pk, p.\`${provNombre}\` AS NombreProvincia`;
        const joinPais =
          paisesTable && provCodigoPais && paisCodigo
            ? ` LEFT JOIN \`${paisesTable}\` pa ON (p.\`${provCodigoPais}\` = pa.\`${paisCodigo}\` OR UPPER(TRIM(p.\`${provCodigoPais}\`)) = UPPER(TRIM(pa.\`${paisCodigo}\`)))`
            : '';
        if (joinPais) sql += `, pa.\`${paisPk}\` AS pais_pk, pa.\`${paisNombreCol}\` AS NombrePais, pa.\`${paisCodigo}\` AS pais_codigo`;
        sql += ` FROM \`${codigosTable}\` cp LEFT JOIN \`${provTable}\` p ON ${joinCond}${joinPais} WHERE TRIM(cp.\`${cpCodigo}\`) = ? LIMIT 1`;
        const rows = await db.query(sql, [cp]).catch(() => []);
        const r = rows?.[0];
        if (r) {
          provinciaId = r.Id_Provincia ?? r.prov_pk ?? null;
          provinciaNombre = r.NombreProvincia ?? null;
          paisId = r.pais_pk ?? null;
          paisNombre = r.NombrePais ?? null;
          respPaisCodigo = r.pais_codigo ? String(r.pais_codigo).trim().toUpperCase() : paisId ? 'ES' : null;
          const loc = r.Localidad;
          poblacion = loc != null && String(loc).trim() ? String(loc).trim() : null;
        }
      }
      if (!provinciaId && /^[0-9]{5}$/.test(cp)) {
        const prefix = cp.substring(0, 2);
        const prefixNum = parseInt(prefix, 10);
        const provincias = await db.getProvincias?.().catch(() => []);
        const prov = (provincias || []).find((p) => {
          const esEspana =
            String(p?.CodigoPais ?? p?.prov_codigo_pais ?? p?.codigo_pais ?? 'ES')
              .trim()
              .toUpperCase() === 'ES';
          if (!esEspana) return false;
          const cod = String(p?.Codigo ?? p?.codigo ?? p?.prov_codigo ?? '').trim();
          const codNorm = cod ? String(cod).padStart(2, '0') : '';
          const provId = p?.prov_id ?? p?.id ?? p?.Id;
          return cod === prefix || codNorm === prefix || (provId != null && Number(provId) === prefixNum);
        });
        if (prov) {
          provinciaId = prov.id ?? prov.Id ?? prov.prov_id ?? null;
          provinciaNombre = prov.Nombre ?? prov.nombre ?? null;
          const codPais = String(prov.CodigoPais ?? prov.prov_codigo_pais ?? prov.codigo_pais ?? 'ES')
            .trim()
            .toUpperCase();
          respPaisCodigo = codPais || 'ES';
          if (codPais) {
            const pais = await db.getPaisByCodigoISO?.(codPais).catch(() => null);
            if (pais) {
              paisId = pais.pais_id ?? pais.id ?? pais.Id ?? null;
              paisNombre = pais.pais_nombre ?? pais.Nombre_pais ?? pais.Nombre ?? null;
            }
          }
        }
      }
      return res.json({
        ok: true,
        provinciaId,
        provinciaNombre,
        paisId,
        paisNombre,
        poblacion,
        paisCodigo: respPaisCodigo || (paisId ? 'ES' : null)
      });
    } catch (e) {
      return res.json({
        ok: true,
        provinciaId: null,
        provinciaNombre: null,
        paisId: null,
        paisNombre: null,
        poblacion: null,
        paisCodigo: null
      });
    }
  });

  /**
   * @openapi
   * /api/banco-por-entidad:
   *   get:
   *     tags:
   *       - DB
   *     summary: Nombre y BIC/SWIFT por código de entidad bancaria (4 dígitos, IBAN ES)
   */
  app.get('/api/banco-por-entidad', requireLoginJson, async (req, res) => {
    try {
      const ent = String(getQueryParam(req, 'entidad') || '')
        .trim()
        .replace(/\D/g, '');
      if (!/^[0-9]{4}$/.test(ent)) {
        return res.json({ ok: false, bancoNombre: null, swiftBic: null });
      }
      const table = await db._resolveTableNameCaseInsensitive?.('bancos').catch(() => 'bancos');
      const rows = await db
        .query(
          `SELECT banco_nombre, banco_swift_bic FROM \`${table}\` WHERE TRIM(banco_entidad) = ? LIMIT 1`,
          [ent]
        )
        .catch(() => []);
      const r = rows?.[0];
      if (!r) return res.json({ ok: false, bancoNombre: null, swiftBic: null });
      const nombre = r.banco_nombre != null ? String(r.banco_nombre).trim() : '';
      const swift = r.banco_swift_bic != null ? String(r.banco_swift_bic).trim() : '';
      return res.json({
        ok: true,
        bancoNombre: nombre || null,
        swiftBic: swift || null
      });
    } catch (_e) {
      return res.json({ ok: false, bancoNombre: null, swiftBic: null });
    }
  });

  app.get('/favicon.ico', (_req, res) => {
    res.redirect(302, '/assets/images/gemavip-logo.svg');
  });

  app.get('/api/email-status', requireAdmin, async (req, res) => {
    try {
      const { getSmtpStatus, getGraphStatus } = require('../../lib/mailer');
      const [smtp, graph] = await Promise.all([getSmtpStatus(), getGraphStatus()]);
      return res.json({
        smtpConfigured: smtp.configured,
        graphConfigured: graph.configured,
        emailReady: smtp.configured || graph.configured,
        smtp: { hasHost: smtp.hasHost, hasUser: smtp.hasUser, hasPass: smtp.hasPass, port: smtp.port },
        graph: {
          hasTenant: graph.hasTenant,
          hasClientId: graph.hasClientId,
          hasSecret: graph.hasSecret,
          hasSender: graph.hasSender
        }
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message });
    }
  });

  app.get('/api/email-test', requireAdmin, async (req, res) => {
    try {
      const to = String(req.query?.to || req.session?.user?.email || '').trim();
      if (!to) {
        return res.status(400).json({ error: 'Indica ?to=tu@email.com o inicia sesión con un email' });
      }
      const { sendTestEmail } = require('../../lib/mailer');
      const result = await sendTestEmail(to);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: e?.message });
    }
  });

  app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'sw.js'));
  });
}

module.exports = { registerJsonHelperRoutes };
