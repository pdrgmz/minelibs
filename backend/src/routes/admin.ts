import { unlink } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { requireAdmin } from '../auth/guards';
import { revokeAllRefreshTokens } from '../auth/tokens';
import { prisma } from '../db';
import { HttpError } from '../errors';
import { storedSchematicPath, thumbnailPath } from '../storage';

const CreateUserSchema = z.object({
  username: z.string().regex(/^[a-z0-9_-]{3,32}$/),
  password: z.string().min(10).max(128),
  role: z.enum(['USER', 'ADMIN']).default('USER'),
});

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/users', async (request) => {
    const query = PaginationSchema.parse(request.query);
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, username: true, role: true, createdAt: true },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count(),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  });

  app.post('/admin/users', async (request, reply) => {
    const body = CreateUserSchema.parse(request.body);
    const existing = await prisma.user.findUnique({ where: { username: body.username } });
    if (existing) throw new HttpError(409, 'Ese nombre de usuario ya está en uso', 'USERNAME_TAKEN');
    const user = await prisma.user.create({
      data: { username: body.username, role: body.role, passwordHash: await argon2.hash(body.password, { type: argon2.argon2id }) },
      select: { id: true, username: true, role: true, createdAt: true },
    });
    return reply.code(201).send(user);
  });

  app.patch('/admin/users/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      role: z.enum(['USER', 'ADMIN']).optional(),
      password: z.string().min(10).max(128).optional(),
    }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new HttpError(404, 'Usuario no encontrado', 'NOT_FOUND');
    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(body.role ? { role: body.role } : {}),
        ...(body.password ? { passwordHash: await argon2.hash(body.password, { type: argon2.argon2id }) } : {}),
      },
      select: { id: true, username: true, role: true, createdAt: true },
    });
    // Un reset de contraseña admin invalida todas las sesiones del usuario.
    if (body.password) await revokeAllRefreshTokens(id);
    return updated;
  });

  app.delete('/admin/users/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (id === request.user!.id) throw new HttpError(400, 'Un admin no puede borrarse a sí mismo', 'SELF_DELETE');
    const schematics = await prisma.schematic.findMany({ where: { userId: id }, select: { id: true, storageFilename: true } });
    await revokeAllRefreshTokens(id);
    await prisma.user.delete({ where: { id } });
    await Promise.all([
      ...schematics.map((s) => unlink(storedSchematicPath(s.storageFilename)).catch(() => undefined)),
      ...schematics.map((s) => unlink(thumbnailPath(s.id)).catch(() => undefined)),
    ]);
    return reply.code(204).send();
  });

  app.get('/admin/schematics', async (request) => {
    const query = PaginationSchema.extend({
      q: z.string().max(200).optional(),
      userId: z.string().uuid().optional(),
    }).parse(request.query);
    const where = {
      ...(query.q ? { name: { contains: query.q } } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.schematic.findMany({
        where,
        select: {
          id: true, name: true, userId: true, format: true, createdAt: true,
          widthX: true, heightY: true, lengthZ: true,
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.schematic.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  });
}
