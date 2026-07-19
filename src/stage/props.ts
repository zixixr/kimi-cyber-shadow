// 传统布景厚片（酒旗 / 山石 / 火云洞等衬景道具）：加载方式同 tree.ts——
// geometry.json 的 outline 挤出 2mm 厚片 + dye/alpha 贴图 + 透光皮革材质，放 layer 1（进投影）。
// 与枯树不同：布景是纯静态衬景（无玩法状态），摆位全部走 PropPlacement 常量表。
// 进深语义：z 越靠近灯位（0.85m）影越大越虚（远景），越贴幕（z→0）影越小越锐（近景）。

import * as THREE from 'three';
import type { PartGeom } from '../puppet/assembly';

const THICK = 0.002; // 厚片厚度（2mm，皮影皮革厚度）
const TRANSMISSION = 0.72; // 皮革透光率（与影人/枯树一致）
export const GROUND_Y = 0.5; // 台面地面高（幕布下缘，同 tree.ts）

/** 布景摆位：name = geometry.json 的 parts 键（贴图 <name>_dye/alpha.png） */
export interface PropPlacement {
  name: string;
  /** 台面横向位置（幕心 0，左负右正；幕布半宽 0.9，台边 ±0.8 上下） */
  x: number;
  /** 底缘离地高（默认 GROUND_Y 台面） */
  y?: number;
  /** 幕后进深：0=贴幕（影锐）… 0.85=灯位（影虚）；远景道具往灯侧放 */
  z: number;
  /** 道具高度（米，等比缩放） */
  height: number;
}

/** 水浒 · 武松打虎布景：「三碗不过冈」酒旗 + 景阳冈山石（远山）
 *  注意：影子落点 = x×0.85/(0.85−z)（灯在 x=0 z=0.85 透视投影），
 *  离灯越近放大越狠——z=0.6 时 x=0.62 的影子落在幕外 2.1m 处（正面看不见的教训）。 */
export const SHUIHU_PROPS: PropPlacement[] = [
  // 酒旗：抬高悬于角色头顶上方（旗面不占表演区），细旗杆垂下——皮影道具由操偶者举持，不落地
  { name: 'jiuqi', x: -0.25, y: 0.78, z: 0.1, height: 0.85 },
  // 山石：后景偏灯——影子落在幕右当景阳冈远山（影 ≈ x-0.5，放大 2 倍）
  { name: 'shanshi', x: -0.25, z: 0.42, height: 0.5 },
];

/** 西游 · 悟空打红孩儿布景：火云洞 + 复用山石侧景 */
export const XIYOU_PROPS: PropPlacement[] = [
  // 火云洞：中后景偏右（红孩儿一方），深度适中保持洞形可读
  { name: 'huoyun', x: 0.3, z: 0.35, height: 0.9 },
  // 山石复用：幕左侧景，靠灯拉开前后层次（影 ≈ x+0.66）
  { name: 'shanshi', x: 0.31, z: 0.45, height: 0.5 },
];

export class StageProp {
  readonly group = new THREE.Group();
  /** 皮革材质：投影 pass 交给 transmissionGuard（坑③） */
  readonly leather: THREE.MeshPhysicalMaterial[] = [];

  constructor(geom: PartGeom, dye: THREE.Texture, alpha: THREE.Texture, p: PropPlacement) {
    this.group.name = `prop_${p.name}`;

    const shape = new THREE.Shape();
    geom.outline.forEach(([gx, gy], i) => {
      if (i === 0) shape.moveTo(gx, 1 - gy);
      else shape.lineTo(gx, 1 - gy);
    });
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: THICK / p.height, bevelEnabled: false });
    const mat = new THREE.MeshPhysicalMaterial({
      map: dye,
      alphaMap: alpha,
      alphaTest: 0.5,
      transmission: TRANSMISSION,
      thickness: THICK,
      roughness: 0.7,
      side: THREE.DoubleSide,
    });
    this.leather.push(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `part_${p.name}`;
    mesh.scale.setScalar(p.height);
    // 枢在内容底缘水平中心：group 原点 = 道具落地支点（同 tree.ts 对齐方式）
    mesh.position.set((-(geom.bbox[0] + geom.bbox[2]) / 2) * p.height, -(1 - geom.bbox[3]) * p.height, 0);
    this.group.add(mesh);
    this.group.position.set(p.x, p.y ?? GROUND_Y, p.z);
    this.group.traverse((o) => o.layers.set(1)); // 影人专用层：进投影、主相机可见
  }

  /**
   * 加载一件布景道具。贴图 URL 带 ?v= 版本号防浏览器缓存；
   * geometry.json 的 parts 表模块级缓存（一场多道具只取一次）。
   */
  static async load(p: PropPlacement, base = '/assets/props'): Promise<StageProp> {
    const v = `?v=${Date.now()}`;
    const parts = await loadParts(base);
    const geom = parts[p.name];
    if (!geom) throw new Error(`道具资产缺失：geometry.json 无 ${p.name} 部件`);

    const loader = new THREE.TextureLoader();
    const [dye, alpha] = await Promise.all([
      loader.loadAsync(`${base}/${p.name}_dye.png${v}`),
      loader.loadAsync(`${base}/${p.name}_alpha.png${v}`),
    ]);
    dye.colorSpace = THREE.SRGBColorSpace;
    return new StageProp(geom, dye, alpha, p);
  }
}

/** parts 表缓存：首取失败则清空缓存，允许下次重试（资产可能后补生成） */
let partsCache: Promise<Record<string, PartGeom>> | null = null;

function loadParts(base: string): Promise<Record<string, PartGeom>> {
  partsCache ??= fetch(`${base}/geometry.json`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`道具资产加载失败（geometry ${res.status}）`);
      const geo = (await res.json()) as { parts: Record<string, PartGeom> };
      return geo.parts;
    })
    .catch((err: unknown) => {
      partsCache = null;
      throw err;
    });
  return partsCache;
}
