// 影人铰链装配（M2）：geometry.json + pivots.json + 贴图三件套 → THREE.Group 铰链树。
// 无骨骼蒙皮：每件是 2mm 厚挤出片，挂在父件铆点上，只绕铆点单轴旋转（文档第 4 章）。
//
// 装配算法（文档 4.1）：
//  - 网格平移使 pivotInSelf 对齐关节组原点；
//  - 关节组位置 = (pivotInParent − parentPivotInSelf) × parentHeight（父/子两图上同一铆点的坐标差）；
//  - layer 决定 z 微偏移（layer × 0.0007），实现前后叠压。
// 绑定教训（文档 4.2）：
//  - 转身（绕 y 翻面）后 z 偏移符号取反：zSign = root.rotation.y > π/2 ? -1 : 1；
//  - art 借稿件（前手复用后手画稿）；flipX 镜像（前手不镜像、后手镜像调转虎口）。
// 姿势约定（文档 6.5）：预设姿势一律 FK（u=抬臂角、e=肘向身后折弯角，应用时取负，
// 平滑插值 dt×14）；IK 只用于「指向」，选解规则「肘永远朝身后」+ 环带钳制 + 迟滞（见 ik.ts）。
// 比例标定（文档第 8 章拖点标定，setProportions）：头关节偏移（插领深度）+ 臂/腿关节树
// 整体缩放（joint.scale.setScalar）；臂缩放同步 IK 段长与 armReach，腿缩放由 applyTransform
// 把 root 上移补偿保持贴地；挂在手关节上的棒/枪由道具侧按 1/armScale 反向缩放。

import * as THREE from 'three';
import { chooseElbowSign, solveTwoBone } from './ik';
import { PendulumLeg } from './legs';

/** geometry.json 中单个部件的几何：归一化轮廓多边形 + 包围盒 */
export interface PartGeom {
  outline: [number, number][];
  bbox: [number, number, number, number];
}

/** pivots.json 中单个部件的铆点标注（语义见文档 4.1） */
export interface PivotDef {
  /** 父部件名；null = 根部件（belly） */
  parent: string | null;
  /** 铆点在父件图内的归一化坐标（UV，原点左上，y 向下；根部件忽略） */
  pivotInParent: [number, number];
  /** 同一铆点在本件图内的归一化坐标 */
  pivotInSelf: [number, number];
  /** 本件世界高度（米）：图高 1 映射到该米数 */
  height: number;
  /** 关节角限位（度），供标定/后续限位使用 */
  limits: [number, number];
  /** 前后叠压层序：z 微偏移 = layer × 0.0007，转身后符号取反 */
  layer: number;
  /** 静置角（弧度）：画稿方向与「自铆点垂下」不一致时的基准旋转 */
  rest?: number;
  /** 借用另一件的画稿（几何 + 贴图），如前手 art:'hand_b' */
  art?: string;
  /** 水平镜像（绕铆点翻面调转虎口）：前手 false、后手 true */
  flipX?: boolean;
  /** 连接桩擦除区（文档 4.3：露出的素皮铆桩运行时涂透明）：本件图内的归一化 UV 矩形列表 */
  erase?: [number, number, number, number][];
}

export type PivotsFile = Record<string, PivotDef>;

/**
 * alpha 贴图运行时加工（文档 4.3/第 8 章）：
 *  - erase 矩形涂透明：遮住暴露在外的素皮连接桩；
 *  - pivotInSelf 处填实小圆点：铆孔透出的黑点是「铆钉太明显」的来源，填平即遮钉
 *    （dye 贴图在离线后处理时已做孔区近邻填色，填实后颜色无缝）。
 */
export function cookAlphaTexture(tex: THREE.Texture, def: PivotDef): THREE.Texture {
  const rects = def.erase ?? [];
  const img = tex.image as HTMLImageElement;
  const w = img.width;
  const h = img.height;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  for (const [u0, v0, u1, v1] of rects) {
    ctx.clearRect(u0 * w, v0 * h, (u1 - u0) * w, (v1 - v0) * h);
  }
  const r = 0.018 * Math.min(w, h);
  ctx.fillStyle = '#fff'; // alphaMap 取绿通道，白色=不透明
  const [u, v] = def.pivotInSelf;
  ctx.beginPath();
  ctx.arc(u * w, v * h, r, 0, Math.PI * 2);
  ctx.fill();
  const out = new THREE.CanvasTexture(cv);
  out.flipY = tex.flipY;
  out.colorSpace = tex.colorSpace;
  return out;
}

/** 前手 / 后手 */
export type ArmSide = 'front' | 'back';

/** 手臂模式：FK 直接角度（预设姿势，确定性）或 IK 目标点（仅指向用） */
type ArmMode = 'fk' | 'ik';

const THICK = 0.002; // 皮片厚度 2mm（文档第 3 章末段）
const LAYER_STEP = 0.0007; // 每层 z 微偏移（文档 4.1）
const TRANSMISSION = 0.72; // 皮革透光率（投影 pass 期间由 transmissionGuard 临时置 0）

/** 每侧手臂对应的关节名 */
const ARM_JOINTS: Record<ArmSide, { upper: string; lower: string }> = {
  front: { upper: 'upper_arm_f', lower: 'lower_arm_f' },
  back: { upper: 'upper_arm_b', lower: 'lower_arm_b' },
};

export class Puppet {
  /** 整棵铰链树的根（已整体放 layer 1） */
  readonly group = new THREE.Group();
  /** 全部皮革材质：投影时交给 transmissionGuard 生成钩子（坑③） */
  readonly leather: THREE.MeshPhysicalMaterial[] = [];

  private joints = new Map<string, THREE.Group>();
  /** 记录每个网格的 layer，转身时重算 z 偏移符号 */
  private partMeshes: { mesh: THREE.Mesh; layer: number }[] = [];
  private defs: PivotsFile;

  // ---- 手臂状态 ----
  private armMode: Record<ArmSide, ArmMode> = { front: 'fk', back: 'fk' };
  private armFK: Record<ArmSide, { u: number; e: number }> = {
    front: { u: 0, e: 0 },
    back: { u: 0, e: 0 },
  };
  private armIK: Record<ArmSide, { x: number; y: number }> = {
    front: { x: 0, y: -0.15 },
    back: { x: 0, y: -0.14 },
  };
  /** 「肘朝身后」迟滞：每侧手臂记住上一次选解 */
  private prevElbowSign: Record<ArmSide, 1 | -1> = { front: 1, back: 1 };
  /** 大/小臂骨骼长度（米），由铆点距离估算，IK 用 */
  private armLen = { upper: 0.09, lower: 0.085 };

  // ---- 走位 / 身段状态 ----
  private posX = 0;
  private posY = 0.95; // 根（髋部铆点）离地高度
  private depth = 0.15; // 0=贴幕 1=近灯
  private facing: 1 | -1 = 1;
  private lean = 0;
  /** 主动腿摆角（弧度）；null = 被动摆锤 */
  private legPose: { front: number | null; back: number | null } = { front: null, back: null };

  // ---- 摆锤腿（走路时腿部自然摆动，根水平加速度驱动）----
  private legF = new PendulumLeg(26, 3.2, 0.9);
  private legB = new PendulumLeg(26, 3.2, 0.7); // 后腿耦合弱一点，前后腿错相
  private prevPosX = 0;
  private prevVelX = 0;

  // ---- 比例标定状态（文档第 8 章拖点标定）----
  private prop = { headOffX: 0, headOffY: 0, arm: 1, leg: 1 };
  /** 头关节装配基准位置（父件局部系），👤 偏移量的零点 */
  private headBase: THREE.Vector3 | null = null;
  /** 静置腿长（米）：由 leg_f 网格包围盒量得（同 cloud.ts 的量法），root 贴地补偿用 */
  private legLen = 0.234;

  /**
   * @param defs     pivots.json 内容
   * @param parts    geometry.json 的 parts 表
   * @param textures 每件的 dye/alpha 贴图（键为部件名；art 借稿件自动取被借件）
   * @param tint     染色（第二影人可着色区分；默认白 = 原色）
   */
  constructor(
    defs: PivotsFile,
    parts: Record<string, PartGeom>,
    textures: Record<string, { dye: THREE.Texture; alpha: THREE.Texture }>,
    tint = 0xffffff,
  ) {
    this.defs = defs;
    this.group.name = 'puppet';

    // 1) 建件：网格 + 关节组，铆点对齐关节原点
    for (const [name, def] of Object.entries(defs)) {
      const joint = new THREE.Group();
      joint.name = `joint_${name}`;
      joint.rotation.z = def.rest ?? 0;

      const artKey = def.art ?? name; // art 借稿件：几何与贴图都取被借件
      const geom = parts[artKey];
      const tex = textures[artKey];
      if (!geom || !tex) throw new Error(`影人部件资产缺失：${artKey}（${name} 引用）`);
      const mesh = this.buildPart(name, def, geom, tex, tint);

      // 网格平移使 pivotInSelf 对齐关节组原点。
      // shape 坐标系 y 向上（建 Shape 时图 y 已翻转），铆点 three 坐标 = (px·s, (1-py)·s)；
      // flipX 时几何绕 x=0 镜像（scale.x 取负），铆点 x 相应取反。
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

    // 2) 组树：关节组位置 = (pivotInParent − parentPivotInSelf) × parentHeight（y 已翻转为向上）
    for (const [name, def] of Object.entries(defs)) {
      const joint = this.joints.get(name)!;
      if (!def.parent) {
        this.group.add(joint);
        continue;
      }
      const parentDef = this.defs[def.parent];
      const parentJoint = this.joints.get(def.parent)!;
      const ps = parentDef.height;
      joint.position.set(
        (def.pivotInParent[0] - parentDef.pivotInSelf[0]) * ps,
        (parentDef.pivotInSelf[1] - def.pivotInParent[1]) * ps,
        0,
      );
      parentJoint.add(joint);
    }

    // 3) 手臂骨骼长度：铆点间距离（IK 段长）
    this.armLen.upper = this.boneLen('upper_arm_f', 'lower_arm_f');
    this.armLen.lower = this.boneLen('lower_arm_f', 'hand_f');

    // 4) 标定基准：头关节装配位置 + 静置腿长（腿网格包围盒最低点，关节局部系）
    const headJ = this.joints.get('head');
    if (headJ) this.headBase = headJ.position.clone();
    const legJ = this.joints.get('leg_f');
    const legMesh = legJ?.children.find((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh === true);
    if (legMesh) {
      legMesh.geometry.computeBoundingBox();
      const bb = legMesh.geometry.boundingBox;
      if (bb) {
        const footY = bb.min.y * legMesh.scale.y + legMesh.position.y;
        if (footY < -0.1) this.legLen = -footY;
      }
    }

    // 影人专用层：主相机与灯位相机都看 layer 1（文档第 5 章分层）
    this.group.traverse((o) => o.layers.set(1));
    this.applyTransform();
  }

  /**
   * 加载一套影人资产并装配。
   * 贴图 URL 带 ?v= 版本号防浏览器缓存（文档踩坑条款：否则改图「看起来没生效」）。
   */
  static async load(set: string, base = '/assets/puppets'): Promise<Puppet> {
    const v = `?v=${Date.now()}`;
    const [geoRes, pivRes] = await Promise.all([
      fetch(`${base}/${set}/geometry.json`),
      fetch(`${base}/${set}/pivots.json`),
    ]);
    if (!geoRes.ok || !pivRes.ok) {
      throw new Error(`影人资产加载失败：${set}（geometry ${geoRes.status} / pivots ${pivRes.status}）`);
    }
    const geo = (await geoRes.json()) as { parts: Record<string, PartGeom> };
    const pivots = (await pivRes.json()) as PivotsFile;

    const loader = new THREE.TextureLoader();
    const textures: Record<string, { dye: THREE.Texture; alpha: THREE.Texture }> = {};
    await Promise.all(
      Object.keys(pivots).map(async (name) => {
        const [dye, alpha] = await Promise.all([
          loader.loadAsync(`${base}/${set}/${name}_dye.png${v}`),
          loader.loadAsync(`${base}/${set}/${name}_alpha.png${v}`),
        ]);
        dye.colorSpace = THREE.SRGBColorSpace; // dye 是颜色贴图；alpha 保持线性
        textures[name] = { dye, alpha: cookAlphaTexture(alpha, pivots[name]) };
      }),
    );
    return new Puppet(pivots, geo.parts, textures);
  }

  // ---------- 公共 API：手臂 ----------

  /**
   * FK 摆臂（预设姿势唯一入口，文档 6.5：预设姿势绝对不要用 IK）。
   * @param u 抬臂角（度）：0=下垂，90=水平指向面向侧，180=竖直上举
   * @param e 肘向身后折弯角（度）：0=伸直
   * 应用时取负并在 update 中按 dt×14 平滑插值，防姿势切换跳变。
   */
  setArmPose(u: number, e: number, arm: ArmSide = 'front'): void {
    this.armMode[arm] = 'fk';
    this.armFK[arm] = { u, e };
  }

  /**
   * IK 指向（仅「单伸食指指向」类动作用，文档 6.5）。
   * @param target 影人局部系目标点（米，肩为原点，y 向上，+x = 身后）
   */
  pointAt(target: { x: number; y: number }, arm: ArmSide = 'front'): void {
    this.armMode[arm] = 'ik';
    this.armIK[arm] = { x: target.x, y: target.y };
  }

  /** 臂展（米）：大臂 + 小臂骨骼长度 × 臂长缩放（前后臂同长；IK 射程/导演指向基准） */
  get armReach(): number {
    return (this.armLen.upper + this.armLen.lower) * this.prop.arm;
  }

  // ---------- 公共 API：比例标定（文档第 8 章拖点标定）----------

  /** 静置臂展（未缩放，米）：拖 💪 时把肩手距离换算成缩放比 */
  get restArmReach(): number {
    return this.armLen.upper + this.armLen.lower;
  }

  /** 静置腿长（未缩放，米）：拖 🦵 时把髋脚距离换算成缩放比 */
  get restLegLen(): number {
    return this.legLen;
  }

  /** 当前腿长（米，静置腿长 × 腿缩放）：🦵 拖点跟随脚底用 */
  get legLength(): number {
    return this.legLen * this.prop.leg;
  }

  /** 当前臂长缩放比：挂在手关节上的棒/枪按 1/armScale 反向缩放，避免跟着臂长变 */
  get armScale(): number {
    return this.prop.arm;
  }

  /**
   * 比例标定：头偏移（米，父件局部系）+ 臂/腿关节树整体缩放（joint.scale.setScalar）。
   * 臂缩放经 prop.arm 同步 IK 段长（solveArm）与 armReach；腿缩放在 applyTransform
   * 把 root 上移 (leg−1)×legLen 补偿保持贴地。每帧调用冪等，可直接跟标定单例。
   */
  setProportions(v: { headOff: { x: number; y: number }; arm: number; leg: number }): void {
    this.prop.headOffX = v.headOff.x;
    this.prop.headOffY = v.headOff.y;
    this.prop.arm = v.arm;
    this.prop.leg = v.leg;
    const hj = this.joints.get('head');
    if (hj && this.headBase) {
      hj.position.set(this.headBase.x + v.headOff.x, this.headBase.y + v.headOff.y, this.headBase.z);
    }
    for (const n of ['upper_arm_f', 'upper_arm_b']) this.joints.get(n)?.scale.setScalar(v.arm);
    for (const n of ['leg_f', 'leg_b']) this.joints.get(n)?.scale.setScalar(v.leg);
  }

  /**
   * 世界点 → 头部偏移量（拖 👤 用）：投到头关节父件局部系减装配基准，
   * 场景图矩阵天然处理转身镜像，不手推符号。
   */
  headOffsetFromWorld(w: THREE.Vector3): { x: number; y: number } {
    const hj = this.joints.get('head');
    if (!hj?.parent || !this.headBase) return { x: this.prop.headOffX, y: this.prop.headOffY };
    const l = hj.parent.worldToLocal(w.clone());
    return { x: l.x - this.headBase.x, y: l.y - this.headBase.y };
  }

  // ---------- 公共 API：走位 / 身段 ----------

  /** 设置台面横向位置与离地高度（米） */
  setPosition(x: number, y = this.posY): void {
    this.posX = x;
    this.posY = y;
  }

  get x(): number {
    return this.posX;
  }

  /** 进深：0=贴幕（影锐）1=近灯（影虚） */
  setDepth(depth: number): void {
    this.depth = THREE.MathUtils.clamp(depth, 0, 1);
  }

  /** 面向：1 = 画稿原方向（朝左），-1 = 翻面（转身，绕 y 转 180°，平滑过渡） */
  face(dir: 1 | -1): void {
    this.facing = dir;
  }

  /** 整体缩放（近灯影人等比放大等） */
  setScale(s: number): void {
    this.group.scale.setScalar(s);
  }

  /** 身段倾角 [-1,1]：胸/头跟随侧倾 */
  setLean(v: number): void {
    this.lean = v;
  }

  /**
   * 主动腿摆角（弧度）：传入后覆盖被动摆锤（走/踢等主动动作）；
   * 传 null 恢复被动摆锤。切换在 update 中平滑混合。
   */
  setLegPose(front: number | null, back: number | null = front): void {
    this.legPose = { front, back };
  }

  /** 关节世界坐标（后续 Director/Tuner 对齐道具、标定用）；关节不存在返回 false */
  getJointWorld(name: string, out: THREE.Vector3): boolean {
    const j = this.joints.get(name);
    if (!j) return false;
    j.getWorldPosition(out);
    return true;
  }

  /** object 别名（与场景图交互用） */
  get object(): THREE.Group {
    return this.group;
  }

  // ---------- 每帧更新 ----------

  update(dt: number): void {
    this.applyTransform();

    // 转身：绕 y 平滑翻面；翻面后局部 z 被镜像 → 各件 z 偏移符号同步取反（文档 4.2.1）
    const targetRotY = this.facing === 1 ? 0 : Math.PI;
    this.group.rotation.y += (targetRotY - this.group.rotation.y) * Math.min(1, dt * 9);
    const zSign = this.group.rotation.y > Math.PI / 2 ? -1 : 1;
    for (const p of this.partMeshes) p.mesh.position.z = p.layer * LAYER_STEP * zSign;

    // 身段倾角：胸主倾、头跟随
    const chest = this.joints.get('chest');
    if (chest) chest.rotation.z = -this.lean * 0.35;
    const head = this.joints.get('head');
    if (head) head.rotation.z = -this.lean * 0.18;

    // 手臂：FK 直接角度优先（预设姿势，确定性），IK 仅指向
    for (const arm of ['front', 'back'] as const) {
      if (this.armMode[arm] === 'fk') this.applyArmFK(arm, dt);
      else this.solveArm(arm);
    }

    // 腿：根水平加速度驱动被动摆锤；有主动角时平滑切入主动角
    const vx = dt > 0 ? (this.posX - this.prevPosX) / dt : 0;
    const ax = dt > 0 ? (vx - this.prevVelX) / dt : 0;
    this.prevPosX = this.posX;
    this.prevVelX = vx;
    this.updateLeg('leg_f', this.legPose.front, this.legF.update(dt, ax), dt);
    this.updateLeg('leg_b', this.legPose.back, this.legB.update(dt, ax * 0.8) * 0.85, dt);
  }

  // ---------- 内部实现 ----------

  private applyTransform(): void {
    // 进深映射到灯幕之间：贴幕 0.05m ↔ 近灯 0.55m（灯在幕后 0.85m）
    // 腿长缩放补偿：腿加长时 root 上移 (leg−1)×legLen，脚底保持贴地（文档第 8 章）
    this.group.position.set(this.posX, this.posY + (this.prop.leg - 1) * this.legLen, 0.05 + this.depth * 0.5);
  }

  /** 由 a、b 两件的铆点关系估算骨骼长度（米） */
  private boneLen(a: string, b: string): number {
    const da = this.defs[a];
    const db = this.defs[b];
    if (!da || !db) return 0.09;
    const s = da.height;
    const dx = (db.pivotInParent[0] - da.pivotInSelf[0]) * s;
    const dy = (da.pivotInSelf[1] - db.pivotInParent[1]) * s;
    return Math.hypot(dx, dy);
  }

  /** 建单件：outline → Shape → 2mm 挤出 → 皮革透光材质 */
  private buildPart(
    name: string,
    def: PivotDef,
    geom: PartGeom,
    tex: { dye: THREE.Texture; alpha: THREE.Texture },
    tint: number,
  ): THREE.Mesh {
    // 图 y 向下 → three y 向上；此时 shape 坐标恰与贴图 uv 一致
    const shape = new THREE.Shape();
    geom.outline.forEach(([x, y], i) => {
      if (i === 0) shape.moveTo(x, 1 - y);
      else shape.lineTo(x, 1 - y);
    });
    shape.closePath();

    // 网格整体再乘 height 缩放，故挤出深度写 THICK/height → 世界厚度恰为 2mm
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: THICK / def.height,
      bevelEnabled: false,
    });
    const mat = new THREE.MeshPhysicalMaterial({
      color: tint,
      map: tex.dye,
      alphaMap: tex.alpha,
      alphaTest: 0.5, // 外轮廓 + 雕孔一起镂空
      transmission: TRANSMISSION, // 皮革透光（投影 pass 期间被钩子临时置 0）
      thickness: THICK,
      roughness: 0.65,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `part_${name}`;
    mesh.scale.setScalar(def.height);
    if (def.flipX) mesh.scale.x = -def.height; // 绕铆点水平翻面（调转虎口，文档 4.2.2）
    this.leather.push(mat);
    return mesh;
  }

  /** FK 应用：角度取负（标定验证的符号约定），dt×14 平滑插值防跳变 */
  private applyArmFK(arm: ArmSide, dt: number): void {
    const { upper, lower } = ARM_JOINTS[arm];
    const uj = this.joints.get(upper);
    const lj = this.joints.get(lower);
    if (!uj || !lj) return;
    const fk = this.armFK[arm];
    const targetU = -(fk.u * Math.PI) / 180;
    const targetE = -(fk.e * Math.PI) / 180;
    const k = Math.min(1, dt * 14);
    uj.rotation.z += (targetU - uj.rotation.z) * k;
    lj.rotation.z += (targetE - lj.rotation.z) * k;
  }

  /**
   * IK 求解（指向用）：目标在影人局部系（肩为原点，y 向上，+x = 身后）。
   * 求解器工作于 y 向下屏幕系：目标 y 取反送入，返回角再取反映回。
   * 段长乘臂长缩放 prop.arm：臂关节树被 setScalar 后世界臂展同步变，IK 用缩放后段长解。
   */
  private solveArm(arm: ArmSide): void {
    const { upper, lower } = ARM_JOINTS[arm];
    const uj = this.joints.get(upper);
    const lj = this.joints.get(lower);
    if (!uj || !lj) return;
    const L1 = this.armLen.upper * this.prop.arm;
    const L2 = this.armLen.lower * this.prop.arm;
    const t = { x: this.armIK[arm].x, y: -this.armIK[arm].y };

    // 「肘永远朝身后」选解 + 迟滞；环带钳制在求解器内部完成
    const sign = chooseElbowSign(L1, L2, t, this.prevElbowSign[arm]);
    this.prevElbowSign[arm] = sign;
    const { shoulder, elbow } = solveTwoBone(L1, L2, t, sign);

    // 部件静置时竖直下垂（局部 -90°）。y 向上系中骨骼绝对角 φ = -θ：
    // 大臂关节 r_u = φ_s + 90°；小臂关节（相对大臂）r_l = φ_e - φ_s = θ_s - θ_e。
    uj.rotation.z = -shoulder + Math.PI / 2;
    lj.rotation.z = shoulder - elbow;
  }

  /** 单腿更新：被动摆锤或主动角（平滑混合，切回被动时同步摆锤状态防回弹） */
  private updateLeg(name: string, active: number | null, pendulum: number, dt: number): void {
    const joint = this.joints.get(name);
    if (!joint) return;
    if (active == null) {
      joint.rotation.z = pendulum;
    } else {
      joint.rotation.z += (active - joint.rotation.z) * Math.min(1, dt * 14);
      // 主动期间把摆锤相位钉在当前角，切回被动时不会猛甩
      const leg = name === 'leg_f' ? this.legF : this.legB;
      leg.theta = joint.rotation.z;
      leg.omega = 0;
    }
  }
}
