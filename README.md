# Minelibs

Gestor privado de schematics de Minecraft (self-hosted): sube `.litematic`, `.schem` o `.nbt`, calcula dimensiones y una **lista de compra de ítems**, mira el tutorial de YouTube y construye con un visor 3D por capas. Cada usuario tiene su biblioteca privada.

## Características

- Biblioteca privada por usuario con registro abierto opcional y roles `USER`/`ADMIN`.
- Login con contraseña (argon2id) + JWT de acceso y refresh rotatorio.
- Parser NBT con prismarine-nbt para Litematica, Sponge v2/v3 y estructuras vanilla; validación de integridad y límites.
- Materiales como ítems de survival (mapeo bloque→ítem, bloques dobles, stacks/shulkers) + checklist de progreso.
- Visor 3D con deepslate: cámara, slider de capas, vista superior 2D, resaltado de material, grid de chunks con conteo y regla/medición por dos clics.
- Thumbnails automáticos, colecciones, favoritos, búsqueda y filtros.
- Export/import ZIP de la biblioteca y backup global de admin.
- PWA instalable, i18n ES/EN y SQLite por defecto (Postgres opcional).

## Estado de implementación

- ✅ **Fase 1**: backend (Fastify + Prisma + SQLite + JWT + CRUD + storage), frontend (login/registro, biblioteca, alta y detalle, ES/EN), Docker y CI.
- ✅ **Fase 2**: parser NBT real en `worker_thread` (Litematica, Sponge v2/v3 y vanilla), materiales versionados (`PARSER_VERSION=2`) y reparseo admin.
- ✅ **Fase 3**: visor deepslate con capas/vista superior, resaltado, grid, regla y medición, thumbnails, colecciones y tabla de materiales con checklist/export.
- ✅ **Fase 4**: export/import ZIP, caché de assets, PWA, panel admin completo y endurecimiento.
- 🔒 Verificado: 73 tests de backend + 32 de frontend, typecheck, build de producción, `npm audit` en verde y `docker compose build`.

## Inicio rápido

```bash
git clone <repo> && cd minelibs
cp .env.example .env
# Editar .env: JWT_SECRET, ADMIN_PASSWORD y, si se expone a internet, REGISTRATION_ENABLED=false
docker compose up -d --build
```

La app queda en `http://localhost:3000` (o el puerto configurado en `PORT`). El usuario admin se crea automáticamente con `ADMIN_USERNAME` / `ADMIN_PASSWORD` del `.env`.

### Portainer

El `docker-compose.yml` no usa `env_file`, así que no hace falta crear `/data/compose/<id>/.env` en el host de Portainer. Las variables se leen por interpolación (`${VAR:-default}`) y se pueden definir en **Stacks → Environment variables**.

Mínimo recomendado en Portainer:

```text
JWT_SECRET=<openssl rand -base64 48>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<contraseña fuerte>
REGISTRATION_ENABLED=false
```

Si despliegas desde Git, usa `docker-compose.yml` como compose path y añade esas variables en el stack. Si despliegas pegando el compose en el editor web, pega también el contenido actualizado y define las variables antes de hacer **Deploy the stack**. El resto de variables tiene valores por defecto en el propio compose.

## Configuración

Todas las variables están documentadas en [`.env.example`](.env.example). Las más importantes:

| Variable | Default | Uso |
| :--- | :--- | :--- |
| `DATABASE_URL` | `file:/data/db/minelibs.db` | SQLite (o cadena `postgresql://...`). |
| `STORAGE_DIR` / `ASSETS_DIR` / `THUMBNAILS_DIR` | `/data/...` | Volúmenes persistentes. |
| `JWT_SECRET` | — | **Obligatorio cambiarlo.** `openssl rand -base64 48`. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / … | Seed del primer administrador. **Cambiar la contraseña.** |
| `REGISTRATION_ENABLED` | `true` | Poner `false` cuando ya estén creadas las cuentas. |
| `MAX_FILE_SIZE_MB` | `25` | Límite de subida. |
| `MAX_DECOMPRESSED_MB` / `MAX_DIMENSION` / `MAX_BLOCKS` | `256` / `4096` / `10000000` | Anti zip-bomb y sanity-check. |
| `MAX_SCHEMATICS_PER_USER` / `MAX_STORAGE_MB_PER_USER` | `200` / `1024` | Cuotas. |
| `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_AUTH_WINDOW_MINUTES` | `5` / `1` | Anti fuerza bruta en login/registro. |
| `TRUST_PROXY` | `false` | Poner `true` detrás de Nginx/Cloudflare para cookies `Secure` y `X-Forwarded-*`. |
| `DEFAULT_MC_VERSION` | `1.21.4` | Versión de assets por defecto. |
| `ASSETS_UPSTREAM_URL` | `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets` | Base de la caché; se concatenan `/{version}/{ruta}`. Sin `/master`: las versiones son ramas/tags del repo. |
| `ASSETS_CACHE_TTL_SECONDS` / `ASSETS_FETCH_TIMEOUT_MS` / `ASSETS_MAX_FILE_MB` | `86400` / `10000` / `16` | Caché y descarga diferida de assets. |
| `MAX_IMPORT_ZIP_MB` / `MAX_IMPORT_ENTRIES` / `MAX_MANIFEST_KB` | `512` / `2000` / `2048` | Límites del backup ZIP. |

Detalles de arquitectura y contratos de API: [`docs/03-architecture-and-api.md`](docs/03-architecture-and-api.md).

## Desarrollo

```bash
# Backend
cd backend && npm ci && npm run dev && npm test

# Frontend
cd frontend && npm ci && npm run dev

# Verificación completa (igual que CI), desde la raíz
(cd backend && npm test && npm run build)
(cd frontend && npm test && npm run build)
docker compose build
```

La CI de GitHub Actions ejecuta typecheck, tests de parser y build de Docker en cada push/PR. `npm audit` está en verde en ambos paquetes; las `overrides` de `backend/package.json` fijan `deepmerge-ts@8` y `effect@3.22.5` para resolver avisos transitivos de Prisma 6 sin migrar a Prisma 7.

Los fixtures para tests viven en [`samples/`](samples/README.md); **no añadir archivos reales sin su `.expected.json`**. La decodificación de bits está especificada en [`docs/02b-blockstates-decoding.md`](docs/02b-blockstates-decoding.md).

## Backup y restore

- **Backup en caliente:** `GET /api/v1/me/export` descarga un ZIP con metadatos, binarios y thumbnails de tu biblioteca. `GET /api/v1/admin/export` incluye todas. Se importa con `POST /api/v1/me/import` en otra instalación.
- **Backup completo del servidor:** copiar los cuatro volúmenes `data/schematics`, `data/assets`, `data/thumbnails` y `data/db` (o `data/postgres`). `data/thumbnails` es derivado: se puede regenerar.
- **Restore:** parar contenedores, restaurar volúmenes, arrancar. Si se cambió la lógica de materiales, ejecutar `POST /api/v1/schematics/reparse` como admin para actualizar los registros con `parserVersion` antiguo.

## Reverse proxy

Si se expone mediante Nginx o Cloudflare Tunnel, activar `TRUST_PROXY=true` y reenviar las cabeceras `Forwarded` / `X-Forwarded-Proto` para que las cookies de refresh se marquen como `Secure`. Se recomienda mantener `REGISTRATION_ENABLED=false` y el rate limit activo. El `nginx.conf` incluido ya aumenta `client_max_body_size` para ZIPs de hasta `MAX_IMPORT_ZIP_MB` y no cachea `/api/` ni `/sw.js`.

## Documentación

- [`docs/01-domain-and-features.md`](docs/01-domain-and-features.md) — dominio, reglas de materiales y pantallas.
- [`docs/02-schematics-and-3d.md`](docs/02-schematics-and-3d.md) — formatos y visor 3D.
- [`docs/02b-blockstates-decoding.md`](docs/02b-blockstates-decoding.md) — decodificación de `BlockStates`.
- [`docs/03-architecture-and-api.md`](docs/03-architecture-and-api.md) — arquitectura, BD y API.
- [`docs/04-implementation-plan.md`](docs/04-implementation-plan.md) — fases de implementación.
