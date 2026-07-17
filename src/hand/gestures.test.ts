// 手势识别铁律单测（文档 6.3）：分母=掌长、握拳迟滞+去抖、深度基线稳定后才锁。

import { describe, expect, it } from 'vitest';
import {
  classify,
  DepthBaseline,
  FIST_ENTER,
  FIST_EXIT,
  fingerRatios,
  GestureDebouncer,
  palmLength,
  type FingerRatios,
  type Gesture,
  type Lm,
} from './gestures';

/** 快捷构造比率：默认四指攥紧（0.9×掌长） */
function ratios(p: Partial<FingerRatios> = {}): FingerRatios {
  return { thumbExt: false, index: 0.9, middle: 0.9, ring: 0.9, pinky: 0.9, ...p };
}

/** 合成 21 点手：腕在原点，中指根在 (0,1)（掌长=1），指尖按给定距离放在 +y */
function makeHand(tips: { index?: number; middle?: number; ring?: number; pinky?: number; thumbToIndexMcp?: number }): Lm[] {
  const lm: Lm[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  lm[0] = { x: 0, y: 0 }; // 腕
  lm[5] = { x: 0.3, y: 0.9 }; // 食指根
  lm[9] = { x: 0, y: 1 }; // 中指根（掌长锚点）
  lm[8] = { x: 0, y: tips.index ?? 0.9 };
  lm[12] = { x: 0, y: tips.middle ?? 0.9 };
  lm[16] = { x: 0, y: tips.ring ?? 0.9 };
  lm[20] = { x: 0, y: tips.pinky ?? 0.9 };
  const d = tips.thumbToIndexMcp ?? 0.3;
  lm[4] = { x: 0.3 + d, y: 0.9 }; // 拇指尖：离食指根 d
  return lm;
}

describe('铁律①：比率分母 = 掌长（腕→中指根单段）', () => {
  it('掌长只依赖腕与中指根，不随握合变化', () => {
    const open = makeHand({ index: 1.8, middle: 1.85, ring: 1.7, pinky: 1.5 });
    const fist = makeHand({}); // 全攥
    expect(palmLength(open)).toBeCloseTo(1, 6);
    expect(palmLength(fist)).toBeCloseTo(1, 6);
  });

  it('fingerRatios：伸直≈1.8，攥紧≈0.9', () => {
    const r = fingerRatios(makeHand({ index: 1.8 }));
    expect(r.index).toBeCloseTo(1.8, 6);
    expect(r.middle).toBeCloseTo(0.9, 6);
  });
});

describe('classify 手势分类', () => {
  it('五指全伸 → open', () => {
    expect(classify(ratios({ index: 1.7, middle: 1.75, ring: 1.7, pinky: 1.55 }), 'none')).toBe('open');
  });
  it(`四指全 < ${FIST_ENTER} → fist`, () => {
    expect(classify(ratios(), 'none')).toBe('fist');
  });
  it('食+中指伸、无名小指屈 → sword', () => {
    expect(classify(ratios({ index: 1.6, middle: 1.65, ring: 1.1, pinky: 1.0 }), 'none')).toBe('sword');
  });
  it('单伸食指（显著长于中指） → point', () => {
    expect(classify(ratios({ index: 1.6, middle: 1.1, ring: 1.0 }), 'none')).toBe('point');
  });
  it('攥紧但拇指外伸 → thumb', () => {
    expect(classify(ratios({ thumbExt: true }), 'none')).toBe('thumb');
  });
  it('自然半握（1.2 左右）不是握拳：落在 none（铁律②防误闯）', () => {
    expect(classify(ratios({ index: 1.2, middle: 1.2, ring: 1.15, pinky: 1.05 }), 'none')).toBe('none');
  });
});

describe(`铁律②：握拳迟滞（进 <${FIST_ENTER} / 退 <${FIST_EXIT}）+ 去抖`, () => {
  it('已在 fist：比率升到迟滞带内（1.2）仍是 fist', () => {
    expect(classify(ratios({ index: 1.2, middle: 1.2, ring: 1.1, pinky: 1.0 }), 'fist')).toBe('fist');
  });
  it(`已在 fist：比率全部 > ${FIST_EXIT} 才退出（四指全伸 → open）`, () => {
    expect(classify(ratios({ index: 1.5, middle: 1.5, ring: 1.5, pinky: 1.5 }), 'fist')).toBe('open');
  });
  it('去抖：候选持续 0.12s 才生效，瞬时不切', () => {
    const d = new GestureDebouncer();
    let g: Gesture = d.update('open', 0);
    expect(g).toBe('none');
    g = d.update('open', 0.05);
    expect(g).toBe('none');
    g = d.update('open', 0.13);
    expect(g).toBe('open');
  });
  it('去抖：候选中途变回则重新计时', () => {
    const d = new GestureDebouncer();
    d.update('fist', 0);
    d.update('fist', 0.05);
    d.update('none', 0.08); // 候选打断
    const g = d.update('fist', 0.13); // 重新成为候选，才 0.05s
    expect(g).toBe('none');
  });
});

describe('铁律③：深度基线稳定 0.4s 后才锁 + 缓慢漂移', () => {
  it('未稳定前深度固定 0.15，稳定后前推掌长变大 → depth 增大', () => {
    const b = new DepthBaseline();
    // 30fps 恒定掌长 0.1：0.4s 内全部返回中位 0.15
    for (let i = 0; i <= 10; i++) expect(b.update(0.1, i / 30)).toBe(0.15);
    // 喂满 0.5s → 基线锁定
    for (let i = 11; i <= 15; i++) b.update(0.1, i / 30);
    // 掌长 ×1.5 → depth = 0.15 + 0.5×2.2 = 1.25 → 钳到 1
    expect(b.update(0.15, 16 / 30)).toBe(1);
  });

  it('小偏差只小幅移动（基线缓慢漂移，不吞前推）', () => {
    const b = new DepthBaseline();
    for (let i = 0; i <= 15; i++) b.update(0.1, i / 30);
    const d = b.update(0.102, 16 / 30); // +2% 掌长
    expect(d).toBeGreaterThan(0.15);
    expect(d).toBeLessThan(0.25);
  });

  it('离镜 >0.5s 重新入镜 → 基线作废重锁（深度回到 0.15）', () => {
    const b = new DepthBaseline();
    for (let i = 0; i <= 15; i++) b.update(0.1, i / 30);
    expect(b.update(0.2, 16 / 30)).toBeGreaterThan(0.5); // 已锁定，大手 → 近灯
    expect(b.update(0.2, 16 / 30 + 1.0)).toBe(0.15); // 隔 1s → 重新标定中
  });
});
