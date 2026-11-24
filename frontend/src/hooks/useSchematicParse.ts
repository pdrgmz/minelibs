import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParsedSchematic } from '../viewer/parser/types';

type Stage = 'downloading' | 'parsing' | 'rendering';

interface WorkerMessage {
  type: 'progress' | 'result' | 'error';
  id: number;
  stage?: Stage;
  parsed?: ParsedSchematic;
  message?: string;
  code?: string;
}

export interface ParseState {
  parsed: ParsedSchematic | null;
  stage: Stage | null;
  error: string | null;
}

/** Mantiene un Web Worker vivo mientras haya un schematic que parsear. */
export function useSchematicParse(url: string | null, token: string | null) {
  const [state, setState] = useState<ParseState>({ parsed: null, stage: null, error: null });
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!url) {
      setState({ parsed: null, stage: null, error: null });
      return;
    }

    const worker = new Worker(new URL('../viewer/parser/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const id = ++requestId.current;
    setState({ parsed: null, stage: 'downloading', error: null });

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === 'progress') setState((current) => ({ ...current, stage: message.stage ?? null }));
      else if (message.type === 'result' && message.parsed) setState({ parsed: message.parsed, stage: 'rendering', error: null });
      else if (message.type === 'error') setState({ parsed: null, stage: null, error: message.message ?? 'Error' });
    };
    worker.onerror = (event) => {
      setState({ parsed: null, stage: null, error: event.message || 'Error en el worker de parseo' });
    };
    worker.postMessage({ type: 'parse', id, url, token });

    return () => {
      worker.postMessage({ type: 'cancel', id });
      worker.terminate();
      workerRef.current = null;
    };
  }, [url, token]);

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setState({ parsed: null, stage: null, error: null });
  }, []);

  return { ...state, cancel };
}
