import { Structure, StructureRenderer } from 'deepslate/render';
import type { Resources } from 'deepslate/render';
import { mat4, vec3 } from 'gl-matrix';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../components/ui';
import {
  chunkCenter,
  clampCamera,
  fitDistance,
  presetCamera,
  type ViewerCamera,
  type ViewPreset,
  wheelDeltaPixels,
} from './camera';
import {
  blockKey,
  chunkCounts,
  filterBlocks,
  isInvisibleBlock,
  measurePoints,
  pickableBlockKeys,
  rulerMarks,
  splitForDisplay,
} from './layers';
import type { Measurement, Point3 } from './layers';
import { intersectYPlane, pickVoxel, type Vec3Tuple } from './picking';
import type { ParsedBlock } from './parser/types';
import { AssetLoader, type AssetProgress } from './resources';

export type ViewerTheme = 'dark' | 'light';
/** Las miniaturas son siempre blancas, con independencia del tema del visor. */
export type CaptureFn = () => string | null;
type DrawTheme = ViewerTheme | 'thumbnail';

export interface SchematicViewerProps {
  blocks: ParsedBlock[];
  version: string;
  layerY: number | null;
  highlight: string | null;
  showGrid: boolean;
  showRuler: boolean;
  /** Vista superior 2D (útil junto con `layerY`). */
  layerMode?: boolean;
  /** Dos clics sobre el canvas devuelven dx/dy/dz y distancia. */
  measureMode?: boolean;
  theme: ViewerTheme;
  /** Opacidad de las capas inferiores / materiales no seleccionados (0..1). */
  contextOpacity: number;
  /** Ocultar también las capas inferiores: capa pura sin contexto. */
  isolateLayer?: boolean;
  token: string | null;
  onThemeChange?: () => void;
  onHelp?: () => void;
  onLayerStep?: (delta: number) => void;
  onProgress?: (stage: string) => void;
  onReady?: (capture: CaptureFn) => void;
  onMeasure?: (measurement: Measurement | null) => void;
}

type Size = [number, number, number];
type RendererWithDispose = StructureRenderer & { dispose?: () => void };

interface GridData {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  positionLocation: number;
  viewLocation: WebGLUniformLocation | null;
  projectionLocation: WebGLUniformLocation | null;
  colorLocation: WebGLUniformLocation | null;
  vertexCount: number;
  sizeKey: string;
}

interface DisplayPair {
  focus: Structure;
  context: Structure;
  contextCount: number;
}

type Gesture = 'rotate' | 'pan' | 'pinch' | 'measure' | null;
type ScreenPoint = { clientX: number; clientY: number };

interface Engine {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  focusRenderer: RendererWithDispose | null;
  contextRenderer: RendererWithDispose | null;
  contextCount: number;
  resources: Resources | null;
  size: Size;
  camera: ViewerCamera;
  grid: GridData | null;
  outlineBuffer: WebGLBuffer | null;
  outlineVertexCount: number;
  measureBuffer: WebGLBuffer | null;
  measureVertexCount: number;
  frame: number | null;
  rebuildFrame: number | null;
  showGrid: boolean;
  showRuler: boolean;
  theme: ViewerTheme;
  contextOpacity: number;
  occupied: Set<string>;
  structureCache: Map<string, DisplayPair>;
  hoveredCell: Point3 | null;
  selectedCell: Point3 | null;
  scheduleRender: () => void;
  requestRebuild: () => void;
  fit: () => void;
  applyPreset: (preset: ViewPreset) => void;
  focusChunk: (key: string) => void;
}

function computeSize(blocks: ParsedBlock[]): Size {
  let widthX = 1;
  let heightY = 1;
  let lengthZ = 1;
  for (const block of blocks) {
    widthX = Math.max(widthX, block.x + 1);
    heightY = Math.max(heightY, block.y + 1);
    lengthZ = Math.max(lengthZ, block.z + 1);
  }
  return [widthX, heightY, lengthZ];
}

function structureFromBlocks(blocks: ParsedBlock[], size: Size): Structure {
  const structure = new Structure(size);
  for (const block of filterBlocks(blocks, null, null)) {
    if (
      block.x < 0 || block.y < 0 || block.z < 0 ||
      block.x >= size[0] || block.y >= size[1] || block.z >= size[2]
    ) {
      continue;
    }
    structure.addBlock([block.x, block.y, block.z], block.blockId, block.properties);
  }
  return structure;
}

/** Una Structure para el foco y otra para el contexto; geometría por secciones 16³. */
function buildDisplayPair(
  blocks: ParsedBlock[],
  layerY: number | null,
  highlight: string | null,
  isolateLayer: boolean,
  size: Size,
): DisplayPair {
  const split = splitForDisplay(blocks, layerY, highlight, isolateLayer);
  return {
    focus: structureFromBlocks(split.focus, size),
    context: structureFromBlocks(split.context, size),
    contextCount: split.context.length,
  };
}

function displayKey(props: SchematicViewerProps, size: Size): string {
  return [size.join(','), props.layerY ?? 'all', props.highlight ?? 'none', props.isolateLayer ? 'isolated' : 'context'].join('|');
}

function computeView(camera: ViewerCamera): mat4 {
  const view = mat4.create();
  mat4.translate(view, view, [0, 0, -camera.distance]);
  mat4.rotate(view, view, camera.xRotation, [1, 0, 0]);
  mat4.rotate(view, view, camera.yRotation, [0, 1, 0]);
  mat4.translate(view, view, [-camera.center[0], -camera.center[1], -camera.center[2]]);
  return view;
}

function computeProjection(canvas: HTMLCanvasElement): mat4 {
  const projection = mat4.create();
  const width = Math.max(1, canvas.width || canvas.clientWidth);
  const height = Math.max(1, canvas.height || canvas.clientHeight);
  mat4.perspective(projection, (70 * Math.PI) / 180, width / height, 0.1, 500);
  return projection;
}

/** La preview de la biblioteca usa 4:3; capturar en el mismo aspecto evita recortes. */
const THUMB_WIDTH = 640;
const THUMB_HEIGHT = 480;

function gridVertices(size: Size): Float32Array {
  const [widthX, heightY, lengthZ] = size;
  const points: number[] = [];
  const line = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): void => {
    points.push(x1, y1, z1, x2, y2, z2);
  };

  for (let x = 0; x <= widthX; x += 16) line(x, 0, 0, x, 0, lengthZ);
  if (widthX % 16 !== 0) line(widthX, 0, 0, widthX, 0, lengthZ);
  for (let z = 0; z <= lengthZ; z += 16) line(0, 0, z, widthX, 0, z);
  if (lengthZ % 16 !== 0) line(0, 0, lengthZ, widthX, 0, lengthZ);

  const perimeter = (y: number): void => {
    line(0, y, 0, widthX, y, 0);
    line(widthX, y, 0, widthX, y, lengthZ);
    line(widthX, y, lengthZ, 0, y, lengthZ);
    line(0, y, lengthZ, 0, y, 0);
  };
  for (let y = 0; y <= heightY; y += 16) perimeter(y);
  if (heightY % 16 !== 0) perimeter(heightY);

  return new Float32Array(points);
}

function outlineVertices(cell: Point3): Float32Array {
  const [x, y, z] = cell;
  const lo = 0.02;
  const hi = 0.98;
  const corners: Vec3Tuple[] = [
    [lo, lo, lo], [hi, lo, lo], [hi, lo, hi], [lo, lo, hi],
    [lo, hi, lo], [hi, hi, lo], [hi, hi, hi], [lo, hi, hi],
  ];
  const edges: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const points: number[] = [];
  for (const [from, to] of edges) {
    const a = corners[from] ?? [0, 0, 0];
    const b = corners[to] ?? [0, 0, 0];
    points.push(x + a[0], y + a[1], z + a[2], x + b[0], y + b[1], z + b[2]);
  }
  return new Float32Array(points);
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createGrid(gl: WebGLRenderingContext, size: Size): GridData | null {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, `
    attribute vec3 vertPos;
    uniform mat4 mView;
    uniform mat4 mProj;
    void main(void) {
      gl_Position = mProj * mView * vec4(vertPos, 1.0);
    }
  `);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec4 uColor;
    void main(void) {
      gl_FragColor = uColor;
    }
  `);
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }

  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  if (!program || !buffer) {
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
    return null;
  }

  const vertices = gridVertices(size);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  return {
    program,
    buffer,
    positionLocation: gl.getAttribLocation(program, 'vertPos'),
    viewLocation: gl.getUniformLocation(program, 'mView'),
    projectionLocation: gl.getUniformLocation(program, 'mProj'),
    colorLocation: gl.getUniformLocation(program, 'uColor'),
    vertexCount: vertices.length / 3,
    sizeKey: size.join(','),
  };
}

function unproject(engine: Engine, ndcX: number, ndcY: number, ndcZ: number): vec3 | null {
  const viewProjection = mat4.multiply(mat4.create(), computeProjection(engine.canvas), computeView(engine.camera));
  const inverse = mat4.invert(mat4.create(), viewProjection);
  if (!inverse) return null;
  return vec3.transformMat4(vec3.create(), vec3.fromValues(ndcX, ndcY, ndcZ), inverse);
}

function rayFromEvent(engine: Engine, point: ScreenPoint): { origin: Vec3Tuple; direction: Vec3Tuple } | null {
  const rect = engine.canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const ndcX = ((point.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = 1 - ((point.clientY - rect.top) / rect.height) * 2;
  const near = unproject(engine, ndcX, ndcY, -1);
  const far = unproject(engine, ndcX, ndcY, 1);
  if (!near || !far) return null;
  const direction = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), far, near));
  return {
    origin: [near[0], near[1], near[2]],
    direction: [direction[0], direction[1], direction[2]],
  };
}

function clampPoint(point: Vec3Tuple, size: Size): Point3 {
  const clamp = (value: number, max: number): number => Math.max(0, Math.min(max - 1, Math.round(value)));
  return [clamp(point[0], size[0]), clamp(point[1], size[1]), clamp(point[2], size[2])];
}

function pickCell(engine: Engine, point: ScreenPoint, planeY: number | null): Point3 | null {
  const ray = rayFromEvent(engine, point);
  if (!ray) return null;
  const hit = pickVoxel(ray.origin, ray.direction, engine.occupied);
  if (hit) return clampPoint(hit, engine.size);
  if (planeY === null) return null;
  const plane = intersectYPlane(ray.origin, ray.direction, planeY);
  return plane ? clampPoint(plane, engine.size) : null;
}

function setLineBuffer(engine: Engine, kind: 'outline' | 'measure', cell: Point3 | null, measurement: Measurement | null): void {
  const existing = kind === 'outline' ? engine.outlineBuffer : engine.measureBuffer;
  if (existing) {
    engine.gl.deleteBuffer(existing);
    if (kind === 'outline') {
      engine.outlineBuffer = null;
      engine.outlineVertexCount = 0;
    } else {
      engine.measureBuffer = null;
      engine.measureVertexCount = 0;
    }
  }

  let vertices: Float32Array | null = null;
  if (kind === 'outline' && cell) vertices = outlineVertices(cell);
  if (kind === 'measure' && measurement) {
    const [ax, ay, az] = measurement.a;
    const [bx, by, bz] = measurement.b;
    vertices = new Float32Array([
      ax + 0.5, ay + 1, az + 0.5,
      bx + 0.5, by + 1, bz + 0.5,
    ]);
  }
  if (!vertices) return;

  const buffer = engine.gl.createBuffer();
  if (!buffer) return;
  engine.gl.bindBuffer(engine.gl.ARRAY_BUFFER, buffer);
  engine.gl.bufferData(engine.gl.ARRAY_BUFFER, vertices, engine.gl.STATIC_DRAW);
  if (kind === 'outline') {
    engine.outlineBuffer = buffer;
    engine.outlineVertexCount = vertices.length / 3;
  } else {
    engine.measureBuffer = buffer;
    engine.measureVertexCount = 2;
  }
}

const THEME_COLORS = {
  dark: {
    clear: [0.06, 0.07, 0.09, 1] as const,
    grid: [0.655, 0.545, 0.98, 0.55] as const,
    outline: [0, 0.902, 0.463, 1] as const,
    measure: [0.776, 0.545, 0, 1] as const,
    contextAlpha: 0.28,
  },
  light: {
    clear: [0.918, 0.925, 0.894, 1] as const,
    grid: [0.078, 0.082, 0.078, 0.35] as const,
    outline: [0.078, 0.082, 0.078, 1] as const,
    measure: [0.788, 0.231, 0.231, 1] as const,
    contextAlpha: 0.35,
  },
  thumbnail: {
    clear: [1, 1, 1, 1] as const,
    grid: [0.078, 0.082, 0.078, 0.25] as const,
    outline: [0.078, 0.082, 0.078, 1] as const,
    measure: [0.788, 0.231, 0.231, 1] as const,
    contextAlpha: 0.55,
  },
} as const;

function drawEngine(engine: Engine, themeOverride?: DrawTheme): void {
  const { gl, canvas } = engine;
  if (!engine.focusRenderer) return;
  const palette = THEME_COLORS[themeOverride ?? engine.theme];

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(palette.clear[0], palette.clear[1], palette.clear[2], palette.clear[3]);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const view = computeView(engine.camera);
  const projection = computeProjection(canvas);

  // Pasada de contexto: capas inferiores / materiales atenuados, sin escribir profundidad.
  if (engine.contextRenderer && engine.contextCount > 0 && engine.contextOpacity > 0) {
    gl.depthMask(false);
    gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    gl.blendColor(1, 1, 1, engine.contextOpacity);
    engine.contextRenderer.drawStructure(view);
    gl.depthMask(true);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  // Pasada de foco: capa activa y/o material seleccionado, nítida por encima.
  engine.focusRenderer.drawStructure(view);

  const grid = engine.grid;
  const hasOverlay = (grid && engine.showGrid && grid.vertexCount > 0)
    || engine.outlineVertexCount > 0
    || engine.measureVertexCount > 0;
  if (!grid || !hasOverlay) return;

  gl.useProgram(grid.program);
  gl.uniformMatrix4fv(grid.viewLocation, false, view);
  gl.uniformMatrix4fv(grid.projectionLocation, false, projection);
  gl.enableVertexAttribArray(grid.positionLocation);
  gl.disable(gl.DEPTH_TEST);

  if (engine.showGrid && grid.vertexCount > 0) {
    gl.uniform4f(grid.colorLocation, palette.grid[0], palette.grid[1], palette.grid[2], palette.grid[3]);
    gl.bindBuffer(gl.ARRAY_BUFFER, grid.buffer);
    gl.drawArrays(gl.LINES, 0, grid.vertexCount);
  }
  if (engine.outlineBuffer && engine.outlineVertexCount > 0) {
    gl.uniform4f(grid.colorLocation, palette.outline[0], palette.outline[1], palette.outline[2], palette.outline[3]);
    gl.bindBuffer(gl.ARRAY_BUFFER, engine.outlineBuffer);
    gl.drawArrays(gl.LINES, 0, engine.outlineVertexCount);
  }
  if (engine.measureBuffer && engine.measureVertexCount > 0) {
    gl.uniform4f(grid.colorLocation, palette.measure[0], palette.measure[1], palette.measure[2], palette.measure[3]);
    gl.bindBuffer(gl.ARRAY_BUFFER, engine.measureBuffer);
    gl.drawArrays(gl.LINES, 0, engine.measureVertexCount);
  }
  gl.enable(gl.DEPTH_TEST);
}

function captureCanvas(canvas: HTMLCanvasElement, engine: Engine): string | null {
  if (!engine.focusRenderer) return null;
  const snapshot = document.createElement('canvas');
  snapshot.width = THUMB_WIDTH;
  snapshot.height = THUMB_HEIGHT;
  const context = snapshot.getContext('2d');
  if (!context) return null;

  const originalWidth = canvas.width;
  const originalHeight = canvas.height;
  const originalStyleWidth = canvas.style.width;
  const originalStyleHeight = canvas.style.height;
  const originalCamera = engine.camera;
  const originalGrid = engine.showGrid;
  const originalOutline = engine.outlineVertexCount;
  const originalMeasure = engine.measureVertexCount;
  const originalOpacity = engine.contextOpacity;
  try {
    canvas.width = THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
    // StructureRenderer calcula su proyección con clientWidth/clientHeight,
    // no con el buffer: el CSS también debe ser 4:3 durante la captura.
    canvas.style.width = `${THUMB_WIDTH}px`;
    canvas.style.height = `${THUMB_HEIGHT}px`;
    engine.focusRenderer.setViewport(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    engine.contextRenderer?.setViewport(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    engine.camera = presetCamera('iso', engine.size, THUMB_WIDTH / THUMB_HEIGHT);
    engine.showGrid = false;
    engine.outlineVertexCount = 0;
    engine.measureVertexCount = 0;
    engine.contextOpacity = THEME_COLORS.thumbnail.contextAlpha;
    drawEngine(engine, 'thumbnail');
    context.drawImage(canvas, 0, 0);
    return snapshot.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    canvas.width = originalWidth;
    canvas.height = originalHeight;
    canvas.style.width = originalStyleWidth;
    canvas.style.height = originalStyleHeight;
    engine.focusRenderer.setViewport(0, 0, originalWidth, originalHeight);
    engine.contextRenderer?.setViewport(0, 0, originalWidth, originalHeight);
    engine.camera = originalCamera;
    engine.showGrid = originalGrid;
    engine.outlineVertexCount = originalOutline;
    engine.measureVertexCount = originalMeasure;
    engine.contextOpacity = originalOpacity;
    engine.scheduleRender();
  }
}

function progressLabel(progress: AssetProgress, t: (key: string, options?: Record<string, unknown>) => string): string {
  const count = `${progress.done}/${progress.total}`;
  if (progress.phase === 'definitions') return t('loadingDefinitions', { count });
  if (progress.phase === 'models') return t('loadingModels', { count });
  if (progress.phase === 'textures') return t('loadingTextures', { count });
  return t('buildingAtlas');
}

export function SchematicViewer(props: SchematicViewerProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const [status, setStatus] = useState('Inicializando visor…');
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [hoveredCell, setHoveredCell] = useState<Point3 | null>(null);
  const [selectedCell, setSelectedCell] = useState<Point3 | null>(null);
  const [epoch, setEpoch] = useState(0);
  const firstPoint = useRef<Point3 | null>(null);
  const hoverKey = useRef<string | null>(null);

  const size = useMemo(() => computeSize(props.blocks), [props.blocks]);
  const chunks = useMemo(() => chunkCounts(props.blocks), [props.blocks]);
  const marks = useMemo(
    () => rulerMarks({ widthX: size[0], heightY: size[1], lengthZ: size[2] }),
    [size],
  );
  const cellBlocks = useMemo(() => {
    const map = new Map<string, ParsedBlock>();
    for (const block of props.blocks) map.set(blockKey([block.x, block.y, block.z]), block);
    return map;
  }, [props.blocks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    setFatalError(null);
    setStatus(t('viewerLoading'));

    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: true });
    if (!gl) {
      setFatalError(t('viewerNoWebGL'));
      setStatus(t('viewerNoWebGL'));
      propsRef.current.onReady?.(() => null);
      return;
    }

    const aspect = Math.max(0.2, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    const engine: Engine = {
      canvas,
      gl,
      focusRenderer: null,
      contextRenderer: null,
      contextCount: 0,
      resources: null,
      size,
      camera: presetCamera('iso', size, aspect),
      grid: null,
      outlineBuffer: null,
      outlineVertexCount: 0,
      measureBuffer: null,
      measureVertexCount: 0,
      frame: null,
      rebuildFrame: null,
      showGrid: propsRef.current.showGrid,
      showRuler: propsRef.current.showRuler,
      theme: propsRef.current.theme,
      contextOpacity: propsRef.current.theme === 'dark' ? THEME_COLORS.dark.contextAlpha : THEME_COLORS.light.contextAlpha,
      occupied: pickableBlockKeys(props.blocks, props.layerY, props.isolateLayer ?? false),
      structureCache: new Map(),
      hoveredCell: null,
      selectedCell: null,
      scheduleRender: () => undefined,
      requestRebuild: () => undefined,
      fit: () => undefined,
      applyPreset: () => undefined,
      focusChunk: () => undefined,
    };
    engine.scheduleRender = () => {
      if (cancelled || engine.frame !== null) return;
      engine.frame = requestAnimationFrame(() => {
        engine.frame = null;
        drawEngine(engine);
        // La celda bajo el cursor cambia aunque el ratón no se mueva si la
        // cámara rota, hace zoom o cambia de capa.
        refreshHover();
      });
    };
    engine.requestRebuild = () => {
      if (cancelled || engine.rebuildFrame !== null || !engine.focusRenderer || !engine.contextRenderer) return;
      engine.rebuildFrame = requestAnimationFrame(() => {
        engine.rebuildFrame = null;
        if (cancelled || !engine.focusRenderer || !engine.contextRenderer) return;
        const current = propsRef.current;
        engine.occupied = pickableBlockKeys(current.blocks, current.layerY, current.isolateLayer ?? false);
        const key = displayKey(current, engine.size);
        let pair = engine.structureCache.get(key);
        if (!pair) {
          pair = buildDisplayPair(current.blocks, current.layerY, current.highlight, current.isolateLayer ?? false, engine.size);
          engine.structureCache.set(key, pair);
          if (engine.structureCache.size > 12) {
            const oldest = engine.structureCache.keys().next();
            if (!oldest.done) engine.structureCache.delete(oldest.value);
          }
        }
        engine.focusRenderer.setStructure(pair.focus);
        engine.contextRenderer.setStructure(pair.context);
        engine.contextCount = pair.contextCount;
        engine.scheduleRender();
      });
    };
    engine.fit = () => {
      engine.camera = presetCamera(propsRef.current.layerMode ? 'top' : 'iso', engine.size, canvas.clientWidth / Math.max(1, canvas.clientHeight));
      engine.scheduleRender();
    };
    engine.applyPreset = (preset) => {
      engine.camera = presetCamera(preset, engine.size, canvas.clientWidth / Math.max(1, canvas.clientHeight));
      engine.scheduleRender();
    };
    engine.focusChunk = (key) => {
      const center = chunkCenter(key, engine.size);
      if (!center) return;
      engine.camera.center = center;
      engine.camera.distance = Math.max(4, fitDistance([16, 16, 16], canvas.clientWidth / Math.max(1, canvas.clientHeight)) * 0.9);
      engine.scheduleRender();
    };
    engineRef.current = engine;

    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: Gesture = null;
    let downAt: { x: number; y: number; time: number; button: number } | null = null;
    let pinchDistance = 0;
    let pinchMid: [number, number] = [0, 0];
    let lastHoverPoint: ScreenPoint | null = null;
    let refreshHover: () => void = () => undefined;

    const panBy = (dx: number, dy: number): void => {
      const inverseView = mat4.invert(mat4.create(), computeView(engine.camera));
      if (!inverseView) return;
      const scale = (engine.camera.distance * Math.tan((70 * Math.PI) / 180 / 2) * 2) / Math.max(1, canvas.clientHeight);
      const right = vec3.fromValues(inverseView[0] ?? 1, inverseView[1] ?? 0, inverseView[2] ?? 0);
      const up = vec3.fromValues(inverseView[4] ?? 0, inverseView[5] ?? 1, inverseView[6] ?? 0);
      const delta = vec3.create();
      vec3.scaleAndAdd(delta, delta, right, -dx * scale);
      vec3.scaleAndAdd(delta, delta, up, dy * scale);
      vec3.add(engine.camera.center, engine.camera.center, delta);
      engine.scheduleRender();
    };
    const zoomAt = (clientX: number, clientY: number, factor: number): void => {
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const ndcY = 1 - ((clientY - rect.top) / Math.max(1, rect.height)) * 2;
      const before = unproject(engine, ndcX, ndcY, 0);
      engine.camera = clampCamera({ ...engine.camera, distance: engine.camera.distance * factor });
      const after = unproject(engine, ndcX, ndcY, 0);
      if (before && after) vec3.add(engine.camera.center, engine.camera.center, vec3.subtract(vec3.create(), before, after));
      engine.scheduleRender();
    };
    const setOutline = (): void => {
      const cell = engine.selectedCell ?? engine.hoveredCell;
      setLineBuffer(engine, 'outline', cell, null);
      engine.scheduleRender();
    };
    const applyHover = (point: ScreenPoint | null): void => {
      const cell = point
        ? pickCell(engine, point, propsRef.current.layerMode ? propsRef.current.layerY ?? 0 : null)
        : null;
      const key = cell ? blockKey(cell) : null;
      if (key === hoverKey.current) return;
      hoverKey.current = key;
      engine.hoveredCell = cell;
      setHoveredCell(cell);
      setOutline();
    };
    refreshHover = (): void => {
      if (lastHoverPoint) applyHover(lastHoverPoint);
    };
    const updateHover = (point: ScreenPoint): void => {
      lastHoverPoint = { clientX: point.clientX, clientY: point.clientY };
      applyHover(lastHoverPoint);
    };
    const clearHover = (): void => {
      lastHoverPoint = null;
      applyHover(null);
    };
    const completeMeasure = (event: PointerEvent): void => {
      const cell = pickCell(engine, event, propsRef.current.layerY ?? 0);
      if (!cell) return;
      if (!firstPoint.current) {
        firstPoint.current = cell;
        setMeasurement(null);
        setLineBuffer(engine, 'measure', null, null);
        propsRef.current.onMeasure?.(null);
      } else {
        const result = measurePoints(firstPoint.current, cell);
        firstPoint.current = null;
        setMeasurement(result);
        setLineBuffer(engine, 'measure', null, result);
        propsRef.current.onMeasure?.(result);
      }
      engine.scheduleRender();
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 && event.button !== 2) return;
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      downAt = { x: event.clientX, y: event.clientY, time: performance.now(), button: event.button };
      const current = propsRef.current;
      if (current.measureMode) gesture = 'measure';
      else if (event.button === 2 || event.shiftKey || current.layerMode) gesture = 'pan';
      else gesture = 'rotate';

      if (pointers.size === 2) {
        const positions = [...pointers.values()];
        const first = positions[0];
        const second = positions[1];
        if (first && second) {
          pinchDistance = Math.hypot(first.x - second.x, first.y - second.y);
          pinchMid = [(first.x + second.x) / 2, (first.y + second.y) / 2];
          gesture = 'pinch';
        }
      }
      canvas.style.cursor = gesture === 'pan' ? 'grabbing' : gesture === 'measure' ? 'crosshair' : 'grabbing';
    };
    const onPointerMove = (event: PointerEvent): void => {
      const pointer = pointers.get(event.pointerId);
      if (!pointer) {
        updateHover(event);
        return;
      }
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;

      if (gesture === 'pinch' && pointers.size >= 2) {
        const positions = [...pointers.values()];
        const first = positions[0];
        const second = positions[1];
        if (first && second) {
          const distance = Math.hypot(first.x - second.x, first.y - second.y);
          const mid: [number, number] = [(first.x + second.x) / 2, (first.y + second.y) / 2];
          if (pinchDistance > 0 && distance > 0) zoomAt(mid[0], mid[1], pinchDistance / distance);
          panBy(mid[0] - pinchMid[0], mid[1] - pinchMid[1]);
          pinchDistance = distance;
          pinchMid = mid;
        }
        return;
      }
      if (gesture === 'rotate') {
        engine.camera.yRotation += dx / 100;
        engine.camera.xRotation = clampCamera({ ...engine.camera, xRotation: engine.camera.xRotation + dy / 100 }).xRotation;
        engine.scheduleRender();
      } else if (gesture === 'pan') {
        panBy(dx, dy);
      }
    };
    const finishPointer = (event: PointerEvent, cancelled = false): void => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      const start = downAt;
      downAt = null;
      const moved = start ? Math.hypot(event.clientX - start.x, event.clientY - start.y) : Number.POSITIVE_INFINITY;
      const quick = start ? performance.now() - start.time < 600 : false;
      if (!cancelled && start?.button === 0 && moved < 5 && quick) {
        if (propsRef.current.measureMode) {
          completeMeasure(event);
        } else {
          const cell = pickCell(engine, event, propsRef.current.layerMode ? propsRef.current.layerY ?? 0 : null);
          const next = cell && (!engine.selectedCell || blockKey(engine.selectedCell) !== blockKey(cell)) ? cell : null;
          engine.selectedCell = next;
          setSelectedCell(next);
          setOutline();
        }
      }
      if (pointers.size < 2) pinchDistance = 0;
      if (pointers.size === 0) {
        gesture = null;
        canvas.style.cursor = propsRef.current.measureMode ? 'crosshair' : 'grab';
        if (!cancelled) {
          const rect = canvas.getBoundingClientRect();
          const inside = event.clientX >= rect.left && event.clientX <= rect.right
            && event.clientY >= rect.top && event.clientY <= rect.bottom;
          if (inside) updateHover(event);
          else clearHover();
        }
      }
    };
    const onPointerUp = (event: PointerEvent): void => finishPointer(event);
    const onPointerCancel = (event: PointerEvent): void => finishPointer(event, true);
    const onPointerLeave = (): void => {
      if (pointers.size === 0) clearHover();
    };
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const delta = wheelDeltaPixels(event.deltaY, event.deltaMode, canvas.clientHeight);
      // Un delta enorme (trackpad rápido o salto de página) haría invisible el modelo.
      const stepped = Math.max(-240, Math.min(240, delta));
      zoomAt(event.clientX, event.clientY, Math.exp(stepped * 0.001));
    };
    const onDoubleClick = (event: MouseEvent): void => {
      event.preventDefault();
      engine.fit();
    };
    const onContextMenu = (event: MouseEvent): void => event.preventDefault();
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLElement && target.matches('input, textarea, select, button')) return;
      const key = event.key.toLowerCase();
      let handled = true;
      if (key === '?' || key === 'f1') propsRef.current.onHelp?.();
      else if (key === 'b') propsRef.current.onThemeChange?.();
      else if (key === 'f' || key === '0') engine.fit();
      else if (key === '+' || key === '=') zoomAt(canvas.getBoundingClientRect().left + canvas.clientWidth / 2, canvas.getBoundingClientRect().top + canvas.clientHeight / 2, 0.85);
      else if (key === '-') zoomAt(canvas.getBoundingClientRect().left + canvas.clientWidth / 2, canvas.getBoundingClientRect().top + canvas.clientHeight / 2, 1.15);
      else if (event.key === 'PageDown') propsRef.current.onLayerStep?.(1);
      else if (event.key === 'PageUp') propsRef.current.onLayerStep?.(-1);
      else if (event.key === 'Escape') {
        firstPoint.current = null;
        setMeasurement(null);
        setLineBuffer(engine, 'measure', null, null);
        propsRef.current.onMeasure?.(null);
        engine.selectedCell = null;
        setSelectedCell(null);
        setOutline();
        clearHover();
      } else if (event.key === 'ArrowLeft') {
        if (propsRef.current.layerMode) panBy(24, 0);
        else engine.camera.yRotation -= 0.12;
      } else if (event.key === 'ArrowRight') {
        if (propsRef.current.layerMode) panBy(-24, 0);
        else engine.camera.yRotation += 0.12;
      } else if (event.key === 'ArrowUp') {
        if (propsRef.current.layerMode) panBy(0, 24);
        else engine.camera.xRotation = clampCamera({ ...engine.camera, xRotation: engine.camera.xRotation - 0.12 }).xRotation;
      } else if (event.key === 'ArrowDown') {
        if (propsRef.current.layerMode) panBy(0, -24);
        else engine.camera.xRotation = clampCamera({ ...engine.camera, xRotation: engine.camera.xRotation + 0.12 }).xRotation;
      } else handled = false;
      if (handled) {
        event.preventDefault();
        engine.scheduleRender();
      }
    };
    const resize = (): void => {
      const width = Math.max(1, canvas.clientWidth || 640);
      const height = Math.max(1, canvas.clientHeight || 480);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        engine.focusRenderer?.setViewport(0, 0, pixelWidth, pixelHeight);
        engine.contextRenderer?.setViewport(0, 0, pixelWidth, pixelHeight);
      }
      engine.scheduleRender();
    };
    const onContextLost = (event: Event): void => {
      event.preventDefault();
      cancelled = true;
      if (engine.frame !== null) cancelAnimationFrame(engine.frame);
      if (engine.rebuildFrame !== null) cancelAnimationFrame(engine.rebuildFrame);
      setFatalError(t('viewerContextLost'));
      setStatus(t('viewerContextLost'));
    };
    const onContextRestored = (): void => {
      setEpoch((value) => value + 1);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    if (observer) observer.observe(canvas);
    else window.addEventListener('resize', resize);

    const loader = new AssetLoader(props.version);
    loader.setToken(props.token);
    // `waterlogged` decide si deepslate dibuja agua dentro de otro bloque;
    // conservarlo permite descargar también las texturas del líquido.
    const allBlockIds = [...new Set(props.blocks
      .filter((block) => !isInvisibleBlock(block.blockId))
      .map((block) => {
        const base = block.blockId.split('[')[0] ?? block.blockId;
        return block.properties.waterlogged === 'true' ? `${base}[waterlogged=true]` : base;
      }))];

    void (async () => {
      try {
        propsRef.current.onProgress?.(t('viewerLoading'));
        setStatus(t('viewerLoading'));
        const resources = await loader.buildResources(allBlockIds, (progress) => {
          if (cancelled) return;
          const label = progressLabel(progress, t);
          setStatus(label);
          propsRef.current.onProgress?.(label);
        });
        if (cancelled) return;

        engine.resources = resources;
        engine.size = computeSize(propsRef.current.blocks);
        engine.camera.center = [engine.size[0] / 2, engine.size[1] / 2, engine.size[2] / 2];
        engine.occupied = pickableBlockKeys(propsRef.current.blocks, propsRef.current.layerY, propsRef.current.isolateLayer ?? false);
        const sizeKey = displayKey(propsRef.current, engine.size);
        const initialPair = buildDisplayPair(
          propsRef.current.blocks,
          propsRef.current.layerY,
          propsRef.current.highlight,
          propsRef.current.isolateLayer ?? false,
          engine.size,
        );
        engine.structureCache.set(sizeKey, initialPair);

        const makeRenderer = (structure: Structure): RendererWithDispose => new StructureRenderer(gl, structure, resources, {
          chunkSize: 16,
          useInvisibleBlockBuffer: false,
        });
        engine.focusRenderer = makeRenderer(initialPair.focus);
        engine.contextRenderer = makeRenderer(initialPair.context);
        engine.contextCount = initialPair.contextCount;
        engine.grid = createGrid(gl, engine.size);
        resize();

        setStatus(t('ready'));
        propsRef.current.onProgress?.(t('ready'));
        const sourceBlocks = propsRef.current.blocks;
        propsRef.current.onReady?.(() => {
          // Un motor reconstruido con bloques nuevos invalida las capturas anteriores.
          if (cancelled || sourceBlocks.length === 0 || propsRef.current.blocks !== sourceBlocks) return null;
          return captureCanvas(canvas, engine);
        });
        engine.scheduleRender();
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setFatalError(`${t('viewerError')}: ${message}`);
        setStatus(t('error'));
      }
    })();

    return () => {
      cancelled = true;
      if (engine.frame !== null) cancelAnimationFrame(engine.frame);
      if (engine.rebuildFrame !== null) cancelAnimationFrame(engine.rebuildFrame);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', resize);
      if (engine.grid) {
        gl.deleteBuffer(engine.grid.buffer);
        gl.deleteProgram(engine.grid.program);
      }
      if (engine.outlineBuffer) gl.deleteBuffer(engine.outlineBuffer);
      if (engine.measureBuffer) gl.deleteBuffer(engine.measureBuffer);
      if (typeof engine.focusRenderer?.dispose === 'function') engine.focusRenderer.dispose();
      if (typeof engine.contextRenderer?.dispose === 'function') engine.contextRenderer.dispose();
      // No llamar a loseContext(): React puede reutilizar el mismo canvas tras un
      // rerender/StrictMode y getContext devolvería un contexto ya perdido.
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [props.blocks, props.version, props.token, size, epoch, t]);

  useEffect(() => {
    engineRef.current?.requestRebuild();
  }, [props.blocks, props.layerY, props.highlight, props.isolateLayer, size, epoch]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.theme = props.theme;
    engine.contextOpacity = props.contextOpacity;
    engine.scheduleRender();
  }, [props.theme, props.contextOpacity]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.showGrid = props.showGrid;
    engine.scheduleRender();
  }, [props.showGrid]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.showRuler = props.showRuler;
    engine.scheduleRender();
  }, [props.showRuler]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.applyPreset(props.layerMode ? 'top' : 'iso');
  }, [props.layerMode, props.blocks, props.version, props.token, size, epoch]);

  useEffect(() => {
    firstPoint.current = null;
    setMeasurement(null);
    const engine = engineRef.current;
    if (engine) {
      setLineBuffer(engine, 'measure', null, null);
      engine.scheduleRender();
    }
    props.onMeasure?.(null);
  }, [props.blocks, props.layerY, props.onMeasure]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.selectedCell = null;
    engine.hoveredCell = null;
    hoverKey.current = null;
    setSelectedCell(null);
    setHoveredCell(null);
    setLineBuffer(engine, 'outline', null, null);
    engine.scheduleRender();
  }, [props.blocks]);

  const isDark = props.theme === 'dark';
  const chrome = isDark
    ? 'border-paper/30 bg-ink/90 text-paper'
    : 'border-ink bg-canvas/95 text-ink';
  const chromeButton = isDark ? 'onDark' : 'ghost';
  const rulerMax = Math.max(size[0], size[1], size[2]);
  const activeCell = selectedCell ?? hoveredCell;
  const activeBlock = activeCell ? cellBlocks.get(blockKey(activeCell)) : undefined;

  return (
    <div
      className={`relative h-full min-h-[26rem] w-full overflow-hidden ${isDark ? 'bg-terminal' : 'bg-canvas'}`}
      data-testid="schematic-viewer"
      data-viewer-theme={props.theme}
      data-viewer-stats={JSON.stringify({
        blocks: props.blocks.length,
        layer: props.layerY ?? 'all',
        contextOpacity: props.contextOpacity,
        isolate: props.isolateLayer ?? false,
        theme: props.theme,
      })}
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-grab touch-none"
        tabIndex={0}
        aria-label={t('viewerAriaLabel')}
      />

      <div className={`pointer-events-none absolute left-3 top-3 rounded-control border px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] ${isDark ? 'border-accent bg-ink text-paper' : 'border-ink bg-canvas text-ink'}`} role="status" aria-live="polite">
        {status}
      </div>
      {fatalError && (
        <div className="absolute inset-x-3 top-12 rounded-control border-2 border-terracotta bg-terracotta px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-paper" role="alert">
          {fatalError}
        </div>
      )}

      <div className={`absolute right-3 top-3 flex max-w-[calc(100%-7rem)] flex-wrap justify-end gap-1 rounded-control border p-1 ${chrome}`}>
        <IconButton label={t('fitView')} icon="fit" variant={chromeButton} size="xs" onClick={() => engineRef.current?.fit()} />
        <IconButton label={t('resetView')} icon="target" variant={chromeButton} size="xs" onClick={() => engineRef.current?.applyPreset('iso')} />
        {(['iso', 'top', 'front', 'right'] as ViewPreset[]).map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => engineRef.current?.applyPreset(preset)}
            className={`h-6 rounded-control border px-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] ${isDark ? 'border-paper/30 hover:bg-paper/10' : 'border-ink/50 hover:bg-surface'}`}
            aria-label={`${t('viewPreset')} ${preset.toUpperCase()}`}
          >
            {preset}
          </button>
        ))}
        <IconButton
          label={isDark ? t('lightBackground') : t('darkBackground')}
          icon={isDark ? 'sun' : 'moon'}
          variant={chromeButton}
          size="xs"
          aria-pressed={!isDark}
          onClick={() => props.onThemeChange?.()}
        />
        <IconButton label={t('viewerHelp')} icon="help" variant={chromeButton} size="xs" onClick={() => props.onHelp?.()} />
      </div>

      {activeCell && (
        <div className={`pointer-events-none absolute left-1/2 top-12 -translate-x-1/2 rounded-control border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] ${chrome}`}>
          {activeBlock ? `${activeBlock.blockId} · ` : ''}[{activeCell.join(', ')}]
        </div>
      )}

      {props.showGrid && chunks.length > 0 && (
        <div className={`absolute right-3 top-16 max-h-32 max-w-[11rem] overflow-auto rounded-control border p-2 font-mono text-[10px] ${chrome}`} aria-label={t('chunkSections')}>
          {chunks.slice(0, 12).map((chunk) => (
            <button
              key={chunk.key}
              type="button"
              onClick={() => engineRef.current?.focusChunk(chunk.key)}
              className={`block w-full text-left hover:underline ${isDark ? 'text-paper' : 'text-ink'}`}
              title={t('focusChunk')}
            >
              {chunk.key} · {chunk.count}
            </button>
          ))}
          {chunks.length > 12 && <div>+{chunks.length - 12}…</div>}
        </div>
      )}

      {props.measureMode && (
        <div className={`absolute bottom-3 right-3 rounded-control border px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em] ${isDark ? 'border-amber bg-ink text-amber' : 'border-terracotta bg-canvas text-terracotta'}`} role="status" aria-live="polite">
          {measurement
            ? `Δx ${measurement.dx} · Δy ${measurement.dy} · Δz ${measurement.dz} · d ${measurement.distance}`
            : t('measureHint')}
        </div>
      )}

      {props.showRuler && (
        <div className={`absolute bottom-3 left-3 rounded-control border px-2.5 py-1.5 font-mono text-[10px] ${chrome}`} aria-label={t('rulerLabel', { max: rulerMax })}>
          <div className="relative h-3 w-40 border-b border-current">
            {marks.map((mark) => (
              <span key={mark} className="absolute bottom-0 h-2 w-px bg-current" style={{ left: `${(mark / rulerMax) * 100}%` }} />
            ))}
          </div>
          <div className="relative h-3 w-40">
            {marks.map((mark) => (
              <span key={mark} className="absolute top-0 -translate-x-1/2" style={{ left: `${(mark / rulerMax) * 100}%` }}>
                {mark}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
