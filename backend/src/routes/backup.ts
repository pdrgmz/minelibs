import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { strFromU8, strToU8, unzipSync, zipSync, type UnzipFileInfo } from 'fflate';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../auth/guards';
import { env } from '../config';
import { prisma } from '../db';
import { HttpError } from '../errors';
import { PARSER_VERSION } from '../parser/materials';
import { parseInWorker } from '../parser/run';
import {
  ensureSchematicDir,
  ensureThumbnailDir,
  schematicPath,
  storedSchematicPath,
  thumbnailPath,
} from '../storage';
import { storedFilename, validateUpload } from '../utils/upload';

const MANIFEST_VERSION = 1;
const MB = 1024 * 1024;

const MaterialSchema = z.object({
  blockId: z.string(),
  displayName: z.string(),
  count: z.number().int(),
  stackSize: z.number().int(),
});

const ManifestCollectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
});

const ManifestSchematicSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  youtubeUrl: z.string().nullable(),
  youtubeVideoId: z.string().nullable(),
  minecraftVersion: z.string().nullable(),
  edition: z.string(),
  tags: z.array(z.string()),
  isFavorite: z.boolean(),
  checkedMaterials: z.array(z.string()),
  format: z.enum(['LITEMATIC', 'SCHEM', 'NBT']),
  originalFilename: z.string(),
  storageFilename: z.string(),
  fileSizeBytes: z.number().int().nonnegative(),
  sha256: z.string(),
  parserVersion: z.number().int(),
  widthX: z.number().int(),
  heightY: z.number().int(),
  lengthZ: z.number().int(),
  totalBlocks: z.number().int(),
  materials: z.array(MaterialSchema),
  collectionId: z.string().uuid().nullable(),
  thumbnail: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  file: z.string(),
  thumbnailFile: z.string().nullable(),
});

const ManifestSchema = z.object({
  schemaVersion: z.literal(MANIFEST_VERSION),
  exportedAt: z.string(),
  owner: z.object({ id: z.string().uuid(), username: z.string() }).optional(),
  collections: z.array(ManifestCollectionSchema),
  schematics: z.array(ManifestSchematicSchema),
});

/** Rechaza rutas absolutas, `..`, barras invertidas y caracteres de control en entradas ZIP. */
function safeZipEntry(name: string): string {
  if (
    !name ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    /^[a-zA-Z]:/.test(name) ||
    name.split('/').some((part) => part === '..' || part === '.' || part === '')
  ) {
    throw new HttpError(400, `Entrada ZIP no permitida: ${name}`, 'INVALID_ZIP_ENTRY');
  }
  return name;
}

function jsonDate(value: Date): string {
  return value.toISOString();
}

async function buildExport(userId: string | null): Promise<{ buffer: Buffer; filename: string }> {
  const where = userId ? { userId } : {};
  const [collections, schematics] = await Promise.all([
    prisma.collection.findMany({
      where,
      select: { id: true, name: true, description: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.schematic.findMany({ where, orderBy: { createdAt: 'asc' } }),
  ]);

  const manifest = {
    schemaVersion: MANIFEST_VERSION,
    exportedAt: jsonDate(new Date()),
    ...(userId
      ? {
          owner: await prisma.user
            .findUnique({ where: { id: userId }, select: { id: true, username: true } })
            .then((user) => (user ? { id: user.id, username: user.username } : undefined)),
        }
      : {}),
    collections: collections.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      createdAt: jsonDate(c.createdAt),
    })),
    schematics: schematics.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      youtubeUrl: s.youtubeUrl,
      youtubeVideoId: s.youtubeVideoId,
      minecraftVersion: s.minecraftVersion,
      edition: s.edition,
      tags: JSON.parse(s.tags) as string[],
      isFavorite: s.isFavorite,
      checkedMaterials: JSON.parse(s.checkedMaterials) as string[],
      format: s.format,
      originalFilename: s.originalFilename,
      storageFilename: s.storageFilename,
      fileSizeBytes: s.fileSizeBytes,
      sha256: s.sha256,
      parserVersion: s.parserVersion,
      widthX: s.widthX,
      heightY: s.heightY,
      lengthZ: s.lengthZ,
      totalBlocks: s.totalBlocks,
      materials: JSON.parse(s.materials) as unknown[],
      collectionId: s.collectionId,
      thumbnail: s.thumbnail,
      createdAt: jsonDate(s.createdAt),
      updatedAt: jsonDate(s.updatedAt),
      file: `files/${s.storageFilename}`,
      thumbnailFile: s.thumbnail ? `thumbnails/${s.id}.png` : null,
    })),
  };

  const entries: Record<string, Uint8Array> = { 'manifest.json': strToU8(JSON.stringify(manifest)) };
  for (const s of schematics) {
    entries[`files/${s.storageFilename}`] = new Uint8Array(await readFile(storedSchematicPath(s.storageFilename)));
    if (s.thumbnail) {
      try {
        entries[`thumbnails/${s.id}.png`] = new Uint8Array(await readFile(thumbnailPath(s.id)));
      } catch {
        // Un thumbnail huérfano no debe impedir el backup.
      }
    }
  }

  return {
    buffer: Buffer.from(zipSync(entries, { level: 0, mtime: new Date('2000-01-01T00:00:00Z') })),
    filename: `minelibs-${userId ?? 'all'}-${new Date().toISOString().slice(0, 10)}.zip`,
  };
}

function sendZip(reply: FastifyReply, buffer: Buffer, filename: string) {
  return reply
    .header('Content-Type', 'application/zip')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(buffer);
}

async function receiveZip(request: FastifyRequest): Promise<Buffer> {
  let buffer: Buffer | undefined;
  for await (const part of request.parts({
    limits: { fileSize: env.MAX_IMPORT_ZIP_MB * MB, files: 1 },
  })) {
    if (part.type === 'file' && part.fieldname === 'file') buffer = await part.toBuffer();
    else if (part.type === 'file') await part.file.resume();
  }
  if (!buffer) throw new HttpError(400, 'Falta el ZIP (campo "file")', 'MISSING_FILE');
  if (buffer.length > env.MAX_IMPORT_ZIP_MB * MB) {
    throw new HttpError(413, `El ZIP supera los ${env.MAX_IMPORT_ZIP_MB} MB permitidos`, 'IMPORT_TOO_LARGE');
  }
  return buffer;
}

async function importZip(userId: string, zipBuffer: Buffer): Promise<{ imported: number; skipped: number; errors: string[] }> {
  let entries: Record<string, Uint8Array>;
  let source: z.infer<typeof ManifestSchema>;

  try {
    let entryCount = 0;
    let decompressedBytes = 0;
    entries = unzipSync(new Uint8Array(zipBuffer), {
      filter: (info: UnzipFileInfo) => {
        safeZipEntry(info.name);
        entryCount++;
        if (entryCount > env.MAX_IMPORT_ENTRIES) {
          throw new HttpError(400, `El ZIP supera las ${env.MAX_IMPORT_ENTRIES} entradas permitidas`, 'IMPORT_TOO_MANY_ENTRIES');
        }
        if (info.compression !== 0 && info.compression !== 8) {
          throw new HttpError(400, `Compresión ZIP no soportada en ${info.name}`, 'INVALID_ZIP');
        }
        decompressedBytes += info.originalSize;
        if (decompressedBytes > env.MAX_IMPORT_ZIP_MB * MB) {
          throw new HttpError(413, 'El contenido descomprimido del ZIP excede el límite', 'IMPORT_TOO_LARGE');
        }
        if (info.originalSize > env.MAX_FILE_SIZE_MB * MB && !info.name.endsWith('.png')) {
          throw new HttpError(413, `El archivo ${info.name} excede el tamaño máximo`, 'FILE_TOO_LARGE');
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'El ZIP es inválido o está corrupto', 'INVALID_ZIP', { cause: error });
  }

  const manifestBytes = entries['manifest.json'];
  if (!manifestBytes) throw new HttpError(400, 'Falta manifest.json en el ZIP', 'MISSING_MANIFEST');
  if (manifestBytes.byteLength > env.MAX_MANIFEST_KB * 1024) {
    throw new HttpError(413, 'El manifest supera el tamaño permitido', 'MANIFEST_TOO_LARGE');
  }
  try {
    source = ManifestSchema.parse(JSON.parse(strFromU8(manifestBytes)));
  } catch (error) {
    throw new HttpError(400, 'El manifest.json no es válido', 'INVALID_MANIFEST', { cause: error });
  }

  const [existingCount, aggregated, existingHashes] = await Promise.all([
    prisma.schematic.count({ where: { userId } }),
    prisma.schematic.aggregate({ where: { userId }, _sum: { fileSizeBytes: true } }),
    prisma.schematic.findMany({ where: { userId }, select: { sha256: true } }),
  ]);
  const knownHashes = new Set(existingHashes.map((row) => row.sha256));

  let plannedCount = existingCount;
  let plannedBytes = aggregated._sum.fileSizeBytes ?? 0;
  const errors: string[] = [];
  let skipped = 0;

  interface Prepared {
    manifest: z.infer<typeof ManifestSchematicSchema>;
    buffer: Buffer;
    extension: string;
    format: 'LITEMATIC' | 'SCHEM' | 'NBT';
    sha256: string;
  }
  const prepared: Prepared[] = [];

  for (const schematic of source.schematics) {
    const label = schematic.name || schematic.id;
    const entry = entries[schematic.file];
    if (!entry) {
      skipped++;
      errors.push(`${label}: falta el binario en el ZIP`);
      continue;
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(entry);
      const validated = validateUpload(schematic.originalFilename, buffer);
      // Regla crítica: nada se guarda sin haber sido parseado primero.
      await parseInWorker(buffer, validated.format);
      if (validated.sha256 !== schematic.sha256) {
        throw new HttpError(400, 'El SHA-256 del binario no coincide con el manifest', 'SHA_MISMATCH');
      }
      if (knownHashes.has(validated.sha256)) {
        skipped++;
        errors.push(`${label}: ya existe un schematic con ese SHA-256`);
        continue;
      }
      knownHashes.add(validated.sha256);
      plannedCount++;
      plannedBytes += validated.size;
      prepared.push({
        manifest: schematic,
        buffer,
        extension: validated.extension,
        format: validated.format,
        sha256: validated.sha256,
      });
    } catch (error) {
      skipped++;
      errors.push(`${label}: ${error instanceof Error ? error.message : 'error desconocido'}`);
    }
  }

  if (plannedCount > env.MAX_SCHEMATICS_PER_USER) {
    throw new HttpError(429, `La importación superaría el límite de ${env.MAX_SCHEMATICS_PER_USER} schematics`, 'QUOTA_EXCEEDED');
  }
  if (plannedBytes > env.MAX_STORAGE_MB_PER_USER * MB) {
    throw new HttpError(413, 'La importación excede tu cuota de almacenamiento', 'STORAGE_QUOTA_EXCEEDED');
  }

  // Colecciones: se reutilizan por nombre para no duplicarlas en cada importación.
  const existingCollections = await prisma.collection.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  const collectionsByName = new Map(existingCollections.map((c) => [c.name, c.id]));
  for (const collection of source.collections) {
    if (collectionsByName.has(collection.name)) continue;
    const created = await prisma.collection.create({
      data: { userId, name: collection.name, description: collection.description },
      select: { id: true },
    });
    collectionsByName.set(collection.name, created.id);
  }
  const remapCollections = new Map(source.collections.map((c) => [c.id, collectionsByName.get(c.name) ?? null]));

  await ensureSchematicDir();
  await ensureThumbnailDir();
  const writtenFiles: string[] = [];
  let imported = 0;

  try {
    for (const item of prepared) {
      const id = randomUUID();
      const storageFilename = storedFilename(id, item.extension);
      const manifest = item.manifest;
      const row = await prisma.schematic.create({
        data: {
          id,
          userId,
          name: manifest.name,
          description: manifest.description,
          youtubeUrl: manifest.youtubeUrl,
          youtubeVideoId: manifest.youtubeVideoId,
          minecraftVersion: manifest.minecraftVersion,
          edition: manifest.edition,
          tags: JSON.stringify(manifest.tags),
          isFavorite: manifest.isFavorite,
          checkedMaterials: JSON.stringify(manifest.checkedMaterials),
          collectionId: manifest.collectionId ? remapCollections.get(manifest.collectionId) ?? null : null,
          format: item.format,
          originalFilename: manifest.originalFilename,
          storageFilename,
          fileSizeBytes: item.buffer.length,
          sha256: item.sha256,
          parserVersion: PARSER_VERSION,
          widthX: manifest.widthX,
          heightY: manifest.heightY,
          lengthZ: manifest.lengthZ,
          totalBlocks: manifest.totalBlocks,
          materials: JSON.stringify(manifest.materials),
        },
      });
      const filePath = schematicPath(id, item.extension);
      await writeFile(filePath, item.buffer);
      writtenFiles.push(filePath);

      if (manifest.thumbnailFile && manifest.thumbnail) {
        const thumbnail = entries[manifest.thumbnailFile];
        if (thumbnail) {
          await writeFile(thumbnailPath(id), thumbnail);
          await prisma.schematic.update({ where: { id: row.id }, data: { thumbnail: true } });
        }
      }
      imported++;
    }
  } catch (error) {
    await Promise.all(writtenFiles.map((file) => unlink(file).catch(() => undefined)));
    throw error;
  }

  return { imported, skipped, errors };
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me/export', { preHandler: authenticate }, async (_request, reply) => {
    const { buffer, filename } = await buildExport(_request.user!.id);
    return sendZip(reply, buffer, filename);
  });

  app.post('/me/import', { preHandler: authenticate }, async (request) => {
    const buffer = await receiveZip(request);
    return importZip(request.user!.id, buffer);
  });

  app.get('/admin/export', { preHandler: requireAdmin }, async (_request, reply) => {
    const { buffer, filename } = await buildExport(null);
    return sendZip(reply, buffer, filename);
  });
}
