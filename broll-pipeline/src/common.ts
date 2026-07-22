// 共用：帧率、缓动、部件中文名、overlay 写字助手。
export const FPS = 60;

/**
 * 干净模式（?clean=1）：隐藏页面自带的一切 chrome（工序头 / 右侧件名列 / 底部说明 / 计数器 /
 * 进度点 / 取景框），只留纯内容主体（皮件画面 / 扫描 / 描边 / 挤出 / 铆点 / 装配动画本体），
 * 内容居中放大占满画面。统一的「工序 0N · 名称」标注交给 Remotion 包装层，这里不再画。
 * DOM overlay 由 body.clean 的 CSS display:none 整块隐藏；canvas 版件名列 / 标注由各 clip 用
 * CLEAN 跳过；三维 clip 相机在 clean 下拉近放大。
 */
export const CLEAN = new URLSearchParams(location.search).get('clean') === '1';

/** 2D clips（01/02/03）的光台面板取景框：clean 下居中放大到近满高。 */
export const PANEL = CLEAN
  ? { X: (1920 - 968) / 2, Y: (1080 - 968) / 2, W: 968, H: 968 }
  : { X: 600, Y: 176, W: 720, H: 720 };

/** 每条 clip 的总帧数（时长 × 60）。 */
export const CLIP_FRAMES: Record<number, number> = {
  1: 360, // 6s
  2: 300, // 5s
  3: 360, // 6s
  4: 360, // 6s
  5: 300, // 5s
  6: 480, // 8s
};

export const CLIP_TITLE: Record<number, string> = {
  1: '平面皮件',
  2: '品红抠除',
  3: '轮廓矢量化',
  4: '挤出成厚片',
  5: '铆点铰接',
  6: '组装验活',
};

/** 部件中文名（用于逐件展示 / 标注）。 */
export const ZH: Record<string, string> = {
  belly: '胯胯（根件）',
  chest: '前胸',
  head: '头',
  upper_arm_f: '前大臂',
  lower_arm_f: '前小臂',
  hand_f: '前手',
  hand_b: '后手',
  hand_fist: '拳手',
  upper_arm_b: '后大臂',
  lower_arm_b: '后小臂',
  leg_f: '前腿',
  leg_b: '后腿',
};

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 帧区间 [f0,f1] 内把 frame 映射到 0..1。 */
export function seg(frame: number, f0: number, f1: number): number {
  return clamp01((frame - f0) / (f1 - f0));
}

export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// ---- overlay DOM 助手（全部 f(帧) 确定性写入） ----
const $ = (id: string) => document.getElementById(id)!;

export function setStation(no: number) {
  $('station-no').textContent = String(no).padStart(2, '0');
}
export function setTitle(t: string) {
  $('title').textContent = t;
}
export function setCaption(html: string) {
  $('caption').innerHTML = html;
}
export function setStat(html: string) {
  $('stat').innerHTML = html;
}
export function setBrand(t: string) {
  $('brand').textContent = t;
}

export interface Clip {
  frames: number;
  seek(frame: number): void;
}
