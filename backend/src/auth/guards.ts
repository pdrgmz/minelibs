import type { FastifyReply, FastifyRequest } from 'fastify';
import { setRefreshCookie, signAccessToken, toPublicUser, verifyAccessToken, type PublicUser } from './tokens';
import { HttpError } from '../errors';

declare module 'fastify' {
  interface FastifyRequest {
    user?: PublicUser;
  }
}

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Se requiere autenticación', 'UNAUTHORIZED');
  }
  const payload = verifyAccessToken(header.slice(7));
  request.user = toPublicUser({ id: payload.sub, username: payload.username, role: payload.role });
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authenticate(request, reply);
  if (request.user?.role !== 'ADMIN') {
    throw new HttpError(403, 'Se requiere rol de administrador', 'FORBIDDEN');
  }
}

export function issueSession(reply: FastifyReply, user: PublicUser, refreshToken: string): { accessToken: string; user: PublicUser } {
  setRefreshCookie(reply, refreshToken);
  return { accessToken: signAccessToken(user), user };
}
