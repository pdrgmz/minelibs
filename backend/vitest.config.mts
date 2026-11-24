import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const testData = path.join(tmpdir(), 'minelibs-tests');

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    // Cada subida lanza un worker_thread de parseo; en CI puede superar los 5 s por defecto.
    testTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./dev.db',
      JWT_SECRET: 'test-secret-con-al-menos-16-caracteres',
      STORAGE_DIR: path.join(testData, 'schematics'),
      THUMBNAILS_DIR: path.join(testData, 'thumbnails'),
      ASSETS_DIR: path.join(testData, 'assets'),
      REGISTRATION_ENABLED: 'true',
      RATE_LIMIT_AUTH_MAX: '500',
      ADMIN_USERNAME: 'admintest',
      ADMIN_PASSWORD: 'admin-pass-test-123',
    },
  },
});
