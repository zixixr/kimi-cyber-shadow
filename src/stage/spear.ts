// 火尖枪（M5）：红孩儿的兵器。红缨枪杆 + 银枪头 + 枪头小火舌（加色叠加、呼吸式闪烁）；
// 剑指（器械套路）时挂前手显示，挂载思路同金箍棒（getObjectByName('joint_hand_f')，
// 场景图天然继承手臂 FK / 转身镜像，不改 assembly）。

import * as THREE from 'three';
import type { Puppet } from '../puppet/assembly';

const LEN = 0.42; // 枪杆长（米）
const TIP_LEN = 0.05; // 枪头长
const GRIP_Y = -0.06; // 握持点：枪心在手关节局部 y=-0.06
const Z_OFF = 0.003; // 错层：枪身在手前
const TRANSMISSION = 0.72;

export class FireSpear {
  /** 皮革材质（枪杆 + 枪头；火舌是加色材质不在其列）：投影 pass 交给 transmissionGuard */
  readonly leather: THREE.MeshPhysicalMaterial[] = [];

  private group = new THREE.Group();
  private flame: THREE.Mesh; // 枪头小火舌
  private flameMat: THREE.MeshBasicMaterial;
  private heldTarget = 0;
  private heldP = 0.001; // 入场进度（与臂缩放补偿解耦，EMA 向 heldTarget 收敛）
  private puppet: Puppet | null = null; // attach 后持有：读臂长缩放做反向补偿

  constructor() {
    const shaftMat = new THREE.MeshPhysicalMaterial({
      color: 0xb32222, // 红缨枪杆
      transmission: TRANSMISSION,
      thickness: 0.002,
      roughness: 0.6,
    });
    this.leather.push(shaftMat);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, LEN, 8), shaftMat);
    shaft.name = 'fire_spear';
    this.group.add(shaft);

    const tipMat = new THREE.MeshPhysicalMaterial({
      color: 0xd8d8e0, // 银枪头
      metalness: 0.7,
      roughness: 0.3,
      transmission: TRANSMISSION,
      thickness: 0.002,
    });
    this.leather.push(tipMat);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.011, TIP_LEN, 8), tipMat);
    // 枪头朝外（手关节局部 -y，顺手臂延伸方向）；圆锥 apex 默认 +y，转 π 让它冲下
    tip.rotation.x = Math.PI;
    tip.position.y = -(LEN + TIP_LEN) / 2;
    this.group.add(tip);

    // 枪头小火舌：加色圆锥，update 里呼吸式闪烁（非皮革，不进 transmissionGuard）
    this.flameMat = new THREE.MeshBasicMaterial({
      color: 0xff7a26,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.055, 8), this.flameMat);
    this.flame.rotation.x = Math.PI;
    this.flame.position.y = -(LEN + TIP_LEN) / 2 - 0.045;
    this.group.add(this.flame);

    this.group.position.set(0, GRIP_Y, Z_OFF);
    this.group.visible = false;
    this.group.scale.set(1, 0.001, 1);
    this.group.traverse((o) => o.layers.set(1)); // 影人专用层
  }

  /** 挂到红孩儿前手关节上（joint_hand_f 不存在 = 资产 bug，直接抛错） */
  attach(puppet: Puppet): void {
    const hand = puppet.group.getObjectByName('joint_hand_f');
    if (!hand) throw new Error('火尖枪挂载失败：红孩儿缺少 joint_hand_f 关节');
    hand.add(this.group);
    this.puppet = puppet;
  }

  /** 剑指持枪 / 收枪（平滑缩放入场） */
  setHeld(held: boolean): void {
    this.heldTarget = held ? 1 : 0;
  }

  update(dt: number, t: number): void {
    // 平滑缩放入场/收枪；臂长标定缩放手关节时按 1/armScale 反向缩放（文档第 8 章）
    const inv = 1 / (this.puppet?.armScale ?? 1);
    this.heldP += (Math.max(0.001, this.heldTarget) - this.heldP) * Math.min(1, dt * 10);
    this.group.scale.set(inv, this.heldP * inv, inv);
    this.group.visible = this.heldP > 0.02;
    // 火舌闪烁：双频正弦叠加，像喘动的火苗
    this.flame.scale.set(1, 1 + 0.25 * Math.sin(t * 21) + 0.12 * Math.sin(t * 33 + 1), 1);
    this.flameMat.opacity = 0.55 + 0.25 * Math.sin(t * 27 + 0.5);
  }
}
