import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/guards';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  issueRefreshToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  toPublicUser,
} from '../auth/tokens';
import { env } from '../config';
import { prisma } from '../db';
import { HttpError } from '../errors';
import { issueSession } from '../auth/guards';

const RegisterSchema = z.object({
  username: z.string().regex(/^[a-z0-9_-]{3,32}$/, 'Usuario: 3–32 caracteres, solo a-z, 0-9, _ y -'),
  password: z.string().min(10, 'La contraseña debe tener al menos 10 caracteres').max(128),
});

const LoginSchema = RegisterSchema.pick({ username: true, password: true });

const PasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, 'La contraseña debe tener al menos 10 caracteres').max(128),
});

const rateLimitConfig = {
  rateLimit: {
    max: env.RATE_LIMIT_AUTH_MAX,
    timeWindow: `${env.RATE_LIMIT_AUTH_WINDOW_MINUTES} minutes`,
  },
};

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', { config: rateLimitConfig }, async (request, reply) => {
    if (!env.REGISTRATION_ENABLED) {
      throw new HttpError(403, 'El registro está desactivado', 'REGISTRATION_DISABLED');
    }
    const { username, password } = RegisterSchema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) throw new HttpError(409, 'Ese nombre de usuario ya está en uso', 'USERNAME_TAKEN');

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await prisma.user.create({ data: { username, passwordHash } });
    const publicUser = toPublicUser(user);
    const refreshToken = await issueRefreshToken(user.id);
    return reply.code(201).send(issueSession(reply, publicUser, refreshToken));
  });

  app.post('/auth/login', { config: rateLimitConfig }, async (request, reply) => {
    const { username, password } = LoginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new HttpError(401, 'Usuario o contraseña incorrectos', 'INVALID_CREDENTIALS');
    }
    const publicUser = toPublicUser(user);
    const refreshToken = await issueRefreshToken(user.id);
    return reply.send(issueSession(reply, publicUser, refreshToken));
  });

  app.post('/auth/refresh', { config: rateLimitConfig }, async (request, reply) => {
    const { user, refreshToken } = await rotateRefreshToken(request.cookies[REFRESH_COOKIE]);
    return reply.send(issueSession(reply, user, refreshToken));
  });

  app.post('/auth/logout', async (request, reply) => {
    await revokeRefreshToken(request.cookies[REFRESH_COOKIE]);
    clearRefreshCookie(reply);
    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: authenticate }, async (request) => {
    return request.user;
  });

  app.post('/auth/password', { preHandler: authenticate }, async (request, reply) => {
    const { currentPassword, newPassword } = PasswordSchema.parse(request.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id } });
    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new HttpError(401, 'Contraseña actual incorrecta', 'INVALID_CREDENTIALS');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(newPassword, { type: argon2.argon2id }) },
    });
    await revokeAllRefreshTokens(user.id);
    clearRefreshCookie(reply);
    return reply.code(204).send();
  });
}
