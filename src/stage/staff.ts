// 哨棒道具（M4）：武松的兵器。剑指（器械套路）时挂在前手关节上跟随手臂 FK；
// 打在枯树上第二下 → 断成两截掉落（断木音效由玩法层触发），剑指自动降级为拳脚。
// 实现要点：assembly.ts 不改，棒用 getObjectByName('joint_hand_f') 从外部挂进
// 手关节（场景图天然继承手臂旋转/转身镜像，不用手推坐标系）。
// 断截网格在构造时预建（断时才摆位入场）：皮革材质清单因此一开始就齐全，
// main 可在断棒之前安全创建 transmissionGuard。

import * as THREE from 'three';
import type { Puppet } from '../puppet/assembly';

const LEN = 0.46; // 棒长（米）
const GRIP_Y = -0.08; // 握持点偏上：棒心在手关节局部 y=-0.08
const Z_OFF = 0.003; // 错层：棒身在手前
const TRANSMISSION = 0.72;
const BREAK_GRAVITY = 3.5; // 断截下落重力（舞台微缩观感，不用真实 9.8）
const GROUND_Y = 0.52; // 台面地面（幕布下缘 0.5 + 半截厚度）
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** 断截：世界系自由落体 + 翻转 + 淡出 */
interface PieceState {
  vel: THREE.Vector3;
  spin: number;
  t: number;
  falling: boolean;
}

function woodMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x8a4a26, // 枣木色
    transmission: TRANSMISSION,
    thickness: 0.002,
    roughness: 0.7,
  });
}

export class Staff {
  /** 皮革材质（整棒 + 两截，构造时即齐全）：投影 pass 交给 transmissionGuard（坑③） */
  readonly leather: THREE.MeshPhysicalMaterial[] = [];

  private intact: THREE.Mesh;
  private pieces: { mesh: THREE.Mesh; mat: THREE.MeshPhysicalMaterial; half: 1 | -1; st: PieceState }[] = [];
  private heldTarget = 0; // 1=手持显示（平滑缩放入场）
  private broken = false;

  constructor() {
    const intactMat = woodMaterial();
    this.leather.push(intactMat);
    this.intact = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.008, LEN, 8), intactMat);
    this.intact.name = 'staff';
    this.intact.position.set(0, GRIP_Y, Z_OFF);
    this.intact.visible = false;
    this.intact.scale.set(1, 0.001, 1);
    this.intact.layers.set(1); // 影人专用层（后挂入，不在 Puppet 构造时的 traverse 内）

    // 预建两截（断棒时摆到整棒上下半段的世界位姿再入场）
    for (const half of [1, -1] as const) {
      const mat = woodMaterial();
      mat.transparent = true; // 淡出用
      this.leather.push(mat);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.008, LEN / 2, 8), mat);
      mesh.name = `staff_piece_${half > 0 ? 'top' : 'bottom'}`;
      mesh.visible = false;
      mesh.layers.set(1);
      this.pieces.push({ mesh, mat, half, st: { vel: new THREE.Vector3(), spin: 0, t: 0, falling: false } });
    }
  }

  /** 挂到主角前手关节上（joint_hand_f 不存在 = 资产 bug，直接抛错） */
  attach(puppet: Puppet): void {
    const hand = puppet.group.getObjectByName('joint_hand_f');
    if (!hand) throw new Error('哨棒挂载失败：主角缺少 joint_hand_f 关节');
    hand.add(this.intact);
  }

  /** 是否还完好（断了 = false，repair 后恢复） */
  get isIntact(): boolean {
    return !this.broken;
  }

  /** 剑指持棒 / 收棒（平滑缩放入场） */
  setHeld(held: boolean): void {
    this.heldTarget = held ? 1 : 0;
  }

  /**
   * 打断：整棒隐藏，两截从当前世界位姿掉落（上截前抛、下截滑落，翻转 + 淡出）。
   * @param parent 断截挂入的场景节点（世界系，一般是 scene 本身）
   */
  breakOff(parent: THREE.Object3D): void {
    if (this.broken) return;
    this.broken = true;
    this.heldTarget = 0;
    this.intact.visible = false;

    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    this.intact.updateWorldMatrix(true, false);
    this.intact.getWorldQuaternion(worldQuat);
    for (const p of this.pieces) {
      // 半截中心 = 整棒中心 ± 1/4 棒长（沿棒轴）
      worldPos.set(0, (p.half * LEN) / 4, 0).applyMatrix4(this.intact.matrixWorld);
      p.mesh.position.copy(worldPos);
      p.mesh.quaternion.copy(worldQuat);
      p.mat.opacity = 1;
      p.mesh.visible = true;
      parent.add(p.mesh);
      p.st.vel.set(p.half * 0.22, p.half > 0 ? 0.5 : 0.15, 0);
      p.st.spin = p.half * 3.2;
      p.st.t = 0;
      p.st.falling = true;
    }
  }

  /** 修好（r 键再战）：断截清场，整棒恢复可用 */
  repair(): void {
    this.broken = false;
    for (const p of this.pieces) {
      p.mesh.removeFromParent();
      p.mesh.visible = false;
      p.st.falling = false;
    }
    this.intact.visible = false;
    this.intact.scale.set(1, 0.001, 1);
    this.heldTarget = 0;
  }

  update(dt: number): void {
    // 整棒：平滑缩放入场/收棒
    if (!this.broken) {
      const cur = this.intact.scale.y;
      const next = cur + (Math.max(0.001, this.heldTarget) - cur) * Math.min(1, dt * 10);
      this.intact.scale.set(1, next, 1);
      this.intact.visible = next > 0.02;
    }
    // 断截：自由落体 + 翻转 + 淡出（落地不弹，淡出即走）
    for (const p of this.pieces) {
      if (!p.st.falling) continue;
      p.st.t += dt;
      p.st.vel.y -= BREAK_GRAVITY * dt;
      p.mesh.position.addScaledVector(p.st.vel, dt);
      p.mesh.rotateOnWorldAxis(Z_AXIS, p.st.spin * dt);
      if (p.mesh.position.y < GROUND_Y) {
        p.mesh.position.y = GROUND_Y; // 落到台面：停住等淡出
        p.st.vel.set(0, 0, 0);
        p.st.spin = 0;
      }
      const fade = THREE.MathUtils.clamp(1 - (p.st.t - 0.7) / 0.5, 0, 1);
      p.mat.opacity = fade;
      if (fade <= 0) {
        p.mesh.visible = false;
        p.st.falling = false;
      }
    }
  }
}
