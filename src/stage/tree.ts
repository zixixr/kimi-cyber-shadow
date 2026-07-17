// 景阳冈枯树（M4）：静态道具。props/tree 贴图建 2mm 厚片，立在场边（台面地面 ≈ 幕布下缘 0.5m）。
// 哨棒打两下 → 第二下树倒（绕树根加速倒伏 + 淡出）——配合哨棒断裂还原水浒名场面。

import * as THREE from 'three';
import type { PartGeom } from '../puppet/assembly';

const THICK = 0.002;
const TRANSMISSION = 0.72;
const GROUND_Y = 0.5; // 台面地面高（幕布下缘）
const HITS_TO_FALL = 2; // 打两下树倒

export type TreeState = 'stand' | 'falling' | 'gone';

export class Tree {
  readonly group = new THREE.Group();
  /** 皮革材质：投影 pass 交给 transmissionGuard（坑③） */
  readonly leather: THREE.MeshPhysicalMaterial[] = [];
  /** 台面位置（命中判定用） */
  readonly x: number;

  private mat: THREE.MeshPhysicalMaterial;
  private hits = 0;
  private state: TreeState = 'stand';
  private shakeT = 0;
  private fallT = 0;

  constructor(geom: PartGeom, dye: THREE.Texture, alpha: THREE.Texture, x: number, height = 0.95) {
    this.x = x;
    this.group.name = 'tree';

    const shape = new THREE.Shape();
    geom.outline.forEach(([gx, gy], i) => {
      if (i === 0) shape.moveTo(gx, 1 - gy);
      else shape.lineTo(gx, 1 - gy);
    });
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: THICK / height, bevelEnabled: false });
    this.mat = new THREE.MeshPhysicalMaterial({
      map: dye,
      alphaMap: alpha,
      alphaTest: 0.5,
      transparent: true, // 倒伏淡出用
      transmission: TRANSMISSION,
      thickness: THICK,
      roughness: 0.7,
      side: THREE.DoubleSide,
    });
    this.leather.push(this.mat);

    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.name = 'part_tree';
    mesh.scale.setScalar(height);
    // 铆枢在树根底部中心（倒下时绕根旋转）：内容底缘 / 水平中心对齐组原点
    mesh.position.set((-(geom.bbox[0] + geom.bbox[2]) / 2) * height, -(1 - geom.bbox[3]) * height, 0);
    this.group.add(mesh);
    this.group.position.set(x, GROUND_Y, 0.1);
    this.group.traverse((o) => o.layers.set(1)); // 影人专用层
  }

  /** 加载枯树道具（geometry.json + dye/alpha 贴图），x = 台面位置（默认场左） */
  static async load(x = -0.62, base = '/assets/props'): Promise<Tree> {
    const v = `?v=${Date.now()}`;
    const geoRes = await fetch(`${base}/geometry.json`);
    if (!geoRes.ok) throw new Error(`道具资产加载失败（geometry ${geoRes.status}）`);
    const geo = (await geoRes.json()) as { parts: Record<string, PartGeom> };
    const treeGeom = geo.parts.tree;
    if (!treeGeom) throw new Error('道具资产缺失：geometry.json 无 tree 部件');

    const loader = new THREE.TextureLoader();
    const [dye, alpha] = await Promise.all([
      loader.loadAsync(`${base}/tree_dye.png${v}`),
      loader.loadAsync(`${base}/tree_alpha.png${v}`),
    ]);
    dye.colorSpace = THREE.SRGBColorSpace;
    return new Tree(treeGeom, dye, alpha, x);
  }

  get alive(): boolean {
    return this.state === 'stand';
  }

  get object(): THREE.Group {
    return this.group;
  }

  /** 被哨棒打中：晃动；第二下 → 倒伏。返回是否触发了断（第二击） */
  hit(): boolean {
    if (this.state !== 'stand') return false;
    this.hits += 1;
    this.shakeT = 0.35;
    if (this.hits >= HITS_TO_FALL) {
      this.state = 'falling';
      this.fallT = 0;
      return true;
    }
    return false;
  }

  /** 复位重开：立回原地（配合 r 键再战） */
  reset(): void {
    this.hits = 0;
    this.state = 'stand';
    this.shakeT = 0;
    this.fallT = 0;
    this.group.rotation.z = 0;
    this.group.visible = true;
    this.mat.opacity = 1;
  }

  update(dt: number): void {
    if (this.state === 'stand' && this.shakeT > 0) {
      this.shakeT -= dt;
      this.group.rotation.z = Math.sin(this.shakeT * 40) * 0.05 * (this.shakeT / 0.35);
    } else if (this.state === 'falling') {
      this.fallT += dt;
      const p = Math.min(1, this.fallT / 1.1);
      this.group.rotation.z = 1.5 * p * p; // 加速倒下
      this.mat.opacity = 1 - Math.max(0, (p - 0.6) / 0.4) * 0.9;
      if (p >= 1) {
        this.state = 'gone';
        this.group.visible = false;
      }
    }
  }
}
