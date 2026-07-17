// 西游场景玩法逻辑（M5）：悟空打红孩儿。
// 职责（纯逻辑，不碰 three 场景图，便于单测；道具/粒子/装配的接线在 main.ts）：
//  - 第二角色控制路由：第二只手在镜 → PuppetActor 喂出红孩儿控制量（gesture open=喷火）；
//    无手 → 简单 AI（面向悟空、游走逼近、周期喷三昧真火、偶尔亮相）；
//  - 通用演出覆盖层（直接改写 PuppetControl，优先级：败阵倒地 > 受击 flail+击退 >
//    胜利谢幕「亮相→躬身→挥手」 > 喷火姿势）；
//  - 三昧真火判定：火舌射程内命中悟空 → 受击（跳起筋斗云可躲）；
//  - 棒/拳脚命中红孩儿（复用 battle.ts 的 heroAttack/strikePoint/inRange）→ HP → 败阵；
//  - 双手握棒拍位 / 金箍棒·火尖枪显隐 / 筋斗云进度等装配标志位。
// ⚠️ 耦合注意：STAFF_BEAT / JUMP_DUR / BASE_Y 复制自 hand/director.ts 内部常量
//   （director 冻结不改；改了要同步——同 battle.ts 复制 COMBO_BEAT/STAFF_BEAT 的既有约定）。

import { PuppetActor, type PuppetControl, type SecondRoleIntent } from '../hand/director';
import { heroAttack, inRange, strikePoint, type AttackKind } from './battle';

// ---------- 与导演同步的常量（勿单独改）----------
const STAFF_BEAT = 0.8; // = director.ts PuppetActor.staffRoutine 的 BEAT
const JUMP_DUR = 0.55; // = director.ts PuppetActor 的 JUMP_DUR
const BASE_Y = 0.95; // = director.ts 的 BASE_Y

// ---------- 西游常量（参考实现标定值）----------
export const FOE_MAX_HP = 8; // 红孩儿 HP（参考实现同值）
export const MOUTH_OFF = { x: 0.047, y: 0.032 }; // 嘴部相对头关节（颈部铆点）的前移/上移（拖点标定值）
const FOE_TOL = 0.3; // 棒/拳脚命中红孩儿容差（与 battle.FOE_TOL 一致）
const HERO_TOL = 0.3; // 红孩儿兵刃命中悟空容差
const FIRE_NEAR = 0.05; // 火舌近界（米，嘴前）
const FIRE_FAR = 0.78; // 火舌远界
const JUMP_DODGE = 0.12; // 悟空根高于 BASE_Y+此值 = 筋斗云躲火
const HIT_DUR = 0.5; // 受击 flail 时长（秒）
const VICTORY_DUR = 5.5; // 胜利谢幕时长（亮相 1.5 → 躬身 1.4 → 挥手 2.6）
const PEAK = 0.82; // 攻击拍力度峰值触发阈（与 battle.ts 一致）
const RELEASE = 0.3; // 锁存释放阈
const MSG_DUR = 4; // 战报提示驻留（秒）
const AI_START_X = 0.45; // 红孩儿上场位（世界 x，观众左侧）
const AI_HOLD_DIST = 0.52; // AI 对峙保持的距离（火舌射程内）
const AI_FIRE_DUR = 1.1; // AI 单次喷火时长（秒）

// ---------- 纯函数（单测直接覆盖）----------

/** 双手握棒拍位：器械套路第 1 拍（高劈）与第 3 拍（前刺）为双手动作（文档第 7 章「特定拍位」） */
export function twoHandGrip(t: number): boolean {
  const beat = Math.floor(t / STAFF_BEAT) % 4;
  return beat === 0 || beat === 2;
}

/** 面向方向的世界 x 符号：facing 1 = 面向观众右 = 世界 -x（与 battle.strikePoint 同约定） */
export function facingDirX(facing: 1 | -1): 1 | -1 {
  return facing === 1 ? -1 : 1;
}

/**
 * 三昧真火喷口世界坐标：头关节（颈部铆点）+ 面向前移 mouth.x + 上移 mouth.y。
 * mouth 默认 MOUTH_OFF（固化常量）；拖点标定时 main 传入标定单例的 mouth 实时覆盖（文档第 8 章）。
 */
export function fireOrigin(
  head: { x: number; y: number; z: number },
  facing: 1 | -1,
  mouth: { x: number; y: number } = MOUTH_OFF,
): { x: number; y: number; z: number } {
  return { x: head.x + facingDirX(facing) * mouth.x, y: head.y + mouth.y, z: head.z };
}

/** 火舌是否命中悟空：嘴前 FIRE_NEAR..FIRE_FAR 条带内；跳起（筋斗云，根抬高）躲过 */
export function fireBreathHits(foeX: number, foeFacing: 1 | -1, heroX: number, heroRootY: number): boolean {
  if (heroRootY > BASE_Y + JUMP_DODGE) return false;
  const dx = (heroX - foeX) * facingDirX(foeFacing); // 红孩儿面前为正
  return dx > FIRE_NEAR && dx < FIRE_FAR;
}

/** 演出覆盖姿势：双臂 FK + 倾身 + 击退/下沉（参考实现数值，经本项目 lean 约定换算） */
export interface PoseOverlay {
  frontFK: { u: number; e: number };
  rearFK: { u: number; e: number };
  lean: number;
  /** 击退位移量（米，沿背离攻击者方向加在 rootX 上） */
  knock: number;
  /** 根下沉（米，从 rootY 减） */
  dip: number;
  legFront: number | null;
  legRear: number | null;
}

/** 受击 flail：hitT 剩余 0.5→0，包络 sin（缓入缓出）；双臂乱舞 + 后仰 + 击退 */
export function flailPose(hitT: number): PoseOverlay {
  const e = Math.sin(Math.PI * Math.min(1, Math.max(0, hitT) / HIT_DUR));
  return {
    frontFK: { u: 120 * e + 15, e: 30 },
    rearFK: { u: -110 * e - 10, e: 25 },
    lean: 0.5 * e, // 后仰（胸 −0.175e，等效参考实现 bow −0.18e）
    knock: 0.1 * e,
    dip: 0,
    legFront: null,
    legRear: null,
  };
}

/** 败阵倒地：双臂瘫垂、躬身前倾、瘫坐（参考实现 bow 0.45 → 本项目 lean −1 等效胸 +0.35） */
export function defeatPose(): PoseOverlay {
  return {
    frontFK: { u: 8, e: 30 },
    rearFK: { u: -6, e: 25 },
    lean: -1,
    knock: 0,
    dip: 0.1,
    legFront: 0.7,
    legRear: -0.7,
  };
}

/** 胜利谢幕三段：vt 剩余 5.5→0；>4 亮相定格 / >2.6 躬身 / 其余挥手（挥手循环至谢幕结束） */
export function victoryPose(vt: number, t: number): PoseOverlay {
  if (vt > 4) {
    // 亮相定格：双臂高展
    return { frontFK: { u: 145, e: 20 }, rearFK: { u: -125, e: 25 }, lean: 0.4, knock: 0, dip: 0, legFront: null, legRear: null };
  }
  if (vt > 2.6) {
    // 躬身谢幕（参考实现 bow 0.35 → lean −1）
    return { frontFK: { u: 55, e: 60 }, rearFK: { u: -40, e: 50 }, lean: -1, knock: 0, dip: 0, legFront: null, legRear: null };
  }
  // 挥手（同导演 open 手势的挥动节奏）
  const w = Math.sin(t * 4.5);
  return {
    frontFK: { u: 148 + 12 * w, e: 20 + 16 * (0.5 + 0.5 * w) },
    rearFK: { u: -8, e: 20 },
    lean: 0.29,
    knock: 0,
    dip: 0,
    legFront: null,
    legRear: null,
  };
}

/** 把覆盖姿势写到控制量上（awayDir = 击退方向，世界系 ±1；无击退传 1 即可） */
function applyOverlay(c: PuppetControl, p: PoseOverlay, awayDir: 1 | -1): void {
  c.frontFK = p.frontFK;
  c.rearFK = p.rearFK;
  c.lean = p.lean;
  c.rootX += awayDir * p.knock;
  c.rootY -= p.dip;
  if (p.legFront != null) {
    c.legFront = p.legFront;
    c.legRear = p.legRear;
  }
}

/** 每帧判定/演出事件（main 据此播音效） */
export interface XiyouEvents {
  /** 悟空出招太鼓（本帧进入攻击拍峰值；null = 无） */
  drum: AttackKind | null;
  /** 红孩儿出招太鼓（第二只手操控时；小声） */
  foeDrum: AttackKind | null;
  /** 棒/拳脚命中红孩儿（锣） */
  foeHit: boolean;
  /** 三昧真火燎到悟空（锣·降调小声） */
  heroBurned: boolean;
  /** 红孩儿兵刃/拳脚打中悟空（锣·降调小声） */
  foeStruck: boolean;
  /** 喷火起始边沿（吼） */
  fireStart: boolean;
  /** 红孩儿 HP 归零败阵（双声降调大锣） */
  foeDied: boolean;
}

/** Xiyou.update 的每帧产出：红孩儿控制量 + 事件 + 装配标志位 */
export interface XiyouFrame {
  /** 红孩儿控制量（main 用 applyControl 应用到二号影人） */
  foe: PuppetControl;
  ev: XiyouEvents;
  /** 本帧双手握棒（main 在 hero puppet.update 后调 GoldenStaff.solveRearGrip） */
  grip: boolean;
  /** 金箍棒显隐（剑指持棒；受击/谢幕期间收棒） */
  staffHeld: boolean;
  /** 火尖枪显隐（红孩儿剑指持枪） */
  spearHeld: boolean;
  /** 本帧喷火中（main 从嘴部 emit 粒子） */
  fireActive: boolean;
  /** 喷火朝向（= 红孩儿面向） */
  fireFacing: 1 | -1;
}

/**
 * 西游玩法状态机：红孩儿控制路由（第二只手 / AI）+ 命中判定 + 演出覆盖层。
 * hero 控制量原地改写（main 随后照常 applyControl）；红孩儿控制量每帧新产出。
 */
export class Xiyou {
  foeHp = FOE_MAX_HP;

  private foeActor: PuppetActor; // 第二只手 → 红孩儿（与主角同一个状态机类）
  // ---- AI 状态 ----
  private aiX = AI_START_X;
  private aiMode: 'pace' | 'fire' | 'wave' = 'pace';
  private aiModeT = 0; // 当前模式已进行时间
  private aiNextFire = 2.2; // pace 模式距下次喷火
  private aiNextWave = 6; // pace 模式距下次亮相
  // ---- 演出/判定状态 ----
  private heroHitT = 0;
  private foeHitT = 0;
  private victoryT = 0;
  private heroLatch = false;
  private foeLatch = false;
  private prevFire = false;
  private jumpT = 0; // 筋斗云本地计时（导演 jump 状态边沿重启）
  private msg = '';
  private msgUntil = -1;

  /** @param foeArmReach 红孩儿臂展（米，传 foePuppet.armReach） */
  constructor(foeArmReach = 0.175) {
    this.foeActor = new PuppetActor(foeArmReach);
  }

  get foeDefeated(): boolean {
    return this.foeHp <= 0;
  }

  /** 筋斗云进度 0→1；不在跳跃返回 null（云隐藏） */
  get cloudP(): number | null {
    return this.jumpT > 0 ? 1 - this.jumpT / JUMP_DUR : null;
  }

  /**
   * 每帧更新。
   * @param hero  导演产出的悟空控制量（原地改写：受击/谢幕覆盖、握棒拍位 rearFK 置空）
   * @param second 导演的第二只手路由输出（active 时接管红孩儿）
   */
  update(dt: number, t: number, hero: PuppetControl, second: SecondRoleIntent): XiyouFrame {
    const ev: XiyouEvents = {
      drum: null,
      foeDrum: null,
      foeHit: false,
      heroBurned: false,
      foeStruck: false,
      fireStart: false,
      foeDied: false,
    };

    // ---------- 红孩儿基础控制：第二只手 > AI ----------
    let foe: PuppetControl;
    if (second.active && second.signal) {
      foe = this.foeActor.update(dt, t, second.signal);
      this.aiX = foe.rootX; // 手离镜后 AI 从当前位置无缝接管
    } else {
      foe = this.aiControl(dt, t, hero.rootX);
    }

    // ---------- 悟空出招：攻击拍峰值 + 面向 + 射程 → 红孩儿掉血 ----------
    if (this.victoryT <= 0 && this.heroHitT <= 0) {
      const atk = heroAttack(hero.state, t);
      if (atk && atk.power > PEAK) {
        if (!this.heroLatch) {
          this.heroLatch = true;
          ev.drum = atk.kind;
          if (
            !this.foeDefeated &&
            this.foeHitT <= 0 &&
            inRange(strikePoint(hero.rootX, hero.facing, atk.kind), foe.rootX, FOE_TOL)
          ) {
            this.foeHp -= 1;
            this.foeHitT = HIT_DUR;
            ev.foeHit = true;
            if (this.foeDefeated) {
              ev.foeDied = true;
              this.victoryT = VICTORY_DUR;
              this.aiMode = 'pace'; // 倒地后不再喷火
              this.setMsg('红孩儿败阵！悟空谢幕（r 键再战）', t);
            }
          }
        }
      } else if (!atk || atk.power < RELEASE) {
        this.heroLatch = false;
      }
    }

    // ---------- 红孩儿出招（第二只手：火尖枪/拳脚命中悟空；悟空不掉血，受击演出） ----------
    if (!this.foeDefeated && this.foeHitT <= 0 && second.active) {
      const atk = heroAttack(foe.state, t);
      if (atk && atk.power > PEAK) {
        if (!this.foeLatch) {
          this.foeLatch = true;
          ev.foeDrum = atk.kind;
          if (
            this.heroHitT <= 0 &&
            this.victoryT <= 0 &&
            inRange(strikePoint(foe.rootX, foe.facing, atk.kind), hero.rootX, HERO_TOL)
          ) {
            this.heroHitT = HIT_DUR;
            ev.foeStruck = true;
          }
        }
      } else if (!atk || atk.power < RELEASE) {
        this.foeLatch = false;
      }
    }

    // ---------- 三昧真火：第二只手张开 / AI 喷火拍（败阵与受击硬直期间熄火） ----------
    let fire = false;
    if (!this.foeDefeated && this.foeHitT <= 0) {
      fire = second.active ? second.gesture === 'open' : this.aiMode === 'fire';
    }
    if (fire && !this.prevFire) ev.fireStart = true;
    this.prevFire = fire;
    if (
      fire &&
      this.heroHitT <= 0 &&
      this.victoryT <= 0 &&
      fireBreathHits(foe.rootX, foe.facing, hero.rootX, hero.rootY)
    ) {
      this.heroHitT = HIT_DUR;
      ev.heroBurned = true;
      this.setMsg('悟空被三昧真火燎到！快提手跳起（筋斗云）躲火', t);
    }

    // ---------- 演出覆盖层：红孩儿（败阵 > 受击 > 喷火姿势） ----------
    if (this.foeDefeated) {
      applyOverlay(foe, defeatPose(), 1);
    } else if (this.foeHitT > 0) {
      this.foeHitT -= dt;
      applyOverlay(foe, flailPose(this.foeHitT), foe.rootX >= hero.rootX ? 1 : -1); // 远离悟空击退
    } else if (fire) {
      // 仰头喷火：双臂后张蓄力（参考实现 bow −0.12 → 本项目 lean 0.34 等效胸 −0.12）
      foe.frontFK = { u: 18, e: 25 };
      foe.rearFK = { u: -55, e: 30 };
      foe.lean = 0.34;
    }

    // ---------- 演出覆盖层：悟空（受击 > 胜利谢幕） ----------
    if (this.heroHitT > 0) {
      this.heroHitT -= dt;
      applyOverlay(hero, flailPose(this.heroHitT), hero.rootX >= foe.rootX ? 1 : -1); // 远离红孩儿击退
    } else if (this.victoryT > 0) {
      this.victoryT -= dt;
      applyOverlay(hero, victoryPose(this.victoryT, t), 1);
    }

    // ---------- 筋斗云进度（导演 jump 状态边沿重启本地计时） ----------
    if (hero.state === 'jump' && this.jumpT <= 0) this.jumpT = JUMP_DUR;
    if (this.jumpT > 0) this.jumpT -= dt;

    // ---------- 装配标志位 ----------
    const staffHeld = hero.state === 'staff' && this.heroHitT <= 0 && this.victoryT <= 0;
    const grip = staffHeld && twoHandGrip(t);
    if (grip) hero.rearFK = null; // 后手改走 IK：applyControl 先占位，update 后由 GoldenStaff 解到棒线
    return {
      foe,
      ev,
      grip,
      staffHeld,
      spearHeld: foe.state === 'staff' && !this.foeDefeated && this.foeHitT <= 0,
      fireActive: fire,
      fireFacing: foe.facing,
    };
  }

  /** 当前战报提示（过期自动清空） */
  notice(t: number): string {
    return t < this.msgUntil ? this.msg : '';
  }

  /** 对照表战斗状态行：红孩儿 HP / 控制来源 + 战报 */
  statusLine(secondActive: boolean, t: number): string {
    const parts: string[] = [];
    parts.push(this.foeDefeated ? '👹 红孩儿 败阵' : `👹 红孩儿 HP ${this.foeHp}/${FOE_MAX_HP}`);
    parts.push(secondActive ? '二手在镜' : 'AI 代打');
    const msg = this.notice(t);
    if (msg) parts.push(msg);
    else if (this.foeDefeated) parts.push('[r] 再战');
    return parts.join(' · ');
  }

  /** 重开（r 键）：红孩儿满血回场、演出/锁存/战报清零（金箍棒无需复位） */
  reset(): void {
    this.foeHp = FOE_MAX_HP;
    this.aiX = AI_START_X;
    this.aiMode = 'pace';
    this.aiModeT = 0;
    this.aiNextFire = 2.2;
    this.aiNextWave = 6;
    this.heroHitT = 0;
    this.foeHitT = 0;
    this.victoryT = 0;
    this.heroLatch = false;
    this.foeLatch = false;
    this.prevFire = false;
    this.jumpT = 0;
    this.msg = '';
    this.msgUntil = -1;
  }

  /** AI 控制量：面向悟空游走逼近，周期喷火，偶尔亮相（无第二只手时接管） */
  private aiControl(dt: number, t: number, heroX: number): PuppetControl {
    const facing: 1 | -1 = heroX < this.aiX ? 1 : -1; // facing 1 = 面向观众右 = 世界 -x

    // 模式切换（败阵后由 update 强制回 pace，这里只管正常循环）
    if (this.aiMode === 'pace') {
      this.aiNextFire -= dt;
      this.aiNextWave -= dt;
      if (this.aiNextFire <= 0 && Math.abs(heroX - this.aiX) < 0.85) {
        this.aiMode = 'fire';
        this.aiModeT = 0;
        this.aiNextFire = 2.6 + Math.abs(Math.sin(t * 7.3)) * 1.4; // 伪随机间隔
      } else if (this.aiNextWave <= 0) {
        this.aiMode = 'wave';
        this.aiModeT = 0;
        this.aiNextWave = 6.5 + Math.abs(Math.sin(t * 5.1)) * 3;
      }
    } else {
      this.aiModeT += dt;
      const dur = this.aiMode === 'fire' ? AI_FIRE_DUR : 1.3;
      if (this.aiModeT >= dur) {
        this.aiMode = 'pace';
        this.aiModeT = 0;
      }
    }

    // 游走：拉开对峙距离就逼近（喷火/亮相时站定）
    let moving = false;
    if (this.aiMode === 'pace') {
      const dx = heroX - this.aiX;
      if (Math.abs(dx) > AI_HOLD_DIST) {
        this.aiX += Math.sign(dx) * 0.12 * dt;
        moving = true;
      }
    }

    // 手臂：亮相 = 双臂高展挥手；其余 = 走路摆臂 / 待机呼吸（喷火姿势由覆盖层写）
    const b = Math.sin(t * 1.4);
    const legSwing = Math.sin(t * 7);
    let frontFK = moving
      ? { u: 24 + 20 * legSwing, e: 22 + 10 * Math.abs(legSwing) }
      : { u: 14 + b * 3, e: 18 };
    let rearFK = moving
      ? { u: 2 - 14 * legSwing, e: 20 + 9 * Math.abs(legSwing) }
      : { u: 2 - b * 2.5, e: 16 };
    let state: PuppetControl['state'] = moving ? 'walk' : 'idle';
    if (this.aiMode === 'wave') {
      const w = Math.sin(t * 4.5);
      frontFK = { u: 148 + 12 * w, e: 20 + 16 * (0.5 + 0.5 * w) };
      rearFK = { u: -122, e: 25 };
      state = 'wave';
    }

    return {
      active: true,
      state,
      gesture: 'none',
      facing,
      rootX: this.aiX,
      rootY: BASE_Y + (moving ? Math.abs(legSwing) * 0.012 : b * 0.006),
      depth: 0.15,
      lean: 0,
      frontFK,
      rearFK,
      frontTarget: { x: 0.03, y: -0.15 },
      rearTarget: { x: 0.03, y: -0.14 },
      legFront: moving ? 0.24 * legSwing : null,
      legRear: moving ? -0.22 * legSwing : null,
      moving,
    };
  }

  private setMsg(text: string, t: number): void {
    this.msg = text;
    this.msgUntil = t + MSG_DUR;
  }
}
