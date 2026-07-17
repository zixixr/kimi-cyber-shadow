// 装配总入口：舞台 + 彩色透光投影 + 真铰接影人 + 手势控制系统 + 场景玩法。
// 场景路由（文档第 7 章）：?scene=shuihu（默认，M4 武松打虎：老虎 AI/第二只手、枯树哨棒、
// 命中判定与音效）；?scene=xiyou（M5 悟空打红孩儿：双手双角色、金箍棒双手握棒、
// 火尖枪、三昧真火、筋斗云、受击/败阵/胜利谢幕演出）。
// 控制源：默认摄像头（MediaPipe）；?debug=mouse 强制鼠标调试源；
// 摄像头/模型加载失败优雅降级鼠标源并顶部提示（无摄像头也能开发）。
// ?debug=calib：姿势标定模式（←/→ 切预设 FK 姿势，肉眼核对朝向符号，文档 6.6）。
// 主循环：手信号 →（棒断降级改写）→ 导演 → Puppet 公共 API → 玩法判定 → 投影 → 渲染。

import * as THREE from 'three';
import { ShadowProjection, transmissionGuard, type ProjectionHooks } from './stage/projection';
import { buildTheater, LAMP_POS, SCREEN_CY } from './stage/theater';
import { Puppet } from './puppet/assembly';
import { Tiger } from './puppet/tiger';
import { Tree } from './stage/tree';
import { Staff } from './stage/staff';
import { Sfx } from './audio/sfx';
import { Battle, degradeSignals, heroAttack } from './game/battle';
import { Xiyou, facingDirX, fireOrigin, type XiyouFrame } from './game/xiyou';
import { Director, type PuppetControl } from './hand/director';
import { MediaPipeSource } from './hand/mediapipe';
import { MouseDebugSource, type HandSource } from './hand/source';
import { FireBreath } from './stage/fire';
import { GoldenStaff } from './stage/goldenstaff';
import { FireSpear } from './stage/spear';
import { SomersaultCloud } from './stage/cloud';
import { CalibMode } from './ui/calib';
import { CheatSheet } from './ui/cheatsheet';

const PARAMS = new URLSearchParams(location.search);
const DEBUG = PARAMS.get('debug');
/** 场景：shuihu=武松打虎（默认） / xiyou=悟空打红孩儿 */
const SCENE: 'shuihu' | 'xiyou' = PARAMS.get('scene') === 'xiyou' ? 'xiyou' : 'shuihu';

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

// ---------- 影人（水浒 wusheng 套 / 西游 wukong 套） + 控制系统 + 玩法 + 主循环 ----------
async function main() {
  // 主角影人：水浒=武松（wusheng 套），西游=悟空（wukong 套）
  const puppet = await Puppet.load(SCENE === 'xiyou' ? 'wukong' : 'wusheng');
  scene.add(puppet.group);

  // ?debug=calib：姿势标定模式（不接控制系统/玩法，导演/对照表不上场）
  if (DEBUG === 'calib') {
    // 坑③：投影 pass 期间把皮革 transmission 置 0，否则透明 RT 里渲成黑
    const projectionHooks: ProjectionHooks = transmissionGuard(puppet.leather);
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

  // ---------- 音效（两场景通用；首次用户交互后解锁 + BGM 锣鼓循环开播）----------
  const sfx = new Sfx();
  const sfxReady = sfx.init().catch((err) => console.warn('[sfx] 初始化失败，本局无声', err));
  const unlock = () => void sfxReady.then(() => sfx.unlock());
  addEventListener('pointerdown', unlock, { once: true });
  addEventListener('keydown', unlock, { once: true });

  // ---------- 水浒场景系统（M4）：老虎 + 枯树 + 哨棒 + 玩法链 ----------
  let tiger: Tiger | null = null;
  let tree: Tree | null = null;
  let staff: Staff | null = null;
  let battle: Battle | null = null;
  // ---------- 西游场景系统（M5）：红孩儿 + 金箍棒 + 火尖枪 + 筋斗云 + 三昧真火 ----------
  let foe: Puppet | null = null; // 红孩儿（二号影人，第二只手 / AI 控制）
  let goldStaff: GoldenStaff | null = null;
  let spear: FireSpear | null = null;
  let cloud: SomersaultCloud | null = null;
  let fire: FireBreath | null = null;
  let xiyou: Xiyou | null = null;
  const guardMats = [...puppet.leather];

  if (SCENE === 'xiyou') {
    try {
      foe = await Puppet.load('honghaier');
      scene.add(foe.group);
      goldStaff = new GoldenStaff();
      goldStaff.attach(puppet);
      spear = new FireSpear();
      spear.attach(foe);
      cloud = new SomersaultCloud();
      cloud.attach(puppet);
      fire = new FireBreath(scene);
      xiyou = new Xiyou(foe.armReach);
      guardMats.push(...foe.leather, ...goldStaff.leather, ...spear.leather);
    } catch (err) {
      // 红孩儿资产缺失：优雅降级排练模式（主角可控，无玩法链）
      console.warn('[xiyou] 红孩儿资产加载失败，本局仅排练', err);
      showToast('红孩儿资产加载失败，本局仅排练（主角可控）');
      foe?.group.removeFromParent(); // 部分挂载失败时已入场的影人一并清掉
      foe = null;
      goldStaff = null;
      spear = null;
      cloud = null;
      fire = null;
      xiyou = null;
    }
    // r = 重开一局：红孩儿满血回场、演出/判定清零
    addEventListener('keydown', (e) => {
      if (e.key !== 'r' || !xiyou) return;
      xiyou.reset();
      sfx.play('gong', { volume: 0.8, rate: 1.2 });
    });
  } else {
    try {
      tiger = await Tiger.load();
      scene.add(tiger.group);
    } catch (err) {
      console.warn('[shuihu] 老虎资产加载失败，本局无老虎', err);
      showToast('老虎资产加载失败，本局无老虎（仅排练）');
    }
    try {
      tree = await Tree.load();
      scene.add(tree.group);
    } catch (err) {
      console.warn('[shuihu] 枯树资产加载失败，本局无枯树', err);
    }
    staff = new Staff();
    staff.attach(puppet);
    battle = new Battle();
    if (tiger) guardMats.push(...tiger.leather);
    if (tree) guardMats.push(...tree.leather);
    guardMats.push(...staff.leather);

    // r = 重开一局：老虎复活、枯树立回、哨棒修好、玩法链复位
    addEventListener('keydown', (e) => {
      if (e.key !== 'r' || !battle) return;
      tiger?.revive();
      tree?.reset();
      staff?.repair();
      battle.reset();
      sfx.play('gong', { volume: 0.8, rate: 1.2 });
    });
  }

  // 坑③：投影 pass 期间把皮革 transmission 置 0（主角 + 老虎/红孩儿 + 道具一起守）
  const projectionHooks: ProjectionHooks = transmissionGuard(guardMats);

  const source = await openSource();
  const director = new Director(puppet.armReach);
  const sheet = new CheatSheet(SCENE);

  // 西游每帧复用的临时向量（嘴部/喷口世界坐标）
  const headW = new THREE.Vector3();
  const firePos = new THREE.Vector3();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    theater.update(dt, t);

    // 手信号 →（棒断后剑指降级拳脚）→ 导演 → 主角影人
    let signals = source.read();
    if (battle) signals = degradeSignals(signals, battle.staffBroken);
    const frame = director.update(dt, t, signals);

    // 虎扑命中主角的击退演出：根位置 + 倾身加衰减偏移
    if (battle) {
      const f = battle.flinch();
      frame.hero.rootX += f.dx;
      frame.hero.lean += f.lean;
    }
    // 西游玩法：第二角色路由/AI、命中判定、演出覆盖层（原地改写 frame.hero）
    const xf: XiyouFrame | null = xiyou && foe ? xiyou.update(dt, t, frame.hero, frame.second) : null;
    applyControl(puppet, frame.hero);
    puppet.update(dt);

    // ---------- 西游玩法：金箍棒 / 双手握棒 / 火尖枪 / 筋斗云 / 三昧真火 ----------
    if (xf && foe) {
      // 金箍棒：剑指持棒；握棒拍后手 IK 解到棒线（前臂 FK 定格后，场景图矩阵 worldToLocal）
      goldStaff!.setHeld(xf.staffHeld);
      goldStaff!.update(dt);
      if (xf.grip) goldStaff!.solveRearGrip(puppet);
      // 火尖枪：红孩儿剑指持枪
      spear!.setHeld(xf.spearHeld);
      spear!.update(dt, t);
      // 红孩儿本体（第二只手 / AI 控制量）
      applyControl(foe, xf.foe);
      foe.update(dt);
      // 三昧真火：嘴部喷口持续喷（第二只手张开 / AI 喷火拍）
      if (xf.fireActive && foe.getJointWorld('head', headW)) {
        const o = fireOrigin(headW, xf.fireFacing);
        firePos.set(o.x, o.y, o.z);
        fire!.emit(firePos, facingDirX(xf.fireFacing));
      }
      fire!.update(dt);
      // 筋斗云：跳跃进度驱动，云高动态贴脚
      cloud!.update(xiyou!.cloudP);
      // 音效：锣=命中、太鼓=出招、吼=喷火、败阵=双声降调大锣
      if (xf.ev.drum) sfx.play('drum', { volume: 0.7, rate: xf.ev.drum === 'kick' ? 0.8 : 1 });
      if (xf.ev.foeDrum) sfx.play('drum', { volume: 0.5, rate: 1.1 });
      if (xf.ev.foeHit) sfx.play('gong', { volume: 0.9, minGap: 0.2 });
      if (xf.ev.heroBurned || xf.ev.foeStruck) sfx.play('gong', { volume: 0.6, rate: 1.3, minGap: 0.2 });
      if (xf.ev.fireStart) sfx.play('roar', { volume: 0.7, rate: 1.3, minGap: 0.5 });
      if (xf.ev.foeDied) {
        sfx.play('gong', { volume: 1, rate: 0.6 });
        setTimeout(() => sfx.play('gong', { volume: 0.7, rate: 0.5 }), 500);
      }
    }

    // ---------- 水浒玩法：老虎 / 枯树 / 哨棒 / 命中判定 / 音效 ----------
    if (battle) {
      staff!.setHeld(frame.hero.state === 'staff' && !battle.staffBroken);
      staff!.update(dt);
      if (tiger) {
        // 第二只手 = 老虎（active=false 时 AI 自动接管）
        tiger.setControl(frame.second.active ? frame.second : null);
        tiger.update(dt, t, frame.hero.rootX);
        if (tiger.justPounced || tiger.justRoared) sfx.play('roar', { volume: 0.9 });
      }
      tree?.update(dt);

      // 命中判定：攻击拍力度峰值 + 面向 + 射程（棒 0.5m / 拳 0.3m）
      const atk = heroAttack(frame.hero.state, t);
      const ev = battle.update(dt, t, atk, frame.hero.rootX, frame.hero.facing, tiger, tree);
      if (ev.drum) sfx.play('drum', { volume: 0.7, rate: ev.drum === 'kick' ? 0.8 : 1 });
      if (ev.treeCrack) {
        sfx.play('crack', { volume: ev.treeCrack === 'broke' ? 1 : 0.5, rate: ev.treeCrack === 'broke' ? 0.9 : 1.4 });
        if (ev.treeCrack === 'broke') staff!.breakOff(scene); // 树倒棒断（水浒名场面）
      }
      if (ev.tigerHit) sfx.play('gong', { volume: 0.9, minGap: 0.2 });
      if (ev.tigerDied) {
        // 伏诛：双声降调大锣
        sfx.play('gong', { volume: 1, rate: 0.6 });
        setTimeout(() => sfx.play('gong', { volume: 0.7, rate: 0.5 }), 500);
      }
    }

    sheet.update({
      gesture: signals.length > 0 ? frame.hero.gesture : null,
      state: frame.hero.state,
      hands: signals.length,
      source: source.name,
      battle: battle
        ? battle.statusLine(tiger, tree, t)
        : xiyou
          ? xiyou.statusLine(frame.second.active, t)
          : undefined,
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
