// 复制自主项目的真实素材加载（只读）：geometry.json / pivots.json / 品红原图 / dye+alpha 贴图。
const BASE = '/data/wusheng';

export interface PartGeom {
  outline: [number, number][];
  bbox: [number, number, number, number];
}
export interface PivotDef {
  parent: string | null;
  pivotInParent: [number, number];
  pivotInSelf: [number, number];
  height: number;
  limits: [number, number];
  layer: number;
  rest?: number;
  art?: string;
  flipX?: boolean;
  erase?: [number, number, number, number][];
  /** 素皮插领桩降调区（同主项目 assembly.ts）：dye 图内归一化 UV 矩形，运行时整体压暗，
   *  消掉头件底部 tan 插领桩在 3D 装配视图里读作「过长发亮的脖子」。 */
  dyeDarken?: [number, number, number, number][];
}

export interface Assets {
  parts: Record<string, PartGeom>;
  pivots: Record<string, PivotDef>;
}

export async function loadData(): Promise<Assets> {
  const [g, p] = await Promise.all([
    fetch(`${BASE}/geometry.json`).then((r) => r.json()),
    fetch(`${BASE}/pivots.json`).then((r) => r.json()),
  ]);
  return { parts: g.parts as Record<string, PartGeom>, pivots: p as Record<string, PivotDef> };
}

export function rawURL(name: string): string {
  return `${BASE}/raw/${name}.png`;
}
export function dyeURL(name: string): string {
  return `${BASE}/tex/${name}_dye.png`;
}
export function alphaURL(name: string): string {
  return `${BASE}/tex/${name}_alpha.png`;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

/** 品红抠图（复刻 postprocess_puppet.key_magenta 的色距阈值逻辑，用于 canvas 版可视化）。
 *  返回一张 RGBA canvas：品红背景/镂空 → 透明，其余保留原色。 */
export function keyMagenta(img: HTMLImageElement, thr = 170): HTMLCanvasElement {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - 255;
    const dg = d[i + 1] - 0;
    const db = d[i + 2] - 255;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist < thr) d[i + 3] = 0;
  }
  ctx.putImageData(id, 0, 0);
  return cv;
}

/** 生成一份「品红 alpha 蒙版」：dist<thr（品红/镂空）处为 true。 */
export function magentaMask(img: HTMLImageElement, thr = 170): { w: number; h: number; mask: Uint8Array } {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let p = 0, i = 0; i < d.length; i += 4, p++) {
    const dr = d[i] - 255;
    const dg = d[i + 1];
    const db = d[i + 2] - 255;
    mask[p] = Math.sqrt(dr * dr + dg * dg + db * db) < thr ? 1 : 0;
  }
  return { w, h, mask };
}
