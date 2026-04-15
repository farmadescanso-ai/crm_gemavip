/** Evita warnings de SESSION_SECRET al cargar la app en tests. */
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'jest-session-secret-do-not-use-in-production-32b';
}
