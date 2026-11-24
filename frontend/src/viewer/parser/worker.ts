import { gunzipSync, inflateSync } from 'fflate';
import { ParserError } from './errors';
import { parseSchematic } from './index';
import type { ParsedSchematic } from './types';

interface ParseRequest {
  type: 'parse';
  id: number;
  url: string;
  token: string | null;
}

interface CancelRequest {
  type: 'cancel';
  id: number;
}

type WorkerRequest = ParseRequest | CancelRequest;

type WorkerResponse =
  | { type: 'progress'; id: number; stage: 'downloading' | 'parsing' }
  | { type: 'result'; id: number; parsed: ParsedSchematic }
  | { type: 'error'; id: number; message: string; code: string };

// En un worker `self` es DedicatedWorkerGlobalScope; el lib del frontend sólo
// declara el Window global, así que lo tipamos localmente sin imports de node.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

const cancelled = new Set<number>();

function publish(message: WorkerResponse): void {
  if (!cancelled.has(message.id)) scope.postMessage(message);
}

/**
 * prismarine-nbt usa `node:zlib` para GZIP, que no existe en el navegador.
 * Descomprimimos aquí con fflate para que `parse` reciba NBT crudo.
 */
export function inflateIfNeeded(data: Uint8Array): Uint8Array {
  let format: 'gzip' | 'deflate' | null = null;
  if (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b) format = 'gzip';
  else if (data.length > 2 && data[0] === 0x78 && [0x01, 0x9c, 0xda].includes(data[1])) format = 'deflate';
  if (!format) return data;
  try {
    // fflate es puro JavaScript: funciona en workers sin APIs de compresión nativas.
    return format === 'gzip' ? gunzipSync(data) : inflateSync(data);
  } catch (cause) {
    throw new ParserError('No se pudo descomprimir el schematic', 'INVALID_NBT', { cause });
  }
}

async function handleParse(request: ParseRequest): Promise<void> {
  const { id, url, token } = request;
  if (cancelled.has(id)) return;

  publish({ type: 'progress', id, stage: 'downloading' });
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    throw new ParserError(`No se pudo descargar el schematic (HTTP ${response.status})`, 'DOWNLOAD_FAILED');
  }
  if (cancelled.has(id)) return;

  publish({ type: 'progress', id, stage: 'parsing' });
  const raw = new Uint8Array(await response.arrayBuffer());
  const parsed = await parseSchematic(inflateIfNeeded(raw));
  publish({ type: 'result', id, parsed });
}

scope.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const request = event.data;
  if (request.type === 'cancel') {
    cancelled.add(request.id);
    return;
  }

  void handleParse(request)
    .catch((error: unknown) => {
      const failure =
        error instanceof ParserError
          ? error
          : new ParserError(
              error instanceof Error ? error.message : 'No se pudo parsear el schematic',
              'INVALID_SCHEMATIC',
              { cause: error },
            );
      publish({ type: 'error', id: request.id, message: failure.message, code: failure.code });
    })
    .finally(() => {
      cancelled.delete(request.id);
    });
};
