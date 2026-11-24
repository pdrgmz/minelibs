import { mkdir } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { env } from '../config';
import { prisma } from '../db';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    let db = 'error';
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = 'ok';
    } catch {
      // Se reporta el estado, no se lanza: el healthcheck decide.
    }

    let assets = 'error';
    try {
      await mkdir(env.ASSETS_DIR, { recursive: true });
      assets = 'ok';
    } catch {
      // Se reporta el estado, no se lanza.
    }

    const status = db === 'ok' && assets === 'ok' ? 'ok' : 'degraded';
    return { status, db, assets };
  });
}
