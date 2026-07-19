// 幕后模式（b 键）：机位 ~1s 平滑绕到幕侧后 45°，左键拖拽绕台心球坐标环绕、滚轮缩放，
// 直观展示皮影工作原理——灯·点光源 / 幕布·亮子 / 3D 铰链皮偶 / 颈+双手三根操纵杆（真皮影同制）。
// 幕后时幕布 shader 背面输出暗色素背衬（projection.ts 的 gl_FrontFacing 分支），
// 投影照常渲染（projection.update 与主相机无关）、手势表演不中断；再按 b 平滑回前台机位。
// 操纵杆只挂 layer 0（主相机可见），不进 layer 1——否则杆会作为影人投进幕布。

import * as THREE from 'three';
import { LAMP_POS, SCREEN_CY } from '../stage/theater';
import type { Puppet } from '../puppet/assembly';

const TRANSITION_S = 1.0; // 机位过渡时长（秒）
const ORBIT_TARGET = new THREE.Vector3(0, SCREEN_CY, 0.2); // 环绕台心（幕心略偏幕后）
const FRONT_POS = new THREE.Vector3(0, SCREEN_CY, -2.3); // 前台观众机位（同 main.ts）
const FRONT_LOOK = new THREE.Vector3(0, SCREEN_CY, 0);
const R_MIN = 0.8; // 环绕最近距离（米）
const R_MAX = 6; // 环绕最远距离（米）
const DEF_THETA = Math.PI / 4; // 默认方位：侧后 45°（0=正后方 +z，向 +x 侧转）
const DEF_PHI = 1.3; // 默认俯仰（自 +y 轴，≈74°：略高于台面平视）
const DEF_R = 2.6; // 默认距离（米）
const ROD_COLOR = 0x8b5a2b; // 操纵杆赭石色
const UP = new THREE.Vector3(0, 1, 0);

/**
 * 球坐标机位：theta 自 +z 轴向 +x 旋转（0=幕正后方），phi 自 +y 轴（0=正上方），
 * r 为到 target 的距离。结果写入 out 并返回。
 */
export function orbitPos(
  theta: number,
  phi: number,
  r: number,
  target: THREE.Vector3,
  out: THREE.Vector3,
): THREE.Vector3 {
  const sp = Math.sin(phi);
  return out.set(
    target.x + r * sp * Math.sin(theta),
    target.y + r * Math.cos(phi),
    target.z + r * sp * Math.cos(theta),
  );
}

/**
 * 操纵杆对齐：返回杆长；mid = 两端中点，quat 把 +y 轴旋到 a→b 方向
 * （CylinderGeometry 高默认沿 +y，配合 scale.y = 杆长即对齐两端）。
 */
export function solveRod(
  a: THREE.Vector3,
  b: THREE.Vector3,
  mid: THREE.Vector3,
  quat: THREE.Quaternion,
): number {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(dir.length(), 1e-4);
  mid.addVectors(a, b).multiplyScalar(0.5);
  quat.setFromUnitVectors(UP, dir.divideScalar(len));
  return len;
}

// 三杆制（真皮影同制）：主杆（领签）接颈后、手签接双手。
// 真实持法（调研：操纵口诀「签子掌得平」）：杆近水平、垂直幕布指向幕后的操偶师傅，
// 手与关节基本同高、略低几厘米——不是从台底斜向上够。
const ROD_DEFS: ReadonlyArray<{ joint: string; off: readonly [number, number, number] }> = [
  { joint: 'head', off: [0, -0.05, 0.32] }, // 主杆（领签）：颈后水平向后
  { joint: 'hand_f', off: [0.04, -0.06, 0.3] }, // 手签：前手水平向后
  { joint: 'hand_b', off: [-0.04, -0.06, 0.3] }, // 手签：后手水平向后
];

// 兽形影人（虎）：身 1 杆 + 头 1 杆（皮影兽形同理：主杆在背/颈，头杆控首）
const TIGER_ROD_DEFS: ReadonlyArray<{ joint: string; off: readonly [number, number, number] }> = [
  { joint: 'tiger_body', off: [0, -0.05, 0.32] },
  { joint: 'tiger_head', off: [0, -0.04, 0.3] },
];

/** 有铰链关节世界坐标的角色（Puppet / Tiger） */
interface JointSource {
  group: THREE.Group;
  getJointWorld(name: string, out: THREE.Vector3): boolean;
}

/** 一套影人的操纵杆（细杆 + 顶端小球），每帧从手位（关节+偏移）连到关节世界坐标 */
class PuppetRods {
  readonly group = new THREE.Group();
  /** 首杆中点（「操纵杆」标注的锚点） */
  readonly neckMid = new THREE.Vector3();

  private actor: JointSource;
  private rods: { mesh: THREE.Mesh; ball: THREE.Mesh; joint: string; off: THREE.Vector3 }[] = [];
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpM = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();

  constructor(actor: JointSource, defs = ROD_DEFS) {
    this.actor = actor;
    const mat = new THREE.MeshStandardMaterial({ color: ROD_COLOR, roughness: 0.75 });
    for (const def of defs) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 6), mat);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 10), mat);
      this.group.add(mesh, ball);
      this.rods.push({ mesh, ball, joint: def.joint, off: new THREE.Vector3(...def.off) });
    }
  }

  update(): void {
    // 手位 = 关节世界坐标 + 各自偏移（近水平向后指向幕后），杆随关节动——签子掌得平
    for (const rod of this.rods) {
      if (!this.actor.getJointWorld(rod.joint, this.tmpB)) continue;
      const a = this.tmpA.set(
        this.tmpB.x + rod.off.x,
        this.tmpB.y + rod.off.y,
        this.tmpB.z + rod.off.z,
      );
      const len = solveRod(a, this.tmpB, this.tmpM, this.tmpQ);
      rod.mesh.position.copy(this.tmpM);
      rod.mesh.quaternion.copy(this.tmpQ);
      rod.mesh.scale.set(1, len, 1);
      rod.ball.position.copy(this.tmpB);
      if (rod === this.rods[0]) this.neckMid.copy(this.tmpM);
    }
  }
}

export interface BackstageOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  dom: HTMLElement; // 渲染画布（拖拽/滚轮监听挂在它上面）
  /** 人形影人（主角 + 西游红孩儿）：三杆制（颈 + 双手） */
  puppets: Puppet[];
  /** 老虎（水浒）：兽形两杆制（身 + 头）；无老虎场景省略 */
  tiger?: { group: THREE.Group; getJointWorld(name: string, out: THREE.Vector3): boolean };
  /** 返回 true 时 b 键让位（tuner 拖点标定中） */
  blocked?: () => boolean;
}

type Phase = 'front' | 'enter' | 'back' | 'exit';

export class Backstage {
  private camera: THREE.PerspectiveCamera;
  private blocked?: () => boolean;
  private phase: Phase = 'front';
  private k = 0; // 过渡进度 0~1
  private theta = DEF_THETA;
  private phi = DEF_PHI;
  private radius = DEF_R;

  private fromPos = new THREE.Vector3();
  private fromLook = new THREE.Vector3();
  private look = new THREE.Vector3();
  private orbitPosV = new THREE.Vector3();

  private rods: PuppetRods[] = [];
  private rodsGroup = new THREE.Group();
  private labels: { el: HTMLDivElement; anchor: (out: THREE.Vector3) => void }[] = [];
  private bar: HTMLDivElement;
  private tmpP = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(opts: BackstageOptions) {
    this.camera = opts.camera;
    this.blocked = opts.blocked;

    // 操纵杆：人形三杆制、老虎两杆制（身+头），只挂 layer 0（不进投影）
    for (const p of opts.puppets) {
      const r = new PuppetRods(p);
      this.rods.push(r);
      this.rodsGroup.add(r.group);
    }
    if (opts.tiger) {
      const r = new PuppetRods(opts.tiger, TIGER_ROD_DEFS);
      this.rods.push(r);
      this.rodsGroup.add(r.group);
    }
    this.rodsGroup.visible = false;
    opts.scene.add(this.rodsGroup);

    // 原理标注（HTML，每帧把世界坐标 project 到屏幕摆 div）
    const hero = opts.puppets[0];
    const heroRods = this.rods[0];
    const defs: { text: string; anchor: (out: THREE.Vector3) => void }[] = [
      { text: '灯 · 点光源', anchor: (out) => out.copy(LAMP_POS) },
      { text: '幕布 · 亮子', anchor: (out) => out.set(0, SCREEN_CY, 0) },
      {
        text: '影人 · 3D 铰链皮偶（2mm 厚）',
        anchor: (out) => {
          if (!hero.getJointWorld('head', out)) out.copy(hero.group.position);
        },
      },
      {
        text: '操纵杆 · 颈 + 双手（真皮影也是这三根）',
        anchor: (out) => out.copy(heroRods.neckMid),
      },
    ];
    for (const d of defs) {
      const el = document.createElement('div');
      el.textContent = d.text;
      el.style.cssText =
        'position:fixed;display:none;z-index:12;pointer-events:none;white-space:nowrap;' +
        'transform:translate(-50%,calc(-100% - 24px));' +
        'padding:3px 9px;background:rgba(10,8,6,0.85);border:1px solid #c8a05a88;border-radius:3px;' +
        'color:#f5e8d0;font:12px/1.4 "Songti SC","Noto Serif SC",serif';
      // 引线 + 锚点圆点（两个子元素，圆点正好落在标注对象上）
      const line = document.createElement('i');
      line.style.cssText =
        'position:absolute;left:50%;top:100%;width:1px;height:18px;background:#c8a05aaa;display:block';
      const dot = document.createElement('i');
      dot.style.cssText =
        'position:absolute;left:50%;top:calc(100% + 18px);width:6px;height:6px;margin:-3px 0 0 -3px;' +
        'border-radius:50%;background:#c8a05a;display:block';
      el.appendChild(line);
      el.appendChild(dot);
      document.body.appendChild(el);
      this.labels.push({ el, anchor: d.anchor });
    }

    // 底部投影原理解说条
    this.bar = document.createElement('div');
    this.bar.innerHTML =
      '光沿直线传播 → 皮偶挡住光 → 幕布上留下彩色透光影；近灯影大而虚，贴幕影小而锐<br>' +
      '<span style="opacity:.65">左键拖拽环绕 · 滚轮缩放 · 按 b 回前台</span>';
    this.bar.style.cssText =
      'position:fixed;display:none;bottom:18px;left:50%;transform:translateX(-50%);z-index:12;' +
      'pointer-events:none;text-align:center;padding:8px 18px;max-width:86%;' +
      'background:rgba(10,8,6,0.85);border:1px solid #c8a05a55;border-radius:4px;' +
      'color:#e8d9b8;font:12px/1.8 "Songti SC","Noto Serif SC",serif';
    document.body.appendChild(this.bar);

    addEventListener('keydown', (e) => {
      if (e.key !== 'b' || this.blocked?.()) return;
      this.toggle();
    });
    opts.dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.phase !== 'back') return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      // 左键拖拽 = 绕台心球坐标环绕
      this.theta -= (e.clientX - this.lastX) * 0.005;
      this.phi = THREE.MathUtils.clamp(this.phi - (e.clientY - this.lastY) * 0.005, 0.2, 2.8);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    addEventListener('pointerup', () => {
      this.dragging = false;
    });
    opts.dom.addEventListener(
      'wheel',
      (e) => {
        if (this.phase !== 'back') return;
        e.preventDefault();
        this.radius = THREE.MathUtils.clamp(this.radius * (1 + e.deltaY * 0.001), R_MIN, R_MAX);
      },
      { passive: false },
    );
  }

  /** 幕后中（含进出过渡） */
  get active(): boolean {
    return this.phase !== 'front';
  }

  private toggle(): void {
    if (this.phase === 'front') {
      this.phase = 'enter';
      this.k = 0;
      this.fromPos.copy(this.camera.position);
      // 当前视线前方 1m 处作为 lookAt 插值起点
      this.fromLook.copy(this.camera.getWorldDirection(this.tmpDir)).add(this.camera.position);
    } else if (this.phase === 'back') {
      this.phase = 'exit';
      this.k = 0;
      this.fromPos.copy(this.camera.position);
      this.fromLook.copy(ORBIT_TARGET);
      this.setUiVisible(false);
    }
  }

  private setUiVisible(v: boolean): void {
    this.rodsGroup.visible = v;
    this.bar.style.display = v ? 'block' : 'none';
    if (!v) for (const l of this.labels) l.el.style.display = 'none';
  }

  /** 每帧驱动机位过渡/环绕、操纵杆与标注（仅幕后态有实际效果） */
  update(dt: number): void {
    if (this.phase === 'front') return;

    if (this.phase === 'enter' || this.phase === 'exit') {
      this.k = Math.min(1, this.k + dt / TRANSITION_S);
      const e = this.k * this.k * (3 - 2 * this.k); // smoothstep 缓动
      orbitPos(this.theta, this.phi, this.radius, ORBIT_TARGET, this.orbitPosV);
      const destPos = this.phase === 'enter' ? this.orbitPosV : FRONT_POS;
      const destLook = this.phase === 'enter' ? ORBIT_TARGET : FRONT_LOOK;
      this.camera.position.lerpVectors(this.fromPos, destPos, e);
      this.look.lerpVectors(this.fromLook, destLook, e);
      this.camera.lookAt(this.look);
      if (this.k >= 1) {
        if (this.phase === 'enter') {
          this.phase = 'back';
          this.setUiVisible(true);
        } else {
          this.phase = 'front';
          this.camera.position.copy(FRONT_POS);
          this.camera.lookAt(FRONT_LOOK);
        }
      }
      return;
    }

    // 幕后态：机位 = 当前球坐标；杆与标注逐帧跟随
    orbitPos(this.theta, this.phi, this.radius, ORBIT_TARGET, this.camera.position);
    this.camera.lookAt(ORBIT_TARGET);
    for (const r of this.rods) r.update();
    this.updateLabels();
  }

  /** 标注摆屏：世界坐标 project 到屏幕像素；在相机背后/视锥外则隐藏 */
  private updateLabels(): void {
    this.camera.getWorldDirection(this.tmpDir);
    for (const l of this.labels) {
      l.anchor(this.tmpP);
      this.orbitPosV.subVectors(this.tmpP, this.camera.position);
      if (this.tmpDir.dot(this.orbitPosV) <= 0.02) {
        l.el.style.display = 'none';
        continue;
      }
      this.orbitPosV.copy(this.tmpP).project(this.camera);
      if (this.orbitPosV.z > 1) {
        l.el.style.display = 'none';
        continue;
      }
      l.el.style.display = 'block';
      l.el.style.left = `${(this.orbitPosV.x * 0.5 + 0.5) * innerWidth}px`;
      l.el.style.top = `${(-this.orbitPosV.y * 0.5 + 0.5) * innerHeight}px`;
    }
  }
}
