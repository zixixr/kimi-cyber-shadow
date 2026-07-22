import './style.css';
import { loadData, type Assets } from './assets';
import { CLIP_FRAMES, CLIP_TITLE, CLEAN, setStation, setTitle, setBrand, type Clip } from './common';

// 逻辑分辨率 1920×1080；画布内部按 2× 渲染 → 截图 deviceScaleFactor=2 得真 4K。
export const W = 1920;
export const H = 1080;
export const SCALE = 2;

export interface ClipCtx {
  gl: HTMLCanvasElement; // WebGL（three 用）
  c2d: HTMLCanvasElement; // 2D（canvas 版可视化用）
  ctx: CanvasRenderingContext2D; // 已 setTransform(2,2)，按逻辑坐标绘制
  assets: Assets;
  W: number;
  H: number;
  SCALE: number;
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const clipNo = Number(params.get('clip') ?? '1');

  const gl = document.getElementById('gl') as HTMLCanvasElement;
  const c2d = document.getElementById('c2d') as HTMLCanvasElement;
  for (const cv of [gl, c2d]) {
    cv.width = W * SCALE;
    cv.height = H * SCALE;
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
  }
  const ctx = c2d.getContext('2d')!;
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

  const assets = await loadData();
  // clean 模式：隐藏一切页面 chrome（DOM overlay 由 CSS 整块隐藏），只留内容主体
  if (CLEAN) document.body.classList.add('clean');
  setStation(clipNo);
  setTitle(CLIP_TITLE[clipNo] ?? '');
  setBrand('影人资产管线 · 武生');

  const cctx: ClipCtx = { gl, c2d, ctx, assets, W, H, SCALE };

  const modules: Record<number, () => Promise<{ create(c: ClipCtx): Promise<Clip> }>> = {
    1: () => import('./clip1_flat'),
    2: () => import('./clip2_cutout'),
    3: () => import('./clip3_vectorize'),
    4: () => import('./clip4_extrude'),
    5: () => import('./clip5_rivets'),
    6: () => import('./clip6_assembly'),
  };
  const mod = await modules[clipNo]();
  const clip = await mod.create(cctx);

  const cap = {
    ready: false,
    frames: CLIP_FRAMES[clipNo] ?? clip.frames,
    fps: 60,
    seek(frame: number) {
      clip.seek(frame);
    },
  };
  (window as unknown as { __cap: typeof cap }).__cap = cap;

  clip.seek(0);
  // 双 rAF 确保首帧（含 WebGL / 字体）真正落盘后再置 ready
  requestAnimationFrame(() => requestAnimationFrame(() => { cap.ready = true; }));
}

boot();
