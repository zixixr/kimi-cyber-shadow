// 金箍棒（M5）：悟空的兵器。染金长棒挂前手关节（同哨棒思路，assembly 不改：
// getObjectByName('joint_hand_f') 挂进手关节，场景图天然继承手臂 FK / 转身镜像）；
// 剑指（器械套路）时平滑缩放入场。
// 双手握棒（文档第 7 章付过学费的正确实现）：前手臂 FK 定格后，取棒线上目标
// 握点的世界坐标，用后肩父节点 worldToLocal 变换到后肩局部系，再交
// puppet.pointAt 解 IK —— 场景图矩阵天然处理面向镜像/胸倾/肩偏，绝不在
// 导演层手推坐标符号；握点超出后臂臂展时沿棒线回退（可达性自适应），避免手悬空。

import * as THREE from 'three';
import type { Puppet } from '../puppet/assembly';

const LEN = 0.46; // 棒长（米，同哨棒）
const GRIP_Y = -0.08; // 握持点偏上：棒心在手关节局部 y=-0.08
const Z_OFF = 0.003; // 错层：棒身在手前
const TRANSMISSION = 0.72; // 皮革透光率（与影人一致）
export const GRIP_DIST = 0.057; // 后手握点距前手沿棒距离（参考实现拖点标定值）
const GRIP_MIN = -0.06; // 回退下限：最多退到前手上方 6cm
const GRIP_STEP = 0.01; // 回退步长

/**
 * 可达性自适应（纯函数，可单测）：从期望握距 gripDist 沿棒线向前手回退，
 * 返回首个「肩到握点距离 ≤ reach」的握距；都够不着返回 GRIP_MIN（由 IK 环带钳制兜底）。
 * @param distAt 给定握距 g，返回肩到该握点的距离（米）
 */
export function reachableGrip(gripDist: number, reach: number, distAt: (g: number) => number): number {
  for (let g = gripDist; g > GRIP_MIN; g -= GRIP_STEP) {
    if (distAt(g) <= reach) return g;
  }
  return GRIP_MIN;
}

export class GoldenStaff {
  /** 皮革材质（投影 pass 交给 transmissionGuard，坑③） */
  readonly leather: THREE.MeshPhysicalMaterial[] = [];

  private group = new THREE.Group(); // 棒体（轴 + 两端金箍），挂前手关节
  private heldTarget = 0; // 1=手持显示（平滑缩放入场）

  constructor() {
    const gold = new THREE.MeshPhysicalMaterial({
      color: 0xd9a441, // 染金
      metalness: 0.55,
      roughness: 0.35,
      transmission: TRANSMISSION,
      thickness: 0.002,
    });
    this.leather.push(gold);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, LEN, 8), gold);
    shaft.name = 'golden_staff';
    this.group.add(shaft);
    // 两端金箍（略粗的暗金环）
    const band = new THREE.MeshPhysicalMaterial({
      color: 0x8a5c0e,
      metalness: 0.6,
      roughness: 0.4,
      transmission: TRANSMISSION,
      thickness: 0.002,
    });
    this.leather.push(band);
    for (const half of [1, -1] as const) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 8), band);
      ring.position.y = (half * (LEN - 0.03)) / 2;
      this.group.add(ring);
    }
    this.group.position.set(0, GRIP_Y, Z_OFF);
    this.group.visible = false;
    this.group.scale.set(1, 0.001, 1);
    this.group.traverse((o) => o.layers.set(1)); // 影人专用层（后挂入，不在 Puppet 构造的 traverse 内）
  }

  /** 挂到悟空前手关节上（joint_hand_f 不存在 = 资产 bug，直接抛错） */
  attach(puppet: Puppet): void {
    const hand = puppet.group.getObjectByName('joint_hand_f');
    if (!hand) throw new Error('金箍棒挂载失败：悟空缺少 joint_hand_f 关节');
    hand.add(this.group);
  }

  /** 棒是否显示中（双手握棒只在棒可见时解） */
  get onStage(): boolean {
    return this.group.visible;
  }

  /** 剑指持棒 / 收棒（平滑缩放入场） */
  setHeld(held: boolean): void {
    this.heldTarget = held ? 1 : 0;
  }

  /**
   * 双手握棒：把后手 IK 目标解到棒线上（在 puppet.update(dt) 之后调用）。
   * 步骤：①刷新场景图世界矩阵；②取棒线（前手原点 + 棒轴向下方向）；
   * ③沿棒线取目标握点（可达性自适应回退）；④worldToLocal 到后肩父系、
   * 减去肩偏移，交 puppet.pointAt 解 IK（下一帧 update 生效，60fps 下无感）。
   * @returns false = 棒不可见或关节缺失（本帧未改后手）
   */
  solveRearGrip(puppet: Puppet, gripDist = GRIP_DIST): boolean {
    if (!this.group.visible) return false;
    const handJ = puppet.group.getObjectByName('joint_hand_f');
    const uj = puppet.group.getObjectByName('joint_upper_arm_b');
    if (!handJ || !uj?.parent) return false;

    // ① 用本帧 FK 结果刷新世界矩阵（worldToLocal 内部不自动更新矩阵）
    puppet.group.updateWorldMatrix(true, true);
    // ② 棒线（世界系）：origin=前手，dir=棒杆向下
    const handW = handJ.getWorldPosition(new THREE.Vector3());
    const dirW = new THREE.Vector3(0, -1, 0)
      .applyQuaternion(handJ.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();

    // ③④ 握点 → 后肩局部系（肩为原点），可达性自适应回退
    const reach = puppet.armReach * 0.97; // 与 ik.ts ANNULUS_OUT 一致
    const local = new THREE.Vector3();
    const distAt = (g: number): number => {
      local.copy(handW).addScaledVector(dirW, g);
      uj.parent!.worldToLocal(local); // 世界 → 后肩父系（矩阵天然含转身镜像/胸倾/肩偏）
      local.sub(uj.position); // 肩为原点
      return Math.hypot(local.x, local.y);
    };
    distAt(reachableGrip(gripDist, reach, distAt));
    puppet.pointAt({ x: local.x, y: local.y }, 'back');
    return true;
  }

  update(dt: number): void {
    // 平滑缩放入场/收棒（同哨棒）
    const cur = this.group.scale.y;
    const next = cur + (Math.max(0.001, this.heldTarget) - cur) * Math.min(1, dt * 10);
    this.group.scale.set(1, next, 1);
    this.group.visible = next > 0.02;
  }
}
