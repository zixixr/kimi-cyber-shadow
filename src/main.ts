// 装配总入口：舞台 + 彩色透光投影 + 真铰接影人 + 手势控制系统 + 场景玩法。
// 场景路由（文档第 7 章）：?scene=shuihu（默认，M4 武松打虎：老虎 AI/第二只手、枯树哨棒、
// 命中判定与音效）；?scene=xiyou（M5 悟空打红孩儿：双手双角色、金箍棒双手握棒、
// 火尖枪、三昧真火、筋斗云、受击/败阵/胜利谢幕演出）。
// 体验增强：传统布景上台（props.ts，酒旗/山石/火云洞厚片衬景）；开场报幕（opening.ts，
// 全暗→渐亮→锣+字幕牌，期间导演/手势输入挂起）；幕后模式（backstage.ts，按 b 侧后机位
// 环绕看灯/幕/皮偶/三根操纵杆 + 投影原理标注，tuner 标定中 b 让位）。
// 控制源：默认摄像头（MediaPipe）；?debug=mouse 强制鼠标调试源；
// 摄像头/模型加载失败优雅降级鼠标源并顶部提示（无摄像头也能开发）。
// ?debug=calib：姿势标定模式（←/→ 切预设 FK 姿势，肉眼核对朝向符号，文档 6.6）。
// 按 t：拖点标定模式（文档第 8 章）——画面定格成标定摆位（西游=悟空持棒定势+红孩儿持续
// 喷火，水浒=主角持哨棒定势），手势/战斗暂停；拖 🔥✊👤💪🦵 改参数实时生效、存 localStorage。
// 主循环：手信号 →（棒断降级改写）→ 导演 → Puppet 公共 API → 玩法判定 → 投影 → 渲染。

import * as THREE from 'three';
import { ShadowProjection, transmissionGuard, type ProjectionHooks } from './stage/projection';
import { buildTheater, LAMP_POS, SCREEN_CY } from './stage/theater';
import { Puppet } from './puppet/assembly';
import { Tiger } from './puppet/tiger';
import { Tree } from './stage/tree';
import { SHUIHU_PROPS, StageProp, XIYOU_PROPS } from './stage/props';
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
import { Opening } from './ui/opening';
import { Backstage } from './ui/backstage';
import { Tuner } from './ui/tuner';
import { loadCalib } from './ui/calibValues';

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
  let tuner: Tuner | null = null; // 拖点标定（场景系统就位后创建；标定中 r = 重置标定值而非重开）
  const guardMats = [...puppet.leather];

  // c = 换幕（水浒 ↔ 西游）：保留 debug 等参数整页重载，对局状态清零（标定模式下让位）
  addEventListener('keydown', (e) => {
    if (e.key !== 'c' || tuner?.visible) return;
    const p = new URLSearchParams(location.search);
    p.set('scene', SCENE === 'xiyou' ? 'shuihu' : 'xiyou');
    location.search = p.toString();
  });

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
    // r = 重开一局：红孩儿满血回场、演出/判定清零（标定模式下 r 让位给标定值重置）
    addEventListener('keydown', (e) => {
      if (e.key !== 'r' || !xiyou || tuner?.visible) return;
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

    // r = 重开一局：老虎复活、枯树立回、哨棒修好、玩法链复位（标定模式下 r 让位给标定值重置）
    addEventListener('keydown', (e) => {
      if (e.key !== 'r' || !battle || tuner?.visible) return;
      tiger?.revive();
      tree?.reset();
      staff?.repair();
      battle.reset();
      sfx.play('gong', { volume: 0.8, rate: 1.2 });
    });
  }

  // ---------- 传统布景上台（酒旗/山石/火云洞）：厚片衬景摆幕后不同进深，材质一并守坑③ ----------
  // 资产缺失时单件跳过不阻塞（布景只是衬景）；摆位表见 props.ts 顶部常量
  for (const placement of SCENE === 'xiyou' ? XIYOU_PROPS : SHUIHU_PROPS) {
    try {
      const prop = await StageProp.load(placement);
      scene.add(prop.group);
      guardMats.push(...prop.leather);
    } catch (err) {
      console.warn(`[props] 布景「${placement.name}」加载失败，本局无此布景`, err);
    }
  }

  // 坑③：投影 pass 期间把皮革 transmission 置 0（主角 + 老虎/红孩儿 + 道具一起守）
  const projectionHooks: ProjectionHooks = transmissionGuard(guardMats);

  const source = await openSource();
  const director = new Director(puppet.armReach);
  const sheet = new CheatSheet(SCENE);

  // 西游每帧复用的临时向量（嘴部/喷口世界坐标）
  const headW = new THREE.Vector3();
  const firePos = new THREE.Vector3();

  // ---------- 拖点标定（t 键，文档第 8 章）：数值中心 + 拖点器 + 定格摆位 ----------
  const calib = loadCalib(); // 标定单例：Tuner 拖动改写，本循环每帧读（实时生效）
  /** 喷火角色（西游=红孩儿；水浒无喷火，🔥 点不显示，👤 回落到主角） */
  const firePuppet = SCENE === 'xiyou' && foe ? foe : puppet;
  /** 当前喷火朝向（正常运行每帧更新；定格时固定为 foeFreeze.facing） */
  let fireFacing: 1 | -1 = -1;
  tuner = new Tuner({
    camera,
    showMouth: SCENE === 'xiyou' && !!fire,
    headWorld: (out) => {
      firePuppet.getJointWorld('head', out);
      return fireFacing;
    },
    staffLine: (o, d) => {
      // 棒线 = 前手关节原点 + 棒杆向下方向（金箍棒/哨棒同挂 joint_hand_f，约定一致）
      const onStage = SCENE === 'xiyou' ? (goldStaff?.onStage ?? false) : (staff?.onStage ?? false);
      const handJ = puppet.group.getObjectByName('joint_hand_f');
      if (!onStage || !handJ) return false;
      handJ.getWorldPosition(o);
      d.set(0, -1, 0).applyQuaternion(handJ.getWorldQuaternion(new THREE.Quaternion())).normalize();
      return true;
    },
    headDot: (out) => firePuppet.getJointWorld('head', out),
    dragHead: (w) => {
      calib.headOff = firePuppet.headOffsetFromWorld(w);
    },
    armTip: (out) => puppet.getJointWorld('hand_f', out),
    dragArm: (w) => {
      const a = new THREE.Vector3();
      if (!puppet.getJointWorld('upper_arm_f', a)) return;
      calib.armScale = Math.min(1.25, Math.max(0.6, a.distanceTo(w) / puppet.restArmReach));
    },
    legTip: (out) => {
      if (!puppet.getJointWorld('leg_f', out)) return false;
      out.y -= puppet.legLength; // 脚底 = 髋 − 当前腿长（定格双腿站直）
      return true;
    },
    dragLeg: (w) => {
      const a = new THREE.Vector3();
      if (!puppet.getJointWorld('leg_f', a)) return;
      calib.legScale = Math.min(1.4, Math.max(0.8, (a.y - w.y) / puppet.restLegLen));
    },
  });
  /** 标定比例（👤💪🦵）常驻生效：拖一次、关掉标定继续看效果（主角 + 红孩儿同套铆位同比例） */
  const applyProportions = (): void => {
    const v = { headOff: calib.headOff, arm: calib.armScale, leg: calib.legScale };
    puppet.setProportions(v);
    foe?.setProportions(v);
  };
  // 定格摆位（静止画面才好拖）：主角持棒定势 + 双腿站直（🦵 标定要脚底正在髋下）；
  // 前手 u=115 e=12 是 goldenstaff.test 同款标定姿势（臂近伸直，💪 标定肩手距≈臂展）。
  const heroFreeze: PuppetControl = {
    active: true,
    state: 'staff',
    gesture: 'sword',
    facing: 1,
    rootX: 0.2,
    rootY: 0.95, // BASE_Y（director 内部常量，复制约定同 battle/xiyou）
    depth: 0.15,
    lean: 0,
    frontFK: { u: 115, e: 12 },
    rearFK: null, // 后手走 IK：西游由 solveRearGrip 解到标定握点；水浒垂放
    frontTarget: { x: 0.03, y: -0.15 },
    rearTarget: { x: 0.03, y: -0.14 },
    legFront: 0,
    legRear: 0,
    moving: false,
  };
  // 红孩儿定格喷火：仰头喷火姿势（xiyou.ts 喷火覆盖层同款），面向悟空持续喷
  const foeFreeze: PuppetControl = {
    active: true,
    state: 'idle',
    gesture: 'open',
    facing: -1,
    rootX: -0.25,
    rootY: 0.95,
    depth: 0.15,
    lean: 0.34,
    frontFK: { u: 18, e: 25 },
    rearFK: { u: -55, e: 30 },
    frontTarget: { x: 0.03, y: -0.15 },
    rearTarget: { x: 0.03, y: -0.14 },
    legFront: 0,
    legRear: 0,
    moving: false,
  };

  // ---------- 开场报幕：全暗 0.6s → 灯 1.2s 渐亮 → 一声锣 + 字幕牌 2.4s 淡出 ----------
  // 报幕期间主循环走门闩分支（导演/手势挂起）；只建一次——r 重开不重播，c 换幕整页重载天然重播
  const opening = new Opening({
    theater,
    dimUniform: projection.screenMaterial.uniforms.dim as { value: number },
    sfx,
    title: SCENE === 'xiyou' ? '孙悟空大战红孩儿 · 火云洞' : '武松打虎 · 景阳冈',
  });

  // ---------- 幕后模式（b 键）：侧后 45° 环绕机位 + 三杆操纵可视化 + 投影原理标注 ----------
  // 人形影人才有杆（主角；西游加红孩儿；老虎非人形不加）；tuner 标定中 b 让位
  const backstage = new Backstage({
    scene,
    camera,
    dom: renderer.domElement,
    puppets: SCENE === 'xiyou' && foe ? [puppet, foe] : [puppet],
    blocked: () => tuner?.visible ?? false,
  });

  // 报幕候场位：导演接管前先把影人各就各位（默认都在 x=0 会重叠成一坨）
  puppet.setPosition(0.2);
  if (SCENE === 'xiyou' && foe) {
    foe.setPosition(-0.25);
    foe.face(-1); // 红孩儿在左、面向悟空
  }

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    theater.update(dt, t);
    applyProportions(); // 👤💪🦵 标定比例常驻生效（含正常运行）

    // ---------- 开场报幕门闩：报幕未完 → 导演/玩法/标定挂起（手势帧丢弃防开演瞬移）， ----------
    // 只推进灯渐亮/字幕牌；投影照常渲（幕布渐亮看得到影人站位），幕后模式此时也可进入
    if (!opening.done) {
      source.read();
      opening.update(dt);
      puppet.update(dt);
      foe?.update(dt);
      backstage.update(dt);
      const depthRatio = THREE.MathUtils.clamp(puppet.group.position.z / LAMP_POS.z, 0, 1);
      projection.update(renderer, scene, depthRatio, projectionHooks);
      renderer.render(scene, camera);
      return;
    }

    // ---------- 拖点标定定格（t 键）：手势/战斗全部暂停，摆位静止好拖 ----------
    if (tuner?.visible) {
      source.read(); // 丢弃手势帧：防关闭标定后信号积压、影人瞬移
      applyControl(puppet, heroFreeze);
      puppet.update(dt);
      if (SCENE === 'xiyou' && foe && goldStaff && spear && cloud && fire) {
        // 悟空持棒定势：后手 IK 解到标定握点（✊ 拖动实时可见）
        goldStaff.setHeld(true);
        goldStaff.update(dt);
        goldStaff.solveRearGrip(puppet, calib.grip);
        spear.setHeld(false); // 收枪，不干扰 🔥 标定
        spear.update(dt, t);
        // 红孩儿定格持续喷火：喷口 = 头关节 + 标定嘴部偏移（🔥 拖动实时可见）
        applyControl(foe, foeFreeze);
        foe.update(dt);
        fireFacing = foeFreeze.facing;
        if (foe.getJointWorld('head', headW)) {
          const o = fireOrigin(headW, fireFacing, calib.mouth);
          firePos.set(o.x, o.y, o.z);
          fire.emit(firePos, facingDirX(fireFacing));
        }
        fire.update(dt);
        cloud.update(null);
      } else if (staff) {
        // 水浒：主角持哨棒定势（棒已断则无棒，✊ 点自动隐藏）
        staff.setHeld(!battle?.staffBroken);
        staff.update(dt);
      }
      tuner.update();
      backstage.update(dt); // 标定中 b 已让位，这里只兜「标定前已在幕后」的机位/杆/标注
      const depthRatio = THREE.MathUtils.clamp(puppet.group.position.z / LAMP_POS.z, 0, 1);
      projection.update(renderer, scene, depthRatio, projectionHooks);
      renderer.render(scene, camera);
      return;
    }

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
      // 金箍棒：剑指持棒；握棒拍后手 IK 解到棒线（前臂 FK 定格后，场景图矩阵 worldToLocal）；
      // 握距读标定单例（✊ 拖点实时覆盖 GRIP_DIST 默认值）
      goldStaff!.setHeld(xf.staffHeld);
      goldStaff!.update(dt);
      if (xf.grip) goldStaff!.solveRearGrip(puppet, calib.grip);
      // 火尖枪：红孩儿剑指持枪
      spear!.setHeld(xf.spearHeld);
      spear!.update(dt, t);
      // 红孩儿本体（第二只手 / AI 控制量）
      applyControl(foe, xf.foe);
      foe.update(dt);
      // 三昧真火：嘴部喷口持续喷（第二只手张开 / AI 喷火拍）；
      // 嘴部偏移读标定单例（🔥 拖点实时覆盖 MOUTH_OFF 默认值）
      fireFacing = xf.fireFacing;
      if (xf.fireActive && foe.getJointWorld('head', headW)) {
        const o = fireOrigin(headW, xf.fireFacing, calib.mouth);
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

    backstage.update(dt); // 幕后模式：机位环绕/操纵杆/标注逐帧跟随（前台态无副作用）

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
