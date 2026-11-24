# 04 — Plan de Implementación por Fases

> **Estado:** Fases 1–4 implementadas y verificadas (73 tests de backend + 32 de frontend, typecheck, build de Vite/TypeScript y `npm audit` en verde; `docker compose build` verificado). El parser NBT real calcula dimensiones, bloques y materiales (`PARSER_VERSION=2`) en un `worker_thread`; el visor usa deepslate, el visor y el parser del navegador usan un Web Worker, y la app incluye PWA y backup ZIP.

## 1. Principios de Ejecución para el Agente

- Avanzar en **fases pequeñas, verticales y verificables**; no implementar todo el sistema de una vez sin comprobar cada capa.
- Mantener los cambios acotados a la fase activa y verificar que el proyecto compile y pase tests antes de pasar a la siguiente.
- Usar archivos reales de muestra en `samples/` para validar el parsing y el renderizado (ver `samples/README.md`).
- Toda la lógica de decodificación sigue `docs/02b-blockstates-decoding.md`; toda decisión de dominio, `docs/01` y `docs/03`.
- `user_id` y la autenticación existen **desde la Fase 1** para evitar migraciones de datos posteriormente.
- CI de GitHub Actions activa desde la Fase 1: typecheck + tests + build + Docker en cada push/PR.

---

## 2. Fase 1: Estructura Base, Usuarios, Autenticación y CRUD Inicial

**Objetivo:** levantar el esqueleto del proyecto con SQLite + Prisma, cuentas con JWT, almacenamiento en volumen y operaciones básicas de alta/consulta/edición/borrado de metadatos (sin parsing real todavía; se acepta un stub que valide NBT y devuelva dimensiones/materiales vacíos, marcando `parserVersion=0`).

**Tareas:**
1. Estructura `backend/`, `frontend/`, `samples/`, `docker-compose.yml`, `.env.example`, `README.md` y workflow de CI.
2. Esquema Prisma: `users`, `refresh_tokens`, `collections`, `schematics` (con `userId` NOT NULL); migración inicial; seed del admin desde `.env`.
3. Auth: argon2id, access JWT, refresh rotatorio en cookie `HttpOnly`, rate limit, registro configurable, cambio de contraseña, guard de rutas en frontend, pantalla de login/registro.
4. Panel admin mínimo: listar usuarios, crear usuario, reset de contraseña, cambio de rol, borrado con cascade de archivos.
5. CRUD de colecciones y de schematics (metadatos): `GET` paginado/filtrado, `GET :id`, `POST`, `PATCH`, `DELETE`, `GET :id/file`. Todo scoping por usuario; admin con `asAdmin=true`.
6. Guardado del binario con nombre UUID + extensión, validación básica de extensión/magic bytes/tamaño, limpieza de huérfanos.
7. Extracción y validación de `youtubeVideoId`.
8. i18n ES/EN instalado desde el inicio (claves de texto, sin hardcodear strings en componentes).
9. Responsive + estados vacíos/loading; fuente de la biblioteca con placeholders en tarjetas.

**Criterios de aceptación:**
- Registro/login/refresh/logout funcionan; un usuario **no ve** los schematics de otro (404).
- Se pueden crear, listar (con paginación y filtros), ver detalle, editar y eliminar registros vía API y UI.
- Los archivos persisten en el volumen y sobreviven al reinicio; `docker compose up -d --build` levanta servicios sanos.
- CI pasa: typecheck, tests y build de Docker.

---

## 3. Fase 2: Parser NBT, Validación Completa y Materiales ✅

**Objetivo:** extraer dimensiones, total de bloques y lista de materiales (como ítems) al subir o reemplazar un archivo, con validación completa y tests contra fixtures reales.

**Resultado:** `backend/src/parser/` implementa los cuatro formatos con `prismarine-nbt`, decodificación según `docs/02b` y materiales versionados (`PARSER_VERSION=2`). El parseo ocurre en `worker_thread` antes de escribir en disco o BD. Los 6 fixtures reales más 10 sintéticos tienen `.expected.json` y se validan en CI; se añadió `npm run fixtures:generate`.

**Tareas (completadas):**
1. Implementar `docs/02b-blockstates-decoding.md` en un módulo compartido: litematic (longs que cruzan), schem v2 (padding), schem v3 (varints/secciones), nbt vanilla (pos/state).
2. Añadir los fixtures de `samples/README.md` con sus `.expected.json` y la suite de tests correspondiente.
3. Validación completa: magic bytes, tamaño descomprimido (`MAX_DECOMPRESSED_MB`), `MAX_DIMENSION`, `MAX_BLOCKS`, hash SHA-256, detección de duplicados (`409` + `?force=true`), cuotas.
4. Worker del backend (`worker_thread`) para parsear sin bloquear el event loop.
5. Exclusiones ampliadas, normalización por ID base, tabla bloque→ítem versionada, bloques dobles y `stackSize`; `totalBlocks` vs `materials`.
6. Persistir `dimensions`, `totalBlocks`, `materials`, `sha256` y `parserVersion` al crear y al reemplazar archivo.
7. Endpoints `PUT /schematics/:id/file` y `POST /schematics/reparse` (admin).
8. Corregir `parserVersion=0` de la Fase 1 recalculando los registros de prueba.

**Criterios de aceptación (verificados):**
- Tests de parser contra los 6 fixtures reales y los 10 sintéticos (incluidos cruces de longs, varints de 5 bytes, regiones negativas y PaletteMax) en verde.
- Los tres formatos de cada granja real producen exactamente el mismo resumen.
- Archivos corruptos/falsos devuelven `400` sin registros ni archivos huérfanos.
- Duplicado → `409` con referencia, `?force=true` permitido.
- Materiales como ítems: exclusiones, mapeo bloque→ítem, bloques dobles y `stackSize` (`red_bed`=1, `*_sign`=16, resto=64).

---

## 4. Fase 3: Biblioteca, Visor 3D y Funciones de Construcción ✅

**Objetivo:** experiencia completa en frontend: catálogo con thumbnails, detalle con tutorial, tabla de materiales y visor 3D con todas las herramientas de construcción.

**Resultado:** `frontend/src/viewer/` contiene el visor deepslate (`Structure` + `StructureRenderer`, secciones 16³), carga de assets con concurrencia limitada, capas, resaltado, grid y regla con medición por dos clics. El parseo del binario ocurre en `viewer/parser/worker.ts`: `fflate` descomprime GZIP/Zlib y `nbt.ts` usa `parseUncompressed`, sin depender de `node:zlib`. El build aplica `scripts/patch-protodef.mjs` para corregir un `native` eliminado por el minificador en protodef y renombrar el worker para invalidar cachés inmutables. Las miniaturas se capturan del canvas y se suben con `POST /schematics/:id/thumbnail`. Los binarios y thumbnails se descargan con `fetch` + Bearer (un `<img>`/`<a>` directo no está autenticado).

**Tareas (completadas):**
1. Biblioteca: tarjetas con thumbnail/placeholder, búsqueda, filtros (tag/versión/favorito/colección), orden, paginación; alta/edición con validación y aviso de duplicado.
2. Servicio de assets con caché en volumen (`/assets/mc/{version}/...`), pre-calentado de la versión default; manejo de versión desconocida y bloques missing.
3. Visor deepslate: Web Worker (fetch + decode + mesh), geometría por secciones 16³, buffers transferibles, cámara (órbita/zoom/paneo), progreso y cancelación, `dispose()` al desmontar.
4. Slider de capa Y eficiente (reconstruir solo sección cortada).
5. Modo capa completo: vista superior 2D, materiales de la capa, navegación con flechas y contador.
6. Resaltado de material desde la tabla (hover/clic + `Esc`), compatible con el filtro Y.
7. Grid de chunks (toggle + etiquetas) y regla de medición (dos clics → dx/dy/dz y distancia).
8. Thumbnails: render isométrico offscreen al crear el schematic, subida a `/:id/thumbnail`, placeholder y regeneración al reemplazar archivo.
9. Tabla de materiales: buscador, cantidades, stacks/shulkers, export CSV/texto, checklist con `checkedMaterials` autoguardado y barra de progreso.
10. UI de colecciones y adaptación de textos ES/EN.

**Criterios de aceptación:**
- Subir una granja con video → ver video, 3D, modo capas y materiales; filtrar en biblioteca; editar/borrar.
- El slider Y y el modo capa responden fluido con 50k+ bloques; el resaltado, el grid y la medición funcionan simultáneamente.
- No hay fugas WebGL al cambiar de schematic; thumbnails aparecen en las tarjetas.

**Notas de verificación:** se validaron typecheck, 32 tests de frontend y build de producción. Los fixtures reales se parsean en el navegador con los mismos resultados que el backend. El smoke en navegador confirmó que el visor llega a `Listo`, dibuja píxeles no fondo y responde a capas, modo capa, grid, regla, medición y resaltado sin errores de consola. Se corrigieron tres problemas del bundle: `parseUncompressed` + `fflate` evita `zlib` en el parser, el post-build parchea `protodef` y renombra el worker para invalidar cachés, y se eliminó un `loseContext()` que inutilizaba el canvas tras rerenders. No se ha generado una benchmark automatizada con 50.000 bloques; el diseño evita un mesh por bloque y reutiliza recursos/mallas entre capas. Algunos renderers especiales de deepslate (cofres, carteles, cabezas) pueden caer en la textura magenta si sus texturas no están en los modelos descargados.

---

## 5. Fase 4: Endurecimiento, Backup, PWA y Despliegue Final ✅

**Objetivo:** dejar la app lista para uso diario y portable.

**Resultado:** export/import ZIP con manifest Zod y re-parseo obligatorio, PWA con `vite-plugin-pwa`, service worker que solo cachea el shell y `/assets/mc/*`, panel admin con moderación (`?asAdmin=true`), pre-calentado de assets, límites de importación y `TRUST_PROXY` para despliegues detrás de proxy.

**Tareas (completadas):**
1. Export/import ZIP (`/me/export`, `/me/import`, `/admin/export`) con manifest Zod, re-parseo de los binarios importados, cuotas y zip-slip protection.
2. PWA: manifest, service worker con caché del shell y assets; **sin** caché indiscriminada de respuestas autenticadas; actualización controlada del SW.
3. Terminar panel admin (moderación de bibliotecas ajenas, borrado de usuario con confirmación fuerte).
4. Límites y observabilidad: mensajes de error en UI, cuotas, rate limit, healthcheck, logs sin secretos.
5. README final: arranque, variables de entorno, cuentas, reverse proxy con cabeceras `Forwarded`, backup de los cuatro volúmenes y procedimiento de restore, migración a Postgres.
6. E2E del flujo completo + build de producción de Docker verificado.

**Criterios de aceptación:**
- `docker compose up -d --build` levanta todo sano; el backup ZIP se importa en una instalación limpia y reproduce bibliotecas y checklists.
- Flujo punta a punta verificado: registro → subir granja con video → 3D/capas/materiales → filtrar → exportar/importar → borrar.
- CI en verde y documentación actualizada.

**Notas de verificación:** 73 tests de backend (incluidos assets y backup) + 32 de frontend, `npm audit` en verde en ambos paquetes (i18next actualizado a 26.3.4), build de producción y `docker compose build` correctos. El flujo punta a punta se cubre con tests de API para subida/parseo/backup, el smoke HTTP del contenedor y un smoke de navegador que verificó WebGL vivo y píxeles dibujados con renderer por software; el rendimiento con GPU real y 50.000+ bloques sigue sin benchmark automatizado.
