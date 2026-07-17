// 筋斗云（M5）：悟空跳跃时脚下生云。云朵 = 五枚压扁半透明球拼成的圆润云形，
// 挂影人根节点下（随影人走/转身）；MeshBasic 半透明，不是皮革，不进 transmissionGuard。
// 贴脚公式（文档第 7 章付过学费：云高不能写死偏移——跳跃蜷腿脚抬高，写死必然对不上）：
//   云 y = 髋关节 y − cos(腿摆角) × 当前腿长 − 余量
// 腿长从场景图量出（腿网格在关节局部系中的最低点），不写死。

import * as THREE from 'three';
import type { Puppet } from '../puppet/assembly';

const FALLBACK_LEG_LEN = 0.234; // 兜底腿长：pivots leg_f height 0.26 × 0.9（参考实现估算比）
const PUFFS: [number, number][] = [
  // [水平偏移, 半径]：中间大两边小的圆润云形
  [-0.09, 0.055],
  [0, 0.075],
  [0.09, 0.05],
  [-0.045, 0.06],
  [0.05, 0.062],
];

export class SomersaultCloud {
  private cloud = new THREE.Group();
  private legJ: THREE.Object3D | null = null; // 前腿关节（读摆角/髋 y）
  private legLen = FALLBACK_LEG_LEN;

  constructor() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe9b8, // 暖白云
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    for (const [ox, r] of PUFFS) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
      puff.scale.y = 0.45; // 压扁成云朵
      puff.position.x = ox;
      this.cloud.add(puff);
    }
    this.cloud.name = 'somersault_cloud';
    this.cloud.position.set(0, -0.33, 0.004);
    this.cloud.visible = false;
    this.cloud.traverse((o) => o.layers.set(1)); // 影人专用层：云也投上幕
  }

  /** 挂到悟空根节点下，并从场景图量出当前腿长（贴脚公式用） */
  attach(puppet: Puppet): void {
    this.legJ = puppet.group.getObjectByName('joint_leg_f') ?? null;
    const mesh = this.legJ?.children.find((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh === true) ?? null;
    if (mesh) {
      // 关节局部系脚底 = 网格包围盒最低点 × 缩放 + 网格平移（负值）
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        const footY = mesh.geometry.boundingBox.min.y * mesh.scale.y + mesh.position.y;
        if (footY < -0.1) this.legLen = -footY;
      }
    }
    puppet.group.add(this.cloud);
  }

  /**
   * 每帧更新。
   * @param p 跳跃进度 0→1（由玩法层按导演 jump 状态计时）；null = 不在跳跃，云隐藏
   */
  update(p: number | null): void {
    // 动态贴脚：云高 = 髋 y − cos(腿摆角) × 当前腿长（跳跃蜷腿时脚抬高，云跟着贴上去）；
    // 腿长 = 装配量得静置腿长 × 腿关节当前缩放（拖点标定 🦵 改腿长后依然贴脚，文档第 7/8 章）
    if (this.legJ) {
      const drop = Math.cos(this.legJ.rotation.z) * this.legLen * this.legJ.scale.y;
      this.cloud.position.y = this.legJ.position.y - drop - 0.015;
    }
    const sc = p == null ? 0 : Math.sin(Math.PI * Math.min(1, p)) * 1.1; // 跳跃中段云最大
    this.cloud.visible = sc > 0.05;
    this.cloud.scale.setScalar(Math.max(0.001, sc));
  }
}
