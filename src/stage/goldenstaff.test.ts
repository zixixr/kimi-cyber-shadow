// 双手握棒可达性自适应单测：reachableGrip 纯函数 + solveRearGrip 场景图矩阵集成
// （真实 wukong 资产 + 桩贴图，无头验证 worldToLocal 解 IK 不抛错、转身镜像也解得出）。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Puppet, type PartGeom, type PivotsFile } from '../puppet/assembly';
import { GoldenStaff, reachableGrip } from './goldenstaff';

/** 从磁盘读真实 wukong pivots/geometry + 桩贴图装配（不走 TextureLoader，无头可跑） */
function loadWukong(): Puppet {
  const dir = new URL('../../assets/puppets/wukong/', import.meta.url);
  const pivots = JSON.parse(readFileSync(new URL('pivots.json', dir), 'utf8')) as PivotsFile;
  const geo = JSON.parse(readFileSync(new URL('geometry.json', dir), 'utf8')) as {
    parts: Record<string, PartGeom>;
  };
  const textures: Record<string, { dye: THREE.Texture; alpha: THREE.Texture }> = {};
  for (const name of Object.keys(pivots)) {
    textures[name] = { dye: new THREE.Texture(), alpha: new THREE.Texture() };
  }
  return new Puppet(pivots, geo.parts, textures);
}

describe('reachableGrip（握点超臂展沿棒线回退）', () => {
  it('期望握距够得着：原样返回', () => {
    expect(reachableGrip(0.057, 0.17, () => 0.1)).toBeCloseTo(0.057);
  });
  it('超臂展：按步长回退到首个够得着的握距', () => {
    // 肩到握点距离 = |g| + 0.2，臂展 0.25：g=0.057 → 0.257 超；g=0.047 → 0.247 够
    expect(reachableGrip(0.057, 0.25, (g) => Math.abs(g) + 0.2)).toBeCloseTo(0.047);
  });
  it('全线超程：回退到下限 -0.06（交 IK 环带钳制兜底）', () => {
    expect(reachableGrip(0.057, 0.17, () => 1)).toBeCloseTo(-0.06);
  });
});

describe('solveRearGrip（场景图矩阵 worldToLocal 集成）', () => {
  it('持棒定势后解出后手 IK；转身翻面（镜像）后依然解得出', () => {
    const p = loadWukong();
    p.setPosition(0, 0.95);
    p.face(1);
    p.setArmPose(115, 12, 'front'); // 持棒定势（参考实现标定姿势）
    p.update(1 / 60);
    const staff = new GoldenStaff();
    staff.attach(p);
    staff.setHeld(true);
    for (let i = 0; i < 90; i++) staff.update(1 / 60); // 平滑缩放入场完成
    expect(staff.onStage).toBe(true);
    expect(staff.solveRearGrip(p)).toBe(true);
    p.update(1 / 60); // 后手 IK 求解路径不抛错

    // 转身（绕 y 翻面，局部系镜像）：矩阵天然处理符号，不手推
    p.face(-1);
    p.update(1); // 平滑翻面一步到位（dt×9 饱和）
    expect(staff.solveRearGrip(p)).toBe(true);
    p.update(1 / 60);

    // 收棒后不再解（棒不可见返回 false）
    staff.setHeld(false);
    for (let i = 0; i < 90; i++) staff.update(1 / 60);
    expect(staff.solveRearGrip(p)).toBe(false);
  });
});
