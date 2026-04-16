'use strict';

describe('db-pool-config timezone (mysql2)', () => {
  const orig = process.env.DB_TIMEZONE;

  afterEach(() => {
    if (orig === undefined) delete process.env.DB_TIMEZONE;
    else process.env.DB_TIMEZONE = orig;
    jest.resetModules();
  });

  test('por defecto usa local', () => {
    delete process.env.DB_TIMEZONE;
    jest.resetModules();
    const { getPoolConfig } = require('../../config/db-pool-config');
    expect(getPoolConfig().timezone).toBe('local');
  });

  test('Z y UTC', () => {
    process.env.DB_TIMEZONE = 'Z';
    jest.resetModules();
    expect(require('../../config/db-pool-config').getPoolConfig().timezone).toBe('Z');
    process.env.DB_TIMEZONE = 'UTC';
    jest.resetModules();
    expect(require('../../config/db-pool-config').getPoolConfig().timezone).toBe('Z');
  });

  test('acepta offset HH:MM', () => {
    process.env.DB_TIMEZONE = '+02:00';
    jest.resetModules();
    expect(require('../../config/db-pool-config').getPoolConfig().timezone).toBe('+02:00');
  });
});
