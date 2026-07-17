// 手信号统一接口 + 鼠标调试源（无摄像头也能开发全靠它，文档附录 C 建议 2）。
// HandSignal 是「归一化手信号」：关键点 / 掌心 / 掌长 / 左右手 / 手势 / 指向，
// 坐标统一为观众视角（x 右正、y 上正，范围约 [-1,1]）——MediaPipe 源与鼠标源都产出它，
// 导演（director.ts）只认这个接口，不关心信号来自哪里。
// 鼠标调试源（?debug=mouse）：移动=走位、滚轮=远近（灯前推）、p=循环切手势、左键拖动=指向。

import type { Gesture } from './gestures';

/** 归一化 2D 点：观众视角，x 右正、y 上正 */
export interface NormPoint {
  x: number;
  y: number;
}

/** 归一化手信号（一只手的全部控制信息） */
export interface HandSignal {
  /** 手是否在镜 */
  present: boolean;
  /** 左右手（观众视角的左右；MediaPipe 源已按自拍镜像修正） */
  handedness: 'left' | 'right';
  /** 21 关键点（归一化镜像坐标，顺序见 mapping.ts）；鼠标源无关键点 → null */
  landmarks: NormPoint[] | null;
  /** 掌心位置（腕+四指根均值，One Euro 滤波后；比单腕稳） */
  palm: NormPoint;
  /** 腕位置（One Euro 滤波后）——走位/跳跃的输入 */
  wrist: NormPoint;
  /** 掌长：腕→中指根单段距离（归一化单位；比率分母/深度基准用，不做硬滤波） */
  palmLen: number;
  /** 进深：0=贴幕（影锐）1=近灯（影虚） */
  depth: number;
  /** 倾身 [-1,1] */
  lean: number;
  /** 手势（已去抖，文档 6.2 手势表） */
  gesture: Gesture;
  /** 食指尖相对掌心方向（point 指向用，未归一化，导演自行单位化） */
  indexTip: NormPoint;
}

/** 手信号源（摄像头 / 鼠标调试，可互换） */
export interface HandSource {
  /** 源名（对照表状态行显示用） */
  readonly name: string;
  start(): Promise<void>;
  /** 当前在镜的手，观众视角从左到右排序（导演按序路由：第 1 只=主角） */
  read(): HandSignal[];
  dispose(): void;
}

export function emptySignal(): HandSignal {
  return {
    present: false,
    handedness: 'right',
    landmarks: null,
    palm: { x: 0, y: 0 },
    wrist: { x: 0, y: 0 },
    palmLen: 0.1,
    depth: 0.15,
    lean: 0,
    gesture: 'none',
    indexTip: { x: -0.8, y: 0.2 },
  };
}

/** p 键循环切换的手势顺序（调试） */
const GESTURE_CYCLE: Gesture[] = ['none', 'open', 'fist', 'sword', 'point', 'thumb'];

/**
 * 鼠标调试源：无摄像头也能联调全部控制逻辑。
 *  - 鼠标移动   → 腕位置（走位/跳/蹲/转身都会由运动层自动判）；
 *  - 滚轮       → 进深（近灯/贴幕）；
 *  - p 键       → 循环切手势（none→open→fist→sword→point→thumb）；
 *  - 左键按住拖 → 指向（相对屏幕中心的方向即指尖方向，配 point 手势用）。
 */
export class MouseDebugSource implements HandSource {
  readonly name = '鼠标调试';

  private sig: HandSignal = emptySignal();
  private dragging = false;

  private onMove = (e: PointerEvent) => {
    const x = (e.clientX / innerWidth) * 2 - 1;
    const y = -((e.clientY / innerHeight) * 2 - 1);
    if (this.dragging) {
      this.sig.indexTip = { x, y };
    } else {
      this.sig.wrist = { x, y };
      this.sig.palm = { x, y };
      this.sig.lean = Math.max(-1, Math.min(1, x * 0.6));
    }
    this.sig.present = true;
  };
  private onDown = (e: PointerEvent) => {
    if (e.button === 0) this.dragging = true;
  };
  private onUp = (e: PointerEvent) => {
    if (e.button === 0) this.dragging = false;
  };
  private onWheel = (e: WheelEvent) => {
    this.sig.depth = Math.max(0, Math.min(1, this.sig.depth + e.deltaY * 0.0012));
  };
  private onKey = (e: KeyboardEvent) => {
    if (e.type !== 'keydown' || e.key !== 'p') return;
    const i = GESTURE_CYCLE.indexOf(this.sig.gesture);
    this.sig.gesture = GESTURE_CYCLE[(i + 1) % GESTURE_CYCLE.length];
  };
  private onMenu = (e: Event) => e.preventDefault();

  start(): Promise<void> {
    addEventListener('pointermove', this.onMove);
    addEventListener('pointerdown', this.onDown);
    addEventListener('pointerup', this.onUp);
    addEventListener('wheel', this.onWheel);
    addEventListener('keydown', this.onKey);
    addEventListener('contextmenu', this.onMenu);
    return Promise.resolve();
  }

  read(): HandSignal[] {
    return this.sig.present ? [this.sig] : [];
  }

  dispose(): void {
    removeEventListener('pointermove', this.onMove);
    removeEventListener('pointerdown', this.onDown);
    removeEventListener('pointerup', this.onUp);
    removeEventListener('wheel', this.onWheel);
    removeEventListener('keydown', this.onKey);
    removeEventListener('contextmenu', this.onMenu);
  }
}
