// 开场报幕时序单测：纯函数 openingTimeline（全暗 → 渐亮 → 锣/字幕 → 淡出结束）

import { describe, expect, it } from 'vitest';
import { openingTimeline } from './opening';

describe('openingTimeline（开场报幕时序）', () => {
  it('0~0.6s 全暗；0.6s 起 1.2s 渐亮到原值并保持', () => {
    expect(openingTimeline(0).dim).toBe(0);
    expect(openingTimeline(0.59).dim).toBe(0);
    expect(openingTimeline(1.2).dim).toBeCloseTo(0.5, 5); // 0.6 亮起后走了一半
    expect(openingTimeline(1.8).dim).toBe(1);
    expect(openingTimeline(3).dim).toBe(1);
  });

  it('亮起前无锣无字幕；亮起后字幕停留 2.4s，随后 0.6s 淡出', () => {
    expect(openingTimeline(0.3).gong).toBe(false);
    expect(openingTimeline(0.3).card).toBe(0);
    expect(openingTimeline(0.6).gong).toBe(true);
    expect(openingTimeline(0.6).card).toBe(0); // 淡入起点
    expect(openingTimeline(1.5).card).toBe(1); // 停留期
    expect(openingTimeline(3.0).card).toBe(1); // 停留期末（0.6 + 2.4）
    expect(openingTimeline(3.3).card).toBeCloseTo(0.5, 5); // 淡出中点
    expect(openingTimeline(3.6).card).toBe(0);
  });

  it('字幕淡出完报幕结束；此前 done=false', () => {
    expect(openingTimeline(0).done).toBe(false);
    expect(openingTimeline(3.59).done).toBe(false);
    expect(openingTimeline(3.6).done).toBe(true);
    expect(openingTimeline(10).done).toBe(true);
  });
});
