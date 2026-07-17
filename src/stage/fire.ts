// 三昧真火粒子系统（M5）：红孩儿从嘴部喷出的火焰。
// 单 THREE.Points + 加色叠加；逐粒子顶点色随寿命按「亮黄白 → 橙 → 红 → 黑」渐变
// （加色混合下黑 = 消失，无需逐点 alpha），水平阻尼衰减 + 上升飘散。
// 挂 layer 1（与影人同层）：火点同样经灯位相机投上幕布。
// 用法：喷火窗口内（张开手 / AI 喷火拍）每帧 emit(喷口世界坐标, 方向±1) 持续喷，
// update(dt) 推进粒子；源头与方向完全由调用方指定，本类不管触发逻辑。

import * as THREE from 'three';

const MAX = 320; // 粒子池上限（喷速 7/帧 × 60fps × 平均寿命 0.6s ≈ 250，留余量）
const EMIT_N = 7; // 每次 emit 喷出的粒子数
const RISE = 0.55; // 上升加速度（火舌水平减速后上飘）
const DRAG = 1.35; // 水平阻尼（1/s）

/**
 * 火焰色渐变：f = 剩余寿命比例（1 初生 → 0 熄灭）。
 * 亮黄白 → 橙 → 红 → 黑；纯函数（粒子更新与单测共用）。
 */
export function fireGradient(f: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, f));
  if (x > 0.65) {
    // 亮黄白 → 橙
    const k = (x - 0.65) / 0.35;
    return [1, 0.55 + 0.35 * k, 0.08 + 0.35 * k];
  }
  if (x > 0.3) {
    // 橙 → 红
    const k = (x - 0.3) / 0.35;
    return [0.85 + 0.15 * k, 0.16 + 0.39 * k, 0.02 + 0.06 * k];
  }
  // 红 → 黑（加色混合下淡出）
  const k = x / 0.3;
  return [0.85 * k, 0.16 * k, 0.02 * k];
}

export class FireBreath {
  private points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array; // 剩余寿命（<=0 = 空位）
  private maxLife: Float32Array;
  private bright: Float32Array; // 逐粒子亮度抖动（0.8~1.1，火苗层次）
  private cursor = 0;

  /** @param parent 挂入的节点（一般传 scene） */
  constructor(parent: THREE.Object3D) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.bright = new Float32Array(MAX);
    // 空位全部藏到台下
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -99;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.02,
        vertexColors: true, // 逐粒子颜色（寿命渐变）
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending, // 加色叠加：黑 = 消失
        depthWrite: false,
      }),
    );
    this.points.name = 'fire_breath';
    this.points.frustumCulled = false; // 粒子四处飘，不做视锥剔除
    this.points.layers.set(1); // 与影人同层：火点也投上幕
    parent.add(this.points);
  }

  /**
   * 从喷口世界坐标向 dirX 方向喷出一撮火（每帧调用 = 持续喷）。
   * @param origin 喷口（嘴部）世界坐标
   * @param dirX   水平方向：±1（世界系；facing 1 = 世界 -x，由调用方换算）
   */
  emit(origin: THREE.Vector3, dirX: number): void {
    for (let n = 0; n < EMIT_N; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      this.pos[i * 3] = origin.x + (Math.random() - 0.5) * 0.012;
      this.pos[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.012;
      this.pos[i * 3 + 2] = origin.z;
      // 主喷向 + 轻微上抬 + 微小侧散（扇形火舌）
      this.vel[i * 3] = dirX * (0.5 + Math.random() * 0.55);
      this.vel[i * 3 + 1] = 0.1 + Math.random() * 0.2;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
      this.maxLife[i] = 0.5 + Math.random() * 0.25;
      this.life[i] = this.maxLife[i];
      this.bright[i] = 0.8 + Math.random() * 0.3;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -99; // 空位藏起来（颜色保持黑）
        continue;
      }
      this.life[i] -= dt;
      // 上升飘散：水平阻尼让火舌减速，同时向上加速
      this.vel[i * 3] *= Math.max(0, 1 - DRAG * dt);
      this.vel[i * 3 + 1] += RISE * dt;
      this.vel[i * 3 + 2] *= Math.max(0, 1 - DRAG * dt);
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      // 寿命渐变 × 亮度抖动
      const [r, g, b] = fireGradient(this.life[i] / this.maxLife[i]);
      const br = this.bright[i];
      this.col[i * 3] = r * br;
      this.col[i * 3 + 1] = g * br;
      this.col[i * 3 + 2] = b * br;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}
