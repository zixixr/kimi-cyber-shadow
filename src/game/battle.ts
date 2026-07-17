// 武松打虎玩法层（M4）：玩法链状态机 + 命中判定。
// 玩法链（文档第 7 章，水浒原著还原）：
//   剑指持哨棒 → 哨棒打枯树两下 → 树倒棒断 → 剑指自动降级为拳脚 → 打虎 HP 归零伏诛。
// 命中判定：连招/器械「攻击拍的力度峰值」（strikeEnv 前 30% 爆发点的峰值时刻）
//   + 主角面向 + 射程（棒 0.5m / 拳脚 0.3m）。
// ⚠️ 耦合注意：导演（hand/director.ts，M3 冻结不改）内部用 strikeEnv 包络驱动
//   combo/staffRoutine 的 FK 动画，本模块用同一条曲线、同样的节拍常量推力度峰值，
//   COMBO_BEAT / STAFF_BEAT 必须与 director.ts 里的 BEAT 保持一致（改了要同步）。

import type { HeroState } from '../hand/director';
import type { HandSignal } from '../hand/source';

// ---------- 与导演同步的节拍常量（勿单独改）----------
const COMBO_BEAT = 0.55; // = director.ts PuppetActor.combo 的 BEAT
const STAFF_BEAT = 0.8; // = director.ts PuppetActor.staffRoutine 的 BEAT

// ---------- 命中判定常量（参考实现标定值）----------
export const REACH_STAFF = 0.5; // 哨棒射程（米）
export const REACH_FIST = 0.3; // 拳脚射程（米）
export const TREE_TOL = 0.32; // 打树容差（米）
export const FOE_TOL = 0.3; // 打虎容差（米）
const POUNCE_TOL = 0.3; // 虎扑命中主角的容差（米）
const PEAK = 0.82; // 力度峰值触发阈（上升沿）
const RELEASE = 0.3; // 锁存释放阈
const FLINCH_DUR = 0.45; // 主角被扑击退时长（秒）
const MSG_DUR = 4; // 战报提示驻留（秒）

/** 出招种类：拳脚（直拳/抡拳）/ 踢腿 / 哨棒 */
export type AttackKind = 'fist' | 'kick' | 'staff';

export interface AttackInfo {
  kind: AttackKind;
  /** 力度包络 [0,1]：>0.82 视为攻击拍峰值 */
  power: number;
}

/**
 * 打击包络：p∈[0,1]，前 30% 爆发、后 70% 缓收。
 * 与 director.ts 的 strikeEnv 同一条曲线（那边不导出，这里必须保持一致）。
 */
export function strikeEnv(p: number): number {
  return p < 0.3 ? Math.sin((p / 0.3) * (Math.PI / 2)) : Math.cos(((p - 0.3) / 0.7) * (Math.PI / 2));
}

/**
 * 由主角状态 + 全局时钟推当前出招力度（与导演内部包络同相：
 * 导演用同一个 t 算 w = t/BEAT，故相位天然对齐）。
 * 非攻击状态（走/跳/蹲/亮相等）返回 null。
 */
export function heroAttack(state: HeroState, t: number): AttackInfo | null {
  if (state === 'combo') {
    return { kind: Math.floor(t / COMBO_BEAT) % 4 === 2 ? 'kick' : 'fist', power: strikeEnv((t / COMBO_BEAT) % 1) };
  }
  if (state === 'staff') {
    return { kind: 'staff', power: strikeEnv((t / STAFF_BEAT) % 1) };
  }
  return null;
}

/** 命中点：主角根位置 + 面向 × 射程（facing 1 = 面向观众右 = 世界 -x） */
export function strikePoint(rootX: number, facing: 1 | -1, kind: AttackKind): number {
  const reach = kind === 'staff' ? REACH_STAFF : REACH_FIST;
  return rootX + (facing === 1 ? -1 : 1) * reach;
}

/** 命中点是否够到目标 */
export function inRange(strikeX: number, targetX: number, tol: number): boolean {
  return Math.abs(strikeX - targetX) < tol;
}

/** 棒断后剑指自动降级为拳脚：改写主角信号（导演/对照表随之自然同步） */
export function degradeSignals(signals: HandSignal[], staffBroken: boolean): HandSignal[] {
  if (!staffBroken) return signals;
  return signals.map((s, i) => (i === 0 && s.gesture === 'sword' ? { ...s, gesture: 'fist' } : s));
}

// ---------- 结构性接口（Tiger/Tree 天然满足，单测可用假对象）----------

/** 对手（老虎）：位置 / 状态 / 受击 */
export interface Foe {
  readonly alive: boolean;
  readonly position: number;
  readonly state: string; // 'pounce' = 扑击进行中
  readonly hp: number;
  readonly maxHp: number;
  hit(): void;
}

/** 枯树：位置 / 受击（第二击返回 true = 树倒） */
export interface TreeLike {
  readonly alive: boolean;
  readonly x: number;
  hit(): boolean;
}

/** 每帧判定结果（main 据此播音效 / 做演出） */
export interface BattleFrame {
  /** 出招太鼓（本帧进入攻击拍峰值；null = 无） */
  drum: AttackKind | null;
  /** 命中老虎（锣） */
  tigerHit: boolean;
  /** 打树断木音：light=第一下，broke=第二下（树倒棒断） */
  treeCrack: 'light' | 'broke' | null;
  /** 虎 HP 归零伏诛（双声降调大锣） */
  tigerDied: boolean;
  /** 虎扑命中主角（击退演出） */
  pounceHit: boolean;
}

/**
 * 玩法链状态机：攻击拍锁存、打树计数与棒断、虎 HP、主角被扑击退、战报提示。
 * 树倒棒断后 staffBroken=true —— main 用它改写信号（degradeSignals）+ 隐藏哨棒。
 */
export class Battle {
  staffBroken = false;
  private latch = false;
  private prevFoeAlive = true;
  private flinchT = 0;
  private flinchDir: 1 | -1 = 1;
  private msg = '';
  private msgUntil = -1;

  /**
   * 每帧判定。
   * @param atk   heroAttack() 的输出（主角状态非攻击时为 null）
   * @param heroX 主角台面位置（导演 rootX，含冲步）
   * @param facing 主角面向
   */
  update(dt: number, t: number, atk: AttackInfo | null, heroX: number, facing: 1 | -1, foe: Foe | null, tree: TreeLike | null): BattleFrame {
    const out: BattleFrame = { drum: null, tigerHit: false, treeCrack: null, tigerDied: false, pounceHit: false };

    // 出招：攻击拍力度峰值（上升沿锁存，power 回落 <0.3 才释放，防一拍多判）
    if (atk && atk.power > PEAK) {
      if (!this.latch) {
        this.latch = true;
        out.drum = atk.kind;
        const sx = strikePoint(heroX, facing, atk.kind);
        if (atk.kind === 'staff' && !this.staffBroken && tree?.alive && inRange(sx, tree.x, TREE_TOL)) {
          // 哨棒优先打树（树在场上更近场边）：第二下树倒棒断
          const fell = tree.hit();
          out.treeCrack = fell ? 'broke' : 'light';
          if (fell) {
            this.staffBroken = true;
            this.setMsg('哨棒打在枯树上，断了！只能赤手空拳了（水浒名场面）', t);
          }
        } else if (foe?.alive && inRange(sx, foe.position, FOE_TOL)) {
          foe.hit();
          out.tigerHit = true;
        }
      }
    } else if (!atk || atk.power < RELEASE) {
      this.latch = false;
    }

    // 虎扑命中主角：击退演出（伏诛后不再扑）
    out.pounceHit = false;
    if (foe?.alive && foe.state === 'pounce' && inRange(foe.position, heroX, POUNCE_TOL) && this.flinchT <= 0) {
      this.flinchT = FLINCH_DUR;
      this.flinchDir = heroX >= foe.position ? 1 : -1;
      out.pounceHit = true;
    }
    this.flinchT = Math.max(0, this.flinchT - dt);

    // 伏诛边沿（HP 归零的瞬间一次）
    if (foe) {
      if (this.prevFoeAlive && !foe.alive) {
        out.tigerDied = true;
        this.setMsg('虎已伏诛！武松谢幕（r 键再战）', t);
      }
      this.prevFoeAlive = foe.alive;
    }
    return out;
  }

  /** 主角被扑的击退偏移：世界系 dx（远离虎）+ 倾身；无击退时为 0 */
  flinch(): { dx: number; lean: number } {
    if (this.flinchT <= 0) return { dx: 0, lean: 0 };
    const p = 1 - this.flinchT / FLINCH_DUR;
    const e = Math.sin(Math.PI * p);
    return { dx: this.flinchDir * 0.06 * e, lean: this.flinchDir * 0.5 * e };
  }

  /** 当前战报提示（过期自动清空） */
  notice(t: number): string {
    return t < this.msgUntil ? this.msg : '';
  }

  /** 对照表战斗状态行：虎 HP / 哨棒 / 枯树 + 战报 */
  statusLine(foe: Foe | null, tree: TreeLike | null, t: number): string {
    const parts: string[] = [];
    if (foe) parts.push(foe.alive ? `🐯 HP ${foe.hp}/${foe.maxHp}` : '🐯 已伏诛');
    parts.push(this.staffBroken ? '棒 已断' : '棒 在手');
    if (tree) parts.push(tree.alive ? '树 立' : '树 已倒');
    const msg = this.notice(t);
    if (msg) parts.push(msg);
    else if (foe && !foe.alive) parts.push('[r] 再战');
    return parts.join(' · ');
  }

  /** 重开（r 键）：棒修好、锁存/击退/战报清零（老虎/树的复位由各自 revive/reset 完成） */
  reset(): void {
    this.staffBroken = false;
    this.latch = false;
    this.prevFoeAlive = true;
    this.flinchT = 0;
    this.msg = '';
    this.msgUntil = -1;
  }

  private setMsg(text: string, t: number): void {
    this.msg = text;
    this.msgUntil = t + MSG_DUR;
  }
}
