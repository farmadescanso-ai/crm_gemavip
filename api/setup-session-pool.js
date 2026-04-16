/**
 * Pool MySQL compartido + sesión express-mysql-session.
 */
const crypto = require('crypto');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const mysql = require('mysql2/promise');
const { getPoolConfig } = require('../config/db-pool-config');

function resolveSessionSecret() {
  const raw = process.env.SESSION_SECRET;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed) return trimmed;

  const isProdLike =
    process.env.NODE_ENV === 'production' ||
    String(process.env.VERCEL || '').trim() === '1' ||
    Boolean(process.env.VERCEL);

  if (isProdLike) {
    console.error('SESSION_SECRET debe estar definido en producción. Configúralo en las variables de entorno.');
    process.exit(1);
  }

  const dev = process.env.DEV_SESSION_SECRET;
  const devTrim = typeof dev === 'string' ? dev.trim() : '';
  if (devTrim) return devTrim;

  console.warn(
    '[crm] SESSION_SECRET no definido: usando secreto efímero de desarrollo (las sesiones no sobreviven al reinicio). ' +
      'Define SESSION_SECRET o DEV_SESSION_SECRET en .env para un valor estable en local.'
  );
  return crypto.randomBytes(48).toString('base64url');
}

function resolveCookieSameSite() {
  const raw = process.env.SESSION_COOKIE_SAMESITE;
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!v) return 'lax';
  if (v === 'lax' || v === 'strict' || v === 'none') return v;
  console.warn('[crm] SESSION_COOKIE_SAMESITE inválido; usando lax');
  return 'lax';
}

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

  const sessionSecret = resolveSessionSecret();
  const sameSite = resolveCookieSameSite();
  const secureBase = process.env.NODE_ENV === 'production';
  const secure = sameSite === 'none' ? true : secureBase;

  app.use(
    session({
      name: 'crm_session',
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        sameSite,
        secure,
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
