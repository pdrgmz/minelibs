import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { env } from '../config';
import { prisma } from '../db';
import { HttpError } from '../errors';

export const REFRESH_COOKIE = 'minelibs_refresh';

export interface PublicUser {
  id: string;
  username: string;
  role: 'USER' | 'ADMIN';
}

export interface AccessTokenPayload extends PublicUser {
  sub: string;
}

export function toPublicUser(user: { id: string; username: string; role: string }): PublicUser {
  return { id: user.id, username: user.username, role: user.role === 'ADMIN' ? 'ADMIN' : 'USER' };
}

export function signAccessToken(user: PublicUser): string {
  const payload: AccessTokenPayload = { sub: user.id, ...user };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: `${env.JWT_ACCESS_MINUTES}m` });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === 'string' || !decoded.sub) throw new Error('Payload inválido');
    return decoded as AccessTokenPayload;
  } catch {
    throw new HttpError(401, 'Sesión expirada o token inválido', 'UNAUTHORIZED');
  }
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

export function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: '/api/v1/auth',
    maxAge: env.JWT_REFRESH_DAYS * 24 * 60 * 60,
  });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
}

export async function rotateRefreshToken(rawToken: string | undefined): Promise<{ user: PublicUser; refreshToken: string }> {
  if (!rawToken) throw new HttpError(401, 'No hay sesión activa', 'UNAUTHORIZED');

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
    include: { user: true },
  });
  if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
    throw new HttpError(401, 'Sesión expirada', 'UNAUTHORIZED');
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const refreshToken = await issueRefreshToken(stored.userId);
  return { user: toPublicUser(stored.user), refreshToken };
}

export async function revokeRefreshToken(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
