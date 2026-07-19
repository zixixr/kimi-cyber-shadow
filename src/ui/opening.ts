// 开场报幕：场景资产加载完后播一次——幕全暗 0.6s → 灯 1.2s 渐亮 → 一声锣 +
// 皮影风字幕牌（描金边框深色底）停留 2.4s 后淡出 → 开演。
// 报幕期间 main 主循环用 opening.done 门闩挂起导演/手势输入（手势帧丢弃，防开演瞬移）；
// r 重开不重播（Opening 只建一次），c 换幕整页重载天然重播。
// 时序是纯函数 openingTimeline（单测覆盖），本类只负责把它落到灯/幕布/字幕 DOM 上。

import type { Sfx } from '../audio/sfx';
import type { Theater } from '../stage/theater';

// ---- 时序常量（秒）----
const BLACK = 0.6; // 全暗停留
const RISE = 1.2; // 灯渐亮（0→原值）
const CARD_IN = 0.25; // 字幕牌淡入
const CARD_HOLD = 2.4; // 字幕牌停留（自亮起/锣响起算）
const CARD_FADE = 0.6; // 字幕牌淡出

/** 报幕时间线：t = 报幕开始后的秒数 */
export interface OpeningFrame {
  /** 灯/幕布调光比 0（全暗）→1（原值） */
  dim: number;
  /** 字幕牌不透明度 0~1 */
  card: number;
  /** 是否已到锣响时刻（亮起瞬间） */
  gong: boolean;
  /** 报幕全部结束（字幕淡出完） */
  done: boolean;
}

/** 纯时序：全暗 BLACK → RISE 渐亮（亮起时锣+字幕）→ 字幕 CARD_HOLD 后 CARD_FADE 淡出 */
export function openingTimeline(t: number): OpeningFrame {
  const dim = t < BLACK ? 0 : Math.min(1, (t - BLACK) / RISE);
  const ct = t - BLACK; // 字幕/锣的时间轴：亮起瞬间为 0
  const card = ct < 0 ? 0 : ct < CARD_IN ? ct / CARD_IN : ct < CARD_HOLD ? 1 : Math.max(0, 1 - (ct - CARD_HOLD) / CARD_FADE);
  return {
    dim,
    card,
    gong: t >= BLACK,
    done: t >= BLACK + CARD_HOLD + CARD_FADE,
  };
}

export interface OpeningOptions {
  theater: Theater; // 调 lampDim 压暗/渐亮点光源
  dimUniform: { value: number }; // 幕布 shader 的 dim（projection.screenMaterial.uniforms.dim）
  sfx: Sfx; // 亮起时一声锣
  title: string; // 字幕牌剧名（「武松打虎 · 景阳冈」/「孙悟空大战红孩儿 · 火云洞」）
}

export class Opening {
  /** 报幕结束（main 主循环门闩：false 期间挂起导演/手势输入） */
  done = false;

  private t = 0;
  private gongPlayed = false;
  private opts: OpeningOptions;
  private card: HTMLDivElement;

  constructor(opts: OpeningOptions) {
    this.opts = opts;
    this.opts.theater.lampDim = 0;
    this.opts.dimUniform.value = 0;

    // 皮影风字幕牌：深色底 + 描金双框，居中
    this.card = document.createElement('div');
    this.card.textContent = opts.title;
    this.card.style.cssText =
      'position:fixed;left:50%;top:44%;transform:translate(-50%,-50%);z-index:15;' +
      'padding:20px 46px;background:rgba(12,9,6,0.9);' +
      'border:2px solid #c8a05a;outline:1px solid #c8a05a88;outline-offset:6px;' +
      'color:#f5e8d0;font:30px/1.3 "Songti SC","Noto Serif SC",serif;' +
      'letter-spacing:0.32em;text-indent:0.32em;white-space:nowrap;' +
      'text-shadow:0 0 14px rgba(200,160,90,0.45);pointer-events:none;opacity:0';
    document.body.appendChild(this.card);
  }

  /** 每帧推进报幕时序（done 后调用无副作用） */
  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    const f = openingTimeline(this.t);
    this.opts.theater.lampDim = f.dim;
    this.opts.dimUniform.value = f.dim;
    this.card.style.opacity = String(f.card);
    if (f.gong && !this.gongPlayed) {
      this.gongPlayed = true;
      // 注意：浏览器自动播放策略下，首次用户交互前锣可能无声（AudioContext 未解锁）
      this.opts.sfx.play('gong', { volume: 0.9, rate: 0.9 });
    }
    if (f.done) {
      this.done = true;
      this.card.remove();
      this.opts.theater.lampDim = 1;
      this.opts.dimUniform.value = 1;
    }
  }
}
