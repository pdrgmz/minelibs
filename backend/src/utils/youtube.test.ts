import { describe, expect, it } from 'vitest';
import { extractYoutubeVideoId } from './youtube';

describe('extractYoutubeVideoId', () => {
  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=dQw4w9WgXcQ&t=10',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://m.youtube.com/embed/dQw4w9WgXcQ',
  ])('extrae el ID de %s', (url) => {
    expect(extractYoutubeVideoId(url)).toBe('dQw4w9WgXcQ');
  });

  it.each([null, undefined, '', 'https://example.com/watch?v=dQw4w9WgXcQ', 'no-es-una-url', 'https://youtu.be/corto'])(
    'devuelve null para %s',
    (url) => {
      expect(extractYoutubeVideoId(url)).toBeNull();
    },
  );
});
