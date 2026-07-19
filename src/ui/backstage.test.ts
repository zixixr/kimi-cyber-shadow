// 幕后模式纯逻辑单测：球坐标机位 orbitPos + 操纵杆对齐 solveRod

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { orbitPos, solveRod } from './backstage';

describe('orbitPos（幕后环绕机位）', () => {
  const target = new THREE.Vector3(0, 1.1, 0.2);

  it('theta=0 在台心正后方（+z），theta=90° 在 +x 侧', () => {
    const p = orbitPos(0, Math.PI / 2, 2, target, new THREE.Vector3());
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(1.1, 6);
    expect(p.z).toBeCloseTo(2.2, 6);
    const q = orbitPos(Math.PI / 2, Math.PI / 2, 2, target, new THREE.Vector3());
    expect(q.x).toBeCloseTo(2, 6);
    expect(q.y).toBeCloseTo(1.1, 6);
    expect(q.z).toBeCloseTo(0.2, 6);
  });

  it('任意角度到台心距离恒为 r', () => {
    const p = orbitPos(0.7, 1.1, 2.6, target, new THREE.Vector3());
    expect(p.distanceTo(target)).toBeCloseTo(2.6, 6);
  });
});

describe('solveRod（操纵杆对齐）', () => {
  it('竖直杆：中点居中、姿态恒等、长度 = 两端距', () => {
    const mid = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const len = solveRod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 2, 0), mid, quat);
    expect(len).toBeCloseTo(2, 6);
    expect(mid.y).toBeCloseTo(1, 6);
    expect(quat.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 4);
  });

  it('水平杆：+y 轴被旋到 +x 方向，中点在两端正中', () => {
    const mid = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const len = solveRod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.3, 0, 0), mid, quat);
    expect(len).toBeCloseTo(0.3, 6);
    expect(mid.x).toBeCloseTo(0.15, 6);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    expect(up.x).toBeCloseTo(1, 5);
    expect(up.y).toBeCloseTo(0, 5);
  });

  it('两端重合：长度兜底 1e-4，不出 NaN', () => {
    const mid = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const len = solveRod(new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, 1, 1), mid, quat);
    expect(len).toBeCloseTo(1e-4, 8);
    expect(Number.isFinite(mid.x)).toBe(true);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    expect(Number.isFinite(up.x)).toBe(true);
  });
});
