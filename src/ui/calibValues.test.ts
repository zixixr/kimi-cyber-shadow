// 标定参数中心单测：默认值 = 代码常量（MOUTH_OFF/GRIP_DIST）、localStorage 合并/持久化、
// 损坏存档回退、reset 恢复默认且保持单例引用（main/Tuner 持有的引用不失效）。
// node 环境无 localStorage：用 vi.stubGlobal 装假存储；vi.resetModules 让每测拿到新单例。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOUTH_OFF } from '../game/xiyou';
import { GRIP_DIST } from '../stage/goldenstaff';

/** 最小 localStorage 替身（只实现标定模块用到的 get/set） */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) ?? null) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

/** 重置模块表后重新 import（拿新单例），可选注入假 localStorage */
async function fresh(store?: ReturnType<typeof fakeStorage>) {
  vi.resetModules();
  vi.unstubAllGlobals();
  if (store) vi.stubGlobal('localStorage', store);
  return import('./calibValues');
}

afterEach(() => vi.unstubAllGlobals());

describe('calibValues（拖点标定参数中心）', () => {
  it('默认值 = 代码固化常量（MOUTH_OFF / GRIP_DIST），无 localStorage 也回退默认', async () => {
    const m = await fresh(); // node 环境无 localStorage
    const c = m.loadCalib();
    expect(c.mouth).toEqual({ x: MOUTH_OFF.x, y: MOUTH_OFF.y });
    expect(c.grip).toBe(GRIP_DIST);
    expect(c.headOff).toEqual({ x: 0, y: 0 });
    expect(c.armScale).toBe(1);
    expect(c.legScale).toBe(1);
    expect(c).toEqual(m.defaultCalib());
  });

  it('读档：localStorage 部分字段覆盖默认，嵌套 mouth/headOff 逐键合并', async () => {
    const store = fakeStorage({
      'cyber-shadow.calib.v1': JSON.stringify({ grip: 0.09, mouth: { x: 0.06 } }),
    });
    const m = await fresh(store);
    const c = m.loadCalib();
    expect(c.grip).toBe(0.09);
    expect(c.mouth).toEqual({ x: 0.06, y: MOUTH_OFF.y }); // 缺省键回落默认
    expect(c.armScale).toBe(1); // 未存字段保持默认
  });

  it('存档损坏（非法 JSON）→ 回退默认不抛错', async () => {
    const store = fakeStorage({ 'cyber-shadow.calib.v1': '{oops' });
    const m = await fresh(store);
    expect(m.loadCalib()).toEqual(m.defaultCalib());
  });

  it('save + reset：改动持久化；reset 恢复默认并保持同一单例引用', async () => {
    const store = fakeStorage();
    const m = await fresh(store);
    const c = m.loadCalib();
    c.grip = 0.12;
    c.armScale = 0.8;
    m.saveCalib(c);
    expect(JSON.parse(store.map.get('cyber-shadow.calib.v1') ?? '{}')).toMatchObject({
      grip: 0.12,
      armScale: 0.8,
    });
    const r = m.resetCalib();
    expect(r).toBe(c); // 原地改写：main/Tuner 持有的引用即时生效
    expect(c).toEqual(m.defaultCalib());
    expect(JSON.parse(store.map.get('cyber-shadow.calib.v1') ?? '{}')).toMatchObject({ grip: GRIP_DIST });
  });
});
