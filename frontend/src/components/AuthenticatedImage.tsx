import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Props {
  /** Ruta relativa a /api/v1, p. ej. `/schematics/<id>/thumbnail`. */
  src: string;
  alt: string;
  className?: string;
  fallback?: string;
}

/**
 * Las miniaturas están detrás del middleware de autenticación: se descargan con
 * fetch (Bearer) y se muestran como object URL, nunca como `<img src>` directo.
 */
export function AuthenticatedImage({ src, alt, className, fallback = '' }: Props) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setUrl(null);
    void api.blob(src)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!url) return <div className={`${className ?? ''} flex items-center justify-center bg-terminal font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-paper/60`}>{fallback}</div>;
  return <img src={url} alt={alt} className={className} loading="lazy" />;
}
