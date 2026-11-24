# 02b — Decodificación de `BlockStates` (referencia normativa)

Este documento es la **única fuente de verdad** para convertir los arrays de estado de bloques de cada formato en índices de paleta. Implementarlo en un módulo compartido del parser con tests unitarios por formato. Está prohibido reimplementarlo "a ojo" en otra parte del código.

Convenciones:
- `prismarine-nbt` se usa siempre para leer el árbol NBT. En el visor, `fflate` descomprime GZIP/Zlib y se llama a `parseUncompressed`, evitando el `node:zlib` externalizado en el navegador.
- Los `TAG_Long_Array` llegan como pares `[high, low]` de enteros de 32 bits con signo. Reconstruir con `BigInt` **antes** de cualquier shift:

```ts
function longToBigInt([hi, lo]: [number, number]): bigint {
  return (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
}
```

- Los shifts y máscaras de bits se hacen siempre en `BigInt` (los operadores de 32 bits de JS rompen silenciosamente los índices altos).
- `bits = Math.max(2, Math.ceil(Math.log2(paletteSize)))` salvo indicación contraria.

---

## 1. `.litematic` (Litematica)

Estructura relevante: `Regions -> <nombre> -> Size {Width, Height, Length}`, `Position {x,y,z}`, `BlockStatePalette` (lista de `{Name, Properties}`) y `BlockStates` (long array).

1. Leer tamaños y usar **valores absolutos** (`Math.abs`). Normalizar la esquina mínima:
   - Para cada eje, si el tamaño original es negativo: `origin = position + size + 1`; si es positivo: `origin = position`.
   - El borde máximo es `origin + abs(size) - 1`. El bounding box global es el min/max de todas las regiones.
2. `bits = max(2, ceil(log2(palette.length)))`.
3. Decodificar el entry `i` (índice lineal `x + z*width + y*width*length` — verificar el orden en el fixture):

```ts
const bitIndex = BigInt(i) * BigInt(bits);
const start = Number(bitIndex >> 6n);          // long que contiene el bit inicial
const end = Number((bitIndex + BigInt(bits) - 1n) >> 6n); // puede ser distinto → entry partido
const offset = Number(bitIndex & 63n);
let value = longs[start] >> BigInt(offset);
if (start !== end) value |= longs[end] << BigInt(64 - offset);
const index = Number(value & ((1n << BigInt(bits)) - 1n));
```

> Punto crítico: en Litematica los entries **sí cruzan** el borde de 64 bits. No alinear cada entry a su propio long.

4. Resolver `index` contra `BlockStatePalette` → `{Name, Properties}`.

## 2. `.schem` v2 (Sponge)

Estructura: `Version = 2`, `Width/Height/Length`, `Palette` (mapa nombre→índice), `BlockData` (long array).

1. `bits = max(2, ceil(log2(maxPaletteIndex + 1)))`, donde el índice máximo suele ser `Palette.Max` si está presente.
2. **Los entries no cruzan longs**: cada long guarda `entriesPerLong = Math.floor(64 / bits)` entries; los bits sobrantes al final de cada long son padding.

```ts
const entriesPerLong = Math.floor(64 / bits);
const longIndex = Math.floor(i / entriesPerLong);
const bitOffset = (i % entriesPerLong) * bits;
const index = Number((longs[longIndex] >> BigInt(bitOffset)) & ((1n << BigInt(bits)) - 1n));
```

3. La paleta es un **mapa inverso**: construir `index -> "minecraft:...[props]"` invirtiendo cada entrada (el nombre puede incluir propiedades entre corchetes).
4. Longitud esperada del array: `ceil(volume / entriesPerLong)` (algunos writers añaden un long extra de padding; no asumir longitud exacta, pero sí `>=` lo necesario).

> Confundir este esquema con el de Litematica es el bug clásico: el parseo "funciona" pero produce materiales sin sentido. Por eso hay fixtures separados.

## 3. `.schem` v3 (Sponge / WorldEdit 1.20.2+)

Estructura: `Version = 3`, `Width/Height/Length`, `Palette` (global, opcional) y `Sections` (compound con claves `"x,y,z"` donde x/y/z son coordenadas de sección).

1. Cada sección presente contiene `Palette` (lista de `{Name, Properties}`) y `Data` (**byte array** de varints, no longs).
2. Leer varints con el estándar Minecraft: 7 bits por byte, bit 8 = "continúa", little-endian de grupo.
3. El `Data` de cada sección cubre 16³ posiciones. Si no existe la sección, todas sus posiciones son aire.
4. Calcular el índice local dentro de la sección: `(localY * 16 + localZ) * 16 + localX` (verificar contra el fixture de WorldEdit).
5. Construir el array global de índices/resoluciones respetando el offset de cada sección dentro del schematic.

## 4. `.nbt` (estructura vanilla / Create)

Estructura: `size: [x,y,z]`, `palette: [{Name, Properties}]`, `blocks: [{pos: [x,y,z], state: int}]`.

1. No hay bit-packing: cada entrada de `blocks` da directamente su índice `state`.
2. Si existe `palettes` (plural, lista de paletas), usar la primera; ignorar `fluids` / `fluid_palette` para materiales.
3. Índice lineal: `(pos.y * size[2] + pos.z) * size[0] + pos.x`.
4. Crear un array de tamaño `size[0]*size[1]*size[2]` inicializado en "aire" y rellenar las posiciones listadas; las ausentes son aire.

---

## 5. Salida común del módulo

```ts
interface ParsedSchematic {
  dimensions: { widthX: number; heightY: number; lengthZ: number };
  blocks: Array<{
    x: number; y: number; z: number;
    blockId: string;        // "minecraft:oak_stairs"
    properties: Record<string, string>; // facing, half, waterlogged... (solo render)
  }>;
  totalBlocks: number;      // tras exclusiones, conteo de bloques físicos
  materials: Array<{ blockId: string; displayName: string; count: number; stackSize: number }>; // ítems
}
```

`blocks` se usa en el worker del visor; `materials` se persiste en BD. El mapeo bloque→ítem y las exclusiones viven en un módulo separado y versionado (`PARSER_VERSION`).

---

## 6. Tests obligatorios (fixtures en `samples/`)

| Test | Fixture | Resultado esperado |
| :--- | :--- | :--- |
| Dimensions básicas | `basic.litematic` | Coinciden con `.expected.json` |
| Multi-región + negativos | `multi_region.litematic` | Bounding box global correcto |
| Entry cruza long | `bit_boundary.litematic` | Índice correcto en el entry de borde |
| Padding de long | `schem_v2.schem` | Índices correctos, sin desfase |
| Varints por sección | `schem_v3.schem` | Índices y paletas por sección correctos |
| Bloques por posición | `structure.nbt` | Índice lineal correcto |
| Exclusiones + waterlogged | `waterlogged.nbt` | Agua y `piston_head` fuera; `waterlogged` agrupado |
| Bloques dobles | `double_blocks.nbt` | Puertas/camas = 1 ítem con `stackSize` correcto |
| Corrupto / extensión falsa | `corrupt.*`, `fake_extension.schem` | Error controlado → HTTP `400` |

Cualquier cambio en este módulo debe ejecutar **toda** esta tabla antes de merge (regla 5 de `AGENTS.md` y CI).
