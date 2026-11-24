# samples/ — fixtures para tests del parser

Aquí se guardan los archivos usados por la suite de tests del parser (regla crítica 5 de `AGENTS.md`). Todos se leen exclusivamente con `prismarine-nbt`; **nunca** se parsean bytes a mano.

## Fixtures reales

Dos granjas exportadas en los tres formatos soportados. Los tres formatos de cada granja producen exactamente el mismo resumen, lo que verifica la decodificación de forma cruzada:

| Granja | Archivos |
| :--- | :--- |
| `granja-de-cooblestone-rapida` | `.litematic`, `.schem`, `.nbt` (17×24×15) |
| `bamboo-farm-720k-bamboo-per-hour-bonemeal-dependent` | `.litematic`, `.schem`, `.nbt` (13×8×18) |

## Fixtures sintéticos

Generados por `backend/scripts/generate-fixtures.ts` (`npm run fixtures:generate` desde `backend/`). Cubren los casos que los archivos reales no alcanzan:

| Archivo | Propósito |
| :--- | :--- |
| `basic.litematic` | Una región 2×2×2, aire + stone + dirt (bits=2). |
| `multi_region.litematic` | Dos regiones, una con tamaño negativo → bounding box global 6×2×6. |
| `bit_boundary.litematic` | Entry de 6 bits que cruza el borde entre dos longs. |
| `schem_v2.schem` | Sponge v2 con padding de entries dentro de cada long. |
| `schem_v3.schem` | Sponge v3 con `Sections` y `Data` en varints. |
| `structure.nbt` | Estructura vanilla (`size`, `palette`, `blocks`). |
| `waterlogged.nbt` | Agua/lava/bloques técnicos excluidos; `oak_stairs` waterlogged agrupadas. |
| `double_blocks.nbt` | Puertas, camas, plantas altas y cartel de pared → 1 ítem por par. |
| `corrupt.litematic` | GZIP válido con NBT inválido → debe devolver `400`. |
| `fake_extension.schem` | GZIP válido pero no NBT → debe devolver `400`. |

## Reglas

- Los archivos binarios están marcados como `binary` en `.gitattributes` (**nunca** normalizarlos con Git).
- Cada fixture lleva un `<archivo>.expected.json` con `dimensions`, `totalBlocks` y `materials` (o `{"expectError": true}`). Se generan con el propio parser y se comprueban en los tests; los reales están además verificados por concordancia entre los tres formatos.
- Al cambiar exclusiones, mapeo bloque→ítem o `stackSize`, incrementar `PARSER_VERSION` y ejecutar `npm run fixtures:generate` antes de `npm test`.
- No se usa Git LFS mientras los archivos sean pequeños; se reconsiderará si el directorio supera unos pocos MB.
- Licencia: usar solo schematics propios o con licencia que permita redistribución en el repo.
