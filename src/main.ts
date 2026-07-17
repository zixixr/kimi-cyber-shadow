// 装配总入口（M2）：渲染器 + 主相机 + 舞台 + 彩色透光投影 + 真铰接影人（wusheng 套）。
// 主循环每帧：舞台动画 → 影人演示动作（手臂 FK 摆动 + 缓慢走位）→ 更新投影 → 渲染主画面。

import * as THREE from 'three';
import { ShadowProjection, transmissionGuard, type ProjectionHooks } from './stage/projection';
import { buildTheater, LAMP_POS, SCREEN_CY } from './stage/theater';
import { Puppet } from './puppet/assembly';

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

// ---------- 影人（wusheng 套，真铰接） + 主循环 ----------
async function main() {
  const puppet = await Puppet.load('wusheng');
  scene.add(puppet.group);

  // 坑③：投影 pass 期间把皮革 transmission 置 0，否则透明 RT 里渲成黑
  const projectionHooks: ProjectionHooks = transmissionGuard(puppet.leather);

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    theater.update(dt, t);

    // 演示动作：缓慢左右走位（被动摆锤腿自然甩动），到端点转向；
    // 前手 FK 亮相摆动（u=抬臂角/e=肘弯角，文档 6.5 约定），后手微曲配合；
    // 进深来回变化，展示「近灯虚、贴幕锐」的景深签名。
    const px = Math.sin(t * 0.3) * 0.55;
    puppet.setPosition(px);
    puppet.face(Math.cos(t * 0.3) > 0 ? -1 : 1); // 始终面向走位方向
    puppet.setDepth(0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.17)));
    puppet.setArmPose(75 + 45 * Math.sin(t * 1.6), 18 + 12 * Math.sin(t * 1.6 + 1), 'front');
    puppet.setArmPose(20 + 8 * Math.sin(t * 0.8), 25, 'back');
    puppet.setLean(Math.sin(t * 0.6) * 0.25);
    puppet.update(dt);

    const depthRatio = THREE.MathUtils.clamp(puppet.group.position.z / LAMP_POS.z, 0, 1);
    projection.update(renderer, scene, depthRatio, projectionHooks);
    renderer.render(scene, camera);
  });
}

main().catch((err) => {
  // 资产加载失败：在幕前给出明确错误，不把异常吞进动画循环
  console.error('影人资产加载失败', err);
  const div = document.createElement('div');
  div.style.cssText =
    'position:fixed;top:12px;left:12px;color:#f5e8d0;font:14px/1.5 monospace;white-space:pre';
  div.textContent = `影人资产加载失败：${String(err)}`;
  document.body.appendChild(div);
});

// ---------- 自适应窗口 ----------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
