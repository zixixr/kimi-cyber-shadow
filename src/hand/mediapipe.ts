// 摄像头源：getUserMedia → MediaPipe HandLandmarker（最多 2 手）→ 归一化 HandSignal。
// 各路信号 One Euro 滤波（慢速平滑、快速跟手）；手势分类/去抖/深度基线全在 gestures.ts。
// 镜像约定：摄像头原始流未翻转，这里统一翻到「观众视角」（x 右正、y 上正）——
// 手往用户自己的右侧移 → 信号 x 增大 → 影人向观众右侧走，所见即所得。
// 启动失败（无权限 / 无摄像头 / wasm 或模型下载失败）会抛错并清理现场，
// 由 main 捕获后优雅降级到鼠标调试源（?debug=mouse 同款体验）。
// 右下角常驻镜像小窗：视频 + 腕-指尖连线 + 手势名，识别调试用。

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { classify, DepthBaseline, fingerRatios, GestureDebouncer, palmLength, type Gesture } from './gestures';
import { FINGER_TIPS, INDEX_TIP, MIDDLE_MCP, PALM_POINTS, WRIST } from './mapping';
import type { HandSignal, HandSource } from './source';

const MAX_HANDS = 2; // 双手：第 1 只主角，第 2 只预留老虎/第二角色（文档第 6 章路由）
// wasm 与模型走 CDN 并钉死版本（与 node_modules 安装版一致；首次加载需联网，浏览器有缓存）
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/** One Euro 滤波：低速时强平滑（防抖）、高速时弱平滑（跟手），手信号标配 */
class OneEuro {
  private xPrev = 0;
  private dxPrev = 0;
  private tPrev = -1;
  private init = false;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;

  constructor(minCutoff = 1.2, beta = 0.05, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, t: number): number {
    if (!this.init) {
      this.init = true;
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(1e-3, t - this.tPrev);
    this.tPrev = t;
    const dx = (x - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    this.dxPrev = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = this.alpha(cutoff, dt);
    this.xPrev = a * x + (1 - a) * this.xPrev;
    return this.xPrev;
  }
}

/** 每只手（槽位）一套滤波/去抖/深度基线状态 */
interface SlotState {
  wx: OneEuro;
  wy: OneEuro;
  px: OneEuro;
  py: OneEuro;
  depth: OneEuro;
  lean: OneEuro;
  ix: OneEuro;
  iy: OneEuro;
  debounce: GestureDebouncer;
  baseline: DepthBaseline;
}

function makeSlot(): SlotState {
  return {
    wx: new OneEuro(),
    wy: new OneEuro(),
    px: new OneEuro(),
    py: new OneEuro(),
    depth: new OneEuro(0.8, 0.03),
    lean: new OneEuro(0.8, 0.03),
    ix: new OneEuro(1.8, 0.12), // 指向需要更跟手
    iy: new OneEuro(1.8, 0.12),
    debounce: new GestureDebouncer(),
    baseline: new DepthBaseline(),
  };
}

/** MediaPipe 原始关键点（只用了 x/y） */
interface RawLm {
  x: number;
  y: number;
}

export class MediaPipeSource implements HandSource {
  readonly name = '摄像头';

  private video!: HTMLVideoElement;
  private landmarker!: HandLandmarker;
  private signals: HandSignal[] = [];
  private running = false;
  private slots = Array.from({ length: MAX_HANDS }, makeSlot);
  private viz!: HTMLCanvasElement;
  private label!: HTMLDivElement;

  async start(): Promise<void> {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      this.video.srcObject = stream;
      await this.video.play();

      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: MAX_HANDS,
      });
    } catch (err) {
      // 清理已占用的摄像头，让 main 的降级路径干净接管
      this.stopTracks();
      throw err;
    }
    this.running = true;
    this.buildViz();
    this.loop();
  }

  read(): HandSignal[] {
    return this.signals;
  }

  dispose(): void {
    this.running = false;
    this.stopTracks();
    this.landmarker?.close();
    this.viz?.remove();
    this.label?.remove();
  }

  private stopTracks(): void {
    (this.video?.srcObject as MediaStream | null)?.getTracks().forEach((tr) => tr.stop());
  }

  // ---------- 检测主循环（独立 rAF，与渲染循环解耦） ----------

  private loop = () => {
    if (!this.running) return;
    const t = performance.now() / 1000;
    if (this.video.readyState >= 2) {
      const res = this.landmarker.detectForVideo(this.video, performance.now());
      const hands = (res.landmarks ?? [])
        .slice(0, MAX_HANDS)
        .map((lm, i) => ({
          lm: lm as RawLm[],
          handed: (res.handedness?.[i]?.[0]?.categoryName ?? 'Right') as 'Left' | 'Right',
        }))
        // 观众视角从左到右排序：镜像 x = 1-2·raw.x，即按 raw.x 降序；
        // 槽位稳定，滤波器按槽绑定，换手不串状态
        .sort((a, b) => b.lm[WRIST].x - a.lm[WRIST].x);

      this.signals = hands.map(({ lm, handed }, slot) => this.toSignal(lm, handed, slot, t));
      this.drawViz(hands.map(({ lm, handed }, slot) => ({ lm, handed, gesture: this.signals[slot].gesture })));
    }
    requestAnimationFrame(this.loop);
  };

  /** 单手原始关键点 → 归一化 HandSignal（镜像 + 滤波 + 手势 + 深度基线） */
  private toSignal(lm: RawLm[], handed: 'Left' | 'Right', slot: number, t: number): HandSignal {
    const f = this.slots[slot];
    const wrist = lm[WRIST];
    const palm = palmLength(lm);

    // 掌心 = 腕 + 四指根均值（比单腕稳，做指向基准）
    let cx = 0;
    let cy = 0;
    for (const j of PALM_POINTS) {
      cx += lm[j].x;
      cy += lm[j].y;
    }
    cx /= PALM_POINTS.length;
    cy /= PALM_POINTS.length;

    // 五指伸展比率 → 手势（比率分母 = 掌长，铁律①；分类+迟滞+去抖，铁律②）
    const ratios = fingerRatios(lm);
    const gesture = f.debounce.update(classify(ratios, f.debounce.value), t);

    // 深度基准 = 掌长，稳定 0.4s 后才锁基线（铁律③）
    const depth = f.baseline.update(palm, t);

    // 倾身：腕→中指根的横向倾斜（镜像后右倾为正）
    const leanRaw = Math.max(-1, Math.min(1, -(lm[MIDDLE_MCP].x - wrist.x) * 6));

    return {
      present: true,
      // MediaPipe handedness 假设输入已水平翻转（自拍镜像）；原始流未翻 → 交换左右
      handedness: handed === 'Left' ? 'right' : 'left',
      landmarks: lm.map((p) => ({ x: -(p.x * 2 - 1), y: -(p.y * 2 - 1) })),
      palm: { x: f.px.filter(-(cx * 2 - 1), t), y: f.py.filter(-(cy * 2 - 1), t) },
      wrist: { x: f.wx.filter(-(wrist.x * 2 - 1), t), y: f.wy.filter(-(wrist.y * 2 - 1), t) },
      palmLen: palm,
      depth: f.depth.filter(depth, t),
      lean: f.lean.filter(leanRaw, t),
      gesture,
      // 食指尖相对掌心方向（镜像 + y 翻转为上正），point 指向用
      indexTip: { x: f.ix.filter(-(lm[INDEX_TIP].x - cx), t), y: f.iy.filter(cy - lm[INDEX_TIP].y, t) },
    };
  }

  // ---------- 调试小窗 ----------

  private buildViz(): void {
    this.viz = document.createElement('canvas');
    this.viz.width = 280;
    this.viz.height = 210;
    Object.assign(this.viz.style, {
      position: 'fixed',
      right: '14px',
      bottom: '14px',
      width: '280px',
      borderRadius: '4px',
      border: '1px solid #c8a05a55',
      opacity: '0.85',
      transform: 'scaleX(-1)', // 画面镜像成自拍视角，人眼好对
      zIndex: '10',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.viz);

    this.label = document.createElement('div');
    Object.assign(this.label.style, {
      position: 'fixed',
      right: '14px',
      bottom: '228px',
      width: '280px',
      textAlign: 'center',
      color: '#d9c39a',
      font: '13px "Songti SC", serif',
      letterSpacing: '0.15em',
      zIndex: '10',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.label);
  }

  private drawViz(hands: { lm: RawLm[]; handed: string; gesture: Gesture }[]): void {
    const ctx = this.viz.getContext('2d')!;
    const W = this.viz.width;
    const H = this.viz.height;
    ctx.drawImage(this.video, 0, 0, W, H);
    for (const { lm, gesture } of hands) {
      const wx = lm[WRIST].x * W;
      const wy = lm[WRIST].y * H;
      // 五指全部画出（腕-指尖连线 + 指尖点）：确认判定用到了每根手指
      ctx.lineWidth = 2;
      ctx.strokeStyle = gesture === 'fist' ? '#e6537a' : '#37e6a0';
      for (const tip of FINGER_TIPS) {
        const x = lm[tip].x * W;
        const y = lm[tip].y * H;
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = tip === INDEX_TIP ? '#37e6a0' : '#ffd27f';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    this.label.textContent = hands.map((h) => `${h.handed === 'Left' ? '左' : '右'}:${h.gesture}`).join(' · ') || '(无手)';
  }
}
