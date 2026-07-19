// 虎形影人（M4）：7 件四足铰链（tiger_body 为根：头/尾/四腿），装配算法与
// assembly.ts 相同（铆点对齐 + layer 微偏移 + 转身翻 z 符号，文档 4.1/4.2），
// 但老虎不是人形（无手臂 IK / 摆锤腿），按参考实现的组织方式独立成类。
// 行为：AI 状态机（prowl 对峙徘徊 → pounce 扑击 / roar 咆哮 → 循环；受击 flinch；
// hp 归零 dead 扑地伏诛），也可被第二只手接管——消费导演输出的 SecondRoleIntent：
// moveX=走位、fist=扑击、open=咆哮；第二只手离镜（active=false）时 AI 自动接管。

import * as THREE from 'three';
import type { PartGeom, PivotsFile } from './assembly';
import { cookAlphaTexture } from './assembly';
import type { SecondRoleIntent } from '../hand/director';

const THICK = 0.002; // 皮片厚度 2mm（与 assembly 一致）
const LAYER_STEP = 0.0007; // 每层 z 微偏移
const TRANSMISSION = 0.72; // 皮革透光率

const BASE_Y = 0.85; // 虎躯干铆点离地高（台面地面 ≈ 幕布下缘 0.5）
const Z_FIXED = 0.12; // 固定进深（贴幕附近，影锐）
const MAX_HP = 10;
const STAGE_X = 0.7; // 台面半宽（与导演 STAGE_HALF_W 一致）

export type TigerState = 'prowl' | 'pounce' | 'roar' | 'flinch' | 'dead';

export class Tiger {
  /** 整棵铰链树的根（已整体放 layer 1） */
  readonly group = new THREE.Group();
  /** 全部皮革材质：投影 pass 交给 transmissionGuard（坑③） */
  readonly leather: THREE.MeshPhysicalMaterial[] = [];

  state: TigerState = 'prowl';
  hp = MAX_HP;
  /** HP 上限（战斗状态行显示用） */
  readonly maxHp = MAX_HP;
  /** 状态刚切换时置 true 一帧，供 main 触发吼声 */
  justPounced = false;
  justRoared = false;

  private joints = new Map<string, THREE.Group>();
  private partMeshes: { mesh: THREE.Mesh; layer: number }[] = [];
  private x = 0.55; // 台面位置（初始场右侧）
  private facing: 1 | -1 = -1; // -1 = 面向观众左（画稿朝左，朝武松扑）
  private phase = 0;
  private stateT = 0;
  private pounceCooldown = 2;

  /** 第二只手控制意图；null = AI 接管 */
  private ctrl: SecondRoleIntent | null = null;
  private prevCtrlGesture: SecondRoleIntent['gesture'] = 'none';

  constructor(
    defs: PivotsFile,
    parts: Record<string, PartGeom>,
    textures: Record<string, { dye: THREE.Texture; alpha: THREE.Texture }>,
  ) {
    this.group.name = 'tiger';

    // 1) 建件：网格平移使 pivotInSelf 对齐关节组原点（同 assembly 装配算法）
    for (const [name, def] of Object.entries(defs)) {
      const joint = new THREE.Group();
      joint.name = `joint_${name}`;
      joint.rotation.z = def.rest ?? 0;

      const artKey = def.art ?? name;
      const geom = parts[artKey];
      const tex = textures[artKey];
      if (!geom || !tex) throw new Error(`老虎部件资产缺失：${artKey}（${name} 引用）`);
      const mesh = this.buildPart(name, def, geom, tex);

      const s = def.height;
      mesh.position.set(
        (def.flipX ? 1 : -1) * def.pivotInSelf[0] * s,
        -(1 - def.pivotInSelf[1]) * s,
        def.layer * LAYER_STEP,
      );
      joint.add(mesh);
      this.joints.set(name, joint);
      this.partMeshes.push({ mesh, layer: def.layer });
    }

    // 2) 组树：关节组位置 = (pivotInParent − parentPivotInSelf) × parentHeight
    for (const [name, def] of Object.entries(defs)) {
      const joint = this.joints.get(name)!;
      if (!def.parent) {
        this.group.add(joint);
        continue;
      }
      const parentDef = defs[def.parent];
      joint.position.set(
        (def.pivotInParent[0] - parentDef.pivotInSelf[0]) * parentDef.height,
        (parentDef.pivotInSelf[1] - def.pivotInParent[1]) * parentDef.height,
        0,
      );
      this.joints.get(def.parent)!.add(joint);
    }

    // 影人专用层：主相机与灯位相机都看 layer 1
    this.group.traverse((o) => o.layers.set(1));
    this.group.position.set(this.x, BASE_Y, Z_FIXED);
  }

  /** 加载老虎资产（7 件 + geometry/pivots），贴图带 ?v= 防浏览器缓存 */
  static async load(base = '/assets/puppets/tiger'): Promise<Tiger> {
    const v = `?v=${Date.now()}`;
    const [geoRes, pivRes] = await Promise.all([fetch(`${base}/geometry.json`), fetch(`${base}/pivots.json`)]);
    if (!geoRes.ok || !pivRes.ok) {
      throw new Error(`老虎资产加载失败（geometry ${geoRes.status} / pivots ${pivRes.status}）`);
    }
    const geo = (await geoRes.json()) as { parts: Record<string, PartGeom> };
    const pivots = (await pivRes.json()) as PivotsFile;

    const loader = new THREE.TextureLoader();
    const textures: Record<string, { dye: THREE.Texture; alpha: THREE.Texture }> = {};
    await Promise.all(
      Object.keys(pivots).map(async (name) => {
        const [dye, alpha] = await Promise.all([
          loader.loadAsync(`${base}/${name}_dye.png${v}`),
          loader.loadAsync(`${base}/${name}_alpha.png${v}`),
        ]);
        dye.colorSpace = THREE.SRGBColorSpace;
        textures[name] = { dye, alpha: cookAlphaTexture(alpha, pivots[name]) };
      }),
    );
    return new Tiger(pivots, geo.parts, textures);
  }

  // ---------- 公共 API ----------

  /** 台面位置（命中判定用） */
  get position(): number {
    return this.x;
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  /** object 别名（与场景图交互用） */
  get object(): THREE.Group {
    return this.group;
  }

  /** 关节世界坐标（幕后模式操纵杆端点用）；关节不存在返回 false */
  getJointWorld(name: string, out: THREE.Vector3): boolean {
    const j = this.joints.get(name);
    if (!j) return false;
    j.getWorldPosition(out);
    return true;
  }

  /**
   * 第二只手接管：传导演的 SecondRoleIntent（active=false 等价 null 回 AI）。
   * 走位=moveX、握拳=扑击、张开=咆哮（边沿触发，对峙状态才响应）。
   */
  setControl(intent: SecondRoleIntent | null): void {
    this.ctrl = intent && intent.active ? intent : null;
  }

  /** 被击中：掉血 + 后仰硬直；hp 归零 → 扑地伏诛 */
  hit(): void {
    if (this.state === 'dead') return;
    this.hp -= 1;
    this.state = this.hp <= 0 ? 'dead' : 'flinch';
    this.stateT = 0;
  }

  /** 复活重开：满血回场边，姿态复位 */
  revive(): void {
    this.hp = MAX_HP;
    this.state = 'prowl';
    this.stateT = 0;
    this.x = 0.55;
    this.pounceCooldown = 2;
    this.group.rotation.z = 0;
    this.joints.forEach((j) => {
      j.rotation.z = 0;
    });
  }

  /** 每帧更新：AI/玩家控制 + 四足循环动画。heroX = 主角台面位置 */
  update(dt: number, t: number, heroX: number): void {
    this.justPounced = false;
    this.justRoared = false;
    this.stateT += dt;
    const dx = heroX - this.x;
    this.facing = dx < 0 ? -1 : 1;

    // 玩家手势触发（边沿判定，仅对峙状态响应；非对峙时持续刷新防陈旧边沿）
    if (this.ctrl && this.state === 'prowl') {
      const g = this.ctrl.gesture;
      if (g !== this.prevCtrlGesture) {
        if (g === 'fist') {
          this.state = 'pounce';
          this.stateT = 0;
          this.justPounced = true;
        } else if (g === 'open') {
          this.state = 'roar';
          this.stateT = 0;
          this.justRoared = true;
        }
      }
      this.prevCtrlGesture = g;
    } else if (this.ctrl) {
      this.prevCtrlGesture = this.ctrl.gesture;
    }

    const rot = (n: string, v: number) => {
      const jj = this.joints.get(n);
      if (jj) jj.rotation.z = v;
    };
    let bob = 0;
    let bodyRot = 0;

    switch (this.state) {
      case 'prowl': {
        // 玩家控制：走位跟随手掌（镜像映射，同主角）；AI：逼近武松保持对峙距离
        let speed: number;
        if (this.ctrl) {
          const targetX = THREE.MathUtils.clamp(-this.ctrl.moveX * STAGE_X, -STAGE_X, STAGE_X);
          const ddx = targetX - this.x;
          speed = Math.min(0.5, Math.abs(ddx) * 2.5);
          this.x += Math.sign(ddx) * speed * dt;
        } else {
          const dist = Math.abs(dx);
          speed = dist > 0.78 ? 0.16 : 0; // 虎身长约 0.7m，按体缘保持对峙距离
          this.x += Math.sign(dx) * speed * dt;
        }
        this.phase += (speed > 0.02 ? 5.5 : 1.2) * dt;
        const s = Math.sin(this.phase);
        bob = Math.abs(s) * 0.008;
        rot('tiger_leg_nf', 0.28 * s);
        rot('tiger_leg_fh', 0.26 * s);
        rot('tiger_leg_ff', -0.26 * s);
        rot('tiger_leg_nh', -0.24 * s);
        rot('tiger_tail', 0.25 * Math.sin(t * 2.2));
        rot('tiger_head', 0.05 * Math.sin(t * 1.8));
        // AI 伺机扑击（玩家控制时不自动扑）
        this.pounceCooldown -= dt;
        if (!this.ctrl && Math.abs(dx) < 0.95 && this.pounceCooldown <= 0) {
          this.state = 'pounce';
          this.stateT = 0;
          this.justPounced = true;
          this.pounceCooldown = 2.6 + Math.sin(t * 7.3) * 0.8; // 伪随机
        }
        break;
      }
      case 'roar': {
        // 咆哮立威：后腿撑起、前爪扬起、仰天吼
        const p = Math.min(1, this.stateT / 0.9);
        const e = Math.sin(Math.PI * Math.min(1, p * 1.15));
        bodyRot = 0.4 * e;
        bob = 0.05 * e;
        rot('tiger_head', 0.45 * e);
        rot('tiger_leg_nf', -0.7 * e);
        rot('tiger_leg_ff', -0.55 * e);
        rot('tiger_tail', 0.4 * e);
        if (p >= 1) {
          this.state = 'prowl';
          this.stateT = 0;
        }
        break;
      }
      case 'pounce': {
        // 0.2s 伏身蓄力 + 0.5s 腾空扑向武松
        const T = 0.7;
        const p = Math.min(1, this.stateT / T);
        if (p < 0.28) {
          bob = -0.02 * (p / 0.28);
          bodyRot = 0.1 * (p / 0.28);
        } else {
          const q = (p - 0.28) / 0.72;
          const fs = this.facing === -1 ? 1 : -1; // 画稿朝左：腿部摆角随面向镜像
          bob = 0.16 * Math.sin(Math.PI * q);
          this.x += Math.sign(dx) * (0.55 * dt) / 0.72;
          bodyRot = -0.18 * Math.sin(Math.PI * q);
          rot('tiger_leg_nf', -0.55 * Math.sin(Math.PI * q) * fs);
          rot('tiger_leg_ff', -0.45 * Math.sin(Math.PI * q) * fs);
          rot('tiger_leg_nh', 0.5 * Math.sin(Math.PI * q) * fs);
          rot('tiger_leg_fh', 0.45 * Math.sin(Math.PI * q) * fs);
          rot('tiger_head', -0.15 * Math.sin(Math.PI * q));
        }
        if (p >= 1) {
          this.state = 'prowl';
          this.stateT = 0;
        }
        break;
      }
      case 'flinch': {
        // 受击：后仰 + 后退
        const p = Math.min(1, this.stateT / 0.45);
        const e = Math.sin(Math.PI * p);
        bodyRot = 0.3 * e;
        this.x -= Math.sign(dx) * ((0.25 * e * dt) / 0.45);
        rot('tiger_head', 0.35 * e);
        rot('tiger_leg_nf', -0.4 * e);
        if (p >= 1) {
          this.state = 'prowl';
          this.stateT = 0;
          this.pounceCooldown = Math.max(this.pounceCooldown, 1.2);
        }
        break;
      }
      case 'dead': {
        // 扑地伏诛：前倾栽倒 + 伏低 + 四肢摊开
        const p = Math.min(1, this.stateT / 1.1);
        const ease = 1 - (1 - p) * (1 - p);
        bodyRot = -0.5 * ease;
        bob = -0.16 * ease;
        rot('tiger_head', -0.5 * ease);
        rot('tiger_leg_nf', 0.55 * ease);
        rot('tiger_leg_nh', -0.5 * ease);
        rot('tiger_tail', 0.35 * (1 - ease) + 0.05);
        break;
      }
    }

    this.group.position.set(this.x, BASE_Y + bob, Z_FIXED);
    // 画稿朝左：facing -1 = 原方向；翻面绕 y 转 180°，z 偏移符号同步取反（文档 4.2.1）
    const targetRotY = this.facing === -1 ? 0 : Math.PI;
    this.group.rotation.y += (targetRotY - this.group.rotation.y) * Math.min(1, dt * 8);
    this.group.rotation.z = bodyRot * (this.facing === -1 ? 1 : -1);
    const zSign = this.group.rotation.y > Math.PI / 2 ? -1 : 1;
    for (const p of this.partMeshes) p.mesh.position.z = p.layer * LAYER_STEP * zSign;
  }

  // ---------- 内部实现 ----------

  /** 建单件：outline → Shape → 2mm 挤出 → 皮革透光材质（同 assembly.buildPart） */
  private buildPart(
    name: string,
    def: { height: number; flipX?: boolean },
    geom: PartGeom,
    tex: { dye: THREE.Texture; alpha: THREE.Texture },
  ): THREE.Mesh {
    // 图 y 向下 → three y 向上；此时 shape 坐标恰与贴图 uv 一致
    const shape = new THREE.Shape();
    geom.outline.forEach(([x, y], i) => {
      if (i === 0) shape.moveTo(x, 1 - y);
      else shape.lineTo(x, 1 - y);
    });
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: THICK / def.height, bevelEnabled: false });
    const mat = new THREE.MeshPhysicalMaterial({
      map: tex.dye,
      alphaMap: tex.alpha,
      alphaTest: 0.5,
      transmission: TRANSMISSION,
      thickness: THICK,
      roughness: 0.65,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `part_${name}`;
    mesh.scale.setScalar(def.height);
    if (def.flipX) mesh.scale.x = -def.height;
    this.leather.push(mat);
    return mesh;
  }
}
