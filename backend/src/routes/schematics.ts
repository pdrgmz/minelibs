import { createReadStream } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
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
import { extractYoutubeVideoId } from '../utils/youtube';
import { storedFilename, validateUpload } from '../utils/upload';

// Los formularios envían los campos opcionales como cadena vacía; tratarlos como ausentes.
const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const MetadataSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.preprocess(emptyToUndefined, z.string().max(5000).optional()),
  youtubeUrl: z.preprocess(emptyToUndefined, z.string().url().max(500).optional()),
  minecraftVersion: z.preprocess(emptyToUndefined, z.string().max(32).optional()),
  edition: z.enum(['JAVA', 'BEDROCK']).default('JAVA'),
  tags: z.array(z.string().max(40)).max(30).default([]),
  collectionId: z.preprocess(emptyToUndefined, z.string().uuid().nullish()),
  isFavorite: z.boolean().default(false),
  checkedMaterials: z.array(z.string()).default([]),
});

const ListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  tag: z.string().max(40).optional(),
  version: z.string().max(32).optional(),
  favorite: z.enum(['true', 'false']).optional(),
  collectionId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  sort: z.enum(['createdAt', 'name', 'totalBlocks', 'updatedAt']).default('createdAt'),
});

type SchematicRow = Awaited<ReturnType<typeof prisma.schematic.findFirst>>;

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || value.trim() === '') return [];
  if (value.trim().startsWith('[')) {
    try {
      return z.array(z.string()).parse(JSON.parse(value));
    } catch {
      throw new HttpError(400, 'El campo tags debe ser un array JSON o una lista separada por comas', 'INVALID_TAGS');
    }
  }
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function buildMetadata(raw: Record<string, string>): z.infer<typeof MetadataSchema> {
  return MetadataSchema.parse({
    ...raw,
    tags: parseTags(raw.tags),
    isFavorite: raw.isFavorite === 'true' || raw.isFavorite === '1',
    checkedMaterials: raw.checkedMaterials ? JSON.parse(raw.checkedMaterials) : [],
  });
}

function normalizeMetadata(data: z.infer<typeof MetadataSchema>) {
  return {
    ...data,
    youtubeVideoId: extractYoutubeVideoId(data.youtubeUrl ?? null),
    tags: JSON.stringify(data.tags),
    checkedMaterials: JSON.stringify(data.checkedMaterials),
    description: data.description ?? null,
    youtubeUrl: data.youtubeUrl ?? null,
    minecraftVersion: data.minecraftVersion ?? null,
  };
}

function dimensions(row: { widthX: number; heightY: number; lengthZ: number }) {
  return { widthX: row.widthX, heightY: row.heightY, lengthZ: row.lengthZ };
}

function listItem(row: NonNullable<SchematicRow>) {
  return {
    id: row.id,
    name: row.name,
    youtubeVideoId: row.youtubeVideoId,
    minecraftVersion: row.minecraftVersion,
    tags: JSON.parse(row.tags) as string[],
    isFavorite: row.isFavorite,
    format: row.format,
    collectionId: row.collectionId,
    dimensions: dimensions(row),
    totalBlocks: row.totalBlocks,
    thumbnailUrl: row.thumbnail ? `/api/v1/schematics/${row.id}/thumbnail` : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function detail(row: NonNullable<SchematicRow>) {
  return {
    ...listItem(row),
    userId: row.userId,
    description: row.description,
    youtubeUrl: row.youtubeUrl,
    edition: row.edition,
    originalFilename: row.originalFilename,
    fileSizeBytes: row.fileSizeBytes,
    sha256: row.sha256,
    parserVersion: row.parserVersion,
    materials: JSON.parse(row.materials) as unknown[],
    checkedMaterials: JSON.parse(row.checkedMaterials) as string[],
    fileUrl: `/api/v1/schematics/${row.id}/file`,
    updatedAt: row.updatedAt,
  };
}

async function ownedSchematic(userId: string, id: string): Promise<NonNullable<SchematicRow>> {
  const row = await prisma.schematic.findFirst({ where: { id, userId } });
  if (!row) throw new HttpError(404, 'Schematic no encontrado', 'NOT_FOUND');
  return row;
}

const AsAdminQuerySchema = z.object({ asAdmin: z.enum(['true', 'false']).default('false') });

/** Un ADMIN puede abrir en lectura un schematic ajeno con `?asAdmin=true`. */
async function readableSchematic(request: { user?: { id: string; role: string }; query: unknown }, id: string): Promise<NonNullable<SchematicRow>> {
  const { asAdmin } = AsAdminQuerySchema.parse(request.query);
  if (asAdmin === 'true' && request.user?.role === 'ADMIN') {
    const row = await prisma.schematic.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, 'Schematic no encontrado', 'NOT_FOUND');
    return row;
  }
  return ownedSchematic(request.user!.id, id);
}

async function assertCollectionOwner(userId: string, collectionId: string | null | undefined): Promise<void> {
  if (!collectionId) return;
  const collection = await prisma.collection.findFirst({ where: { id: collectionId, userId } });
  if (!collection) throw new HttpError(404, 'Colección no encontrada', 'NOT_FOUND');
}

async function assertQuotas(userId: string, incomingBytes: number): Promise<void> {
  const [count, aggregated] = await Promise.all([
    prisma.schematic.count({ where: { userId } }),
    prisma.schematic.aggregate({ where: { userId }, _sum: { fileSizeBytes: true } }),
  ]);
  if (count >= env.MAX_SCHEMATICS_PER_USER) {
    throw new HttpError(429, `Límite de ${env.MAX_SCHEMATICS_PER_USER} schematics alcanzado`, 'QUOTA_EXCEEDED');
  }
  const currentBytes = aggregated._sum.fileSizeBytes ?? 0;
  if (currentBytes + incomingBytes > env.MAX_STORAGE_MB_PER_USER * 1024 * 1024) {
    throw new HttpError(413, 'Cuota de almacenamiento excedida', 'STORAGE_QUOTA_EXCEEDED');
  }
}

export async function schematicRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/schematics', async (request) => {
    const query = ListQuerySchema.parse(request.query);
    const where: Record<string, unknown> = { userId: request.user!.id };
    if (query.q) {
      where.OR = [
        { name: { contains: query.q } },
        { description: { contains: query.q } },
        { tags: { contains: query.q } },
      ];
    }
    if (query.tag) where.tags = { contains: query.tag };
    if (query.version) where.minecraftVersion = { contains: query.version };
    if (query.favorite) where.isFavorite = query.favorite === 'true';
    if (query.collectionId) where.collectionId = query.collectionId;

    const [items, total] = await Promise.all([
      prisma.schematic.findMany({
        where,
        orderBy: { [query.sort]: query.sort === 'name' ? 'asc' : 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.schematic.count({ where }),
    ]);
    return { items: items.map(listItem), total, page: query.page, limit: query.limit };
  });

  /** Recalcula dimensiones/materiales de toda la biblioteca tras cambiar PARSER_VERSION. */
  app.post('/schematics/reparse', { preHandler: requireAdmin }, async () => {
    const rows = await prisma.schematic.findMany({ select: { id: true, storageFilename: true, format: true } });
    let updated = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const buffer = await readFile(storedSchematicPath(row.storageFilename));
        const parsed = await parseInWorker(buffer, z.enum(['LITEMATIC', 'SCHEM', 'NBT']).parse(row.format));
        await prisma.schematic.update({
          where: { id: row.id },
          data: {
            parserVersion: PARSER_VERSION,
            widthX: parsed.dimensions.widthX,
            heightY: parsed.dimensions.heightY,
            lengthZ: parsed.dimensions.lengthZ,
            totalBlocks: parsed.totalBlocks,
            materials: JSON.stringify(parsed.materials),
          },
        });
        updated++;
      } catch {
        failed++;
      }
    }
    return { total: rows.length, updated, failed, parserVersion: PARSER_VERSION };
  });

  app.post('/schematics', async (request, reply) => {
    const raw: Record<string, string> = {};
    let fileBuffer: Buffer | undefined;
    let originalFilename: string | undefined;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file') {
          await part.file.resume();
          continue;
        }
        fileBuffer = await part.toBuffer();
        originalFilename = part.filename;
      } else {
        raw[part.fieldname] = String(part.value);
      }
    }
    if (!fileBuffer || !originalFilename) {
      throw new HttpError(400, 'Falta el archivo (campo "file")', 'MISSING_FILE');
    }

    const metadata = buildMetadata(raw);
    await assertCollectionOwner(request.user!.id, metadata.collectionId);
    const validated = validateUpload(originalFilename, fileBuffer);
    const parsed = await parseInWorker(fileBuffer, validated.format);
    await assertQuotas(request.user!.id, validated.size);

    const query = z.object({ force: z.enum(['true', 'false']).default('false') }).parse(request.query);
    if (query.force !== 'true') {
      const duplicate = await prisma.schematic.findFirst({
        where: { userId: request.user!.id, sha256: validated.sha256 },
        select: { id: true, name: true },
      });
      if (duplicate) {
        throw new HttpError(409, 'Ese archivo ya existe en tu biblioteca', 'DUPLICATE_FILE', {
          details: { existingId: duplicate.id, existingName: duplicate.name },
        });
      }
    }

    const id = randomUUID();
    const storageFilename = storedFilename(id, validated.extension);
    await ensureSchematicDir();
    const filePath = schematicPath(id, validated.extension);
    await writeFile(filePath, fileBuffer);

    try {
      const row = await prisma.schematic.create({
        data: {
          id,
          userId: request.user!.id,
          ...normalizeMetadata(metadata),
          format: validated.format,
          originalFilename,
          storageFilename,
          fileSizeBytes: validated.size,
          sha256: validated.sha256,
          parserVersion: PARSER_VERSION,
          widthX: parsed.dimensions.widthX,
          heightY: parsed.dimensions.heightY,
          lengthZ: parsed.dimensions.lengthZ,
          totalBlocks: parsed.totalBlocks,
          materials: JSON.stringify(parsed.materials),
        },
      });
      return reply.code(201).send(detail(row));
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  });

  app.get('/schematics/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return detail(await readableSchematic(request, id));
  });

  app.patch('/schematics/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await ownedSchematic(request.user!.id, id);
    const body = MetadataSchema.partial().parse(request.body);
    if (body.collectionId !== undefined) await assertCollectionOwner(request.user!.id, body.collectionId);

    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (key === 'tags') data.tags = JSON.stringify(value);
      else if (key === 'checkedMaterials') data.checkedMaterials = JSON.stringify(value);
      else data[key] = value;
    }
    if (body.youtubeUrl !== undefined) data.youtubeVideoId = extractYoutubeVideoId(body.youtubeUrl);

    const row = await prisma.schematic.update({ where: { id }, data });
    return detail(row);
  });

  app.put('/schematics/:id/file', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const existing = await ownedSchematic(request.user!.id, id);

    let fileBuffer: Buffer | undefined;
    let originalFilename: string | undefined;
    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        fileBuffer = await part.toBuffer();
        originalFilename = part.filename;
      } else if (part.type === 'file') {
        await part.file.resume();
      }
    }
    if (!fileBuffer || !originalFilename) throw new HttpError(400, 'Falta el archivo (campo "file")', 'MISSING_FILE');

    const validated = validateUpload(originalFilename, fileBuffer);
    const parsed = await parseInWorker(fileBuffer, validated.format);
    const storageFilename = storedFilename(id, validated.extension);
    await ensureSchematicDir();
    await writeFile(schematicPath(id, validated.extension), fileBuffer);
    if (existing.storageFilename !== storageFilename) {
      await unlink(storedSchematicPath(existing.storageFilename)).catch(() => undefined);
    }

    const row = await prisma.schematic.update({
      where: { id },
      data: {
        format: validated.format,
        originalFilename,
        storageFilename,
        fileSizeBytes: validated.size,
        sha256: validated.sha256,
        parserVersion: PARSER_VERSION,
        widthX: parsed.dimensions.widthX,
        heightY: parsed.dimensions.heightY,
        lengthZ: parsed.dimensions.lengthZ,
        totalBlocks: parsed.totalBlocks,
        materials: JSON.stringify(parsed.materials),
        thumbnail: false,
      },
    });
    await unlink(thumbnailPath(id)).catch(() => undefined);
    return detail(row);
  });

  app.delete('/schematics/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const row = await ownedSchematic(request.user!.id, id);
    await prisma.schematic.delete({ where: { id } });
    await unlink(storedSchematicPath(row.storageFilename)).catch(() => undefined);
    await unlink(thumbnailPath(id)).catch(() => undefined);
    return reply.code(204).send();
  });

  app.get('/schematics/:id/file', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = z.object({ download: z.enum(['1', 'true']).optional(), asAdmin: z.enum(['true', 'false']).default('false') }).parse(request.query);
    const row = await readableSchematic(request, id);
    const filePath = storedSchematicPath(row.storageFilename);
    const disposition = query.download ? 'attachment' : 'inline';
    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `${disposition}; filename="${row.originalFilename.replace(/"/g, '')}"`)
      .send(createReadStream(filePath));
  });

  app.post('/schematics/:id/thumbnail', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await ownedSchematic(request.user!.id, id);
    let buffer: Buffer | undefined;
    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'thumbnail') buffer = await part.toBuffer();
      else if (part.type === 'file') await part.file.resume();
    }
    if (!buffer || buffer.length > 1024 * 1024 || buffer.subarray(0, 4).toString('hex') !== '89504e47') {
      throw new HttpError(400, 'Se espera una imagen PNG de menos de 1 MB', 'INVALID_THUMBNAIL');
    }
    await ensureThumbnailDir();
    await writeFile(thumbnailPath(id), buffer);
    const row = await prisma.schematic.update({ where: { id }, data: { thumbnail: true } });
    return reply.code(201).send(detail(row));
  });

  app.get('/schematics/:id/thumbnail', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const row = await readableSchematic(request, id);
    if (!row.thumbnail) throw new HttpError(404, 'Thumbnail no disponible', 'NOT_FOUND');
    return reply
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'public, max-age=86400')
      .send(createReadStream(thumbnailPath(id)));
  });
}
