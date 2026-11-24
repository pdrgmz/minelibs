# 01 — Especificación Funcional y de Dominio

## 1. Objetivo del Producto

Proporcionar bibliotecas **privadas por usuario**, rápidas y visuales para organizar granjas y construcciones de Minecraft, centralizando en un solo lugar:

- El archivo del schematic (`.litematic`, `.schem`, `.nbt`).
- El enlace y reproductor del tutorial de YouTube.
- La información descriptiva y técnica (nombre, descripción, versión de Minecraft, categorías/tags, colección).
- Las dimensiones exactas de la estructura (`X × Y × Z`).
- La lista de materiales calculada automáticamente como **ítems de compra** para survival.
- El modelo 3D interactivo en el navegador, con modo de construcción por capas.

La aplicación es multi-usuario: cada cuenta tiene su propia biblioteca aislada. El registro es abierto (configurable), con un rol `ADMIN` que puede moderar todas las bibliotecas y gestionar cuentas.

---

## 2. Entidades del Dominio

### 2.1 Usuario (`User`)

| Campo | Descripción |
| :--- | :--- |
| `id` | UUID. |
| `username` | Único, 3–32 caracteres `[a-z0-9_-]`. |
| `passwordHash` | argon2id (nunca contraseña en claro ni hash casero). |
| `role` | `ADMIN` o `USER`. |
| `createdAt` | Fecha de alta. |

- Registro abierto por defecto (`REGISTRATION_ENABLED=true` en `.env`); se puede desactivar sin tocar código.
- Un admin inicial se crea por seed con `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
- Cuotas por usuario: `MAX_SCHEMATICS_PER_USER` y `MAX_STORAGE_MB_PER_USER`.
- Rate limit en registro y login: `RATE_LIMIT_AUTH_MAX` intentos por `RATE_LIMIT_AUTH_WINDOW_MINUTES`.
- Contraseña mínima de 10 caracteres. Un recurso de otro usuario devuelve `404`.

### 2.2 Colección (`Collection`)

Agrupa schematics por mundo o proyecto (ej. *"Supervival 1.21"*, *"Servidor de amigos"*).

- `id` (UUID), `name` (obligatorio), `description` (opcional), `userId` (propietario), `createdAt`.
- Un schematic pertenece como máximo a una colección (`collectionId` nullable). Al borrar una colección, sus schematics quedan sin colección (no se borran).
- La biblioteca se puede filtrar por colección.

### 2.3 Schematic (Granja / Construcción)

#### Campos ingresados o editados por el usuario

- **ID (`id`):** UUID.
- **Nombre (`name`):** obligatorio, texto corto (ej. *"Granja de hierro 1.21"*).
- **Descripción (`description`):** opcional, multilínea para notas personales (tasas, chunk loading, ubicación, ajustes al diseño original).
- **URL de YouTube (`youtubeUrl`):** opcional; se valida y normaliza para extraer `youtubeVideoId` (11 caracteres). Se conserva la URL original.
- **Versión de Minecraft (`minecraftVersion`):** opcional pero recomendada (`1.21.4`, `1.21`, `1.20.x`); determina los assets del visor.
- **Edición (`edition`):** por defecto `JAVA` (`JAVA` o `BEDROCK`).
- **Categorías / Tags (`tags`):** lista (`hierro`, `aldeanos`, `redstone`, `xp`, `comida`, `perímetro`).
- **Favorito (`isFavorite`):** booleano; la biblioteca es privada, así que no hace falta tabla intermedia por usuario.
- **Colección (`collectionId`):** opcional (ver 2.2).
- **Materiales marcados (`checkedMaterials`):** lista de IDs de ítems ya conseguidos, para el checklist.

#### Campos derivados automáticamente al procesar el archivo

- **Formato (`format`):** `LITEMATIC`, `SCHEM` o `NBT`.
- **Nombre original (`originalFilename`)** y **ruta segura (`storagePath`)** (UUID + extensión).
- **Tamaño (`fileSizeBytes`)** y **SHA-256 (`sha256`)** del binario (detección de duplicados por usuario).
- **Dimensiones (`dimensions`):** `widthX`, `heightY`, `lengthZ` (enteros positivos en bloques).
- **Total de bloques físicos (`totalBlocks`)** (sin aire ni bloques técnicos).
- **Lista de materiales (`materials`):** ítems necesarios, ordenada por `count DESC`.
- **`parserVersion`:** versión de la lógica de parsing usada; permite recalcular con `/reparse`.
- **Thumbnail (`thumbnailUrl`):** PNG opcional generado en el cliente.

---

## 3. Reglas de Negocio para Dimensiones y Materiales

### 3.1 Dimensiones (`X`, `Y`, `Z`)

- Bounding box real en bloques, legible en formato compacto (`32 × 18 × 24`) y desglosado.
- Si un `.litematic` tiene múltiples regiones/subregiones, se calcula el bounding box envolvente global (mínimo a máximo en cada eje). Los tamaños negativos se normalizan.
- Detalles de decodificación: ver `docs/02b-blockstates-decoding.md`.

### 3.2 Lista de Materiales (lista de compra de ítems)

Cada ítem contiene `blockId` (ID de Minecraft del **ítem** resultante), `displayName`, `count`, `stackSize`, `stacks` y `shulkers` (estos dos últimos calculados en el servicio de presentación).

**Exclusiones obligatorias:** aire (`air`, `cave_air`, `void_air`, `structure_void`) y bloques no obtenibles/técnicos: `water`, `lava`, `bubble_column`, `piston_head`, `moving_piston`, `fire`, `soul_fire`, `light`, `frosted_ice`, `nether_portal`, `end_portal`, `end_gateway`. Un `waterlogged=true` no cambia el conteo: el ID base manda.

**Normalización:** los block states (`facing`, `half`, `delay`, `waterlogged`…) se ignoran para materiales y se conservan solo para el renderizado 3D.

**Mapeo bloque → ítem** (tabla versionada en backend):

| Entrada del schematic | Ítem de la lista | Regla adicional |
| :--- | :--- | :--- |
| `minecraft:redstone_wire` | `minecraft:redstone` | — |
| `minecraft:wall_torch`, `soul_wall_torch` | `torch`, `soul_torch` | — |
| `*_wall_sign` | `*_sign` | — |
| `*_door` (upper + lower) | `*_door` | contar solo la mitad `lower` |
| `*_bed` (head + foot) | `*_bed` | contar solo `foot` |
| plantas altas (upper + lower) | índice base | contar solo `lower` |
| macetas | maceta + planta | dos entradas (si aplica) |
| cualquier otro ID | el mismo ID base | pass-through |

**Tamaños de pila:** por defecto 64; excepciones conocidas en la tabla (camas = 1, carteles = 16, velas apilables hasta 16, etc.). Equivalencias: `1 stack = stackSize` ítems, `1 shulker = 27 stacks`.

**Ordenamiento y filtrado:** por defecto `count DESC`; buscador por nombre o `blockId`; copiar/exportar a texto plano o CSV.

**Checklist:** el usuario marca ítems conseguidos; `checkedMaterials` se persiste con PATCH autoguardado y se muestra una barra de progreso. Botón de reinicio.

---

## 4. Pantallas y Flujos de Usuario

### 4.1 Acceso y cuenta

- **Login** (username + contraseña): access JWT en memoria, refresh en cookie `HttpOnly`; expiración silenciosa y renovación automática.
- **Registro** abierto salvo que `REGISTRATION_ENABLED=false`. Rate limit visible con mensaje claro.
- **Menú de usuario:** cambiar contraseña, cerrar sesión.
- Si el usuario es `ADMIN`: panel de gestión de cuentas (crear usuario, reset de contraseña, cambio de rol, borrar usuario con confirmación fuerte) y acceso a bibliotecas ajenas para moderación.

### 4.2 Biblioteca Principal (Catálogo)

- Grid de tarjetas (con **thumbnail** del modelo, o placeholder) y vista de lista compacta.
- Cada tarjeta: nombre, tags/versión, dimensiones, indicador de tutorial, total de bloques, favorito y colección.
- Búsqueda por texto (nombre/descripción/tags); filtros por tag, versión, favorito y colección; `favorite=true`.
- Paginación (`page` / `limit`, 24 por página) y orden (`createdAt`, `name`, `totalBlocks`, `updatedAt`).
- Botón "Nueva granja" y acceso a colecciones.
- Estados vacíos/loading y avisos de cuota.

### 4.3 Alta / Edición de Schematic

- Subida del archivo con validación en cliente (extensión, tamaño) y en servidor (magic bytes, NBT, límites, parser en worker).
- Formulario: Nombre, Descripción, URL de YouTube, Versión, Tags, Colección, Favorito.
- Al guardar: validar → parsear → guardar archivo y BD → generar thumbnail en cliente → redirigir al detalle.
- Duplicado por SHA-256: aviso con nombre del schematic existente y opción de subir de todos modos.
- Reemplazo de archivo (`PUT /:id/file`): recalcula dimensiones/materiales/thumbnail, conserva metadatos e ID.

### 4.4 Vista de Detalle de la Granja

Pantalla principal al construir:

1. **Encabezado:** nombre, descripción, versión, dimensiones, total de bloques, colección, botones de descarga del original, editar y eliminar (con modal de confirmación que muestra nombre y dimensiones; el borrado borra también el archivo, thumbnail y quita el registro de la colección).
2. **Tutorial:** reproductor embebido con `youtube-nocookie.com` más enlace directo.
3. **Visor 3D:** órbita/zoom/paneo, slider de capa Y, resaltado de material, grid de chunks, regla de medición y limpieza de recursos al salir.
4. **Modo capa:** vista superior 2D de la capa seleccionada, navegación con flechas (`capa 7 de 18`) y **materiales de esa capa**.
5. **Lista de materiales:** tabla con buscador, cantidades exactas, stacks/shulkers, checkboxes de checklist, progreso y export CSV/texto. Clic/fila → resaltado en 3D.
6. **Export individual** del schematic (binario + metadatos) dentro del export global de la biblioteca.

### 4.5 Colecciones

Alta/edición/borrado de colecciones (nombre y descripción) y filtro por colección en la biblioteca. Al borrar, los schematics se dejan sin colección.

---

## 5. Casos Borde y Manejo de Errores

- **Extensión inválida / corrupto / falso GZIP / NBT inválido:** `400` con mensaje claro; nunca se escribe el archivo ni el registro.
- **Archivo demasiado grande, descomprimido excesivo, dimensiones absurdas:** `400`/`413` con el límite concretado.
- **URL de YouTube inválida:** informar sin tumbar el guardado (o rechazar si el campo no está vacío y no es de YouTube).
- **Schematic vacío (0 bloques tras filtrar aire/técnicos):** se permite guardar con aviso.
- **Granjas muy grandes:** indicadores de carga en parseo y montaje de escena; workspace en workers.
- **Cuota excedida:** `413`/`429` con mensaje indicando el límite.
- **Duplicado SHA-256:** `409` con referencia al schematic ya existente; `?force=true` lo permite.
- **Recurso de otro usuario:** `404` (incluidos binario, thumbnail y export).
- **Sesión expirada:** renovación automática vía refresh; si falla, redirigir a login.
- **Registro desactivado:** pantalla de acceso informativa.
- **Admin borra un usuario:** confirmación explícita de que se borrarán sus schematics, archivos y thumbnails.
