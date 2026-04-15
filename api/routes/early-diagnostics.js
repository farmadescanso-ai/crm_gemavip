/**
 * Health básico, IP y debug-login (antes de sesión/vistas).
 */
function registerEarlyDiagnostics(app, deps) {
  const { db, getStoredPasswordFromRow, requireApiKeyIfConfigured } = deps;

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true, service: 'crm_gemavip', timestamp: new Date().toISOString() });
  });

  app.get('/health/ip', requireApiKeyIfConfigured, (req, res) => {
    res.json({
      ip: req.ip,
      ips: req.ips,
      xForwardedFor: req.headers['x-forwarded-for'],
      remoteAddress: req.socket?.remoteAddress
    });
  });

  app.get('/api/debug-login', async (req, res) => {
    const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL;
    const secret = process.env.DEBUG_LOGIN_SECRET;
    const providedSecret = String(req.query?.secret || '').trim();
    const debugEnabled = String(process.env.ENABLE_DEBUG_LOGIN || '').trim() === '1';
    const hasAccess =
      !isProd && debugEnabled && secret && secret.length >= 16 && secret === providedSecret;
    if (!hasAccess) {
      return res.status(404).json({ error: 'No disponible' });
    }
    const email = String(req.query?.email || '').trim();
    try {
      const dbNameEnv = process.env.DB_NAME || 'crm_gemavip';
      const actualDb = await db.query('SELECT DATABASE() AS db')
        .then((r) => r?.[0]?.db ?? null)
        .catch(() => null);
      const countAll = await db
        .query('SELECT COUNT(*) AS n FROM `comerciales`')
        .then((r) => r?.[0]?.n ?? null)
        .catch(() => null);
      const t = await db._resolveTableNameCaseInsensitive('comerciales');
      const cols = await db._getColumns(t);
      const colEmail = db._pickCIFromColumns(cols, ['com_email', 'Email', 'email']) || 'com_email';
      const colList = cols.length ? cols.map((c) => `\`${c}\``).join(', ') : '*';
      const rawRows = email
        ? await db.query(
            `SELECT ${colList} FROM \`${t}\` WHERE LOWER(TRIM(\`${colEmail}\`)) = LOWER(TRIM(?)) LIMIT 1`,
            [email]
          )
        : [];
      const comercial = Array.isArray(rawRows) && rawRows.length > 0 ? rawRows[0] : null;
      const stored = comercial ? getStoredPasswordFromRow(comercial) : '';
      const pwdCols = cols.filter((c) => /password|contraseña|pass|clave/i.test(String(c)));
      return res.json({
        ok: true,
        dbNameEnv,
        actualDb,
        countComerciales: countAll,
        tableName: t,
        columns: cols,
        colEmail,
        pwdColumns: pwdCols,
        testEmail: email || '(no proporcionado)',
        userFound: !!comercial,
        hasStoredPassword: stored.length > 0,
        storedPrefix: stored ? stored.substring(0, 10) + '...' : null,
        rowKeys: comercial ? Object.keys(comercial) : null
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err?.message,
        stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined
      });
    }
  });
}

module.exports = { registerEarlyDiagnostics };
