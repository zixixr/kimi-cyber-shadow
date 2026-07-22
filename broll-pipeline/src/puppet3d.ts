// 复刻主项目 src/puppet/assembly.ts 的真实装配：outline → ExtrudeGeometry 2mm 厚片 →
// 铆点对齐关节树。材质简化为 MeshStandard（B-roll 打光更干净），几何/装配数学与主项目一致。
import * as THREE from 'three';
import type { Assets, PartGeom, PivotDef } from './assets';
import { dyeURL, alphaURL } from './assets';

export const THICK = 0.002; // 皮片厚度 2mm（与主项目一致）
const LAYER_STEP = 0.0007;
const DYE_DARKEN_FACTOR = 0.45; // 同主项目 assembly.ts：tan 插领桩压暗系数

/**
 * dye 贴图运行时压暗（复刻主项目 cookDyeTexture）：把 def.dyeDarken 矩形整体 multiply 压暗。
 * 头件底部 tan 插领桩压到领口染色皮同调 → 3D 装配视图里不再是「过长发亮的脖子」，头身相连。
 * 无 dyeDarken 时原样返回。
 */
function cookDye(tex: THREE.Texture, def: PivotDef): THREE.Texture {
  const rects = def.dyeDarken;
  if (!rects || rects.length === 0) return tex;
  const img = tex.image as HTMLImageElement;
  const w = img.width;
  const h = img.height;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  const g = Math.round(DYE_DARKEN_FACTOR * 255);
  ctx.fillStyle = `rgb(${g},${g},${g})`;
  for (const [u0, v0, u1, v1] of rects) ctx.fillRect(u0 * w, v0 * h, (u1 - u0) * w, (v1 - v0) * h);
  const out = new THREE.CanvasTexture(cv);
  out.flipY = tex.flipY;
  out.colorSpace = tex.colorSpace;
  return out;
}

/**
 * alpha 贴图运行时加工（复刻主项目 cookAlphaTexture）：def.erase 矩形涂透明——遮住暴露在外的
 * 素皮连接桩（前胸领口的 tan 插领桩）。主项目在投影里靠它 + 头件压暗消颈部亮带；B-roll 3D
 * 装配视图同理：不涂透明则 tan 连接桩露出来读作「过长发亮的脖子」。无 erase 时原样返回。
 */
function cookAlpha(tex: THREE.Texture, def: PivotDef): THREE.Texture {
  const rects = def.erase;
  if (!rects || rects.length === 0) return tex;
  const img = tex.image as HTMLImageElement;
  const w = img.width;
  const h = img.height;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  for (const [u0, v0, u1, v1] of rects) ctx.clearRect(u0 * w, v0 * h, (u1 - u0) * w, (v1 - v0) * h);
  const out = new THREE.CanvasTexture(cv);
  out.flipY = tex.flipY;
  out.colorSpace = tex.colorSpace;
  return out;
}

export interface Part3D {
  name: string;
  def: PivotDef;
  joint: THREE.Group;
  mesh: THREE.Mesh;
  baseJointPos: THREE.Vector3;
}

interface Tex {
  dye: THREE.Texture;
  alpha: THREE.Texture;
}

/** outline → 厚片网格。geometry z 归一化到 [0,1]，mesh.scale.z = 世界厚度 → 可动画"长厚"。 */
function buildMesh(geom: PartGeom, def: PivotDef, tex: Tex, thickWorld: number): THREE.Mesh {
  const shape = new THREE.Shape();
  geom.outline.forEach(([x, y], i) => {
    if (i === 0) shape.moveTo(x, 1 - y);
    else shape.lineTo(x, 1 - y);
  });
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });

  const face = new THREE.MeshStandardMaterial({
    map: tex.dye,
    alphaMap: tex.alpha,
    alphaTest: 0.5,
    transparent: false,
    roughness: 0.62,
    metalness: 0.0,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0x2a1c0e),
    emissiveIntensity: 0.35,
  });
  // 侧壁（2mm 断面）：实心皮革棕，避免拉伸贴图脏色
  const wall = new THREE.MeshStandardMaterial({
    color: 0x8a5a28,
    roughness: 0.72,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, [face, wall]);
  const s = def.height;
  mesh.scale.set(def.flipX ? -s : s, s, thickWorld);
  return mesh;
}

export interface Puppet3D {
  group: THREE.Group;
  parts: Map<string, Part3D>;
  box: THREE.Box3;
}

/** 组装全套（rest pose）。thickWorld 可放大厚度用于强调。 */
export async function buildPuppet(assets: Assets, thickWorld = THICK): Promise<Puppet3D> {
  const { parts: geoms, pivots } = assets;
  const loader = new THREE.TextureLoader();
  const artKeys = new Set<string>();
  for (const [name, def] of Object.entries(pivots)) artKeys.add(def.art ?? name);
  const texs: Record<string, Tex> = {};
  await Promise.all(
    [...artKeys].map(async (k) => {
      const [dye, alpha] = await Promise.all([loader.loadAsync(dyeURL(k)), loader.loadAsync(alphaURL(k))]);
      dye.colorSpace = THREE.SRGBColorSpace;
      texs[k] = { dye, alpha };
    }),
  );

  const group = new THREE.Group();
  const parts = new Map<string, Part3D>();

  // 1) 建件
  for (const [name, def] of Object.entries(pivots)) {
    const joint = new THREE.Group();
    joint.name = `joint_${name}`;
    joint.rotation.z = def.rest ?? 0;
    const artKey = def.art ?? name;
    const geom = geoms[artKey];
    const baseTex = texs[artKey];
    // 与主项目 load() 一致：erase 涂透明（藏连接桩）+ dyeDarken 压暗（头件插领桩）
    const tex =
      def.erase?.length || def.dyeDarken?.length
        ? { dye: cookDye(baseTex.dye, def), alpha: cookAlpha(baseTex.alpha, def) }
        : baseTex;
    const mesh = buildMesh(geom, def, tex, thickWorld);
    const s = def.height;
    mesh.position.set(
      (def.flipX ? 1 : -1) * def.pivotInSelf[0] * s,
      -(1 - def.pivotInSelf[1]) * s,
      def.layer * LAYER_STEP,
    );
    joint.add(mesh);
    parts.set(name, { name, def, joint, mesh, baseJointPos: new THREE.Vector3() });
  }

  // 2) 组树
  for (const [name, def] of Object.entries(pivots)) {
    const p = parts.get(name)!;
    if (!def.parent) {
      group.add(p.joint);
      p.baseJointPos.copy(p.joint.position);
      continue;
    }
    const parentDef = pivots[def.parent];
    const ps = parentDef.height;
    p.joint.position.set(
      (def.pivotInParent[0] - parentDef.pivotInSelf[0]) * ps,
      (parentDef.pivotInSelf[1] - def.pivotInParent[1]) * ps,
      0,
    );
    parts.get(def.parent)!.joint.add(p.joint);
    p.baseJointPos.copy(p.joint.position);
  }

  // 头件插领修正：映射主项目 src/ui/calibValues.ts 固化的拖点标定 headOff
  // （父件局部系·米；y 负 = 头下移插进领口）。头父件是 chest（无缩放），joint 局部系
  // 即世界米尺度，故直接叠加。装配视图里头茬坐进领口、不再是过长脖子。
  // 基准源：optics_front.mp4（脖颈正确的基准）。
  const HEAD_OFF = { x: -0.003295490847335206, y: -0.03255358664527788 };
  const headPart = parts.get('head');
  if (headPart) {
    headPart.joint.position.x += HEAD_OFF.x;
    headPart.joint.position.y += HEAD_OFF.y;
    headPart.baseJointPos.copy(headPart.joint.position);
  }

  group.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(group);
  return { group, parts, box };
}

/** 单件（clip4 用）：几何居中于原点，返回 mesh + 世界 bbox 尺寸。可动态设厚度。 */
export async function buildSinglePart(
  assets: Assets,
  name: string,
): Promise<{ mesh: THREE.Mesh; setThickness(t: number): void; size: THREE.Vector3; geoBox: THREE.Box3 }> {
  const def = assets.pivots[name];
  const artKey = def.art ?? name;
  const loader = new THREE.TextureLoader();
  const [dye, alpha] = await Promise.all([loader.loadAsync(dyeURL(artKey)), loader.loadAsync(alphaURL(artKey))]);
  dye.colorSpace = THREE.SRGBColorSpace;
  const mesh = buildMesh(assets.parts[artKey], def, { dye: cookDye(dye, def), alpha }, THICK);
  // 居中：把几何 x,y 包围盒中心移到原点（scale 已应用于 mesh，故乘 height）
  const s = def.height;
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox!;
  const midX = (bb.min.x + bb.max.x) / 2;
  const midY = (bb.min.y + bb.max.y) / 2;
  mesh.position.set(-midX * mesh.scale.x, -midY * s, 0);
  const size = new THREE.Vector3((bb.max.x - bb.min.x) * s, (bb.max.y - bb.min.y) * s, THICK);
  return {
    mesh,
    setThickness(t: number) {
      mesh.scale.z = t;
    },
    size,
    geoBox: bb.clone(),
  };
}
