// 装配总入口（M3）：舞台 + 彩色透光投影 + 真铰接影人（wusheng 套）+ 手势控制系统。
// 控制源：默认摄像头（MediaPipe）；?debug=mouse 强制鼠标调试源；
// 摄像头/模型加载失败优雅降级鼠标源并顶部提示（无摄像头也能开发）。
// ?debug=calib：姿势标定模式（←/→ 切预设 FK 姿势，肉眼核对朝向符号，文档 6.6）。
// 主循环：手信号 → 导演（运动层+手势状态机）→ Puppet 公共 API → 投影 → 渲染；对照表常驻。

import * as THREE from 'three';
import { ShadowProjection, transmissionGuard, type ProjectionHooks } from './stage/projection';
import { buildTheater, LAMP_POS, SCREEN_CY } from './stage/theater';
import { Puppet } from './puppet/assembly';
import { Director, type PuppetControl } from './hand/director';
import { MediaPipeSource } from './hand/mediapipe';
import { MouseDebugSource, type HandSource } from './hand/source';
import { CalibMode } from './ui/calib';
import { CheatSheet } from './ui/cheatsheet';

const DEBUG = new URLSearchParams(location.search).get('debug');

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

/** 导演输出 → Puppet 公共 API。FK 优先（文档 6.5）；仅 FK 为 null 时走 IK 指向。 */
function applyControl(p: Puppet, c: PuppetControl): void {
  p.setPosition(c.rootX, c.rootY);
  p.setDepth(c.depth);
  p.face(c.facing);
  p.setLean(c.lean);
  if (c.frontFK) p.setArmPose(c.frontFK.u, c.frontFK.e, 'front');
  else p.pointAt(c.frontTarget, 'front');
  if (c.rearFK) p.setArmPose(c.rearFK.u, c.rearFK.e, 'back');
  else p.pointAt(c.rearTarget, 'back');
  p.setLegPose(c.legFront, c.legRear);
}

/** 打开手信号源：?debug=mouse 强制鼠标；否则先试摄像头，失败优雅降级鼠标源 */
async function openSource(): Promise<HandSource> {
  if (DEBUG === 'mouse') {
    const s = new MouseDebugSource();
    await s.start();
    return s;
  }
  try {
    const s = new MediaPipeSource();
    await s.start();
    return s;
  } catch (err) {
    // 优雅降级：无权限 / 无摄像头 / wasm 或模型下载失败 → 鼠标调试源
    console.warn('[hand] 摄像头源启动失败，已降级鼠标调试源（等同 ?debug=mouse）', err);
    showToast('摄像头不可用（权限被拒绝或模型加载失败），已切换鼠标调试源：移动=走位 · 滚轮=远近 · p=切手势 · 左键拖动=指向');
    const s = new MouseDebugSource();
    await s.start();
    return s;
  }
}

/** 顶部提示条（摄像头降级等），常驻 */
function showToast(text: string): void {
  const div = document.createElement('div');
  div.style.cssText =
    'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:20;' +
    'background:rgba(10,8,6,0.88);border:1px solid #c8a05a66;border-radius:4px;' +
    'color:#f5e8d0;font:13px/1.6 "Songti SC",serif;padding:8px 14px;max-width:72%;text-align:center';
  div.textContent = text;
  document.body.appendChild(div);
}

// ---------- 影人（wusheng 套） + 控制系统 + 主循环 ----------
async function main() {
  const puppet = await Puppet.load('wusheng');
  scene.add(puppet.group);

  // 坑③：投影 pass 期间把皮革 transmission 置 0，否则透明 RT 里渲成黑
  const projectionHooks: ProjectionHooks = transmissionGuard(puppet.leather);

  // ?debug=calib：姿势标定模式（不接控制系统，导演/对照表不上场）
  if (DEBUG === 'calib') {
    puppet.face(1);
    const calib = new CalibMode(puppet);
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.05);
      theater.update(dt, clock.elapsedTime);
      calib.update();
      puppet.update(dt);
      const depthRatio = THREE.MathUtils.clamp(puppet.group.position.z / LAMP_POS.z, 0, 1);
      projection.update(renderer, scene, depthRatio, projectionHooks);
      renderer.render(scene, camera);
    });
    return;
  }

  const source = await openSource();
  const director = new Director(puppet.armReach);
  const sheet = new CheatSheet();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    theater.update(dt, t);

    // 手信号 → 导演 → 主角影人（第二只手的意图本阶段只路由不驱动，M4/M5 接管）
    const signals = source.read();
    const frame = director.update(dt, t, signals);
    applyControl(puppet, frame.hero);
    puppet.update(dt);

    sheet.update({
      gesture: signals.length > 0 ? frame.hero.gesture : null,
      state: frame.hero.state,
      hands: signals.length,
      source: source.name,
    });

    const depthRatio = THREE.MathUtils.clamp(puppet.group.position.z / LAMP_POS.z, 0, 1);
    projection.update(renderer, scene, depthRatio, projectionHooks);
    renderer.render(scene, camera);
  });
}

main().catch((err) => {
  // 资产/控制源彻底失败：在幕前给出明确错误，不把异常吞进动画循环
  console.error('启动失败', err);
  const div = document.createElement('div');
  div.style.cssText =
    'position:fixed;top:12px;left:12px;color:#f5e8d0;font:14px/1.5 monospace;white-space:pre;z-index:30';
  div.textContent = `启动失败：${String(err)}`;
  document.body.appendChild(div);
});

// ---------- 自适应窗口 ----------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
