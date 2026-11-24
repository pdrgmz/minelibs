import { existsSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { HttpError } from '../errors';
import type { SchematicFormat } from '../utils/upload';
import type { ParseSummary } from './types';

interface WorkerResponse {
  ok: boolean;
  value?: ParseSummary;
  statusCode?: number;
  code?: string;
  message?: string;
}

/** Parsea en un worker_thread para no bloquear el event loop durante la subida. */
export function parseInWorker(buffer: Buffer, format: SchematicFormat): Promise<ParseSummary> {
  return new Promise((resolve, reject) => {
    const sourcePath = path.join(__dirname, 'worker.ts');
    const fromSource = existsSync(sourcePath);
    const workerPath = fromSource ? sourcePath : path.join(__dirname, 'worker.js');
    const worker = new Worker(workerPath, {
      workerData: { buffer, format },
      ...(fromSource ? { execArgv: ['--import', 'tsx'] } : {}),
    });
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      action();
    };

    worker.once('message', (response: WorkerResponse) => {
      if (response.ok && response.value) {
        finish(() => resolve(response.value!));
      } else {
        finish(() => reject(new HttpError(response.statusCode ?? 400, response.message ?? 'Error al parsear', response.code)));
      }
    });
    worker.once('error', (error) => finish(() => reject(new HttpError(500, `Error en el worker de parseo: ${error.message}`, 'PARSER_WORKER_ERROR'))));
    worker.once('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new HttpError(500, `El worker de parseo terminó inesperadamente (código ${code})`, 'PARSER_WORKER_ERROR'));
      }
    });
  });
}
