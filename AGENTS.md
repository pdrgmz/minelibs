# AGENTS.md — Gestor Privado de Schematics de Minecraft

## 1. Propósito del Proyecto

Aplicación web self-hosted para gestionar bibliotecas **privadas por usuario** de granjas y construcciones de Minecraft. Permite almacenar archivos de schematics (.litematic, .schem, .nbt), asociarlos con metadatos y tutoriales de YouTube, calcular automáticamente sus dimensiones y lista de materiales (como ítems de compra), visualizarlos en un visor 3D interactivo en el navegador y construirlos capa a capa. Incluye cuentas de usuario con JWT, modo offline parcial (PWA) y exportación/importación de la biblioteca.

---

## 2. Stack Tecnológico y Arquitectura

- **Frontend:** TypeScript, React (Vite), Tailwind CSS, PWA (service worker con caché del shell y assets; **nunca** cachear respuestas autenticadas de forma indiscriminada).
- **Motor 3D & Parsing de Minecraft:**
  - deepslate (renderizado WebGL de estructuras y bloques de Minecraft, mallas por secciones 16×16×16).
  - prismarine-nbt (descompresión GZIP/Zlib y lectura de árboles NBT).
  - Algoritmos de empaquetado de bits documentados en `docs/02b-blockstates-decoding.md`.
- **Backend:** Node.js + Fastify (TypeScript). Parseo en `worker_thread`; subida, streaming y rate limiting en el hilo principal.
- **Base de Datos:** SQLite + Prisma por defecto (archivo en volumen persistente); Postgres opcional vía `DATABASE_URL`.
- **Autenticación:** usuarios con contraseñas argon2id, JWT de acceso (15 min) + refresh token rotatorio (7 días) en cookie `HttpOnly`.
- **Almacenamiento de Archivos:** sistema de archivos local montado en volumen Docker (`/data/schematics`, `/data/assets`, `/data/thumbnails`) con nombres sanitizados (UUID + extensión original).
- **Infraestructura:** Docker & docker-compose, CI con GitHub Actions (tests de parsers + build en cada push/PR).

---

## 3. Estructura del Repositorio

```text
/
├── AGENTS.md                     # Reglas y contexto global (este archivo)
├── README.md                     # Arranque, configuración y backups
├── .env.example                  # Todas las variables documentadas
├── .github/workflows/ci.yml      # Typecheck + tests + build + Docker
├── docs/
│   ├── 01-domain-and-features.md
│   ├── 02-schematics-and-3d.md
│   ├── 02b-blockstates-decoding.md
│   ├── 03-architecture-and-api.md
│   └── 04-implementation-plan.md
├── samples/                      # Fixtures reales + .expected.json (ver samples/README.md)
├── backend/                      # API REST, auth, lógica de negocio y persistencia
├── frontend/                     # SPA, visor 3D y gestión de biblioteca
└── docker-compose.yml            # Orquestación de servicios y volúmenes
```

---

## 4. Reglas Críticas de Implementación (NO VIOLAR)

1. **Prohibido parsear binarios NBT a mano:** Nunca intentes leer bytes crudos o usar expresiones regulares sobre archivos .litematic, .schem o .nbt. Usa siempre prismarine-nbt (u otra librería NBT validada) manejando previamente la descompresión GZIP. La decodificación de `BlockStates` sigue `docs/02b-blockstates-decoding.md`.

2. **Normalización de bloques en materiales:**
   - Excluye siempre aire (`minecraft:air`, `cave_air`, `void_air`, `structure_void`) **y** bloques no obtenibles/técnicos (`water`, `lava`, `bubble_column`, `piston_head`, `moving_piston`, `fire`, `soul_fire`, `light`, `frosted_ice`, `nether_portal`, `end_portal`, `end_gateway`).
   - Agrupa por ID base sin propiedades (`minecraft:repeater[delay=2,...]` → `minecraft:repeater`); los block states completos se conservan solo para renderizado.
   - La lista de materiales es una **lista de compra de ítems**: aplica la tabla versionada bloque→ítem (`redstone_wire`→`redstone`, `wall_torch`→`torch`, …), cuenta bloques dobles (puertas/camas/plantas altas) como 1 ítem y usa `stackSize` por ítem (camas=1, carteles=16, resto=64). Lo que no esté en la tabla pasa con su ID base.
   - `totalBlocks` cuenta bloques físicos (con las exclusiones de aire/técnicos); `materials` cuenta ítems.

3. **Validación de archivos subidos:**
   - Acepta exclusivamente `.litematic`, `.schem` y `.nbt`.
   - Valida magic bytes (`1F 8B` GZIP o `0x0A` NBT crudo), integridad del árbol NBT, tamaño descomprimido (`MAX_DECOMPRESSED_MB`), dimensión máxima por eje (`MAX_DIMENSION`) y volumen (`MAX_BLOCKS`) **antes** de escribir en disco o BD. Errores → HTTP `400` claro.
   - Aplica cuotas por usuario y detecta duplicados por SHA-256 (devolver `409` con opción de `?force=true`).

4. **Manejo de URLs de YouTube:**
   - Acepta formatos estándar (watch, youtu.be, shorts), extrae `youtubeVideoId` (11 caracteres) para `https://www.youtube-nocookie.com/embed/{id}` y conserva la URL original.

5. **Rendimiento en el Visor 3D:**
   - Granjas de 50.000+ bloques: parseo en Web Worker, geometría por secciones 16³ con buffers transferibles, **nunca** un mesh/elemento DOM por bloque.
   - Incluye siempre control deslizante de capa Y, modo capa (vista superior 2D + materiales de la capa), resaltado de material, grid de chunks y regla de medición.
   - Los assets de Minecraft se sirven desde `/assets/mc/{version}/...` con caché en volumen; la versión por defecto se pre-calienta. Limpiar recursos WebGL/listeners al desmontar.

---

## 5. Convenciones de Código y Calidad

- **Tipado estricto:** `strict: true` en TypeScript; prohibido `any` sin justificación explícita.
- **Validación de entradas:** todo payload de API se valida con Zod (incluidos manifests de importación ZIP).
- **Seguridad:** contraseñas con argon2id; access JWT de corta duración + refresh rotatorio en cookie `HttpOnly`; `user_id` obligatorio; un recurso ajeno devuelve `404` (nunca `403`, para no revelar existencia); rate limit en login/registro; rutas de archivo siempre derivadas de UUID (nunca del nombre original).
- **Testing obligatorio en parsers:** cualquier cambio en la lectura de .litematic, .schem o .nbt debe pasar pruebas unitarias contra los archivos reales en `samples/` (ver `samples/README.md`).
- **Variables de entorno:** nunca hardcodear rutas, puertos, secretos, límites ni credenciales. Todo documentado en `.env.example`.
- **CI obligatoria:** GitHub Actions ejecuta typecheck, tests de parser y build de Docker en cada push/PR.

---

## 6. Flujo de Trabajo para Agentes

1. Antes de escribir código de una nueva funcionalidad, lee el documento correspondiente en `docs/` (y `02b` si tocas decoding).
2. Implementa de forma incremental siguiendo `docs/04-implementation-plan.md` (Fase 1: base + auth + SQLite + CI; Fase 2: parser; Fase 3: biblioteca + visor + features; Fase 4: endurecimiento, backup y PWA).
3. Tras modificar lógica de parsing, autenticación o API, ejecuta la suite de tests y verifica que el build de Docker compile sin errores.
4. Si cambias la lógica de materiales, incrementa `PARSER_VERSION` y usa el endpoint de reparse para recalcular los registros existentes.
