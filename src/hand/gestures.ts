// 手势分类（关键点 → 离散手势）。文档 6.3 三条铁律全部落在此文件：
//  ① 比率分母 = 掌长（腕→中指根「单段」距离），绝不用整手包围盒——
//     握合时包围盒缩水 → 所有比率失真 → 一直被误判成握拳（付过学费）。
//  ② 握拳粘滞（迟滞）：进入阈值（四指比率全 <1.12）比退出（<1.32）更严，
//     再加 0.12s 去抖，避免自然半握与握拳之间来回抖动。
//  ③ 深度基准 = 掌长：手入镜稳定 0.4s 后才锁基线（半入镜尺寸偏小会误标定），
//     锁定后基线缓慢自适应漂移（吸收坐姿漂移，不吞掉刻意前推）。
// 解剖学参考：伸直指尖-腕 ≈ 1.6~1.9×掌长，攥紧 ≈ 0.8~1.1×掌长。
// 本文件只有纯函数/纯类，无 three / DOM 依赖，可单测（gestures.test.ts）。

import {
  INDEX_MCP,
  INDEX_TIP,
  MIDDLE_MCP,
  MIDDLE_TIP,
  PINKY_TIP,
  RING_TIP,
  THUMB_TIP,
  WRIST,
} from './mapping';

/** 归一化 2D 点（本文件只做距离比率，与坐标系/镜像/单位无关） */
export interface Lm {
  x: number;
  y: number;
}

/** 离散手势（文档 6.2 手势表） */
export type Gesture = 'none' | 'open' | 'fist' | 'sword' | 'point' | 'thumb';

/** 各指伸展比率：指尖-腕距离 ÷ 掌长（攥紧≈0.8~1.1，伸直≈1.6~1.9） */
export interface FingerRatios {
  /** 拇指是否外伸（握拳时拇指贴掌 → false） */
  thumbExt: boolean;
  index: number;
  middle: number;
  ring: number;
  pinky: number;
}

/** 握拳进入阈值：四指比率全 < 1.12 才进入（比退出严，铁律②） */
export const FIST_ENTER = 1.12;
/** 握拳退出阈值：已在握拳时放宽到 1.32（迟滞带宽 0.2，防抖动） */
export const FIST_EXIT = 1.32;
/** 手势去抖时长（秒，铁律②） */
export const DEBOUNCE_SEC = 0.12;
/** 深度基线稳定时长（秒，铁律③）：入镜后需稳定这么久才锁基线 */
export const DEPTH_LOCK_SEC = 0.4;

const dist = (a: Lm, b: Lm) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 掌长 = 腕→中指根的单段距离（铁律①的比率分母、铁律③的深度基准）。
 * 关键性质：不随手指握合/伸展变化，所以握拳头时比率不失真。
 */
export function palmLength(lm: Lm[]): number {
  return dist(lm[WRIST], lm[MIDDLE_MCP]) || 1e-3;
}

/** 21 关键点 → 五指伸展比率 */
export function fingerRatios(lm: Lm[]): FingerRatios {
  const palm = palmLength(lm);
  const w = lm[WRIST];
  return {
    // 拇指伸展不看「指尖-腕」长度（拇指本就短），看拇指尖离食指根的距离：
    // 握拳时拇指贴掌距离近，竖起时明显远离
    thumbExt: dist(lm[THUMB_TIP], lm[INDEX_MCP]) / palm > 0.55,
    index: dist(lm[INDEX_TIP], w) / palm,
    middle: dist(lm[MIDDLE_TIP], w) / palm,
    ring: dist(lm[RING_TIP], w) / palm,
    pinky: dist(lm[PINKY_TIP], w) / palm,
  };
}

/**
 * 比率 → 手势分类。
 * @param current 当前手势（去抖后），用于握拳迟滞：已在握拳时退出门槛放宽。
 * 判定尽量用手指间的相对比较（对手到摄像头距离/朝向鲁棒）。
 */
export function classify(f: FingerRatios, current: Gesture): Gesture {
  const four = [f.index, f.middle, f.ring, f.pinky];
  const nStraight = four.filter((v) => v > 1.45).length;

  // 握拳粘滞：进入用 FIST_ENTER，已在握拳退出用 FIST_EXIT（铁律②）
  const cap = current === 'fist' ? FIST_EXIT : FIST_ENTER;
  if (four.every((v) => v < cap)) return f.thumbExt ? 'thumb' : 'fist';

  if (nStraight >= 3) return 'open';
  // 剑指：食+中指伸直，无名指/小指屈回
  if (f.index > 1.42 && f.middle > 1.42 && f.ring < 1.3 && f.pinky < 1.35) return 'sword';
  // 单伸食指：食指显著长于中指/无名指（相对比较，鲁棒）
  if (f.index > 1.35 && f.index > f.middle * 1.22 && f.index > f.ring * 1.22) return 'point';
  if (four.every((v) => v < 1.2) && f.thumbExt) return 'thumb';
  return 'none';
}

/** 手势去抖：候选手势需持续 holdSec 才生效（铁律②的 0.12s） */
export class GestureDebouncer {
  private current: Gesture = 'none';
  private candidate: Gesture = 'none';
  private since = 0;
  private holdSec: number;

  constructor(holdSec = DEBOUNCE_SEC) {
    this.holdSec = holdSec;
  }

  get value(): Gesture {
    return this.current;
  }

  update(raw: Gesture, t: number): Gesture {
    if (raw === this.current) {
      this.candidate = raw;
      return this.current;
    }
    if (raw !== this.candidate) {
      this.candidate = raw;
      this.since = t;
    }
    if (t - this.since >= this.holdSec) this.current = this.candidate;
    return this.current;
  }
}

/**
 * 深度基线（铁律③）：判断影人远近（靠近灯放大）用掌长对比基线。
 * 手入镜后需稳定 0.4s 才锁定基线（半入镜时尺寸偏小，立刻锁会误标定）；
 * 锁定后小偏差时基线缓慢漂移（吸收坐姿前后挪，但不吞掉刻意的前推手）。
 * 离镜超过 0.5s 视为重新入镜，基线作废重锁。
 */
export class DepthBaseline {
  private neutral = 0; // 锁定的基线掌长；0 = 尚未锁定
  private ema = 0; // 锁定前掌长的指数均值
  private stableT = 0; // 连续稳定时长（秒）
  private seenLast = -1; // 上次见到手的时间戳

  /** 每帧喂入掌长（归一化单位），返回进深 depth ∈ [0,1]（0=贴幕 1=近灯） */
  update(palmLen: number, t: number): number {
    if (t - this.seenLast > 0.5) {
      this.neutral = 0;
      this.stableT = 0;
      this.ema = palmLen;
    }
    this.seenLast = t;

    if (this.neutral === 0) {
      // 未锁定：偏差 <6% 持续 0.4s 才锁；期间深度固定中位 0.15，手一入镜不瞬移
      const dev = Math.abs(palmLen - this.ema) / (this.ema || 1e-3);
      this.ema += (palmLen - this.ema) * 0.25;
      this.stableT = dev < 0.06 ? this.stableT + 1 / 30 : 0;
      if (this.stableT > DEPTH_LOCK_SEC) this.neutral = this.ema;
      return 0.15;
    }

    // 掌长越大 = 手越近 = 影人越近灯（增益 2.2：±45% 掌长变化铺满全行程）
    const depth = Math.min(1, Math.max(0, 0.15 + (palmLen / this.neutral - 1) * 2.2));
    // 缓慢自适应漂移：只在小偏差时跟随（每帧 0.2%）
    if (Math.abs(depth - 0.15) < 0.12) this.neutral += (palmLen - this.neutral) * 0.002;
    return depth;
  }
}
