import { parentPort, workerData } from 'node:worker_threads';
import { HttpError } from '../errors';
import type { SchematicFormat } from '../utils/upload';
import { parseSchematic } from './index';
import { summarize } from './types';

interface WorkerInput {
  // worker_threads clona los Buffer como Uint8Array; se reconstruye antes de parsear.
  buffer: Uint8Array;
  format: SchematicFormat;
}

interface WorkerSuccess {
  ok: true;
  value: ReturnType<typeof summarize>;
}

interface WorkerFailure {
  ok: false;
  statusCode: number;
  code: string;
  message: string;
}

async function run(): Promise<void> {
  if (!parentPort) return;
  const { buffer: rawBuffer, format } = workerData as WorkerInput;
  try {
    const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);
    const parsed = await parseSchematic(buffer, format);
    const response: WorkerSuccess = { ok: true, value: summarize(parsed) };
    parentPort.postMessage(response);
  } catch (error) {
    const httpError = error instanceof HttpError ? error : new HttpError(400, 'No se pudo parsear el schematic', 'INVALID_SCHEMATIC');
    const response: WorkerFailure = {
      ok: false,
      statusCode: httpError.statusCode,
      code: httpError.code ?? 'INVALID_SCHEMATIC',
      message: httpError.message,
    };
    parentPort.postMessage(response);
  }
}

void run();
