/**
 * Pool MySQL compartido + sesión express-mysql-session.
 */
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const mysql = require('mysql2/promise');
const { getPoolConfig } = require('../config/db-pool-config');

/**
 * @param {import('express').Application} app
 * @param {{ db: object, comisionesCrm: object }} deps
 */
function setupSharedPoolAndSession(app, deps) {
  const { db, comisionesCrm } = deps;

  const idleMinutesRaw = process.env.SESSION_IDLE_TIMEOUT_MINUTES;
  const idleMinutes = Number(idleMinutesRaw || 60);
  const sessionMaxAgeDays = Number(process.env.SESSION_MAX_AGE_DAYS || 30);
  const sessionMaxAgeMs = Number.isFinite(idleMinutes)
    ? Math.max(5, idleMinutes) * 60 * 1000
    : Number.isFinite(sessionMaxAgeDays)
      ? Math.max(1, sessionMaxAgeDays) * 24 * 60 * 60 * 1000
      : 60 * 60 * 1000;

  const sharedPool = mysql.createPool(getPoolConfig());
  db.setSharedPool(sharedPool);
  comisionesCrm.setSharedPool(sharedPool);

  const sessionCheckExpirationMs = Number(process.env.SESSION_CHECK_EXPIRATION_MS) || 900000;
  const MySQLStore = MySQLStoreFactory(session);
  const sessionStore = new MySQLStore(
    {
      createDatabaseTable: true,
      expiration: sessionMaxAgeMs,
      clearExpired: true,
      checkExpirationInterval: sessionCheckExpirationMs
    },
    sharedPool
  );

  const sessionSecret =
    process.env.SESSION_SECRET ||
    (process.env.NODE_ENV === 'production' || process.env.VERCEL ? null : 'dev-secret-change-me');
  if (!sessionSecret && (process.env.NODE_ENV === 'production' || process.env.VERCEL)) {
    console.error('SESSION_SECRET debe estar definido en producción. Configúralo en las variables de entorno.');
    process.exit(1);
  }

  app.use(
    session({
      name: 'crm_session',
      secret: sessionSecret || 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: sessionMaxAgeMs
      }
    })
  );

  if (process.env.FIX_NOTIF_FK_ON_STARTUP === '1') {
    db.fixNotifFkCliente()
      .then((r) => {
        console.log(
          '[FIX] notif FK:',
          r.dropped ? 'fk_notif_ag eliminada' : '',
          r.added ? 'fk_notif_cli añadida' : ''
        );
      })
      .catch((e) => console.warn('[FIX] notif FK:', e?.message));
  }

  return { sharedPool, sessionMaxAgeMs };
}

module.exports = { setupSharedPoolAndSession };
