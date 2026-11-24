import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  TRUST_PROXY: booleanFromString.default('false' as never),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  JWT_ACCESS_MINUTES: z.coerce.number().int().positive().default(15),
  JWT_REFRESH_DAYS: z.coerce.number().int().positive().default(7),
  ADMIN_USERNAME: z.string().min(3).default('admin'),
  ADMIN_PASSWORD: z.string().min(10).default('cambiar-esta-contrasena'),
  REGISTRATION_ENABLED: booleanFromString.default('true' as never),
  MAX_SCHEMATICS_PER_USER: z.coerce.number().int().positive().default(200),
  MAX_STORAGE_MB_PER_USER: z.coerce.number().int().positive().default(1024),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_AUTH_WINDOW_MINUTES: z.coerce.number().int().positive().default(1),
  MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(25),
  MAX_DECOMPRESSED_MB: z.coerce.number().int().positive().default(256),
  MAX_DIMENSION: z.coerce.number().int().positive().default(4096),
  MAX_BLOCKS: z.coerce.number().int().positive().default(10_000_000),
  STORAGE_DIR: z.string().min(1).default('./data/schematics'),
  ASSETS_DIR: z.string().min(1).default('./data/assets'),
  THUMBNAILS_DIR: z.string().min(1).default('./data/thumbnails'),
  DEFAULT_MC_VERSION: z.string().min(1).default('1.21.4'),
  ASSETS_UPSTREAM_URL: z.string().url().default('https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets'),
  ASSETS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  ASSETS_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  ASSETS_MAX_FILE_MB: z.coerce.number().int().positive().default(16),
  MAX_IMPORT_ZIP_MB: z.coerce.number().int().positive().default(512),
  MAX_IMPORT_ENTRIES: z.coerce.number().int().positive().default(2000),
  MAX_MANIFEST_KB: z.coerce.number().int().positive().default(2048),
});

export const env = EnvSchema.parse(process.env);
export type Env = typeof env;
