/**
 * El frontend no instala @types/node, pero los tests de Vitest se ejecutan en
 * Node y leen fixtures binarios con node:fs. Sólo declaramos lo que usan.
 */
declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array;
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}

declare module 'node:process' {
  export function cwd(): string;
}
