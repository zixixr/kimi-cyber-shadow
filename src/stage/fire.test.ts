// 三昧真火渐变单测：fireGradient 纯函数（粒子本体依赖 WebGL，不在单测范围）。

import { describe, expect, it } from 'vitest';
import { fireGradient } from './fire';

describe('fireGradient（火焰色随寿命渐变）', () => {
  it('初生亮黄白、熄灭纯黑（加色混合下黑=消失）', () => {
    const [r1, g1, b1] = fireGradient(1);
    expect(r1).toBe(1);
    expect(g1).toBeGreaterThan(0.8); // 黄白
    expect(b1).toBeGreaterThan(0.3);
    expect(fireGradient(0)).toEqual([0, 0, 0]);
  });
  it('寿命越短越暗（橙红段单调衰减）', () => {
    const hi = fireGradient(0.8);
    const mid = fireGradient(0.5);
    const lo = fireGradient(0.15);
    expect(mid[1]).toBeLessThan(hi[1]); // 绿通道降 → 由黄转红
    expect(lo[0]).toBeLessThan(mid[0]); // 红通道降 → 熄灭
  });
  it('超界输入钳制', () => {
    expect(fireGradient(2)).toEqual(fireGradient(1));
    expect(fireGradient(-1)).toEqual(fireGradient(0));
  });
});
