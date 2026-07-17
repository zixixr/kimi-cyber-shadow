// 西游玩法逻辑单测：纯函数（握棒拍位/喷口/火舌命中/演出姿势）+ Xiyou 状态机
// （第二只手路由、命中掉血、败阵谢幕、三昧真火燎悟空、AI 接管、r 重开）。

import { describe, expect, it } from 'vitest';
import type { PuppetControl, SecondRoleIntent } from '../hand/director';
import { emptySignal, type HandSignal } from '../hand/source';
import {
  FOE_MAX_HP,
  Xiyou,
  defeatPose,
  facingDirX,
  fireBreathHits,
  fireOrigin,
  flailPose,
  twoHandGrip,
  victoryPose,
} from './xiyou';

/** 悟空控制量工厂（导演 PuppetActor 产物的最小复刻） */
function heroCtrl(over: Partial<PuppetControl> = {}): PuppetControl {
  return {
    active: true,
    state: 'idle',
    gesture: 'none',
    facing: 1,
    rootX: 0,
    rootY: 0.95,
    depth: 0.15,
    lean: 0,
    frontFK: { u: 14, e: 18 },
    rearFK: { u: 2, e: 16 },
    frontTarget: { x: 0.03, y: -0.15 },
    rearTarget: { x: 0.03, y: -0.14 },
    legFront: null,
    legRear: null,
    moving: false,
    ...over,
  };
}

/** 第二只手路由输出工厂（导演 secondIntent 的最小复刻）；wristX 决定红孩儿走位 */
function secondHand(wristX: number, gesture: HandSignal['gesture'] = 'none'): SecondRoleIntent {
  const signal: HandSignal = {
    ...emptySignal(),
    present: true,
    gesture,
    wrist: { x: wristX, y: 0 },
    palm: { x: wristX, y: 0 },
  };
  return { active: true, gesture, moveX: wristX, depth: 0.15, handedness: 'right', signal };
}

const NO_SECOND: SecondRoleIntent = {
  active: false,
  gesture: 'none',
  moveX: 0,
  depth: 0.15,
  handedness: 'right',
  signal: null,
};

describe('twoHandGrip（双手握棒拍位）', () => {
  it('器械套路第 1 拍（高劈）与第 3 拍（前刺）双手握棒，2/4 拍后手自由', () => {
    expect(twoHandGrip(0.1)).toBe(true); // beat 0
    expect(twoHandGrip(0.9)).toBe(false); // beat 1
    expect(twoHandGrip(1.7)).toBe(true); // beat 2
    expect(twoHandGrip(2.5)).toBe(false); // beat 3
    expect(twoHandGrip(3.3)).toBe(true); // 下一循环 beat 0
  });
});

describe('facingDirX / fireOrigin（喷口世界坐标）', () => {
  it('facing 1 = 面向观众右 = 世界 -x', () => {
    expect(facingDirX(1)).toBe(-1);
    expect(facingDirX(-1)).toBe(1);
  });
  it('喷口 = 头关节 + 面向前移 + 上移（拖点标定值）', () => {
    const o1 = fireOrigin({ x: 0.2, y: 1, z: 0.1 }, 1);
    expect(o1.x).toBeCloseTo(0.2 - 0.047);
    expect(o1.y).toBeCloseTo(1.032);
    expect(o1.z).toBeCloseTo(0.1);
    const o2 = fireOrigin({ x: 0.2, y: 1, z: 0.1 }, -1);
    expect(o2.x).toBeCloseTo(0.2 + 0.047);
  });
});

describe('fireBreathHits（火舌命中悟空）', () => {
  it('嘴前条带内命中；背后/超程不中；跳起（筋斗云）躲过', () => {
    // 红孩儿在 0.35 面向 1（世界 -x 喷）
    expect(fireBreathHits(0.35, 1, -0.05, 0.95)).toBe(true); // 嘴前 0.4m
    expect(fireBreathHits(0.35, 1, 0.6, 0.95)).toBe(false); // 背后
    expect(fireBreathHits(0.35, 1, -0.6, 0.95)).toBe(false); // 超出 0.78m 火舌
    expect(fireBreathHits(0.35, 1, -0.05, 1.2)).toBe(false); // 跳起躲火
    // 面向 -1（世界 +x 喷）
    expect(fireBreathHits(0.35, -1, 0.7, 0.95)).toBe(true);
  });
});

describe('演出姿势（flail / 败阵 / 谢幕）', () => {
  it('flailPose：hitT=0.25 到峰值（u=135、击退 0.1），两端归零', () => {
    const peak = flailPose(0.25);
    expect(peak.frontFK.u).toBeCloseTo(135);
    expect(peak.knock).toBeCloseTo(0.1);
    expect(flailPose(0.5).frontFK.u).toBeCloseTo(15, 0);
    expect(flailPose(0).knock).toBeCloseTo(0, 5);
  });
  it('defeatPose：躬身前倾 + 下沉 + 瘫坐', () => {
    const d = defeatPose();
    expect(d.lean).toBe(-1);
    expect(d.dip).toBeGreaterThan(0);
    expect(d.legFront).toBeCloseTo(0.7);
    expect(d.legRear).toBeCloseTo(-0.7);
  });
  it('victoryPose：亮相 → 躬身 → 挥手三段', () => {
    expect(victoryPose(5, 0).frontFK.u).toBe(145); // 亮相定格
    expect(victoryPose(3, 0).lean).toBe(-1); // 躬身
    const wave = victoryPose(1, 0); // t=0 → sin(0)=0
    expect(wave.frontFK.u).toBeCloseTo(148);
    expect(wave.frontFK.e).toBeCloseTo(28);
  });
});

describe('Xiyou（玩法状态机）', () => {
  it('悟空棒击中红孩儿：出招太鼓 + 命中掉血；锁存防一拍多判', () => {
    const x = new Xiyou();
    const hero = heroCtrl({ state: 'staff', rootX: 0, facing: 1 }); // 命中点 -0.5
    const r1 = x.update(0.016, 0.24, hero, secondHand(0.7)); // 红孩儿 -0.49，t=0.24 为攻击拍峰值
    expect(r1.ev.drum).toBe('staff');
    expect(r1.ev.foeHit).toBe(true);
    expect(x.foeHp).toBe(FOE_MAX_HP - 1);
    // 同一拍持续高位：锁存，不再判
    const hero2 = heroCtrl({ state: 'staff', rootX: 0, facing: 1 });
    const r2 = x.update(0.016, 0.26, hero2, secondHand(0.7));
    expect(r2.ev.drum).toBeNull();
    expect(x.foeHp).toBe(FOE_MAX_HP - 1);
  });

  it('红孩儿 HP 归零败阵：倒地姿势 + 悟空胜利谢幕（亮相段）', () => {
    const x = new Xiyou();
    x.foeHp = 1;
    const hero = heroCtrl({ state: 'staff', rootX: 0, facing: 1 });
    const r = x.update(0.016, 0.24, hero, secondHand(0.7));
    expect(r.ev.foeDied).toBe(true);
    expect(x.foeDefeated).toBe(true);
    // 红孩儿倒地：根下沉 + 瘫坐
    expect(r.foe.rootY).toBeCloseTo(0.95 - 0.1, 1);
    expect(r.foe.legFront).toBeCloseTo(0.7);
    // 悟空谢幕亮相段（vt>4）：双臂高展
    expect(hero.frontFK).toEqual({ u: 145, e: 20 });
    // 败阵后再打不掉血、不再报
    const hero2 = heroCtrl({ state: 'staff', rootX: 0, facing: 1 });
    const r2 = x.update(0.016, 1.04, hero2, secondHand(0.7));
    expect(r2.ev.foeHit).toBe(false);
    expect(x.foeHp).toBe(0);
  });

  it('第二只手张开 → 红孩儿喷火；火舌燎到悟空：受击 + 远离击退', () => {
    const x = new Xiyou();
    const hero = heroCtrl({ rootX: -0.05 }); // 红孩儿 0.35 面向 1 → 嘴前 0.4m
    const r = x.update(0.016, 0.1, hero, secondHand(-0.5, 'open'));
    expect(r.fireActive).toBe(true);
    expect(r.ev.fireStart).toBe(true);
    expect(r.ev.heroBurned).toBe(true);
    expect(hero.rootX).toBeLessThan(-0.05); // 向远离红孩儿方向击退
    expect(r.foe.frontFK).toEqual({ u: 18, e: 25 }); // 仰头喷火姿势
    // 持续张手：fireStart 只在边沿报一次
    const r2 = x.update(0.016, 0.12, heroCtrl({ rootX: -0.05 }), secondHand(-0.5, 'open'));
    expect(r2.ev.fireStart).toBe(false);
  });

  it('筋斗云躲火：悟空跳起（根抬高）时火舌燎不到', () => {
    const x = new Xiyou();
    const hero = heroCtrl({ rootX: -0.05, rootY: 1.2 }); // 跳跃中
    const r = x.update(0.016, 0.1, hero, secondHand(-0.5, 'open'));
    expect(r.fireActive).toBe(true);
    expect(r.ev.heroBurned).toBe(false);
  });

  it('握棒标志：剑指持棒 + 拍位；握棒拍 hero.rearFK 置空走 IK', () => {
    const x = new Xiyou();
    const hero = heroCtrl({ state: 'staff' });
    const r1 = x.update(0.016, 0.1, hero, NO_SECOND); // beat 0 = 握棒拍
    expect(r1.staffHeld).toBe(true);
    expect(r1.grip).toBe(true);
    expect(hero.rearFK).toBeNull();
    const hero2 = heroCtrl({ state: 'staff' });
    const r2 = x.update(0.016, 0.9, hero2, NO_SECOND); // beat 1 = 后手自由拍
    expect(r2.grip).toBe(false);
    expect(hero2.rearFK).not.toBeNull();
  });

  it('无第二只手 → AI 接管：面向悟空、拉开距离逼近、周期喷火（火能燎到悟空）', () => {
    const x = new Xiyou();
    // 对峙游走：hero 在 -0.6，红孩儿从 0.45 逼近
    let foe = x.update(0.05, 0, heroCtrl({ rootX: -0.6 }), NO_SECOND).foe;
    expect(foe.active).toBe(true);
    expect(foe.gesture).toBe('none');
    expect(foe.facing).toBe(1); // 面向观众右 = 世界 -x（悟空方向）
    const x0 = foe.rootX;
    for (let i = 1; i <= 20; i++) foe = x.update(0.05, i * 0.05, heroCtrl({ rootX: -0.6 }), NO_SECOND).foe;
    expect(foe.rootX).toBeLessThan(x0); // 逼近悟空
    // 周期喷火：hero 站 0 不动，2.2s 后 AI 进入喷火拍且火舌够到
    const y = new Xiyou();
    let fired = false;
    let burned = false;
    for (let i = 1; i <= 80; i++) {
      const r = y.update(0.05, i * 0.05, heroCtrl({ rootX: 0 }), NO_SECOND);
      fired ||= r.fireActive;
      burned ||= r.ev.heroBurned;
    }
    expect(fired).toBe(true);
    expect(burned).toBe(true);
  });

  it('reset：满血回场、演出清零', () => {
    const x = new Xiyou();
    x.foeHp = 1;
    x.update(0.016, 0.24, heroCtrl({ state: 'staff', rootX: 0, facing: 1 }), secondHand(0.7));
    expect(x.foeDefeated).toBe(true);
    x.reset();
    expect(x.foeHp).toBe(FOE_MAX_HP);
    expect(x.foeDefeated).toBe(false);
    expect(x.statusLine(false, 99)).toContain(`HP ${FOE_MAX_HP}/${FOE_MAX_HP}`);
  });
});
