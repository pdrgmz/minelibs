import { Structure, StructureRenderer } from 'deepslate/render';
import type { Resources } from 'deepslate/render';
import { mat4, vec3 } from 'gl-matrix';
import { useEffect, useMemo, useRef, useState } from 'react';
import { chunkCounts, filterBlocks, measurePoints, rulerMarks } from './layers';
import type { Measurement, Point3 } from './layers';
import type { ParsedBlock } from './parser/types';
import { AssetLoader } from './resources';

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
  token: string | null;
  onProgress?: (stage: string) => void;
  onReady?: (capture: () => string | null) => void;
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

interface Camera {
  xRotation: number;
  yRotation: number;
  distance: number;
  center: Size;
}

interface Engine {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  renderer: RendererWithDispose | null;
  resources: Resources | null;
  size: Size;
  camera: Camera;
  grid: GridData | null;
  measureBuffer: WebGLBuffer | null;
  measureVertexCount: number;
  frame: number | null;
  showGrid: boolean;
  showRuler: boolean;
  scheduleRender: () => void;
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

/** Una sola Structure con geometría por secciones 16³; nunca un mesh por bloque. */
function buildStructure(
  blocks: ParsedBlock[],
  layerY: number | null,
  highlight: string | null,
  size: Size,
): Structure {
  const structure = new Structure(size);
  for (const block of filterBlocks(blocks, layerY, highlight)) {
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

function computeView(camera: Camera): mat4 {
  const view = mat4.create();
  mat4.translate(view, view, [0, 0, -camera.distance]);
  mat4.rotate(view, view, camera.xRotation, [1, 0, 0]);
  mat4.rotate(view, view, camera.yRotation, [0, 1, 0]);
  mat4.translate(view, view, [-camera.center[0], -camera.center[1], -camera.center[2]]);
  return view;
}

function computeProjection(canvas: HTMLCanvasElement): mat4 {
  const projection = mat4.create();
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  mat4.perspective(projection, (70 * Math.PI) / 180, width / height, 0.1, 500);
  return projection;
}

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

/** Invierte vista+proyección y corta el rayo del ratón con el plano de la capa. */
function pointFromEvent(engine: Engine, event: MouseEvent, planeY: number): Point3 | null {
  const rect = engine.canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = 1 - ((event.clientY - rect.top) / rect.height) * 2;
  const viewProjection = mat4.multiply(mat4.create(), computeProjection(engine.canvas), computeView(engine.camera));
  const inverse = mat4.invert(mat4.create(), viewProjection);
  if (!inverse) return null;

  const near = vec3.transformMat4(vec3.create(), vec3.fromValues(ndcX, ndcY, -1), inverse);
  const far = vec3.transformMat4(vec3.create(), vec3.fromValues(ndcX, ndcY, 1), inverse);
  const direction = vec3.subtract(vec3.create(), far, near);
  if (Math.abs(direction[1]) < 1e-6) return null;

  const travelled = (planeY - near[1]) / direction[1];
  if (travelled < 0) return null;
  const point = vec3.scaleAndAdd(vec3.create(), near, direction, travelled);
  const clamp = (value: number, max: number): number => Math.max(0, Math.min(max - 1, Math.round(value)));
  return [
    clamp(point[0], engine.size[0]),
    clamp(point[1], engine.size[1]),
    clamp(point[2], engine.size[2]),
  ];
}

function setMeasureBuffer(engine: Engine, measurement: Measurement | null): void {
  if (engine.measureBuffer) {
    engine.gl.deleteBuffer(engine.measureBuffer);
    engine.measureBuffer = null;
    engine.measureVertexCount = 0;
  }
  if (!measurement) return;
  const buffer = engine.gl.createBuffer();
  if (!buffer) return;
  const [ax, ay, az] = measurement.a;
  const [bx, by, bz] = measurement.b;
  const vertices = new Float32Array([
    ax + 0.5, ay + 1, az + 0.5,
    bx + 0.5, by + 1, bz + 0.5,
  ]);
  engine.gl.bindBuffer(engine.gl.ARRAY_BUFFER, buffer);
  engine.gl.bufferData(engine.gl.ARRAY_BUFFER, vertices, engine.gl.STATIC_DRAW);
  engine.measureBuffer = buffer;
  engine.measureVertexCount = 2;
}

function drawEngine(engine: Engine): void {
  const { gl, renderer, canvas } = engine;
  if (!renderer) return;

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.06, 0.07, 0.09, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const view = computeView(engine.camera);
  renderer.drawStructure(view);

  const grid = engine.grid;
  if (!grid || (!engine.showGrid && engine.measureVertexCount === 0)) return;

  gl.useProgram(grid.program);
  gl.uniformMatrix4fv(grid.viewLocation, false, view);
  gl.uniformMatrix4fv(grid.projectionLocation, false, computeProjection(canvas));
  gl.enableVertexAttribArray(grid.positionLocation);
  gl.vertexAttribPointer(grid.positionLocation, 3, gl.FLOAT, false, 0, 0);
  gl.disable(gl.DEPTH_TEST);

  if (engine.showGrid) {
    gl.uniform4f(grid.colorLocation, 0.35, 0.75, 1, 0.6);
    gl.bindBuffer(gl.ARRAY_BUFFER, grid.buffer);
    gl.drawArrays(gl.LINES, 0, grid.vertexCount);
  }
  if (engine.measureBuffer && engine.measureVertexCount > 0) {
    gl.uniform4f(grid.colorLocation, 1, 0.75, 0.2, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, engine.measureBuffer);
    gl.drawArrays(gl.LINES, 0, engine.measureVertexCount);
  }
  gl.enable(gl.DEPTH_TEST);
}

function captureCanvas(canvas: HTMLCanvasElement, engine: Engine): string | null {
  if (!engine.renderer) return null;
  try {
    drawEngine(engine);
    const snapshot = document.createElement('canvas');
    snapshot.width = 256;
    snapshot.height = 256;
    const context = snapshot.getContext('2d');
    if (!context) return null;
    context.drawImage(canvas, 0, 0, 256, 256);
    return snapshot.toDataURL('image/png');
  } catch {
    return null;
  }
}

export function SchematicViewer(props: SchematicViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const [status, setStatus] = useState('Inicializando visor…');
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const firstPoint = useRef<Point3 | null>(null);

  const size = useMemo(() => computeSize(props.blocks), [props.blocks]);
  const chunks = useMemo(() => chunkCounts(props.blocks), [props.blocks]);
  const marks = useMemo(
    () => rulerMarks({ widthX: size[0], heightY: size[1], lengthZ: size[2] }),
    [size],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    setFatalError(null);
    setStatus('Creando contexto WebGL…');

    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: true });
    if (!gl) {
      setFatalError('WebGL no está disponible en este navegador.');
      setStatus('Sin WebGL');
      propsRef.current.onReady?.(() => null);
      return;
    }

    const engine: Engine = {
      canvas,
      gl,
      renderer: null,
      resources: null,
      size,
      camera: {
        xRotation: 0.8,
        yRotation: 0.5,
        distance: Math.max(4, Math.max(size[0], size[1], size[2]) * 2),
        center: [size[0] / 2, size[1] / 2, size[2] / 2],
      },
      grid: null,
      measureBuffer: null,
      measureVertexCount: 0,
      frame: null,
      showGrid: propsRef.current.showGrid,
      showRuler: propsRef.current.showRuler,
      scheduleRender: () => undefined,
    };
    engine.scheduleRender = () => {
      if (cancelled || engine.frame !== null) return;
      engine.frame = requestAnimationFrame(() => {
        engine.frame = null;
        drawEngine(engine);
      });
    };
    engineRef.current = engine;

    let drag: [number, number] | null = null;
    const onMouseDown = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      if (propsRef.current.measureMode) {
        const point = pointFromEvent(engine, event, propsRef.current.layerY ?? 0);
        if (!point) return;
        if (!firstPoint.current) {
          firstPoint.current = point;
          setMeasurement(null);
          setMeasureBuffer(engine, null);
          propsRef.current.onMeasure?.(null);
        } else {
          const result = measurePoints(firstPoint.current, point);
          firstPoint.current = null;
          setMeasurement(result);
          setMeasureBuffer(engine, result);
          propsRef.current.onMeasure?.(result);
        }
        engine.scheduleRender();
        return;
      }
      if (propsRef.current.layerMode) return;
      drag = [event.clientX, event.clientY];
    };
    const onMouseMove = (event: MouseEvent): void => {
      if (!drag) return;
      engine.camera.yRotation += (event.clientX - drag[0]) / 100;
      engine.camera.xRotation = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, engine.camera.xRotation + (event.clientY - drag[1]) / 100),
      );
      drag = [event.clientX, event.clientY];
      engine.scheduleRender();
    };
    const onMouseUp = (): void => {
      drag = null;
    };
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      engine.camera.distance = Math.max(
        1,
        Math.min(500, engine.camera.distance * Math.exp(event.deltaY * 0.001)),
      );
      engine.scheduleRender();
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
        engine.renderer?.setViewport(0, 0, pixelWidth, pixelHeight);
      }
      engine.scheduleRender();
    };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    if (observer) observer.observe(canvas);
    else window.addEventListener('resize', resize);

    const loader = new AssetLoader(props.version);
    loader.setToken(props.token);
    const allBlockIds = [...new Set(props.blocks.map((block) => block.blockId))];

    void (async () => {
      try {
        propsRef.current.onProgress?.('Cargando definiciones y modelos…');
        setStatus('Cargando recursos del visor…');
        const resources = await loader.buildResources(allBlockIds);
        if (cancelled) return;

        engine.resources = resources;
        engine.size = computeSize(propsRef.current.blocks);
        engine.camera.center = [engine.size[0] / 2, engine.size[1] / 2, engine.size[2] / 2];
        const structure = buildStructure(
          propsRef.current.blocks,
          propsRef.current.layerY,
          propsRef.current.highlight,
          engine.size,
        );
        const renderer: RendererWithDispose = new StructureRenderer(gl, structure, resources, {
          chunkSize: 16,
          useInvisibleBlockBuffer: false,
        });
        engine.renderer = renderer;
        engine.grid = createGrid(gl, engine.size);
        resize();

        setStatus('Listo');
        propsRef.current.onProgress?.('Listo');
        propsRef.current.onReady?.(() => captureCanvas(canvas, engine));
        engine.scheduleRender();
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setFatalError(`No se pudo preparar el visor: ${message}`);
        setStatus('Error');
      }
    })();

    return () => {
      cancelled = true;
      if (engine.frame !== null) cancelAnimationFrame(engine.frame);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', resize);
      if (engine.grid) {
        gl.deleteBuffer(engine.grid.buffer);
        gl.deleteProgram(engine.grid.program);
      }
      if (engine.measureBuffer) gl.deleteBuffer(engine.measureBuffer);
      if (typeof engine.renderer?.dispose === 'function') engine.renderer.dispose();
      // No llamar a loseContext(): React puede reutilizar el mismo canvas tras un
      // rerender/StrictMode y getContext devolvería un contexto ya perdido.
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [props.blocks, props.version, props.token, size]);

  // Cambiar de capa o resaltar reconstruye la Structure reutilizando recursos y renderer.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine?.renderer) return;
    engine.size = size;
    engine.camera.center = [size[0] / 2, size[1] / 2, size[2] / 2];
    engine.renderer.setStructure(buildStructure(props.blocks, props.layerY, props.highlight, size));
    const sizeKey = size.join(',');
    if (engine.grid?.sizeKey !== sizeKey) {
      if (engine.grid) {
        engine.gl.deleteBuffer(engine.grid.buffer);
        engine.gl.deleteProgram(engine.grid.program);
      }
      engine.grid = createGrid(engine.gl, size);
    }
    engine.scheduleRender();
  }, [props.blocks, props.layerY, props.highlight, size]);

  useEffect(() => {
    const engine = engineRef.current;
    if (engine) {
      engine.showGrid = props.showGrid;
      engine.scheduleRender();
    }
  }, [props.showGrid]);

  useEffect(() => {
    const engine = engineRef.current;
    if (engine) {
      engine.showRuler = props.showRuler;
      engine.scheduleRender();
    }
  }, [props.showRuler]);

  // La vista superior 2D fija la cámara; al salir se restaura la órbita isométrica.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (props.layerMode) {
      engine.camera.xRotation = -Math.PI / 2;
      engine.camera.yRotation = 0;
      engine.camera.distance = Math.max(4, Math.max(size[0], size[2]) * 1.6);
    } else {
      engine.camera.xRotation = 0.8;
      engine.camera.yRotation = 0.5;
      engine.camera.distance = Math.max(4, Math.max(size[0], size[1], size[2]) * 2);
    }
    engine.scheduleRender();
  }, [props.layerMode, props.blocks, props.version, props.token, size]);

  // Cambiar de capa o de schematic invalida la medida en curso.
  useEffect(() => {
    firstPoint.current = null;
    setMeasurement(null);
    const engine = engineRef.current;
    if (engine) {
      setMeasureBuffer(engine, null);
      engine.scheduleRender();
    }
    props.onMeasure?.(null);
  }, [props.blocks, props.layerY, props.onMeasure]);

  const rulerMax = Math.max(size[0], size[1], size[2]);

  return (
    <div className="relative h-96 w-full overflow-hidden rounded bg-slate-900" data-testid="schematic-viewer">
      <canvas ref={canvasRef} className="h-full w-full" aria-label="Visor 3D de schematic" />

      <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white" role="status" aria-live="polite">
        {status}
      </div>
      {fatalError && (
        <div className="absolute inset-x-2 top-10 rounded bg-red-900/90 px-3 py-2 text-sm text-white" role="alert">
          {fatalError}
        </div>
      )}

      {props.showGrid && chunks.length > 0 && (
        <div className="absolute right-2 top-2 max-h-32 overflow-auto rounded bg-black/60 p-2 text-[10px] text-white" aria-label="Secciones 16×16×16 visibles">
          {chunks.slice(0, 12).map((chunk) => (
            <div key={chunk.key}>{chunk.key} · {chunk.count}</div>
          ))}
          {chunks.length > 12 && <div>+{chunks.length - 12}…</div>}
        </div>
      )}

      {props.measureMode && (
        <div className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-1 text-[11px] text-amber-200" role="status" aria-live="polite">
          {measurement
            ? `Δx ${measurement.dx} · Δy ${measurement.dy} · Δz ${measurement.dz} · d ${measurement.distance}`
            : 'Haz clic en dos bloques para medir'}
        </div>
      )}

      {props.showRuler && (
        <div
          className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white"
          aria-label={`Regla de 0 a ${rulerMax} bloques`}
        >
          <div className="relative h-3 w-40 border-b border-white/80">
            {marks.map((mark) => (
              <span
                key={mark}
                className="absolute bottom-0 h-2 w-px bg-white/80"
                style={{ left: `${(mark / rulerMax) * 100}%` }}
              />
            ))}
          </div>
          <div className="relative h-3 w-40">
            {marks.map((mark) => (
              <span
                key={mark}
                className="absolute top-0 -translate-x-1/2"
                style={{ left: `${(mark / rulerMax) * 100}%` }}
              >
                {mark}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
