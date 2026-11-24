# 03 — Arquitectura, Base de Datos y API

## 1. Arquitectura General

Monolito modular (Fastify + TypeScript) pensado para un servidor doméstico detrás de reverse proxy (Nginx / Cloudflare Tunnel):

- **Frontend (SPA):** React + Vite servido como estáticos por Nginx o por el propio backend en producción. Gestiona login, biblioteca, visor 3D, modo capas, PWA y el service worker (caché del shell y de assets; **nunca** cachear respuestas autenticadas de forma indiscriminada).
- **Backend (API REST):** recibe subidas por streaming, valida, delega el parseo a un `worker_thread`, guarda el binario, persiste metadatos, sirve assets y thumbnails, gestiona auth y export/import.
- **Almacenamiento:** volúmenes persistentes `/data/schematics` (binarios con nombre `{uuid}.{ext}`), `/data/assets` (caché de assets de Minecraft), `/data/thumbnails` (PNG derivados) y `/data/db` (SQLite).
- **Base de datos:** **SQLite + Prisma por defecto** (`DATABASE_URL=file:/data/db/minelibs.db`). Postgres opcional cambiando `DATABASE_URL` y el servicio de compose; los campos JSONB se modelan como `TEXT` con JSON serializado para portabilidad.
- **Seguridad:** cada usuario ve solo su biblioteca; `user_id` obligatorio en todo lo que pertenezca a un usuario; recurso ajeno → `404`. Admin puede moderar todo.

### 1.1 Autenticación

- Contraseñas hasheadas con **argon2id**; mínimo 10 caracteres.
- **Access JWT** de 15 min (`JWT_ACCESS_MINUTES`), enviado en `Authorization: Bearer`; se guarda en memoria en el frontend.
- **Refresh token** opaco de 7 días (`JWT_REFRESH_DAYS`) en cookie `HttpOnly`, `SameSite=Strict`, `Secure` en producción; se rota en cada uso y se almacena su hash en BD. Logout invalida el token actual y todos los del usuario si se cambia la contraseña.
- `JWT_SECRET` obligatorio desde `.env`.
- Registro abierto si `REGISTRATION_ENABLED=true`; admin inicial creado por seed con `ADMIN_USERNAME`/`ADMIN_PASSWORD`.
- Rate limit (por IP) en `/auth/login` y `/auth/register`: `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_AUTH_WINDOW_MINUTES`.
- Cuotas: `MAX_SCHEMATICS_PER_USER` y `MAX_STORAGE_MB_PER_USER` comprobadas al subir/importar.
- El refresh de sesión y el guard de rutas del frontend deben renovar el access antes de que expire, con single-flight para no disparar varias peticiones.

---

## 2. Modelo de Datos

### `users`

| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | PK | Identificador |
| `username` | `VARCHAR(32)` | NOT NULL, UNIQUE | `[a-z0-9_-]`, 3–32 |
| `passwordHash` | `VARCHAR(255)` | NOT NULL | argon2id |
| `role` | `VARCHAR(16)` | NOT NULL DEFAULT `USER` | `USER` / `ADMIN` |
| `createdAt` | `TIMESTAMP` | NOT NULL | Alta |

### `refresh_tokens`

| Columna | Tipo | Restricciones |
| :--- | :--- | :--- |
| `id` | `UUID` | PK |
| `userId` | `UUID` | FK → users, ON DELETE CASCADE |
| `tokenHash` | `VARCHAR(64)` | NOT NULL, UNIQUE (SHA-256 del token) |
| `expiresAt` | `TIMESTAMP` | NOT NULL |
| `revokedAt` | `TIMESTAMP` | NULL |

### `collections`

| Columna | Tipo | Restricciones |
| :--- | :--- | :--- |
| `id` | `UUID` | PK |
| `userId` | `UUID` | FK → users, ON DELETE CASCADE |
| `name` | `VARCHAR(100)` | NOT NULL |
| `description` | `TEXT` | NULL |
| `createdAt` | `TIMESTAMP` | NOT NULL |

### `schematics`

| Columna | Tipo | Restricciones | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | PK | Identificador |
| `userId` | `UUID` | FK → users, ON DELETE CASCADE | Propietario (índice) |
| `collectionId` | `UUID` | FK → collections, ON DELETE SET NULL, NULL | Colección opcional |
| `name` | `VARCHAR(150)` | NOT NULL | Nombre |
| `description` | `TEXT` | NULL | Notas |
| `youtubeUrl` | `VARCHAR(500)` | NULL | Enlace original |
| `youtubeVideoId` | `VARCHAR(20)` | NULL | ID de 11 caracteres para embed |
| `minecraftVersion` | `VARCHAR(32)` | NULL | `1.21.4`, `1.20.x`… |
| `edition` | `VARCHAR(16)` | NOT NULL DEFAULT `JAVA` | `JAVA` / `BEDROCK` |
| `tags` | `TEXT` (JSON) | NOT NULL DEFAULT `[]` | Etiquetas |
| `isFavorite` | `BOOLEAN` | NOT NULL DEFAULT FALSE | La biblioteca es privada |
| `checkedMaterials` | `TEXT` (JSON) | NOT NULL DEFAULT `[]` | Ítems marcados en el checklist |
| `format` | `VARCHAR(16)` | NOT NULL | `LITEMATIC` / `SCHEM` / `NBT` |
| `originalFilename` | `VARCHAR(255)` | NOT NULL | Nombre al subir |
| `storageFilename` | `VARCHAR(255)` | NOT NULL UNIQUE | `{uuid}.{ext}` |
| `fileSizeBytes` | `BIGINT` | NOT NULL | Bytes |
| `sha256` | `VARCHAR(64)` | NOT NULL, índice | Hash (único **por usuario**, no global) |
| `parserVersion` | `INTEGER` | NOT NULL DEFAULT 0 (legado) | Versión de lógica de parsing; la actual es `PARSER_VERSION=2` |
| `widthX` / `heightY` / `lengthZ` | `INTEGER` | NOT NULL | Dimensiones |
| `totalBlocks` | `INTEGER` | NOT NULL | Bloques físicos (sin aire/técnicos) |
| `materials` | `TEXT` (JSON) | NOT NULL | `[{ blockId, displayName, count, stackSize }]` ordenado |
| `thumbnail` | `BOOLEAN` | NOT NULL DEFAULT FALSE | Existe PNG en /data/thumbnails |
| `createdAt` / `updatedAt` | `TIMESTAMP` | NOT NULL | Fechas |

Notas:
- Guardar `materials` precalculado evita re-parsear en cada lectura; `parserVersion` permite detectar registros obsoletos y recalcularlos con `/reparse`.
- El thumbnail es derivado y prescindible: se puede regenerar; se borra con el schematic.
- Índices recomendados: `(userId, createdAt)`, `(userId, sha256)`, `(userId, collectionId)`, `(userId, isFavorite)`.

---

## 3. Contratos de la API REST (`/api/v1`)

Todas las rutas salvo `/auth/login`, `/auth/register` y `/assets/mc/*` exigen access JWT válido. Las rutas de schematic se filtran por `userId` del token; un ID ajeno devuelve `404`. El admin puede usar los endpoints `/admin/*` para ver/modificar cualquier biblioteca, y `GET /schematics/:id` con `asAdmin=true` para moderación.

### 3.1 Autenticación

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `POST` | `/auth/register` | `{ username, password }` → `201` con datos del usuario (si `REGISTRATION_ENABLED=false`, `403`). Rate limit. |
| `POST` | `/auth/login` | `{ username, password }` → `200` `{ accessToken, user }` + cookie refresh. Rate limit. |
| `POST` | `/auth/refresh` | Rota el refresh cookie → nuevo access token. |
| `POST` | `/auth/logout` | Revoca el refresh actual. |
| `GET` | `/auth/me` | Usuario autenticado. |
| `POST` | `/auth/password` | `{ currentPassword, newPassword }` → revoca todos los refresh. |

### 3.2 Administración (rol `ADMIN`)

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `GET` | `/admin/users` | Lista de usuarios (paginada). |
| `POST` | `/admin/users` | Crear usuario (para registro cerrado). |
| `PATCH` | `/admin/users/:id` | Cambiar rol o reset de contraseña. |
| `DELETE` | `/admin/users/:id` | Borrar usuario + **todos** sus schematics, archivos y thumbnails (confirmación explícita en UI). |
| `GET` | `/admin/schematics` | Lista global para moderación. |
| `GET` | `/admin/export` | ZIP con **todas** las bibliotecas (backup global). |
| `POST` | `/schematics/reparse` | Recalcula registros con `parserVersion` antiguo desde el binario (tarea admin). |

### 3.3 Colecciones

- `GET /collections` → lista del usuario.
- `POST /collections` → `{ name, description? }`.
- `PATCH /collections/:id` → edita nombre/descripción.
- `DELETE /collections/:id` → los schematics quedan con `collectionId = null`.

### 3.4 Schematics

**`GET /schematics`** — Query params: `q` (texto en nombre/descripción/tags), `tag`, `version`, `favorite`, `collectionId`, `page` (default 1), `limit` (default 24, máx 100), `sort` (`createdAt` | `name` | `totalBlocks` | `updatedAt`).

`200` → `{ items: [...], total, page, limit }`. Cada item omite `materials`: `id`, `name`, `youtubeVideoId`, `minecraftVersion`, `tags`, `isFavorite`, `format`, `collectionId`, `dimensions`, `totalBlocks`, `thumbnailUrl`, `createdAt`.

**`GET /schematics/:id`** — Objeto completo: metadatos, `dimensions`, `totalBlocks`, `materials` (ordenado `count DESC`), `checkedMaterials`, `fileUrl`, `thumbnailUrl`. `404` si no existe o es ajeno.

**`POST /schematics`** (`multipart/form-data`) — Campos: `file`, `name`, `description?`, `youtubeUrl?`, `minecraftVersion?`, `tags?` (JSON array o CSV), `collectionId?`, `isFavorite?`.
Flujo (ver §4): validar → parsear en worker → comprobar cuotas → SHA-256 (duplicado → `409` con `{ existingId, existingName }`; `?force=true` lo permite) → escribir archivo → insertar BD → limpiar huérfano si falla la BD. Respuesta `201` con el detalle.

**`PATCH /schematics/:id`** — Metadatos, `collectionId`, `isFavorite`, `checkedMaterials`. No re-parsea.

**`PUT /schematics/:id/file`** — Reemplaza el binario, lo parsea en un worker, recalcula dimensiones/materiales/SHA-256/`parserVersion`, conserva metadatos e ID. Borra el binario anterior, el thumbnail y marca `thumbnail=false`.

**`DELETE /schematics/:id`** — `204`; borra registro, binario y thumbnail.

**`GET /schematics/:id/file`** — Stream del binario. `Content-Disposition: inline` para carga en el visor; `?download=1` → `attachment; filename="{originalFilename}"`.

**`POST /schematics/:id/thumbnail`** — Sube el PNG 256×256 generado en cliente (multipart); valida tipo y tamaño; guarda en `/data/thumbnails/{uuid}.png` y marca `thumbnail=true`.

**`GET /schematics/:id/thumbnail`** — Imagen con caché (`Cache-Control: public, max-age=86400`); `404` si no hay. Requiere JWT igual que el resto de la API: el frontend la descarga con `fetch` + Bearer y la muestra como object URL (un `<img src>` directo no envía la cabecera). Lo mismo aplica a `GET /schematics/:id/file` para descargas.

### 3.5 Export / Import

- **`GET /me/export`** → ZIP: `manifest.json` (versión de esquema, metadatos de todas las schematics y colecciones del usuario, `checkedMaterials`, `materials`) + `files/{uuid}.{ext}` + `thumbnails/{uuid}.png`.
- **`POST /me/import`** (multipart ZIP) → valida `manifest.json` con Zod, comprueba cuotas y SHA-256, **re-parsea cada binario** (regla: nunca guardar algo no parseado), crea nuevos UUIDs e inserta en la biblioteca del usuario. Devuelve resumen `{ imported, skipped, errors }`.
- **`GET /admin/export`** → igual, pero con todas las bibliotecas.

### 3.6 Assets y salud

- **`GET /assets/mc/{version}/assets/minecraft/{path}`** → archivo de assets (blockstates/models/textures) servido desde `/data/assets`; si no está cacheado, se descarga de `ASSETS_UPSTREAM_URL` y se guarda. Versión desconocida/vaga → `DEFAULT_MC_VERSION`. Solo rutas relativas bajo `assets/minecraft` (rechazar `..`).
- **`GET /health`** → `{ status: "ok", db: "ok", assets: "ok" }`. Usado por el healthcheck de Docker.

### 3.7 Errores

| Código | Caso |
| :--- | :--- |
| `400` | Extensión/magic bytes/NBT inválidos, dimensiones fuera de rango, payload inválido (Zod). |
| `401` | Access token ausente/expirado y refresh inválido. |
| `403` | Registro desactivado, rol insuficiente. |
| `404` | Recurso inexistente o de otro usuario (también archivos y thumbnails). |
| `409` | SHA-256 duplicado (con `existingId`). |
| `413` | Archivo/cuota de almacenamiento excedida. |
| `429` | Rate limit de auth o cuota de schematics excedida. |

---

## 4. Flujo de Subida y Validación

1. Streaming del multipart con límite `MAX_FILE_SIZE_MB` aplicado **mientras se recibe** (cortar temprano).
2. Comprobar extensión (`litematic`/`schem`/`nbt`) y magic bytes: `1F 8B` (GZIP) o `0x0A` (NBT crudo sin comprimir).
3. Descomprimir con límite `MAX_DECOMPRESSED_MB` (anti zip-bomb) y parsear con prismarine-nbt en `worker_thread`.
4. Decodificar `BlockStates` según `02b`; sanity-check de `MAX_DIMENSION` / `MAX_BLOCKS`.
5. Calcular `totalBlocks`, `materials` (ítems, mapeo y `stackSize`), `dimensions` y SHA-256.
6. Cuotas del usuario y deduplicación (`sha256` por usuario, `?force=true`).
7. Escribir archivo en `/data/schematics/{uuid}.{ext}` y fila en BD; si falla la BD, borrar el archivo huérfano.
8. El frontend genera el thumbnail con deepslate y lo sube; si falla, no bloquea el alta (placeholder).

---

## 5. Despliegue (`docker-compose.yml`)

- **Servicios:** `app` (backend + estáticos del frontend en puerto interno configurable) y `db` (PostgreSQL 16 con healthcheck) **solo** si `DATABASE_URL` apunta a Postgres; con SQLite se prescinde del contenedor `db`.
- **Volúmenes:** `./data/schematics`, `./data/assets`, `./data/thumbnails` y `./data/db` (o `./data/postgres`).
- **Healthcheck:** `GET /health` en `app`; arranque de la app condicionado a DB sana si aplica.
- **Variables:** todas las de `.env.example` (ver §1 y §4); nunca valores hardcodeados.
- **Reverse proxy:** documentar en README cabeceras `Forwarded`/`X-Forwarded-*` para cookies `Secure` detrás de Cloudflare/Nginx.

## 6. Seguridad Adicional

- Rutas de archivo siempre derivadas de UUID + extensión fija; rechazar `..` en rutas de assets e imports ZIP (zip-slip).
- Límites de tamaño de JSON y de manifest de importación.
- No logear contraseñas, tokens ni contenido de archivos.
- CORS: mismo origen por defecto; no habilitar `*`.
- El service worker solo cachea el shell, assets de Minecraft y respuestas públicas; nunca `fetch` autenticadas.
