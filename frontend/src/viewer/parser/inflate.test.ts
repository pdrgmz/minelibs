import { readFileSync } from 'node:fs';
import { cwd } from 'node:process';
import { describe, expect, it } from 'vitest';
import { parseSchematic } from './index';
import { inflateIfNeeded } from './worker';

const samplesDir = `${cwd()}/../samples/`;

describe('descompresión en el navegador', () => {
  it('descomprime GZIP antes de pasar el NBT a prismarine', async () => {
    const gzip = readFileSync(`${samplesDir}basic.litematic`);
    expect(gzip[0]).toBe(0x1f);
    const raw = inflateIfNeeded(gzip);
    expect(raw[0]).toBe(0x0a);
    const parsed = await parseSchematic(raw);
    expect(parsed.dimensions).toEqual({ widthX: 2, heightY: 2, lengthZ: 2 });
    expect(parsed.blocks.length).toBeGreaterThan(0);
  });

  it('deja intacto el NBT ya crudo', () => {
    const raw = new Uint8Array([0x0a, 0, 0, 0]);
    expect(inflateIfNeeded(raw)).toBe(raw);
  });
});
