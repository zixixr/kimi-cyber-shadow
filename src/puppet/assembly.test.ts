// 比例标定单测（文档第 8 章拖点标定的装配侧）：真实 wukong 资产 + 桩贴图无头装配，验证
// ① 臂/腿关节树整体缩放（joint.scale.setScalar）+ armReach/腿长/root 贴地补偿同步；
// ② 头关节偏移 = 装配基准 + offset，headOffsetFromWorld 与世界点互逆（拖 👤 的换算）。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Puppet, type PartGeom, type PivotsFile } from './assembly';

/** 从磁盘读真实 wukong pivots/geometry + 桩贴图装配（同 goldenstaff.test 的加载法） */
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

describe('Puppet 比例标定（setProportions）', () => {
  it('臂/腿关节树整体缩放：armReach/腿长同步缩放，root 上移 (leg−1)×腿长 补偿贴地', () => {
    const p = loadWukong();
    const restReach = p.restArmReach;
    const restLeg = p.restLegLen;
    expect(restReach).toBeGreaterThan(0.1);
    expect(restLeg).toBeGreaterThan(0.15);

    p.setPosition(0, 0.95);
    p.update(1 / 60);
    const y0 = p.group.position.y;

    p.setProportions({ headOff: { x: 0, y: 0 }, arm: 1.2, leg: 1.1 });
    expect(p.armScale).toBeCloseTo(1.2);
    expect(p.armReach).toBeCloseTo(restReach * 1.2); // IK 射程同步（solveRearGrip/导演指向基准）
    expect(p.restArmReach).toBeCloseTo(restReach); // 静置基准不随缩放变
    expect(p.legLength).toBeCloseTo(restLeg * 1.1);
    expect(p.group.getObjectByName('joint_upper_arm_f')?.scale.x).toBeCloseTo(1.2);
    expect(p.group.getObjectByName('joint_upper_arm_b')?.scale.x).toBeCloseTo(1.2);
    expect(p.group.getObjectByName('joint_leg_f')?.scale.x).toBeCloseTo(1.1);

    p.update(1 / 60);
    expect(p.group.position.y).toBeCloseTo(y0 + 0.1 * restLeg); // 腿加长 → root 上移保持贴地
  });

  it('头偏移：关节位置 = 装配基准 + offset；headOffsetFromWorld 与世界点互逆', () => {
    const p = loadWukong();
    p.face(1);
    p.setPosition(0, 0.95);
    const hj = p.group.getObjectByName('joint_head')!;
    const orig = hj.position.clone(); // 装配基准（未加偏移）

    p.setProportions({ headOff: { x: 0.01, y: -0.02 }, arm: 1, leg: 1 });
    expect(hj.position.x).toBeCloseTo(orig.x + 0.01);
    expect(hj.position.y).toBeCloseTo(orig.y - 0.02);

    // 世界点 ⇄ 偏移量互逆：拖 👤 到头关节当前位置，换算回应是写入的偏移
    p.update(1 / 60);
    p.group.updateWorldMatrix(true, true);
    const off = p.headOffsetFromWorld(hj.getWorldPosition(new THREE.Vector3()));
    expect(off.x).toBeCloseTo(0.01, 3);
    expect(off.y).toBeCloseTo(-0.02, 3);

    // 恢复默认：回到装配基准，不漂移（每帧冪等调用安全）
    p.setProportions({ headOff: { x: 0, y: 0 }, arm: 1, leg: 1 });
    expect(hj.position.x).toBeCloseTo(orig.x);
    expect(hj.position.y).toBeCloseTo(orig.y);
  });
});
