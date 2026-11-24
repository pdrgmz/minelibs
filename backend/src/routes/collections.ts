import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/guards';
import { prisma } from '../db';
import { HttpError } from '../errors';

const CollectionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).nullish(),
});

export async function collectionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/collections', async (request) => {
    return prisma.collection.findMany({
      where: { userId: request.user!.id },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.post('/collections', async (request, reply) => {
    const body = CollectionSchema.parse(request.body);
    const collection = await prisma.collection.create({
      data: { ...body, description: body.description ?? null, userId: request.user!.id },
    });
    return reply.code(201).send(collection);
  });

  app.patch('/collections/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = CollectionSchema.partial().parse(request.body);
    const existing = await prisma.collection.findFirst({ where: { id, userId: request.user!.id } });
    if (!existing) throw new HttpError(404, 'Colección no encontrada', 'NOT_FOUND');
    return prisma.collection.update({ where: { id }, data: body });
  });

  app.delete('/collections/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await prisma.collection.deleteMany({ where: { id, userId: request.user!.id } });
    if (result.count === 0) throw new HttpError(404, 'Colección no encontrada', 'NOT_FOUND');
    return reply.code(204).send();
  });
}
