// 筋斗云贴脚单测：真实 wukong 资产装配 + 桩贴图，无头验证
// 「云 y = 髋 y − cos(腿摆角) × 场景图量出的腿长 − 余量」（跳跃蜷腿 → 云抬高）。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Puppet, type PartGeom, type PivotsFile } from '../puppet/assembly';
import { SomersaultCloud } from './cloud';

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

describe('SomersaultCloud（筋斗云贴脚）', () => {
  it('云高 = 髋 y − cos(腿摆角)×腿长 − 0.015；蜷腿时云抬高；进度驱动显隐缩放', () => {
    const p = loadWukong();
    const cloud = new SomersaultCloud();
    cloud.attach(p);
    const cloudObj = p.group.getObjectByName('somersault_cloud')!;
    expect(cloudObj).toBeTruthy();

    // 直腿（摆角 0）：云贴在自然脚底
    p.setLegPose(0, 0);
    p.update(1); // 主动角一步到位（dt×14 饱和）
    cloud.update(0.5);
    const hipY = (p.group.getObjectByName('joint_leg_f')?.position.y ?? 0) as number;
    const yStraight = cloudObj.position.y;
    expect(yStraight).toBeLessThan(hipY - 0.2); // 腿长量级（≈0.237）
    expect(cloudObj.visible).toBe(true);
    expect(cloudObj.scale.x).toBeCloseTo(1.1, 1); // 跳跃中段云最大

    // 蜷腿（跳跃摆角 0.6）：脚抬高 cos(0.6)×腿长，云跟着抬高
    p.setLegPose(0.6, -0.6);
    p.update(1);
    cloud.update(0.5);
    const yTucked = cloudObj.position.y;
    expect(yTucked).toBeGreaterThan(yStraight);
    expect(yTucked - yStraight).toBeCloseTo((1 - Math.cos(0.6)) * 0.237, 1);

    // 不在跳跃：云隐藏
    cloud.update(null);
    expect(cloudObj.visible).toBe(false);
  });
});
