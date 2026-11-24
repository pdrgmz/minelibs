import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { env } from './config';
import { prisma } from './db';
import { HttpError, toHttpError } from './errors';
import { adminRoutes } from './routes/admin';
import { assetRoutes } from './routes/assets';
import { backupRoutes } from './routes/backup';
import { authRoutes } from './routes/auth';
import { collectionRoutes } from './routes/collections';
import { healthRoutes } from './routes/health';
import { schematicRoutes } from './routes/schematics';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    ...(env.TRUST_PROXY ? { trustProxy: true } : {}),
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 1000, timeWindow: '1 minute' });
  await app.register(multipart, {
    limits: {
      fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024,
      files: 2,
      fields: 30,
    },
  });

  app.setErrorHandler((error, _request, reply) => {
    const httpError = toHttpError(error);
    if (httpError.statusCode >= 500) app.log.error(error);
    const body: Record<string, unknown> = { error: httpError.code ?? 'ERROR', message: httpError.message };
    if (httpError.details !== undefined) body.details = httpError.details;
    return reply.code(httpError.statusCode).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ruta no encontrada' });
  });

  app.get('/', async () => ({ name: 'minelibs', version: '0.1.0' }));
  await app.register(healthRoutes);
  await app.register(assetRoutes);

  await app.register(async (api) => {
    await api.register(authRoutes);
    await api.register(backupRoutes);
    await api.register(collectionRoutes);
    await api.register(schematicRoutes);
    await api.register(adminRoutes);
  }, { prefix: '/api/v1' });

  // Seed del admin en arranque (idempotente). En producción se puede ejecutar también con `npm run seed`.
  if (env.NODE_ENV !== 'test') {
    const existing = await prisma.user.findUnique({ where: { username: env.ADMIN_USERNAME } });
    if (!existing) {
      await prisma.user.create({
        data: {
          username: env.ADMIN_USERNAME,
          passwordHash: await argon2.hash(env.ADMIN_PASSWORD, { type: argon2.argon2id }),
          role: 'ADMIN',
        },
      });
      app.log.info(`Administrador ${env.ADMIN_USERNAME} creado`);
    }
  }

  return app;
}

export { HttpError };
