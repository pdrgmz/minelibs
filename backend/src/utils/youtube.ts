/** Extrae el ID de 11 caracteres de formatos estándar de YouTube. Devuelve null si no lo reconoce. */
export function extractYoutubeVideoId(input?: string | null): string | null {
  if (!input || input.trim() === '') return null;

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let candidate: string | null = null;

  if (host === 'youtu.be') {
    candidate = url.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (url.pathname === '/watch') {
      candidate = url.searchParams.get('v');
    } else {
      const match = /^\/(shorts|embed|live)\/([^/]+)/.exec(url.pathname);
      candidate = match?.[2] ?? null;
    }
  }

  return candidate && /^[\w-]{11}$/.test(candidate) ? candidate : null;
}
