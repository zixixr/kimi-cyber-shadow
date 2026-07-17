// 玩法链/命中判定单测：纯函数（包络/出招/命中点/信号降级）+ Battle 状态机（假老虎/假树）。

import { describe, expect, it } from 'vitest';
import {
  Battle,
  degradeSignals,
  heroAttack,
  inRange,
  strikeEnv,
  strikePoint,
  type AttackInfo,
  type TreeLike,
} from './battle';
import { emptySignal } from '../hand/source';

/** 假老虎：记录受击次数，HP 归零翻 alive（state 可变，结构满足 Foe） */
function fakeFoe(x = 0.4, hp = 3) {
  const f = {
    hits: 0,
    hp,
    maxHp: 3,
    state: 'prowl',
    position: x,
    get alive() {
      return f.hp > 0;
    },
    hit() {
      f.hits += 1;
      f.hp -= 1;
    },
  };
  return f;
}

/** 假枯树：第二击返回 true（树倒） */
function fakeTree(x = -0.62): TreeLike & { hits: number } {
  const tr = {
    hits: 0,
    x,
    get alive() {
      return tr.hits < 2;
    },
    hit() {
      tr.hits += 1;
      return tr.hits >= 2;
    },
  };
  return tr;
}

const PEAK_ATK = (kind: AttackInfo['kind']): AttackInfo => ({ kind, power: 1 });

describe('strikeEnv（打击包络）', () => {
  it('p=0 与 p=1 归零，p=0.3 到峰值 1（前 30% 爆发）', () => {
    expect(strikeEnv(0)).toBeCloseTo(0);
    expect(strikeEnv(0.3)).toBeCloseTo(1);
    expect(strikeEnv(1)).toBeCloseTo(0, 5);
  });
  it('前段单调升、后段单调降', () => {
    expect(strikeEnv(0.15)).toBeLessThan(strikeEnv(0.29));
    expect(strikeEnv(0.5)).toBeGreaterThan(strikeEnv(0.9));
  });
});

describe('heroAttack（由主角状态推出招力度）', () => {
  it('combo：拍内 30% 处力度峰值；第 3 拍（踢腿）kind=kick', () => {
    const fist = heroAttack('combo', 0.55 * 0.3); // 第 1 拍峰值
    expect(fist).not.toBeNull();
    expect(fist!.kind).toBe('fist');
    expect(fist!.power).toBeCloseTo(1);
    const kick = heroAttack('combo', 0.55 * 2.3); // 第 3 拍峰值
    expect(kick!.kind).toBe('kick');
  });
  it('staff：拍内 30% 处力度峰值，kind=staff', () => {
    const a = heroAttack('staff', 0.8 * 1.3); // 第 2 拍峰值
    expect(a!.kind).toBe('staff');
    expect(a!.power).toBeCloseTo(1);
  });
  it('非攻击状态返回 null', () => {
    for (const s of ['idle', 'walk', 'run', 'jump', 'crouch', 'wave', 'point', 'proud'] as const) {
      expect(heroAttack(s, 1.23)).toBeNull();
    }
  });
});

describe('strikePoint / inRange（命中点 = 根 + 面向 × 射程）', () => {
  it('facing 1 = 面向观众右 = 世界 -x；棒 0.5m / 拳 0.3m', () => {
    expect(strikePoint(0, 1, 'staff')).toBeCloseTo(-0.5);
    expect(strikePoint(0, -1, 'staff')).toBeCloseTo(0.5);
    expect(strikePoint(0.1, 1, 'fist')).toBeCloseTo(-0.2);
    expect(strikePoint(0.1, -1, 'kick')).toBeCloseTo(0.4);
  });
  it('inRange 按容差判定', () => {
    expect(inRange(0.3, 0.4, 0.3)).toBe(true);
    expect(inRange(0.3, 0.8, 0.3)).toBe(false);
  });
});

describe('degradeSignals（棒断后剑指降级为拳脚）', () => {
  it('未断棒：原样返回', () => {
    const sig = { ...emptySignal(), gesture: 'sword' as const };
    expect(degradeSignals([sig], false)).toEqual([sig]);
  });
  it('断棒：仅第 1 只手 sword→fist，第二只手不动', () => {
    const hero = { ...emptySignal(), gesture: 'sword' as const };
    const second = { ...emptySignal(), gesture: 'sword' as const };
    const out = degradeSignals([hero, second], true);
    expect(out[0].gesture).toBe('fist');
    expect(out[1].gesture).toBe('sword');
    expect(hero.gesture).toBe('sword'); // 不改原对象
  });
});

describe('Battle（玩法链状态机）', () => {
  it('哨棒打树：第一下 light、第二下 broke + staffBroken（树倒棒断）', () => {
    const b = new Battle();
    const foe = fakeFoe();
    const tree = fakeTree();
    // 主角站在树右侧 0.4m 处、面向左（facing -1 → 命中点 x-0.5 不够到；
    // 用 facing 1 → 命中点 x-0.5... 树在 -0.62：站 -0.2 面向 1，命中点 -0.7，|−0.7+0.62|<0.32 ✓
    const f1 = b.update(0.016, 0, PEAK_ATK('staff'), -0.2, 1, foe, tree);
    expect(f1.treeCrack).toBe('light');
    expect(f1.drum).toBe('staff');
    expect(b.staffBroken).toBe(false);
    // 释放锁存后再打第二下
    b.update(0.016, 0.1, { kind: 'staff', power: 0 }, -0.2, 1, foe, tree);
    const f2 = b.update(0.016, 0.2, PEAK_ATK('staff'), -0.2, 1, foe, tree);
    expect(f2.treeCrack).toBe('broke');
    expect(b.staffBroken).toBe(true);
    expect(tree.alive).toBe(false);
  });

  it('锁存：力度持续高位只触发一次，回落 <0.3 后才可再触发', () => {
    const b = new Battle();
    const foe = fakeFoe(-0.3); // facing 1 = 世界 -x，命中点 -0.3 正对虎
    b.update(0.016, 0, PEAK_ATK('fist'), 0, 1, foe, null);
    const again = b.update(0.016, 0.02, PEAK_ATK('fist'), 0, 1, foe, null);
    expect(again.drum).toBeNull();
    expect(foe.hits).toBe(1);
    b.update(0.016, 0.04, { kind: 'fist', power: 0.1 }, 0, 1, foe, null); // 释放
    const third = b.update(0.016, 0.06, PEAK_ATK('fist'), 0, 1, foe, null);
    expect(third.drum).toBe('fist');
    expect(foe.hits).toBe(2);
  });

  it('打虎：射程内 tigerHit + 掉血；HP 归零 tigerDied 只报一次', () => {
    const b = new Battle();
    const foe = fakeFoe(-0.3, 2); // 两拳毙命
    const r1 = b.update(0.016, 0, PEAK_ATK('fist'), 0, 1, foe, null);
    expect(r1.tigerHit).toBe(true);
    expect(r1.tigerDied).toBe(false);
    b.update(0.016, 0.1, { kind: 'fist', power: 0 }, 0, 1, foe, null);
    const r2 = b.update(0.016, 0.2, PEAK_ATK('fist'), 0, 1, foe, null);
    expect(r2.tigerHit).toBe(true);
    expect(r2.tigerDied).toBe(true);
    expect(foe.alive).toBe(false);
    // 伏诛后再打不再命中、不再报 died
    b.update(0.016, 0.3, { kind: 'fist', power: 0 }, 0, 1, foe, null);
    const r3 = b.update(0.016, 0.4, PEAK_ATK('fist'), 0, 1, foe, null);
    expect(r3.tigerHit).toBe(false);
    expect(r3.tigerDied).toBe(false);
  });

  it('背向打不中（面向不符，射程够不到）', () => {
    const b = new Battle();
    const foe = fakeFoe(-0.3);
    const miss = b.update(0.016, 0, PEAK_ATK('fist'), 0, -1, foe, null); // 面向 +x，虎在 -x 侧
    expect(miss.tigerHit).toBe(false);
    const b2 = new Battle();
    const foe2 = fakeFoe(-0.3);
    const hit = b2.update(0.016, 0, PEAK_ATK('fist'), 0, 1, foe2, null); // 面向 -x → 中
    expect(hit.tigerHit).toBe(true);
  });

  it('虎扑命中主角：pounceHit + 击退偏移（远离虎方向）', () => {
    const b = new Battle();
    const foe = fakeFoe(0.2);
    foe.state = 'pounce';
    const r = b.update(0.016, 0, null, 0, 1, foe, null);
    expect(r.pounceHit).toBe(true);
    const f = b.flinch();
    expect(f.dx).toBeLessThan(0); // 主角在虎左侧 → 向左（-x）击退
    // 扑击结束后击退随时间衰减到 0
    foe.state = 'prowl';
    for (let i = 0; i < 40; i++) b.update(0.016, 0.1 + i * 0.016, null, 0, 1, foe, null);
    expect(b.flinch().dx).toBe(0);
  });

  it('reset：棒修好、伏诛边沿重新可报', () => {
    const b = new Battle();
    const foe = fakeFoe(0.3, 1);
    const tree = fakeTree();
    b.update(0.016, 0, PEAK_ATK('staff'), -0.2, 1, foe, tree);
    b.update(0.016, 0.1, { kind: 'staff', power: 0 }, -0.2, 1, foe, tree);
    b.update(0.016, 0.2, PEAK_ATK('staff'), -0.2, 1, foe, tree);
    expect(b.staffBroken).toBe(true);
    b.reset();
    expect(b.staffBroken).toBe(false);
    expect(b.statusLine(foe, tree, 99)).toContain('棒 在手');
  });
});
