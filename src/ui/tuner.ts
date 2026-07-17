// 拖点标定工具（按 t 开关，文档第 8 章「本项目最有价值的方法论」）：
// 只有人眼能定的位置/比例，不靠解析推导——把标记拖到正确位置，数值实时生效。
// 开启后画面定格成标定摆位（main 负责：西游=悟空持棒定势 + 红孩儿持续喷火；
// 水浒=主角持哨棒定势；手势与战斗逻辑暂停——静止画面才好拖），屏幕叠加可拖标记点：
//   🔥 嘴部火源（相对头关节的偏移，x 符号随面向自适应）
//   ✊ 后手握棒点（屏幕点投到棒线，取沿棒投影距离）
//   👤 头部位置（拖头件调脖颈插领深度 = 头关节偏移）
//   💪 臂长缩放（拖手：肩手距离 ÷ 静置臂展）
//   🦵 腿长缩放（拖脚：髋脚距离 ÷ 静置腿长；root 自动上移补偿贴地）
// 拖动 = 相机反投影：屏幕点投到部件所在 z 平面得世界坐标，再换算成参数。
// 数值写 calibValues 单例 → main 每帧读（正常运行也生效）→ 松手存 localStorage；
// 面板显示当前数值（用户报数给开发者，固化为代码默认值）；r 键 / 面板「重置」恢复默认。
// 与 ?debug=calib（姿势标定）不冲突：那是独立调试入口；本工具在正常运行时按 t 切换。

import * as THREE from 'three';
import { loadCalib, resetCalib, saveCalib, type CalibValues } from './calibValues';

/** Tuner 与世界的接线（main 提供回调，两场景差异由 main 吸收） */
export interface TunerCtx {
  camera: THREE.PerspectiveCamera;
  /** 🔥 是否显示嘴部火源点（西游有喷火角色才有意义；水浒隐藏） */
  showMouth: boolean;
  /** 🔥 喷火角色头关节（颈部铆点）世界坐标；返回面向 ±1 */
  headWorld: (out: THREE.Vector3) => 1 | -1;
  /** ✊ 棒线（世界系：origin=前手关节，dir=棒杆向下单位向量）；棒不可见返回 false */
  staffLine: (origin: THREE.Vector3, dir: THREE.Vector3) => boolean;
  /** 👤 头关节世界坐标（拖点跟随）；关节缺失返回 false */
  headDot: (out: THREE.Vector3) => boolean;
  /** 👤 拖动落点（世界系）→ 换算头偏移写参数 */
  dragHead: (w: THREE.Vector3) => void;
  /** 💪 前手端点世界坐标；关节缺失返回 false */
  armTip: (out: THREE.Vector3) => boolean;
  /** 💪 拖动落点（世界系）→ 换算臂长缩放写参数 */
  dragArm: (w: THREE.Vector3) => void;
  /** 🦵 前脚端点世界坐标；关节缺失返回 false */
  legTip: (out: THREE.Vector3) => boolean;
  /** 🦵 拖动落点（世界系）→ 换算腿长缩放写参数 */
  dragLeg: (w: THREE.Vector3) => void;
}

type DotKind = 'mouth' | 'grip' | 'head' | 'arm' | 'leg';

interface Dot {
  el: HTMLDivElement;
  kind: DotKind;
}

export class Tuner {
  /** 标定模式是否开启（main 每帧读：true = 走定格摆位分支） */
  visible = false;

  /** 与 main 共享的标定单例：拖动改写即全场生效 */
  private readonly values: CalibValues = loadCalib();
  private dots: Dot[] = [];
  private dotByKind = new Map<DotKind, Dot>();
  private panel: HTMLDivElement;
  private panelText: HTMLPreElement;
  private dragging: Dot | null = null;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private ctx: TunerCtx;

  constructor(ctx: TunerCtx) {
    this.ctx = ctx;
    // ---- 数值面板（右上）：实时数值 + 操作提示 + 重置按钮 ----
    this.panel = document.createElement('div');
    Object.assign(this.panel.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      width: '310px',
      padding: '10px 12px',
      background: 'rgba(10,8,6,0.88)',
      border: '1px solid #c8a05a',
      borderRadius: '4px',
      color: '#d9c39a',
      zIndex: '30',
      display: 'none',
    } as Partial<CSSStyleDeclaration>);
    this.panelText = document.createElement('pre');
    Object.assign(this.panelText.style, {
      margin: '0 0 8px',
      font: '12px/1.6 monospace',
      whiteSpace: 'pre-wrap',
    } as Partial<CSSStyleDeclaration>);
    const resetBtn = document.createElement('button');
    resetBtn.textContent = '重置默认（r）';
    Object.assign(resetBtn.style, {
      background: 'none',
      border: '1px solid #c8a05a66',
      borderRadius: '3px',
      color: '#d9c39a',
      font: '12px monospace',
      padding: '3px 10px',
      cursor: 'pointer',
    } as Partial<CSSStyleDeclaration>);
    resetBtn.addEventListener('click', () => this.reset());
    this.panel.appendChild(this.panelText);
    this.panel.appendChild(resetBtn);
    document.body.appendChild(this.panel);

    // ---- 拖点（HTML 绝对定位圆点 + 标签）----
    const mk = (kind: DotKind, label: string, color: string) => {
      const el = document.createElement('div');
      el.textContent = label;
      Object.assign(el.style, {
        position: 'fixed',
        width: '26px',
        height: '26px',
        marginLeft: '-13px',
        marginTop: '-13px',
        borderRadius: '50%',
        background: color,
        border: '2px solid #fff8',
        display: 'none',
        zIndex: '31',
        cursor: 'grab',
        textAlign: 'center',
        lineHeight: '22px',
        fontSize: '13px',
        userSelect: 'none',
        touchAction: 'none',
      } as Partial<CSSStyleDeclaration>);
      document.body.appendChild(el);
      const dot: Dot = { el, kind };
      el.addEventListener('pointerdown', (e) => {
        this.dragging = dot;
        el.setPointerCapture(e.pointerId);
        e.stopPropagation();
        e.preventDefault();
      });
      el.addEventListener('pointermove', (e) => {
        if (this.dragging === dot) this.onDrag(e);
      });
      el.addEventListener('pointerup', () => {
        this.dragging = null;
        saveCalib(this.values); // 松手持久化（拖动中已实时生效）
      });
      this.dots.push(dot);
      this.dotByKind.set(kind, dot);
    };
    mk('mouth', '🔥', '#c0392bcc');
    mk('grip', '✊', '#b8860bcc');
    mk('head', '👤', '#2e86abcc');
    mk('arm', '💪', '#8e44adcc');
    mk('leg', '🦵', '#27ae60cc');

    addEventListener('keydown', (e) => {
      if (e.key === 't') this.toggle();
      else if (e.key === 'r' && this.visible) this.reset(); // 标定中 r = 恢复默认（不触发战斗重开）
    });
  }

  /** 开/关标定模式（main 读 visible 切定格分支；关闭时收净拖点与拖拽态） */
  private toggle(): void {
    this.visible = !this.visible;
    this.dragging = null;
    this.panel.style.display = this.visible ? 'block' : 'none';
    for (const d of this.dots) d.el.style.display = this.visible ? 'block' : 'none';
  }

  /** 恢复默认（r / 重置按钮）：原地改写单例，main 持有的引用即时生效 */
  private reset(): void {
    resetCalib();
  }

  /** 屏幕点 → 相机反投影到 z=zPlane 平面的世界点 */
  private unproject(e: PointerEvent, zPlane: number, out: THREE.Vector3): void {
    const ndc = new THREE.Vector3((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1, 0.5);
    ndc.unproject(this.ctx.camera);
    const dir = ndc.sub(this.ctx.camera.position).normalize();
    const s = (zPlane - this.ctx.camera.position.z) / dir.z;
    out.copy(this.ctx.camera.position).addScaledVector(dir, s);
  }

  /** 拖动中：反投影得世界点 → 按点类型换算成标定参数（写单例，即时生效） */
  private onDrag(e: PointerEvent): void {
    const d = this.dragging;
    if (!d) return;
    if (d.kind === 'mouth') {
      // 🔥 偏移 = (世界点 − 头关节)，x 除以面向的世界 x 符号（facing 1 = 世界 -x）
      const facing = this.ctx.headWorld(this.tmp2);
      this.unproject(e, this.tmp2.z, this.tmp);
      const dirX = facing === 1 ? -1 : 1;
      this.values.mouth = { x: (this.tmp.x - this.tmp2.x) / dirX, y: this.tmp.y - this.tmp2.y };
    } else if (d.kind === 'grip') {
      // ✊ 世界点投影到棒线：握距 = (点 − 前手)·棒向
      const o = new THREE.Vector3();
      const dir = new THREE.Vector3();
      if (!this.ctx.staffLine(o, dir)) return;
      this.unproject(e, o.z, this.tmp);
      this.values.grip = this.tmp.sub(o).dot(dir);
    } else {
      // 👤/💪/🦵：落点交给 main 的换算回调（头偏移 / 臂腿缩放比）
      const getter = d.kind === 'head' ? this.ctx.headDot : d.kind === 'arm' ? this.ctx.armTip : this.ctx.legTip;
      if (!getter(this.tmp2)) return;
      this.unproject(e, this.tmp2.z, this.tmp);
      if (d.kind === 'head') this.ctx.dragHead(this.tmp);
      else if (d.kind === 'arm') this.ctx.dragArm(this.tmp);
      else this.ctx.dragLeg(this.tmp);
    }
  }

  /** 每帧（定格分支内调用）：把参数对应的世界点投影回屏幕摆拖点 + 刷新数值面板 */
  update(): void {
    if (!this.visible) return;
    const proj = (p: THREE.Vector3, el: HTMLDivElement) => {
      const v = p.clone().project(this.ctx.camera);
      el.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
      el.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
    };
    const show = (kind: DotKind, on: boolean) => {
      const d = this.dotByKind.get(kind);
      if (d) d.el.style.display = on ? 'block' : 'none';
    };

    // 🔥 嘴部火源 = 头关节 + 面向偏移（西游才显示）
    if (this.ctx.showMouth) {
      const facing = this.ctx.headWorld(this.tmp2);
      const dirX = facing === 1 ? -1 : 1;
      this.tmp.set(
        this.tmp2.x + dirX * this.values.mouth.x,
        this.tmp2.y + this.values.mouth.y,
        this.tmp2.z,
      );
      proj(this.tmp, this.dotByKind.get('mouth')!.el);
      show('mouth', true);
    } else show('mouth', false);

    // ✊ 握棒点 = 前手 + 棒向 × 握距（棒不可见时藏点）
    const o = new THREE.Vector3();
    const sd = new THREE.Vector3();
    if (this.ctx.staffLine(o, sd)) {
      this.tmp.copy(o).addScaledVector(sd, this.values.grip);
      proj(this.tmp, this.dotByKind.get('grip')!.el);
      show('grip', true);
    } else show('grip', false);

    // 👤/💪/🦵 拖点跟随关节（💪=前手端点，🦵=脚底端点，由 main 换算）
    const followers: [DotKind, (out: THREE.Vector3) => boolean][] = [
      ['head', this.ctx.headDot],
      ['arm', this.ctx.armTip],
      ['leg', this.ctx.legTip],
    ];
    for (const [kind, getter] of followers) {
      if (getter(this.tmp)) {
        proj(this.tmp, this.dotByKind.get(kind)!.el);
        show(kind, true);
      } else show(kind, false);
    }

    // 数值面板（报数固化用）
    const v = this.values;
    this.panelText.textContent =
      `拖点标定（t 关闭 · r 重置 · 改完值请报给开发者固化）\n` +
      (this.ctx.showMouth ? `🔥 嘴部火源: x=${v.mouth.x.toFixed(3)} y=${v.mouth.y.toFixed(3)}\n` : '') +
      `✊ 握棒点(距前手): ${v.grip.toFixed(3)}m\n` +
      `👤 头部偏移: x=${v.headOff.x.toFixed(3)} y=${v.headOff.y.toFixed(3)}\n` +
      `💪 臂长: ×${v.armScale.toFixed(2)}　🦵 腿长: ×${v.legScale.toFixed(2)}\n` +
      `（👤拖头调脖颈 💪拖手调臂长 🦵拖脚调腿长）`;
  }
}
