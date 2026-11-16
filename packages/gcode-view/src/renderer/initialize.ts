import { VIEW_ANGLES, fitOrbit } from '../camera.ts';
import { createCarveLayer } from '../carve/mesh.ts';
import { link } from '../glProgram.ts';
import { createLineTools } from '../lineTools.ts';
import { SPIN_FRAME_MS, isSoftwareRenderer } from '../markerSpin.ts';
import { PATH_FRAGMENT, SOLID_FRAGMENT, SOLID_VERTEX, pathVertex } from '../pathShaders.ts';
import { bindRenderer } from './bindings.ts';
import { NO_OFFSET, STYLE_COUNT } from './constants.ts';
import { type RendererContext } from './context.ts';
import { type RendererOptions } from './contract.ts';

export function createContext(gl: WebGL2RenderingContext, options: RendererOptions): RendererContext {
  const ctx = { gl, options } as RendererContext;
  bindRenderer(ctx);
  initializeRenderer(ctx);
  return ctx;
}

export function initializeRenderer(ctx: RendererContext): void {
  ctx.requestFrame = ctx.options.requestFrame ?? ((draw: () => void) => { requestAnimationFrame(draw); });
  ctx.now = ctx.options.now ?? (() => performance.now());
  ctx.reducedMotion = ctx.options.reducedMotion ?? (() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  initializePrograms(ctx);
  ctx.colors = ctx.options.colors;
  ctx.path = [];
  ctx.gridChunk = null;
  ctx.frameOverlay = null;
  ctx.markerOverlay = null;
  ctx.playOverlay = null;
  ctx.playAt = null;
  ctx.solids = [];
  ctx.stockSolid = -1;
  ctx.list = null;
  ctx.bounds = null;
  ctx.envelope = null;
  ctx.scene = null;
  ctx.sceneBox = null;
  ctx.pathOffset = NO_OFFSET;
  ctx.wcs = null;
  ctx.showRapids = true;
  ctx.showGrid = ctx.options.grid === true;
  ctx.highlightLine = -1;
  ctx.planner = null;
  ctx.marker = null;
  ctx.toolShape = null;
  ctx.markerPreview = false;
  ctx.motion = null;
  ctx.spin = 0;
  ctx.spinSince = 0;
  ctx.spinTimer = null;
  initializeView(ctx);
}

export function initializePrograms(ctx: RendererContext): void {

  ctx.program = link(ctx.gl, pathVertex(STYLE_COUNT), PATH_FRAGMENT, ['a_pos', 'a_style', 'a_line', 'a_dist']);
  ctx.u = {
    mvp: ctx.gl.getUniformLocation(ctx.program, 'u_mvp'),
    offset: ctx.gl.getUniformLocation(ctx.program, 'u_offset'),
    showRapids: ctx.gl.getUniformLocation(ctx.program, 'u_showRapids'),
    highlightEnd: ctx.gl.getUniformLocation(ctx.program, 'u_highlightEnd'),
    colors: ctx.gl.getUniformLocation(ctx.program, 'u_colors'),
    highlight: ctx.gl.getUniformLocation(ctx.program, 'u_highlight'),
    dash: ctx.gl.getUniformLocation(ctx.program, 'u_dash'),
    plan: ctx.gl.getUniformLocation(ctx.program, 'u_plan'),
    plan2: ctx.gl.getUniformLocation(ctx.program, 'u_plan2'),
    rot: ctx.gl.getUniformLocation(ctx.program, 'u_rot'),
    exec: ctx.gl.getUniformLocation(ctx.program, 'u_exec'),
    queued: ctx.gl.getUniformLocation(ctx.program, 'u_queued'),
    dimRect: ctx.gl.getUniformLocation(ctx.program, 'u_dimRect'),
    dimAlpha: ctx.gl.getUniformLocation(ctx.program, 'u_dimAlpha'),
    toolOn: ctx.gl.getUniformLocation(ctx.program, 'u_toolOn'),
    toolColors: ctx.gl.getUniformLocation(ctx.program, 'u_toolColors'),
    lineTools: ctx.gl.getUniformLocation(ctx.program, 'u_lineTools'),
    focus: ctx.gl.getUniformLocation(ctx.program, 'u_focus'),
    bg: ctx.gl.getUniformLocation(ctx.program, 'u_bg'),
  };
  ctx.solidProgram = link(ctx.gl, SOLID_VERTEX, SOLID_FRAGMENT, ['a_pos', 'a_color']);
  ctx.su = { mvp: ctx.gl.getUniformLocation(ctx.solidProgram, 'u_mvp') };
  ctx.carve = createCarveLayer(ctx.gl, ctx.options.carveMeshMax === undefined ? {} : { meshMax: ctx.options.carveMeshMax });
  ctx.lineTools = createLineTools(ctx.gl);
  ctx.toolFocus = -1;
  ctx.carve.setBelowColor(ctx.options.colors.outOfBounds);
  if (ctx.options.colors.carveCut !== undefined) ctx.carve.setCutColor(ctx.options.colors.carveCut);
}

export function initializeView(ctx: RendererContext): void {

  ctx.canSpin = !isSoftwareRenderer(ctx.gl);
  ctx.spinFrameMs = SPIN_FRAME_MS;
  ctx.angles = VIEW_ANGLES.iso;
  ctx.view = fitOrbit(null);
  ctx.autoFit = true;
  ctx.width = 1;
  ctx.height = 1;
  ctx.scheduled = false;
  ctx.frameCount = 0;
  ctx.generation = 0;
  ctx.disposed = false;
}
