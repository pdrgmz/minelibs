# 02 — Formatos de Schematics y Visor 3D

## 1. Formatos Soportados y sus Diferencias

1. **`.litematic` (Litematica):**
   - GZIP + NBT. Puede contener **múltiples regiones**, cada una con `Width`, `Height`, `Length` (positivos o negativos según la selección → usar valores absolutos y normalizar coordenadas).
   - Paleta (`BlockStatePalette`) + array empaquetado de bits (`BlockStates`) por región. El empaquetado **permite que un entry cruce el límite entre dos longs** (ver `02b`).
2. **`.schem` (Sponge Schematic):**
   - **v2:** NBT (normalmente GZIP) con `Width/Height/Length`, `Palette` y `BlockData`. Los entries **no cruzan longs**: `floor(64/bits)` entries por long, con padding.
   - **v3** (WorldEdit 1.20.2+): `Data` es un **byte array de varints** y las paletas son **por sección** (`Sections`, clave `"x,y,z"`). Secciones ausentes = aire. La versión se detecta por `Version`.
3. **`.nbt` (estructura nativa vanilla / Create):**
   - GZIP + NBT con `size` (`[x,y,z]`), `palette`, `blocks` (cada entrada con `pos` y `state`). Sin empaquetado de bits. Puede existir `palettes` (plural): usar la primera.
   - También se incluyen `fluids`/`fluid_palette` en versiones nuevas: **ignorar** para materiales (los líquidos están excluidos).

> El algoritmo exacto de decodificación de cada formato (bits por entry, longs, varints, normalización de regiones) está en **`docs/02b-blockstates-decoding.md`**. Nunca reimplementarlo a ojo.

---

## 2. Reglas de Parsing y Cálculo de Datos

### 2.1 Extracción de Dimensiones

- Tamaño total por eje en enteros positivos (`widthX`, `heightY`, `lengthZ`).
- Múltiples regiones (`.litematic`): límites mínimos y máximos globales → bounding box envolvente.
- Sanity-check con `MAX_DIMENSION` y `MAX_BLOCKS` antes de asignar memoria; si se excede → `400`.

### 2.2 Extracción de Lista de Materiales

- Resolver cada índice contra su paleta (sección en v3, región en litematic).
- Filtrado: aire y bloques técnicos/líquidos (lista completa en `AGENTS.md` §4.2 y `01` §3.2).
- Normalización por ID base para agrupar; block states completos solo para render.
- **Aplicar mapeo bloque→ítem y `stackSize`** (tabla en `01` §3.2), contando bloques dobles una sola vez.
- Salida ordenada por `count DESC` con `blockId`, `displayName`, `count`, `stackSize`, `stacks`, `shulkers`.
- Calcular también **materiales por capa Y** para el modo construcción (agrupando por la coordenada Y del bloque). Estos datos se calculan en el worker del cliente a partir del mismo array de bloques, no se persisten en BD.
- `totalBlocks` = bloques físicos contabilizados; `materials` = ítems.

### 2.3 Arquitectura de Procesamiento

- **Backend:** parseo en `worker_thread` para no bloquear el event loop durante la subida. El worker devuelve dimensiones, total, materiales y SHA-256; el hilo principal escribe archivo + BD.
- **Frontend:** Web Worker descarga el binario, descomprime (fflate) y decodifica los bloques; comunica progreso (`descargando → parseando → renderizando`) y acepta cancelación al desmontar. La geometría se construye en el hilo principal con deepslate agrupando en secciones 16³.
- Si cambia la lógica de materiales, incrementar `PARSER_VERSION` y ejecutar `POST /api/v1/schematics/reparse` (admin) para recalcular todos los registros desde el binario.

---

## 3. Visor 3D en el Navegador (deepslate)

### 3.1 Requisitos del Visor

- Render en `<canvas>` con WebGL (deepslate): orbitar y zoom con controles de cámara; en modo capa la cámara se fija en vista superior.
- Filtro por capa vertical Y: slider con rango (hasta la altura seleccionada o aislar una capa) que responde en fluido incluso con 50k+ bloques.
- **Modo capa:** vista superior 2D ortográfica de la capa actual (canvas 2D o cámara top-down), navegación `anterior/siguiente` con flechas, contador `capa N de M` y lista de materiales de esa capa.
- **Resaltado de material:** clic/hover en una fila de la tabla atenúa el resto y resalta los bloques del ID elegido; compatible con el filtro Y activo; `Esc` restaura la vista.
- **Grid de chunks:** overlay de líneas cada 16 bloques en X/Z con toggle y etiquetas opcionales de coordenadas de chunk.
- **Regla de medición:** modo en que dos clics muestran `dx, dy, dz` y distancia total (reutiliza el raycast de inspección de bloque).
- **Inspección de bloque:** la medición por dos clics informa de la celda seleccionada y sus deltas; el hover de materiales resalta sus bloques.

### 3.2 Rendimiento y Recursos

- **Nunca** crear un mesh/objeto DOM por bloque: geometría agrupada en **secciones de 16×16×16** (chunk sections) con `Structure`/`StructureRenderer` de deepslate (`chunkSize: 16`).
- El filtro Y reconstruye la `Structure` con solo los bloques visibles reutilizando definiciones, modelos, atlas y renderer; cambiar de capa no recarga assets.
- Los block states completos (facing, half, waterlogged) se usan aquí, aunque los materiales usen solo el ID base.
- Bloques sin modelo en los assets cargados → texto missing (morado/negro) por defecto; aceptable, no debe romper la escena.
- **Assets de Minecraft:** el frontend los carga desde `GET /assets/mc/{minecraftVersion}/assets/minecraft/...` servido por el backend con caché en `/data/assets`. Si la versión no existe o es vaga (`1.20.x`), se usa `DEFAULT_MC_VERSION`. La versión por defecto se pre-calienta al arrancar. El service worker de la PWA puede cachear los assets (no son datos autenticados sensibles).
- **Thumbnails:** al crear el schematic, el mismo pipeline renderiza una vista isométrica fija 256×256 en canvas offscreen → PNG → `POST /:id/thumbnail` → `/data/thumbnails/{uuid}.png`. Placeholder si no existe; regenerar al reemplazar archivo; borrar con el schematic.
- **Limpieza:** al desmontar el visor se cancelan frames y listeners, se borran buffers/programas propios, se llama a `dispose()` si el renderer lo expone y se libera el contexto con `WEBGL_lose_context`; el worker se termina desde el hook de parseo.

### 3.3 Pruebas con Archivos Reales (`samples/`)

Ver `samples/README.md` para la lista de fixtures. Casos mínimos:

- Dimensiones `X`, `Y`, `Z` correctas (incluido bounding box multi-región y tamaños negativos).
- Exclusión de aire/líquidos y agrupación por ID base + mapeo a ítems (incluidos bloques dobles).
- Casos de borde de bit-packing: entry que cruza longs (litematic) y padding de long (schem v2); varints por sección (v3).
- Rechazo limpio de archivos corruptos y de extensión falsa (`400`).
- Test de render en headless (si aplica) y de que el visor no crece en memoria al cambiar de schematic.
