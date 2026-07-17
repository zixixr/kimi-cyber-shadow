// IK 求解器单测。约定：肩在原点，屏幕系 y 向下，角度为各段相对 +X 轴的绝对角（弧度）。

import { describe, expect, it } from 'vitest';
import { ANNULUS_IN, ANNULUS_OUT, chooseElbowSign, solveTwoBone } from './ik';

/** 正解：把求解结果代回，算手部（末端）位置 */
function fk(L1: number, L2: number, shoulder: number, elbow: number) {
  const ex = L1 * Math.cos(shoulder);
  const ey = L1 * Math.sin(shoulder);
  return { x: ex + L2 * Math.cos(elbow), y: ey + L2 * Math.sin(elbow) };
}

/** 肘尖位置（大小臂连接处） */
function elbowPos(L1: number, shoulder: number) {
  return { x: L1 * Math.cos(shoulder), y: L1 * Math.sin(shoulder) };
}

describe('solveTwoBone', () => {
  it('可达目标：正解回代误差 < 1e-6（两个肘向都成立）', () => {
    const target = { x: 0.9, y: 0.7 };
    for (const sign of [1, -1] as const) {
      const r = solveTwoBone(1, 1, target, sign);
      const p = fk(1, 1, r.shoulder, r.elbow);
      expect(Math.hypot(p.x - target.x, p.y - target.y)).toBeLessThan(1e-6);
    }
  });

  it('环带钳制：过远目标被钳到 0.97×臂展，方向不变', () => {
    const r = solveTwoBone(1, 1, { x: 5, y: 0 }, 1);
    const p = fk(1, 1, r.shoulder, r.elbow);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(2 * ANNULUS_OUT, 6);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.x).toBeGreaterThan(0); // 沿目标方向
  });

  it('环带钳制：斜向过远目标按比例钳到环带外缘', () => {
    const target = { x: 3, y: 4 }; // 半径 5，方向 (0.6, 0.8)
    const r = solveTwoBone(1, 1, target, -1);
    const p = fk(1, 1, r.shoulder, r.elbow);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(2 * ANNULUS_OUT, 6);
    expect(p.x).toBeCloseTo(2 * ANNULUS_OUT * 0.6, 6);
    expect(p.y).toBeCloseTo(2 * ANNULUS_OUT * 0.8, 6);
  });

  it('环带钳制：过近目标被钳到 0.35×臂展', () => {
    const r = solveTwoBone(1, 1, { x: 0.05, y: 0 }, 1);
    const p = fk(1, 1, r.shoulder, r.elbow);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(2 * ANNULUS_IN, 6);
  });

  it('退化共线：目标压在肩原点（方向无定义）不 NaN，落到环带内缘', () => {
    const r = solveTwoBone(1, 1, { x: 0, y: 0 }, 1);
    expect(Number.isFinite(r.shoulder)).toBe(true);
    expect(Number.isFinite(r.elbow)).toBe(true);
    const p = fk(1, 1, r.shoulder, r.elbow);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(2 * ANNULUS_IN, 6);
  });

  it('退化共线：目标恰在环带外缘（全伸直边界）角连续无跳变', () => {
    const r = solveTwoBone(1, 1, { x: 2 * ANNULUS_OUT, y: 0 }, 1);
    const p = fk(1, 1, r.shoulder, r.elbow);
    expect(p.x).toBeCloseTo(2 * ANNULUS_OUT, 6);
    expect(p.y).toBeCloseTo(0, 6);
    // 环带外缘保留约 28° 残余折弯（钳制的目的：全伸直退化解不存在），但应明显小于 90°
    expect(Math.abs(r.elbow - r.shoulder)).toBeLessThan(0.6);
  });

  it('elbowSign 翻转肘弯方向：两解肘尖分居目标线两侧', () => {
    const t = { x: 1.2, y: 0.5 };
    const a = solveTwoBone(1, 1, t, 1);
    const b = solveTwoBone(1, 1, t, -1);
    const ea = elbowPos(1, a.shoulder);
    const eb = elbowPos(1, b.shoulder);
    // 目标线叉积符号相反 = 分居两侧
    const crossA = t.x * ea.y - t.y * ea.x;
    const crossB = t.x * eb.y - t.y * eb.x;
    expect(Math.sign(crossA)).not.toBe(Math.sign(crossB));
  });
});

describe('chooseElbowSign（肘永远朝身后 + 迟滞）', () => {
  it('选肘尖更靠后（+x）的解', () => {
    const t = { x: 0.5, y: 0.9 };
    const sign = chooseElbowSign(1, 1, t, 1);
    const chosen = solveTwoBone(1, 1, t, sign);
    const other = solveTwoBone(1, 1, t, -sign as 1 | -1);
    expect(elbowPos(1, chosen.shoulder).x).toBeGreaterThan(elbowPos(1, other.shoulder).x);
  });

  it('与 prev 无关地稳定选解：同一目标给 1/-1 都收敛到同一解', () => {
    const t = { x: 0.3, y: -1.0 };
    expect(chooseElbowSign(1, 1, t, 1)).toBe(chooseElbowSign(1, 1, t, -1));
  });

  it('迟滞：两解肘尖 x 几乎相同（目标在 ±x 轴上）时维持 prev', () => {
    // 目标沿 +x 水平：两解关于 x 轴镜像，肘尖 x 相等 → 奇异方向
    const t = { x: 1.2, y: 0 };
    expect(chooseElbowSign(1, 1, t, 1)).toBe(1);
    expect(chooseElbowSign(1, 1, t, -1)).toBe(-1);
  });

  it('迟滞：扫过奇异方向时不来回跳（离开后才切换）', () => {
    // 从 y>0 缓慢扫到 y<0 穿过 x 轴，穿轴瞬间应保持原符号
    let sign: 1 | -1 = 1;
    const before = chooseElbowSign(1, 1, { x: 1.2, y: 0.3 }, sign);
    sign = before;
    const atCrossing = chooseElbowSign(1, 1, { x: 1.2, y: 0.001 }, sign);
    expect(atCrossing).toBe(before); // 贴轴处两解几乎重合 → 迟滞保持
  });
});
