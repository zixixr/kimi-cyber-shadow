// 装配总入口（M0）：渲染器 + 主相机 + 舞台 + 彩色透光投影 + 占位假影人。
// 主循环每帧：舞台动画 → 摆动占位影人 → 更新投影 → 渲染主画面。

import * as THREE from 'three';
import { ShadowProjection, transmissionGuard, type ProjectionHooks } from './stage/projection';
import { buildTheater, LAMP_POS, SCREEN_CY } from './stage/theater';

// ---------- 渲染器 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

// ---------- 场景与主相机（观众视角，幕前）----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0806);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 30);
camera.position.set(0, SCREEN_CY, -2.3);
camera.lookAt(0, SCREEN_CY, 0);
camera.layers.enable(1); // 同时看 layer 0（舞台）与 layer 1（影人本体）

// ---------- 舞台 + 投影 ----------
const projection = new ShadowProjection();
const theater = buildTheater(projection.screenMaterial);
scene.add(theater.group);

// ---------- 占位假影人 ----------
// TODO(M2)：由真正的铰接 Puppet（src/puppet/assembly.ts）替换。
// 替换要点：新影人同样放 layer 1、材质用 MeshPhysicalMaterial（皮革透光），
// 并把材质列表交给 transmissionGuard 生成投影钩子即可。
interface PlaceholderPuppet {
  group: THREE.Group;
  leather: THREE.MeshPhysicalMaterial[];
}

function buildPlaceholderPuppet(): PlaceholderPuppet {
  const group = new THREE.Group();
  const leather: THREE.MeshPhysicalMaterial[] = [];

  // 三块彩色厚片拼一个小武将：头（赭黄）、躯干（朱红）、哨棒（石绿）
  const head = new THREE.Shape();
  head.absarc(0, 0.5, 0.065, 0, Math.PI * 2, false);

  const torso = new THREE.Shape();
  torso.moveTo(-0.1, 0.44);
  torso.lineTo(0.1, 0.44);
  torso.lineTo(0.16, 0.06);
  torso.lineTo(-0.16, 0.06);
  torso.closePath();

  const staff = new THREE.Shape();
  staff.moveTo(0.2, 0.1);
  staff.lineTo(0.235, 0.1);
  staff.lineTo(0.235, 0.62);
  staff.lineTo(0.2, 0.62);
  staff.closePath();

  const parts: Array<[THREE.Shape, number]> = [
    [head, 0xd9a441],
    [torso, 0x9e2b25],
    [staff, 0x2f6e4f],
  ];
  for (const [shape, color] of parts) {
    // 2mm 厚片，transmission 模拟皮革透光（投影 pass 期间会被钩子临时置 0）
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.002, bevelEnabled: false });
    const mat = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.6,
      transmission: 0.45,
      thickness: 0.002,
      side: THREE.DoubleSide,
    });
    leather.push(mat);
    group.add(new THREE.Mesh(geo, mat));
  }

  group.traverse((o) => o.layers.set(1)); // 影人层
  group.position.set(0, SCREEN_CY - 0.33, 0.3);
  return { group, leather };
}

const puppet = buildPlaceholderPuppet();
scene.add(puppet.group);

// 坑③：投影 pass 期间把皮革 transmission 置 0，否则透明 RT 里渲成黑
const projectionHooks: ProjectionHooks = transmissionGuard(puppet.leather);

// ---------- 主循环 ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  theater.update(dt, t);

  // 占位影人：缓慢左右移动 + 前后呼吸，展示「近灯虚、贴幕锐」的景深变化
  puppet.group.position.x = Math.sin(t * 0.45) * 0.55;
  puppet.group.position.z = 0.35 + 0.33 * Math.sin(t * 0.2);
  const depthRatio = THREE.MathUtils.clamp(puppet.group.position.z / LAMP_POS.z, 0, 1);

  projection.update(renderer, scene, depthRatio, projectionHooks);
  renderer.render(scene, camera);
});

// ---------- 自适应窗口 ----------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
