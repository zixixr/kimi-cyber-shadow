// 导演「大脑」（文档第 6 章，本项目迭代最多、最关键的控制模块）：
//   手信号 → 角色路由 → 运动层 → 手势状态机 → PuppetControl（main 应用到 Puppet 公共 API）。
//
// 顶层哲学（6.1，作者拍板，不可动摇）：
//  - 手势 = 状态，状态 = 循环动画；能自动的全自动（走/跑/跳/蹲/转身全由运动层判）；
//  - 不做打击力度识别：握拳 = 程式化连招循环（保持握拳微微移动即可）——
//    挥拳识别击打被明确否决过（挥拳会被误判成前后走路），不要回退。
// 运动层（6.4）：
//  - 走/跑用「带方向的净速度 EMA」，绝不用速率：来回甩手净位移≈0 → 不走；
//  - 跳跃用腕纵向原始速度触发 + 锁定窗口防连跳；
//  - 转身用持续同向位移累计 + 1s 锁定：翻手/抖动不误触、转身后不闪现。
// 姿势层（6.5）：预设姿势一律 FK（u/e 角度），IK 只留「食指指向」一处（frontFK = null）。
// 路由：第 1 只手 → 主角（PuppetActor）；第 2 只手 → SecondRoleIntent，
//   预留给 M4 老虎 / M5 第二角色（本阶段只产出意图，不驱动本体）。

import type { Gesture } from './gestures';
import type { HandSignal, NormPoint } from './source';

// ---------- 常量（参考实现标定验证过的数值，勿凭直觉改） ----------
const STAGE_HALF_W = 0.7; // 手 x∈[-1,1] → 台面 x∈[-0.7,0.7]（留出木框边距）
const BASE_Y = 0.95; // 影人根（髋部铆点）离地高度
const WALK_SPEED = 0.07; // m/s 净速度进入走
const RUN_SPEED = 0.42; // m/s 净速度进入跑
const JUMP_VY = 1.8; // 腕纵向速度（归一化/s）触发跳
const JUMP_DUR = 0.55; // 跳跃时长（秒）
const JUMP_H = 0.22; // 跳跃高度（米）
const JUMP_LOCK = 0.9; // 跳跃锁定窗口（秒，防连跳）
const CROUCH_Y = -0.45; // 腕低于此值（归一化）进入下蹲
// 转身：同向位移累计 > FLIP_DISP 且瞬时速度 > FLIP_MINV 才触发；触发后锁存 FLIP_LOCK
const FLIP_DISP = 0.34;
const FLIP_MINV = 1.2;
const FLIP_LOCK = 1.0;

/** FK 手臂姿势：u=抬臂角（0下垂/90平举指向面向侧/180竖直上举），e=肘向身后折弯角 */
export interface ArmFK {
  u: number;
  e: number;
}

/** 主角状态名（对照表高亮/调试显示用） */
export type HeroState =
  | 'idle' // 待机（呼吸微动）
  | 'walk' // 走
  | 'run' // 跑
  | 'jump' // 跳
  | 'crouch' // 蹲
  | 'wave' // 张开 = 亮相挥手
  | 'combo' // 握拳 = 拳脚连招
  | 'staff' // 剑指 = 器械套路
  | 'point' // 食指 = 指向（IK）
  | 'proud'; // 拇指 = 傲立

/** 手势 → 状态名（none 无固定状态，由运动层决定） */
const GESTURE_STATE: Record<Exclude<Gesture, 'none'>, HeroState> = {
  open: 'wave',
  fist: 'combo',
  sword: 'staff',
  point: 'point',
  thumb: 'proud',
};

/** 导演每帧产出的一只影人的控制量（main 用 applyControl 应用到 Puppet） */
export interface PuppetControl {
  /** 是否有手在控制（false = 无手待机） */
  active: boolean;
  state: HeroState;
  gesture: Gesture;
  facing: 1 | -1;
  rootX: number;
  rootY: number;
  /** 进深 0=贴幕 1=近灯 */
  depth: number;
  /** 身段倾角 [-1,1] */
  lean: number;
  /** FK 姿势；为 null 表示该臂走 IK（本阶段仅 point 的前手，文档 6.5） */
  frontFK: ArmFK | null;
  rearFK: ArmFK | null;
  /** IK 目标（影人局部系：肩为原点，y 向上，+x=身后；assembly.pointAt 语义） */
  frontTarget: NormPoint;
  rearTarget: NormPoint;
  /** 主动腿摆角（弧度）；null = 恢复被动摆锤腿 */
  legFront: number | null;
  legRear: number | null;
  /** 正在走/跑（对照表「移动」行高亮用） */
  moving: boolean;
}

/**
 * 第二只手的路由输出 —— M4 老虎 / M5 第二角色的接入口（本阶段不驱动本体）。
 * M4 老虎：moveX 走位 + gesture（open=咆哮 / fist=扑击 / none=走位），无手时 AI 接管；
 * M5 第二人形角色：可直接 new PuppetActor(armReach)，把 signal 喂进去得到第二份 PuppetControl。
 */
export interface SecondRoleIntent {
  /** 第二只手是否在镜 */
  active: boolean;
  gesture: Gesture;
  /** 观众视角走位 [-1,1]（右正） */
  moveX: number;
  /** 进深 0=贴幕 1=近灯 */
  depth: number;
  handedness: 'left' | 'right';
  /** 原始信号（需要掌心/关键点/指向等更多自由度时直接取） */
  signal: HandSignal | null;
}

/** 导演每帧总输出 */
export interface DirectorFrame {
  hero: PuppetControl;
  second: SecondRoleIntent;
}

/** 手势状态机的输出：双臂 + 可选腿部覆盖 + 身体冲步/下沉 */
interface ArmsOut {
  frontFK: ArmFK | null;
  rearFK: ArmFK | null;
  frontTarget: NormPoint | null;
  legs: { f: number; r: number } | null;
  lunge: number; // 冲步：朝面向方向的瞬时突进（米）
  dip: number; // 下沉：根向下压（米）
}

function pose(front: ArmFK, rear: ArmFK, extra?: Partial<Pick<ArmsOut, 'legs' | 'lunge' | 'dip'>>): ArmsOut {
  return {
    frontFK: front,
    rearFK: rear,
    frontTarget: null,
    legs: extra?.legs ?? null,
    lunge: extra?.lunge ?? 0,
    dip: extra?.dip ?? 0,
  };
}

/** 打击包络：p∈[0,1]，前 30% 爆发、后 70% 缓收（连招每拍的力感曲线） */
function strikeEnv(p: number): number {
  return p < 0.3 ? Math.sin((p / 0.3) * (Math.PI / 2)) : Math.cos(((p - 0.3) / 0.7) * (Math.PI / 2));
}

/**
 * 单角色控制状态机（运动层 + 手势状态机）。
 * 主角用它；M5 第二人形角色可直接再实例化一个复用（喂第二只手的 signal）。
 */
export class PuppetActor {
  private facing: 1 | -1 = 1;
  private prevRootX = 0;
  private prevWy = 0;
  /** 带方向的净速度 EMA（走/跑判据，文档 6.4：绝不用速率） */
  private vel = 0;
  /** 腕纵向速度 EMA（跳跃触发） */
  private vy = 0;
  private phase = 0; // 走路相位
  private jumpT = 0;
  private lastJumpAt = -10;
  private lastFlipAt = -10;
  private faceTimer = 0;
  private dispDir = 0; // 转身：同向位移累计的方向
  private disp = 0; // 转身：同向位移累计量
  private wasActive = false;
  private rootX = 0; // 无手时的驻留位置
  private armReach: number;

  /** @param armReach 臂展（米，大臂+小臂），point 的 IK 目标半径基准 */
  constructor(armReach = 0.175) {
    this.armReach = armReach;
  }

  /** 每帧更新；hand = null 表示主角手不在镜（自动待机） */
  update(dt: number, t: number, hand: HandSignal | null): PuppetControl {
    if (!hand || !hand.present) {
      this.wasActive = false;
      return this.idleControl(t);
    }

    // ---------- 运动层（文档 6.4） ----------
    // 镜像映射：手往用户右侧移 → 影人往观众右侧走（世界 -x），所见即所得
    const rootX = -hand.wrist.x * STAGE_HALF_W;
    if (!this.wasActive) {
      this.prevRootX = rootX;
      this.prevWy = hand.wrist.y;
      this.wasActive = true;
    }
    let vx = dt > 0 ? (rootX - this.prevRootX) / dt : 0;
    let vyRaw = dt > 0 ? (hand.wrist.y - this.prevWy) / dt : 0;
    if (Math.abs(vx) > 6 || Math.abs(vyRaw) > 8) {
      vx = 0; // 跟踪瞬移保护（换手/丢帧）
      vyRaw = 0;
    }
    this.prevRootX = rootX;
    this.prevWy = hand.wrist.y;
    this.rootX = rootX;
    this.vel += (vx - this.vel) * Math.min(1, dt * 6);
    this.vy += (vyRaw - this.vy) * Math.min(1, dt * 12);

    // 转身①：甩手 = 持续同向大幅位移累计（速度尖峰/翻手不误触）
    const dir = Math.sign(vx);
    if (dir !== 0 && dir === this.dispDir && Math.abs(vx) > FLIP_MINV) this.disp += vx * dt;
    else {
      this.dispDir = dir;
      this.disp = Math.abs(vx) > FLIP_MINV ? vx * dt : 0;
    }
    const locked = t - this.lastFlipAt < FLIP_LOCK;
    if (!locked && Math.abs(this.disp) > FLIP_DISP) {
      this.facing = this.facing === 1 ? -1 : 1;
      this.lastFlipAt = t;
      this.disp = 0;
    }
    // 转身②：自动面向行走方向（净速度判定，0.25s 防抖；锁存期内不动作）
    if (!locked && Math.abs(this.vel) > WALK_SPEED) {
      const want: 1 | -1 = this.vel < 0 ? 1 : -1; // 世界 -x = 观众右 → facing 1（面向行走方向）
      if (want !== this.facing) {
        this.faceTimer += dt;
        if (this.faceTimer > 0.25) {
          this.facing = want;
          this.lastFlipAt = t;
          this.faceTimer = 0;
        }
      } else this.faceTimer = 0;
    } else this.faceTimer = 0;

    // 跳跃：腕快速上提触发，锁定窗口防连跳
    if (this.vy > JUMP_VY && this.jumpT <= 0 && t - this.lastJumpAt > JUMP_LOCK) {
      this.jumpT = JUMP_DUR;
      this.lastJumpAt = t;
    }
    const jumping = this.jumpT > 0;
    let jumpArc = 0;
    if (jumping) {
      jumpArc = JUMP_H * Math.sin(Math.PI * (1 - this.jumpT / JUMP_DUR));
      this.jumpT -= dt;
    }

    // 运动状态：净速度判走/跑（微微前后晃不算走）
    const netSpeed = Math.abs(this.vel);
    const running = netSpeed > RUN_SPEED;
    const walking = !jumping && netSpeed > WALK_SPEED;
    const crouching = !jumping && hand.wrist.y < CROUCH_Y;
    const idle = !jumping && !walking && !crouching;

    const stride = Math.min(0.55, 0.18 + netSpeed * 0.9);
    if (walking) this.phase += (3.5 + netSpeed * 9) * dt * (running ? 1.25 : 1);
    const s = Math.sin(this.phase);

    // ---------- 腿 ----------
    let legFront: number | null = null; // null = 被动摆锤
    let legRear: number | null = null;
    if (walking) {
      legFront = stride * s;
      legRear = -stride * s * 0.9;
    }
    if (jumping) {
      legFront = 0.6;
      legRear = -0.6;
    }
    if (crouching) {
      legFront = 0.5;
      legRear = -0.5;
    }

    // ---------- 手势状态机（6.1：手势=状态=循环动画；6.5：FK 优先） ----------
    const arms = this.armsFor(hand, t, s, netSpeed, walking);
    // 连招含腿部动作时覆盖（踢腿/弓步）；跳/蹲优先级更高
    if (arms.legs && !jumping && !crouching) {
      legFront = arms.legs.f;
      legRear = arms.legs.r;
    }

    let state: HeroState;
    if (jumping) state = 'jump';
    else if (crouching) state = 'crouch';
    else if (hand.gesture !== 'none') state = GESTURE_STATE[hand.gesture];
    else if (walking) state = running ? 'run' : 'walk';
    else state = 'idle';

    // ---------- 身体 ----------
    const bounce = walking ? Math.abs(s) * (running ? 0.026 : 0.013) : 0;
    const breathe = idle && hand.gesture === 'none' ? Math.sin(t * 1.4) * 0.006 : 0;
    const leanAuto = running ? -Math.sign(this.vel || 1) * 0.18 : 0;

    return {
      active: true,
      state,
      gesture: hand.gesture,
      facing: this.facing,
      // 连招冲步：朝面向方向瞬时突进（facing 1 = 世界 -x）
      rootX: rootX + arms.lunge * (this.facing === 1 ? -1 : 1),
      rootY: BASE_Y + hand.wrist.y * 0.22 + bounce + breathe + jumpArc - arms.dip,
      depth: hand.depth,
      lean: hand.lean + leanAuto,
      frontFK: arms.frontFK,
      rearFK: arms.rearFK,
      frontTarget: arms.frontTarget ?? { x: 0.03, y: -0.15 },
      rearTarget: { x: 0.03, y: -0.14 },
      legFront,
      legRear,
      moving: walking,
    };
  }

  /** 无手待机：驻留原位，双臂呼吸微动 */
  private idleControl(t: number): PuppetControl {
    const b = Math.sin(t * 1.4);
    return {
      active: false,
      state: 'idle',
      gesture: 'none',
      facing: this.facing,
      rootX: this.rootX,
      rootY: BASE_Y,
      depth: 0.15,
      lean: 0,
      frontFK: { u: 14 + b * 3, e: 18 },
      rearFK: { u: 2 - b * 2.5, e: 16 },
      frontTarget: { x: 0.03, y: -0.15 },
      rearTarget: { x: 0.03, y: -0.14 },
      legFront: null,
      legRear: null,
      moving: false,
    };
  }

  /** 手势 → 循环动画（每个手势 = 一个状态 = 一段 FK 循环；仅 point 走 IK） */
  private armsFor(hand: HandSignal, t: number, s: number, speed: number, walking: boolean): ArmsOut {
    switch (hand.gesture) {
      case 'open': {
        // 亮相：双臂高展，前手对观众连续挥手
        const w = Math.sin(t * 4.5);
        return pose(
          { u: 148 + 12 * w, e: 20 + 16 * (0.5 + 0.5 * w) },
          { u: -122, e: 25 },
          { dip: 0.004 * (1 + Math.sin(t * 2.2)) },
        );
      }
      case 'fist':
        return this.combo(t);
      case 'sword':
        return this.staffRoutine(t);
      case 'point': {
        // 指向：全项目唯一的 IK（6.5）。食指方向 → 前手目标点。
        const m = Math.hypot(hand.indexTip.x, hand.indexTip.y);
        const d = m > 1e-3 ? { x: hand.indexTip.x / m, y: hand.indexTip.y / m } : { x: -1, y: 0 };
        const r = this.armReach * 0.9; // 收在环带外缘 0.97×臂展以内（ik.ts ANNULUS_OUT）
        // 观众视角（右正）→ 影人局部系：facing=1 面向观众右 = 局部 -x；转身后同步镜像
        return {
          frontFK: null,
          rearFK: { u: -12, e: 20 },
          frontTarget: { x: -d.x * this.facing * r, y: d.y * r },
          legs: null,
          lunge: 0,
          dip: 0,
        };
      }
      case 'thumb':
        // 傲立：前手叉腰、后手扬起
        return pose({ u: 30, e: 105 }, { u: -75, e: 45 });
      default: {
        // none：走路摆臂 / 待机呼吸微动
        if (walking) {
          const amp = Math.min(34, 12 + speed * 40);
          return pose({ u: 24 + amp * s, e: 22 + 12 * Math.abs(s) }, { u: 2 - amp * 0.7 * s, e: 20 + 10 * Math.abs(s) });
        }
        const b = Math.sin(t * 1.4);
        return pose({ u: 14 + b * 3, e: 18 }, { u: 2 - b * 2.5, e: 16 });
      }
    }
  }

  /** 握拳 = 拳脚连招循环（四拍）：直拳→抡拳→踢腿→弓步（6.1：不识别打击力度！） */
  private combo(t: number): ArmsOut {
    const BEAT = 0.55;
    const w = t / BEAT;
    const beat = Math.floor(w) % 4;
    const e = strikeEnv(w % 1);
    const guardF: ArmFK = { u: 75, e: 112 };
    const guardR: ArmFK = { u: -35, e: 118 };
    switch (beat) {
      case 0: // 前手直拳（冲步）
        return pose({ u: 75 + 20 * e, e: 112 - 100 * e }, guardR, { lunge: 0.06 * e, dip: 0.012 * e });
      case 1: // 后手抡拳过顶
        return pose(guardF, { u: -35 + 170 * e, e: 118 - 98 * e }, { lunge: 0.05 * e, dip: 0.015 * e });
      case 2: // 前踢腿（双拳收架）
        return pose(guardF, guardR, { legs: { f: 0.12 + 0.85 * e, r: -0.3 * e }, lunge: 0.03 * e, dip: 0.008 * e });
      default: // 弓步双拳下压（震脚收势）
        return pose({ u: 55 - 15 * e, e: 70 - 30 * e }, { u: -20 + 10 * e, e: 60 - 25 * e }, {
          legs: { f: 0.45 * e, r: -0.45 * e },
          dip: 0.03 * e,
        });
    }
  }

  /** 剑指 = 器械套路循环（四拍）：高劈→侧扫→前刺→环绕（哨棒/金箍棒通用 FK 骨架） */
  private staffRoutine(t: number): ArmsOut {
    const BEAT = 0.8;
    const w = t / BEAT;
    const beat = Math.floor(w) % 4;
    const ph = w % 1;
    const e = strikeEnv(ph);
    switch (beat) {
      case 0: // 高位大劈：由后上抡至前下
        return pose({ u: 160 - 120 * e, e: 20 + 10 * e }, { u: -60 + 20 * e, e: 45 }, { lunge: 0.05 * e, dip: 0.014 * e });
      case 1: // 回抽 + 后手侧扫
        return pose({ u: 40 + 25 * ph, e: 60 }, { u: -60 + 150 * e, e: 55 - 35 * e }, { lunge: 0.03 * e });
      case 2: // 前刺（大冲步）
        return pose({ u: 88, e: 95 - 92 * e }, { u: -70 - 15 * e, e: 30 }, { lunge: 0.09 * e, dip: 0.016 * e });
      default: // 收势环绕亮式
        return pose({ u: 88 + 50 * Math.sin(ph * Math.PI), e: 25 + 45 * ph }, { u: -70 + 100 * e, e: 30 + 30 * e }, { dip: 0.008 });
    }
  }
}

/** 第二只手 → SecondRoleIntent（M4/M5 接入口，本阶段只做透传与命名） */
function secondIntent(s: HandSignal | undefined): SecondRoleIntent {
  if (!s) {
    return { active: false, gesture: 'none', moveX: 0, depth: 0.15, handedness: 'right', signal: null };
  }
  return { active: true, gesture: s.gesture, moveX: s.wrist.x, depth: s.depth, handedness: s.handedness, signal: s };
}

/**
 * 导演：手 → 角色路由 + 主角状态机。
 * signals 约定已按观众视角从左到右排序（HandSource 契约）：
 * 第 1 只手 → 主角；第 2 只手 → SecondRoleIntent（M4 老虎 / M5 第二角色）。
 */
export class Director {
  private heroActor: PuppetActor;

  /** @param heroArmReach 主角臂展（米）；传 Puppet.armReach */
  constructor(heroArmReach = 0.175) {
    this.heroActor = new PuppetActor(heroArmReach);
  }

  /** 每帧：手信号 → 主角控制量 + 第二角色意图 */
  update(dt: number, t: number, signals: HandSignal[]): DirectorFrame {
    const present = signals.filter((s) => s.present);
    return {
      hero: this.heroActor.update(dt, t, present[0] ?? null),
      second: secondIntent(present[1]),
    };
  }
}
