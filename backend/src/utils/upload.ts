import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { env } from '../config';
import { HttpError } from '../errors';

export type SchematicFormat = 'LITEMATIC' | 'SCHEM' | 'NBT';

const FORMATS: Record<string, SchematicFormat> = {
  litematic: 'LITEMATIC',
  schem: 'SCHEM',
  nbt: 'NBT',
};

export interface ValidatedUpload {
  format: SchematicFormat;
  extension: string;
  sha256: string;
  size: number;
}

/**
 * Validación de subida: extensión, magic bytes e integridad GZIP.
 * El árbol NBT, dimensiones y materiales se validan después en el parser (worker_thread).
 */
export function validateUpload(originalFilename: string, buffer: Buffer): ValidatedUpload {
  const dotted = originalFilename.toLowerCase().split('.');
  const extension = dotted.length > 1 ? (dotted.pop() as string) : '';
  const format = FORMATS[extension];
  if (!format) {
    throw new HttpError(400, 'Formato no soportado. Use .litematic, .schem o .nbt', 'INVALID_EXTENSION');
  }
  if (buffer.length === 0) {
    throw new HttpError(400, 'El archivo está vacío', 'EMPTY_FILE');
  }

  const isGzip = buffer[0] === 0x1f && buffer[1] === 0x8b;
  const isRawNbt = buffer[0] === 0x0a;
  if (!isGzip && !isRawNbt) {
    throw new HttpError(400, 'El contenido no es un archivo NBT válido (GZIP o NBT crudo)', 'INVALID_MAGIC_BYTES');
  }

  if (isGzip) {
    try {
      gunzipSync(buffer, { maxOutputLength: env.MAX_DECOMPRESSED_MB * 1024 * 1024 });
    } catch {
      throw new HttpError(400, 'No se pudo descomprimir el archivo NBT o supera el límite de tamaño', 'INVALID_GZIP');
    }
  }

  return {
    format,
    extension,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    size: buffer.length,
  };
}

export function storedFilename(id: string, extension: string): string {
  return `${id}.${extension}`;
}
