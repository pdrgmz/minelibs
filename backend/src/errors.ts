import { ZodError } from 'zod';

interface HttpErrorOptions extends ErrorOptions {
  details?: unknown;
}

export class HttpError extends Error {
  public readonly details?: unknown;

  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    options?: HttpErrorOptions,
  ) {
    super(message, options);
    this.name = 'HttpError';
    this.details = options?.details;
  }
}

export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;

  if (error instanceof ZodError) {
    const first = error.issues[0];
    const path = first?.path.join('.');
    return new HttpError(400, `Datos inválidos${path ? ` en ${path}` : ''}: ${first?.message ?? ''}`, 'VALIDATION_ERROR');
  }

  const possible = error as { code?: string; message?: string; statusCode?: number };
  if (possible.code === 'P2002') {
    return new HttpError(409, 'Ya existe un registro con ese valor único', 'UNIQUE_CONSTRAINT');
  }
  if (possible.code === 'P2025') {
    return new HttpError(404, 'Recurso no encontrado', 'NOT_FOUND');
  }
  if (possible.code === 'FST_REQ_FILE_TOO_LARGE' || possible.statusCode === 413) {
    return new HttpError(413, 'El archivo supera el tamaño máximo permitido', 'FILE_TOO_LARGE');
  }

  return new HttpError(500, possible.message ?? 'Error interno del servidor', 'INTERNAL_ERROR');
}
